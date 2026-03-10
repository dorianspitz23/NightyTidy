# Race Condition & Concurrency Audit Report

**Run**: 01
**Date**: 2026-03-10
**Auditor**: Claude Opus 4.6
**Test count before**: 430 (40 files) | **After**: 437 (41 files) | All passing

---

## 1. Executive Summary

**Safety Level: SAFE**

NightyTidy is a single-process, single-threaded Node.js CLI tool. It has no database, no distributed cache, no queue system, and no frontend beyond a local progress dashboard. The primary concurrency concern is **inter-process coordination** between separate NightyTidy invocations (prevented by the lock file) and **orchestrator mode** where multiple process invocations share state via a JSON file.

**At 100 concurrent invocations, these things WILL go wrong:**
- Orchestrator `--run-step` calls executed in parallel would lose step results (state file last-writer-wins)
- Lock file ENOENT crash during override prompt (now fixed)
- Dashboard `server.address()` crash if `stopDashboard()` fires during listen (now fixed)

**Race conditions found**: 3 fixed, 6 documented (all mitigated by existing design)

---

## 2. Shared Mutable State

### Module-Level Singletons

| Module | Mutable State | Read By | Written By | Risk | Assessment |
|--------|--------------|---------|------------|------|------------|
| `logger.js` | `logFilePath`, `minLevel`, `logQuiet` | All modules via `info()`/`warn()`/`error()` | `initLogger()` (once per process) | Stale config if re-initialized | **Safe** — single init per process, `appendFileSync` is atomic |
| `git.js` | `git`, `projectRoot` | All git operations | `initGit()` (once per process) | Null reference if used before init | **Safe** — init order enforced by `cli.js`/`orchestrator.js` |
| `dashboard.js` | `server`, `sseClients`, `currentState`, `urlFilePath`, `progressFilePath`, `shutdownTimer`, `tuiProcess`, `csrfToken` | HTTP handlers, `updateDashboard()`, `stopDashboard()` | `startDashboard()`, `updateDashboard()`, `stopDashboard()` | Multiple mutation points | **Safe** — single-threaded event loop; all access is synchronous within individual operations |
| `report.js` | `cachedVersion` | `getVersion()` | `getVersion()` (lazy init) | Re-read on empty string version | **Negligible** — `package.json` always has a version |
| `dashboard-standalone.js` | `currentState`, `currentStateJson`, `pollTimer` | HTTP handlers, SIGTERM handler | `pollProgress()`, listen callback | Shared between poll and HTTP | **Safe** — single-threaded |

### Request-Scoped State Leaks

None found. NightyTidy is a CLI tool, not a server handling concurrent requests. The HTTP dashboard serves read-only progress data and has no request-scoped state.

### Fixes Applied

1. **`dashboard.js:162` — Guard `server.address()` against null server** (listen/stop race)
   - Before: `const port = server.address().port;` — crashes if `stopDashboard()` nulled `server` before callback
   - After: Added `if (!server) { resolve({ url: null, port: null }); return; }` check

2. **`dashboard.js:254` — Clear existing timer in `scheduleShutdown()`** (timer leak)
   - Before: `shutdownTimer = setTimeout(...)` — overwrites without clearing previous timer
   - After: `if (shutdownTimer) clearTimeout(shutdownTimer);` before setting new timer

---

## 3. Database Race Conditions

**Not applicable.** NightyTidy has no database. All persistent state is file-based (lock file, state file, progress JSON).

### File-Based State Race Conditions

#### 3.1 Lock File — `removeLockAndReacquire` ENOENT (FIXED)

**Location**: `src/lock.js:58-72`
**Pattern**: Check-then-act — `unlinkSync` assumes file still exists after `isLockStale()` returned true

**Interleaved timeline:**
```
T0: Process A — acquireLock() → EEXIST, reads lock, isLockStale() → true
T1: Process B — original lock holder exits, unlinkSync(lockPath) succeeds
T2: Process A — removeLockAndReacquire() → unlinkSync(lockPath) → ENOENT crash
```

