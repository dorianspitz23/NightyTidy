# Bug Hunt Report — Run 02, 2026-03-10

## Executive Summary

Scanned all 16 source files across 5 phases (static pattern analysis, semantic contract analysis, data flow analysis, test-informed detection, and targeted fixes). Found **18 bugs** total across severity levels. Fixed **5 bugs** (all mechanical, high-confidence). Documented **13 bugs** requiring human review.

| Category | Count |
|----------|-------|
| Critical | 0 |
| High | 2 |
| Medium | 6 |
| Low | 10 |
| **Total** | **18** |
| **Fixed** | **5** |
| **Document-only** | **13** |

Highest-density areas: `orchestrator.js` (5 findings), `dashboard.js` (3 findings), `cli.js` (3 findings).

---

## Bugs Fixed

| # | File | Bug | Fix | Confidence | Tests Pass? | Commit |
|---|------|-----|-----|------------|-------------|--------|
| 1 | `src/orchestrator.js:94` | `\|\|` on numeric `duration` — falsy `0` silently replaced with `null` | Changed `\|\|` to `??` (nullish coalescing) | 99% — mechanical, `??` preserves 0 while still coalescing null/undefined | Yes (437/437) | See commit |
| 2 | `src/orchestrator.js:221,288,376` | `\|\|` on numeric `timeout` — chain of 3 sites where `0` is coerced to null/undefined, disabling timeout guard | Changed all 3 sites from `\|\|` to `??` | 99% — same class as #1 | Yes (437/437) | See commit |
| 3 | `src/dashboard-html.js:277` | Unguarded `JSON.parse` in client-side SSE handler — malformed SSE data crashes dashboard permanently | Wrapped in `try/catch` | 99% — standard defensive parsing | Yes (437/437) | See commit |
| 4 | `src/cli.js:131` | Double-Ctrl+C force-stop skips `stopDashboard()` — ephemeral files left on disk, HTTP server not cleaned up | Added `try { stopDashboard(); } catch {}` before `process.exit(1)` | 99% — `stopDashboard()` is documented as safe to call multiple times | Yes (437/437) | See commit |
| 5 | `src/dashboard.js:164` | `server.address()` can return `null` in race between `stopDashboard()` and `listen` callback — `.port` throws TypeError | Added null guard: `const addr = server.address(); if (!addr) ...` | 95% — race window is narrow but real; outer try/catch prevents crash but dashboard silently fails | Yes (437/437) | See commit |
| 6 | `src/cli.js:65,69` | `parseInt` passed raw as Commander parser — no radix argument; relies on modern Node.js for decimal strings | Wrapped with `(v) => parseInt(v, 10)` | 99% — idiomatic fix, no behavior change for valid inputs | Yes (437/437) | See commit |

---

## High-Priority Bugs — Needs Human Review

### H1. `git.js` `retryWithSuffix` swallows all errors (HIGH, High confidence)

**File**: `src/git.js:67-78`
**What's wrong**: The bare `catch {}` block catches and discards every exception — not just name-collision errors. Network failures, disk full, permission denied, corrupt git index — all are silently swallowed and treated as "name already exists". The loop burns through 10 retries appending suffixes, then throws the misleading message: "Could not create safety tag — too many runs within the same minute."
**Trigger**: Any persistent git error during `createPreRunTag()` or `createRunBranch()` (e.g., git signing misconfigured, filesystem full, git hooks failing).
**Impact**: User sees a wrong error message ("try again shortly") when the real problem is unrelated to timing. Root cause is hidden. Debugging requires checking logs for the actual git error.
**Suggested fix**: Inspect caught error — only retry on name-collision errors (e.g., `err.message.includes('already exists')`). Re-throw immediately on any other error.
**Why not fixed**: Requires testing error messages from `simple-git` for name collisions vs. other failures; the string matching pattern varies by git version.

### H2. `checks.js` interactive auth catch loses original error (HIGH, Medium confidence)

**File**: `src/checks.js:154-159`
**What's wrong**: When `runInteractiveAuth()` fails, the original error (e.g., "spawn ENOENT" if `claude` binary is not found) is discarded and replaced with a generic "Claude Code sign-in did not complete successfully" message.
**Trigger**: `claude` binary not on PATH, or any non-auth-related failure during `runInteractiveAuth()`.
**Impact**: User sees "sign-in did not complete" when the actual problem is "binary not found" or network timeout. Hampers debugging.
**Suggested fix**: Include the original error message: `throw new Error(\`Claude Code sign-in did not complete: ${err.message}\`)`.
**Why not fixed**: The current catch replaces `checkClaudeInstalled()` errors that should have been caught earlier. Need to verify the error path flow to ensure the message change is appropriate.

