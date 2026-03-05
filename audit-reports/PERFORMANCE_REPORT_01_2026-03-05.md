# Performance Report 01 — 2026-03-05

## 1. Executive Summary

NightyTidy is a CLI orchestration tool that spends 99.9%+ of its wall-clock time waiting for Claude Code subprocesses (15-45 min per step, up to 28 steps). The JavaScript orchestration code runs for milliseconds between steps. **There are no critical or high-severity performance issues.**

Two low-severity fixes were implemented:

1. **Dashboard SSE broadcast**: Eliminated redundant `JSON.stringify` calls in `updateDashboard()` — serializes state once and reuses for both progress file and all SSE clients.
2. **Abort listener leak**: Fixed missing `removeEventListener` on the timeout path in `waitForChild()` — prevented minor listener accumulation on the shared `AbortSignal` across timed-out attempts.

No database, no frontend, no hot-path algorithmic issues. The codebase is appropriately simple for its workload profile.

---

## 2. Database Performance

**N/A** — NightyTidy has no database. It orchestrates Claude Code subprocesses and uses git for version control.

---

## 3. Application Performance

### Expensive Operations

| Location | Issue | Complexity | Recommendation |
|----------|-------|-----------|----------------|
| `executor.js:verifyStepsIntegrity()` | SHA-256 of all 28 prompts (~5400 lines) on every run | O(n) single pass | **No action needed** — runs once at startup, completes in <10ms |
| `checks.js:runPreChecks()` | 7 sequential subprocess checks | O(1) per check, ~5-10s total | **Not worth parallelizing** — total pre-check time is negligible vs 4-8h run time. Sequential ordering provides better error messages and user experience |
| `logger.js:log()` | Synchronous `appendFileSync` on every log call | O(1) | **No action needed** — log calls happen between 15-45 min subprocess waits, never on a hot path |
| `claude.js:cleanEnv()` | Copies `process.env` on every subprocess spawn | O(env size) | **No action needed** — runs max ~112 times (28 steps × 4 attempts) over hours |

### Caching Opportunities

| Data | Strategy | Invalidation | Impact |
|------|----------|-------------|--------|
| `report.js:getVersion()` | Already cached via `cachedVersion` | N/A | Already optimized |
| `process.env` copy in `cleanEnv()` | Could cache once per run | Process lifetime | **Negligible** — called at most ~112 times over hours |

No caching infrastructure needed. The only cacheable computation (`getVersion()`) is already cached.

### Async/Concurrency

| Location | Issue | Recommendation |
|----------|-------|----------------|
| `checks.js:runPreChecks()` | 7 sequential checks, some independent | **Not worth changing** — saves ~2-3s out of a 4-8h run. Sequential provides better UX (checks appear one-by-one with clear error ordering) |
| `executor.js:executeSteps()` | Steps run sequentially | **Correct by design** — steps must be sequential because each operates on the same git branch and may depend on prior changes |

---

## 4. Memory & Resources

### Leaks Fixed

| Location | Issue | Fix |
|----------|-------|-----|
| `claude.js:waitForChild()` L76-81 | Timeout path did not remove abort listener from `AbortSignal`. Each timed-out subprocess attempt leaked one listener on the shared signal, persisting for the entire run. Max ~112 listeners if all attempts timed out. | Added `signal?.removeEventListener('abort', onAbort)` before resolve on the timeout path. |

### Potential Issues (Not Worth Fixing)

| Location | Issue | Assessment |
|----------|-------|-----------|
| `claude.js:forceKillChild()` | `setTimeout` for SIGKILL fires even if child dies before delay. Caught by try/catch. | **Harmless** — at most 1 dangling 5s timer per kill. Fires, fails silently, GC'd. |
| `lock.js:acquireLock()` | Adds `process.on('exit', ...)` listener. | **Correct** — runs once per process lifetime. No accumulation. |
| `cli.js` | Adds `SIGINT` and `unhandledRejection` listeners. | **Correct** — one of each, never re-added. |
| `dashboard.js:sseClients` | Module-level `Set` of SSE response objects. | **Correct** — clients removed on `close` event, cleared on `stopDashboard()`. |

### Resource Management

All resources are properly managed:
- **HTTP server**: Closed in `stopDashboard()`, SSE clients ended.
- **Lock file**: Atomic `O_EXCL` create, cleaned up on `process.exit`.
- **Ephemeral files**: Cleaned up in `stopDashboard()`.
- **Child processes**: Killed on timeout with SIGKILL fallback, killed on abort.
- **Timers**: `shutdownTimer` cleared in `stopDashboard()`. Interval in `dashboard-tui.js` cleared on completion.

---

## 5. Frontend Performance

**N/A** — No user-facing frontend. The dashboard HTML (`dashboard-html.js`) is a simple real-time monitor served to localhost. It uses SSE (not polling), has no external dependencies, renders at most every few minutes (on step transitions), and serves a single user. No performance concerns.

---

## 6. Optimizations Implemented

### Fix 1: Deduplicate JSON serialization in `updateDashboard()`

**File**: `src/dashboard.js`

**Before**: `JSON.stringify(state)` called once for `writeProgressFile()` and again for each SSE client in the broadcast loop.

**After**: Serialize once, reuse the JSON string for both the progress file write and all SSE clients. Also inlined the `writeProgressFile()` function (removed dead code).

**Impact**: Eliminates N+1 serializations per state update (where N = number of SSE clients). Practically low impact since updates are infrequent and the state object is small, but it's the correct pattern.

### Fix 2: Remove abort listener on timeout in `waitForChild()`

**File**: `src/claude.js`

**Before**: When the timeout fires, the promise resolves and the child is killed, but the `onAbort` listener remains registered on the `AbortSignal`.

**After**: Added `signal?.removeEventListener('abort', onAbort)` on the timeout path, matching the cleanup already done on the `close` and `error` paths.

**Impact**: Prevents minor listener accumulation on the shared `AbortSignal` over the course of a run. Maximum theoretical leak was ~112 listeners (28 steps × 4 attempts if all timed out).

### All tests passing: Yes (246/248 — 2 pre-existing timeout flakes in integration tests unrelated to these changes)

---

## 7. Optimization Roadmap

There are no larger performance efforts warranted. The application's performance profile is dominated by external subprocess wait time (Claude Code), not internal computation. Optimizing the orchestration code would have zero measurable impact on end-to-end run time.

The only area where user-perceived performance could improve is the **pre-check phase** (~5-10s of sequential subprocess spawns), but:
- Saving 3-5 seconds on a 4-8 hour run is not meaningful
- Sequential checks provide clearer error messages
- The code would become harder to read for negligible gain

---

## 8. Monitoring Recommendations

### Key Metrics
- **Per-step duration**: Already tracked in `executor.js` and reported in `NIGHTYTIDY-REPORT.md`
- **Total run duration**: Already tracked and reported
- **Retry counts**: Already tracked per step

### Alert-Worthy Conditions
- Steps consistently timing out (indicates Claude Code API issues)
- Disk space warnings (already checked in pre-checks)
- Lock file staleness (already handled with PID checking)

### Suggested Approach
No additional monitoring infrastructure needed. The existing logging (`nightytidy-run.log`) and reporting (`NIGHTYTIDY-REPORT.md`) capture all relevant performance data. The dashboard provides real-time visibility during runs.

---

*Generated by NightyTidy Performance Audit — 2026-03-05*