**Fix**: Wrapped `unlinkSync` in try/catch, ignoring `ENOENT`:
```js
try {
  unlinkSync(lockPath);
} catch (unlinkErr) {
  if (unlinkErr.code !== 'ENOENT') throw unlinkErr;
}
```

#### 3.2 Orchestrator State File — Last-Writer-Wins (DOCUMENTED)

**Location**: `src/orchestrator.js:265-311` (`runStep`)
**Pattern**: Read-modify-write without file locking

**Interleaved timeline:**
```
T0: Process A (--run-step 1): readState() → { completedSteps: [] }
T1: Process B (--run-step 2): readState() → { completedSteps: [] }
T2: Process A: completedSteps.push(step1), writeState()  → file = [step1]
T3: Process B: completedSteps.push(step2), writeState()  → file = [step2]
Result: step1 result is lost
```

**Mitigation**: The orchestrator is designed for sequential `--run-step` calls. The calling Claude Code process runs steps one at a time. `runStep` does not call `acquireLock` because the persistent lock from `--init-run` is intended to block other `--init-run` calls, not step calls.

**Recommendation**: If parallel step execution is ever added, use file locking on the state file or switch to an append-only log format.

#### 3.3 `excludeEphemeralFiles` — TOCTOU (LOW RISK)

**Location**: `src/git.js:38-56`
**Pattern**: `existsSync` → `readFileSync` → `appendFileSync` without locking

**Mitigation**: Only called once per run, after `acquireLock()`. Two concurrent NightyTidy processes are prevented by the lock. Worst case (if lock were bypassed): duplicate entries in `.git/info/exclude`, which is harmless.

#### 3.4 `updateClaudeMd` — Read-Modify-Write (LOW RISK)

**Location**: `src/report.js:149-182`
**Pattern**: `readFileSync` → modify → `writeFileSync` without locking

**Mitigation**: Protected by the run lock. Only called during report generation at end of run.

#### 3.5 `setupProject` — Read-Modify-Write (LOW RISK)

**Location**: `src/setup.js:77-108`
**Pattern**: `existsSync` → `readFileSync` → `writeFileSync` without locking

**Mitigation**: `--setup` is a quick one-off command. Concurrent invocations are extremely unlikely and would at worst produce a malformed CLAUDE.md.

---

## 4. Cache Race Conditions

**Not applicable.** NightyTidy has no caching layer. The only "cache" is `report.js:cachedVersion` (a lazy-init singleton for `package.json` version), which is safe in single-threaded Node.js.

---

## 5. Queue & Job Idempotency

**Not applicable.** NightyTidy has no background jobs or message queues. The orchestrator mode uses sequential process invocations, not a job queue.

### Idempotency of Orchestrator Operations

| Operation | Idempotent? | Protection | Risk if Duplicated |
|-----------|-------------|------------|-------------------|
| `--init-run` | Yes | State file check + lock file | Second call fails with "run already in progress" |
| `--run-step N` | Yes | `completedSteps`/`failedSteps` check | Second call fails with "already completed/failed" |
| `--finish-run` | No | State file deleted after finish | Second call fails with "no active run" |
| `stopDashboard()` | Yes | All guards check for null | No-op on second call |
| `releaseLock()` | Yes | try/catch on `unlinkSync` | No-op if already released |

---

## 6. Frontend Concurrency

### Dashboard Stop Button

The browser dashboard has a "Stop" button that sends `POST /stop` with a CSRF token. Multiple clicks are handled safely:
- First click: triggers the `onStop` callback
- Subsequent clicks: the callback may throw "already aborted", which is caught silently

No double-submission risk — the abort is idempotent.

### SSE Client Management

`sseClients` (a `Set`) is modified during iteration in `updateDashboard()`. JavaScript `Set` iteration handles deletions correctly per spec. The `close` event handler also deletes from the set, but cannot interleave with synchronous iteration in single-threaded JS.

---

## 7. Concurrency Tests Written

**New test file**: `test/concurrency.test.js` — 7 tests