---

## Medium-Priority Bugs — Needs Human Review

### M1. `dashboard-standalone.js:106` — `server.address()` null dereference (Medium, Medium confidence)

**File**: `src/dashboard-standalone.js:106`
**What's wrong**: `const port = server.address().port;` — no null guard. Same class as the fixed bug in `dashboard.js`.
**Trigger**: If `server.close()` is called between `listen` starting and the callback firing (unlikely in standalone mode but possible via SIGTERM race).
**Impact**: Uncaught TypeError crashes the standalone dashboard process.
**Suggested fix**: Same pattern as the fix applied to `dashboard.js` — guard `server.address()` against null.
**Why not fixed**: Standalone server is a separate script with different lifecycle; fix is identical but needs testing in the standalone context.

### M2. `claude.js:12-15` — SIGKILL timer never cancelled (Medium, High confidence)

**File**: `src/claude.js:11-16`
**What's wrong**: `forceKillChild()` creates a 5-second `setTimeout` for SIGKILL that is fire-and-forget. The handle is never stored or cancelled. This keeps the event loop alive for 5 extra seconds after every timeout or abort, even when the child process is already dead.
**Trigger**: Every timeout or abort path in `runPrompt()`.
**Impact**: 5-second delay before process shutdown on every abort/timeout. Accumulates in test suite.
**Suggested fix**: Store the timer handle and clear it in the `child.on('close')` handler.
**Why not fixed**: Requires refactoring the `forceKillChild` function to return the timer handle and wiring cleanup into the `waitForChild` promise — touches the most critical subprocess code.

### M3. `checks.js:29,31,114,115` — Same SIGKILL timer pattern (Medium, High confidence)

**File**: `src/checks.js:29-31, 114-115`
**What's wrong**: Identical fire-and-forget SIGKILL timer pattern as M2.
**Trigger**: Auth check or command timeout.
**Impact**: Same 5-second delay.
**Suggested fix**: Same as M2.

### M4. `dashboard.js` — TUI process never killed in `stopDashboard()` (Medium, Medium confidence)

**File**: `src/dashboard.js:20, 95-129, 213-248`
**What's wrong**: `tuiProcess` is spawned and `unref()`'d but `stopDashboard()` never calls `tuiProcess.kill()`. If the progress file is deleted before the TUI reads a terminal status, the TUI window stays open indefinitely.
**Trigger**: Force-quit or error path where `stopDashboard()` deletes `nightytidy-progress.json` before the TUI polls a `completed`/`stopped`/`error` status.
**Impact**: Orphaned terminal window that the user must manually close.
**Suggested fix**: Add `if (tuiProcess) { try { tuiProcess.kill(); } catch {} tuiProcess = null; }` to `stopDashboard()`.
**Why not fixed**: `tuiProcess` is spawned in a separate terminal window — killing it may behave differently across platforms (Windows `start` vs macOS `open -a Terminal`). Needs cross-platform testing.

### M5. `dashboard.js` — `sseClients` not cleared in server error path (Medium, Low confidence)

**File**: `src/dashboard.js:154-158`
**What's wrong**: When the server emits an error (e.g., port conflict), `server` is set to `null` but `sseClients` is not cleared. If `startDashboard()` is called again (unlikely but possible), `updateDashboard()` would attempt to write to dead response objects from the first failed server.
**Trigger**: Dashboard server fails to start, then is retried within the same process.
**Impact**: Write errors on dead SSE connections (caught by existing try/catch in `updateDashboard`).
**Suggested fix**: Add `sseClients.clear()` in the server error handler.
**Why not fixed**: Low probability — `startDashboard()` is only called once per run.

### M6. `lock.js:129-132` — Exit listener accumulates on repeated `acquireLock()` calls (Medium, High confidence)