| Test | Type | Status |
|------|------|--------|
| `removeLockAndReacquire handles ENOENT when lock disappears before unlink` | Verifies fix | Passing |
| `removeLockAndReacquire rethrows non-ENOENT unlink errors` | Verifies fix | Passing |
| `scheduleShutdown clears existing timer before setting new one` | Verifies fix | Passing |
| `stopDashboard is idempotent — can be called multiple times safely` | Idempotency | Passing |
| `updateDashboard after stopDashboard does not crash` | Shutdown safety | Passing |
| `orchestrator state file race — simultaneous runStep` | Documents race | Passing (documented) |
| `pollTimer declaration order is safe` | Documents code quality | Passing (documented) |

---

## 8. Risk Map

| # | Location | Race Condition | Likelihood | Impact | Severity | Manifestation | Status |
|---|----------|---------------|------------|--------|----------|---------------|--------|
| 1 | `lock.js:58` | `unlinkSync` ENOENT when lock disappears during override | Low (requires prompt timeout + holder exit) | Medium (uncaught crash) | **Medium** | Visible crash with stack trace | **FIXED** |
| 2 | `dashboard.js:162` | `server.address()` on closed server during listen | Very low (requires SIGINT during server startup) | Medium (uncaught TypeError) | **Medium** | Visible crash with stack trace | **FIXED** |
| 3 | `dashboard.js:254` | `scheduleShutdown` double call leaks timer | Low (requires specific shutdown sequence) | Low (extra no-op stopDashboard call) | **Low** | Silent — harmless duplicate cleanup | **FIXED** |
| 4 | `orchestrator.js:265` | Parallel `--run-step` loses state | Low (orchestrator design is sequential) | High (step results lost) | **Medium** | Silent — missing step in report | Documented |
| 5 | `git.js:38` | `excludeEphemeralFiles` TOCTOU | Very low (lock prevents concurrent runs) | Low (duplicate entries in exclude file) | **Negligible** | Silent — harmless duplicates | Mitigated by lock |
| 6 | `report.js:149` | `updateClaudeMd` read-modify-write | Very low (lock prevents concurrent runs) | Medium (CLAUDE.md corruption) | **Low** | Visible — malformed CLAUDE.md | Mitigated by lock |
| 7 | `setup.js:77` | `setupProject` read-modify-write | Very low (manual one-off command) | Low (CLAUDE.md corruption) | **Negligible** | Visible — malformed CLAUDE.md | Accepted |
| 8 | `dashboard-standalone.js:117` | `pollTimer` declared after assignment | None (async callback timing) | None (no runtime issue) | **None** | N/A — code quality only | Clarified with comment |

**Distinguishing visible vs. silent errors**: Items 1-3 would produce visible crashes. Item 4 is the most dangerous because it produces a **silent wrong answer** — the final report would simply be missing a step's results without any error message.

---

## 9. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| 1 | Guard parallel `--run-step` with state file locking | Prevents step result loss in orchestrator mode | Medium — only if someone calls `--run-step` in parallel, which the current design doesn't do | Only if time allows | Current sequential design prevents this. If parallel steps are ever added, use `openSync('wx')` on a step-specific lock or switch to append-only state logging. |
| 2 | Add `server.on('close')` handler in `startDashboard` | Prevents promise hanging if server is closed before listen | Low — the existing outer try/catch + timeout in `cli.js` prevents indefinite hang | Only if time allows | The `listen` callback may never fire if `server.close()` is called first. Adding a `close` event handler that resolves the promise would make `startDashboard` fully robust against any shutdown timing. |

---

## Appendix: Node.js Single-Threaded Safety

Many patterns that would be race conditions in multi-threaded environments are safe in Node.js:
- **Module-level singletons** (`logger.js`, `git.js`): Only one piece of code runs at a time; `await` points don't cause true parallel execution.
- **Shared objects passed by reference** (`dashState` in `cli.js`): `JSON.stringify()` is synchronous, so serialization sees a consistent snapshot.
- **`settled` flag in promise callbacks** (`claude.js`, `checks.js`): Event handlers run sequentially in the event loop; two handlers cannot execute simultaneously.
- **`Set` modification during iteration** (`dashboard.js`): JavaScript spec guarantees correct behavior for deletions during `for...of`.

The only true concurrency boundary in NightyTidy is **between separate process invocations** in orchestrator mode, where the lock file and state file serve as the coordination mechanism.