**File**: `src/lock.js:129-132`
**What's wrong**: Each `acquireLock()` call registers a new `process.on('exit')` handler. In tests that call `acquireLock()` multiple times, this accumulates listeners (Node.js warns at >10).
**Trigger**: Running test suite or any scenario where `acquireLock()` is called more than once per process.
**Impact**: Node.js `MaxListenersExceededWarning`, minor memory leak.
**Suggested fix**: Track whether the exit handler has been registered and skip if already set.
**Why not fixed**: Requires adding module-level state to track registration; need to ensure it doesn't interfere with the `persistent` mode.

---

## Low-Priority Bugs — Needs Human Review

### L1. `cli-ui.js:45-46` — `dashState.steps[idx]` without bounds check (Low)

`idx` comes from the executor loop and should always be in-bounds, but no defensive guard exists.

### L2. `claude.js:12, 86` — Initial `child.kill()` in `forceKillChild` has no try/catch (Low)

The SIGKILL follow-up is guarded but the initial kill is not. Could throw on Windows if child already exited.

### L3. `checks.js:29, 114` — Same unguarded initial `child.kill()` pattern (Low)

Same class as L2.

### L4. `orchestrator.js:383` — `generateReport()` called without `await` (Low)

Currently synchronous so not broken, but inconsistent with `cli.js` and a maintenance trap if it ever becomes async.

### L5. `dashboard-standalone.js:37-38` — Redundant `existsSync` before `readFileSync` in try/catch (Low)

TOCTOU is safe because outer try/catch catches ENOENT, but the `existsSync` guard is redundant.

### L6-L8. Various TOCTOU patterns (Low)

`setup.js:81-82`, `report.js:157-158` — `existsSync` followed by `readFileSync`. Both are inside try/catch blocks so functionally safe.

### L9. `report.js:5` — `cachedVersion` never reset (Low)

Benign for current use (single-process lifetime) but misleading if module reused across projects.

### L10. `sleep()` in `claude.js:34-41` accumulates `{ once: true }` listeners (Low)

Each `sleep()` call adds a listener to the abort signal. Not a permanent leak (`{ once: true }` auto-removes on fire), but could accumulate during many retries.

---

## Test Suite Observations

### Tautological Tests

| File | Line(s) | Issue |
|------|---------|-------|
| `test/concurrency.test.js` | 200-218 | `expect(true).toBe(true)` — race condition documentation stub, exercises no code |
| `test/concurrency.test.js` | 222-228 | `expect(true).toBe(true)` — TDZ documentation stub |
| `test/dashboard-standalone.test.js` | 152-175 | `expect(true).toBe(true)` — SSE test collects events but never asserts on content |

### Tests That Don't Test What They Claim

| File | Line(s) | Issue |
|------|---------|-------|
| `test/cli.test.js` | 416-436 | "generates partial report when execution is interrupted" — abort path `if` body is empty, asserts same thing as happy-path test |

---

## Bug Density Map

| Module | Findings |
|--------|----------|
| `src/orchestrator.js` | 5 (4 `||` bugs fixed, 1 missing `await`) |
| `src/dashboard.js` | 3 (null deref fixed, TUI leak, sseClients leak) |
| `src/cli.js` | 3 (force-stop cleanup fixed, parseInt fixed, dashboard stop) |
| `src/claude.js` | 2 (SIGKILL timer, unguarded kill) |
| `src/checks.js` | 3 (SIGKILL timer, unguarded kill, swallowed auth error) |
| `src/git.js` | 1 (retryWithSuffix swallows all errors) |
| `src/dashboard-html.js` | 1 (JSON.parse fixed) |
| `src/dashboard-standalone.js` | 1 (null deref on server.address()) |
| `src/lock.js` | 1 (exit listener accumulation) |
| `src/cli-ui.js` | 1 (missing bounds check) |

---

## Recommendations

1. **Recurring pattern: `||` where `??` is needed** (4 instances fixed). Add an ESLint rule or code review checklist item for numeric/timeout values.
2. **`retryWithSuffix` in git.js** is the highest-severity unfixed bug — the misleading error message will confuse users when git has non-collision errors.
3. **SIGKILL timer leak** in `claude.js` and `checks.js` is a recurring pattern (4 instances). Consider extracting a `killChildWithTimeout(child)` utility that stores and cancels the timer.
4. **Tautological tests** in `concurrency.test.js` should either be implemented as real tests or converted to code comments. They inflate test counts without providing coverage.
5. **The `cli.test.js` abort test** (line 416) should be either fixed to actually trigger an abort or removed.

---

*Generated by NightyTidy Bug Hunt — Run 02, 2026-03-10*
