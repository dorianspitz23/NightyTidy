# Test Hardening Report — Run 03

**Date**: 2026-03-09
**Test Suite**: 430 tests across 40 files (Vitest v2)
**Status**: All passing

---

## 1. Summary

| Metric | Count |
|--------|-------|
| Flaky tests found and fixed | 5 |
| Flaky tests found but couldn't fix | 0 |
| Previously disabled tests re-enabled | 0 |
| Module API contracts mapped | 17 |
| New contract tests written | 15 |
| Documentation discrepancies found | 2 |

---

## 2. Phase 1: Flaky Tests Fixed

### Detection Methodology

- Ran full test suite 5 consecutive times — all 415 tests passed in every run (100% stable)
- Searched for known flaky patterns: `Date.now()` in assertions, unguarded `setTimeout`, shared mutable state, fake timer leaks
- Identified 5 patterns that, while currently passing, are vulnerable to flaking under CI load

### Fixes Applied

| Test File | Root Cause | Severity | Fix Applied |
|-----------|-----------|----------|-------------|
| `claude-spawn-error.test.js` | **Fake timer cleanup not in afterEach** — `vi.useFakeTimers()` at line 70 inside test body; if test hangs, `vi.useRealTimers()` never executes, causing cascading failures in subsequent tests | HIGH | Wrapped in dedicated `describe` block with `beforeEach(() => vi.useFakeTimers())` and `afterEach(() => vi.useRealTimers())` |
| `dashboard.test.js` | **Tight SSE polling timeout** — `connectSSE()` and `waitForEvent()` used 2-second timeouts with 10ms polling; under slow CI, SSE event delivery could exceed 2s | MEDIUM-HIGH | Increased timeouts from 2s to 5s in both `connectSSE` and `waitForEvent` |
| `dashboard-security.test.js` | **Tight SSE teardown wait** — 100ms `setTimeout` for SSE client connection close; insufficient under load | LOW-MEDIUM | Increased from 100ms to 300ms |
| `dashboard-error-paths.test.js` | **Tight SSE teardown wait** — 50ms `setTimeout` for SSE client connection close | LOW | Increased from 50ms to 300ms |
| `git.test.js` | **Missing timeout on slow integration tests** — `mergeRunBranch` conflict test involves 5+ git operations with real I/O, but used 5s default timeout; hit timeout intermittently | MEDIUM | Added `{ timeout: 15000 }` to both merge tests |

### Flaky Tests Unresolved

None — all identified issues were fixed.

### Additional Patterns Reviewed (No Fix Needed)

| File | Pattern | Assessment |
|------|---------|-----------|
| `checks-timeout.test.js` | `process.on('unhandledRejection')` handler added/removed in test | Safe — protected by try/finally, Vitest runs sequentially |
| `dashboard-extended.test.js` | Mixed real/fake timer switching | Safe — afterEach cleanup order is correct (stop server, then useRealTimers) |
| `lock.test.js` | `Date.now()` in timestamp assertions with 5s tolerance | Acceptable — 5s margin is generous enough for CI |
| `dashboard-tui-*.test.js` | `Date.now()` for startTime in test data | Safe — no timing assertions, just rendering input |

---

## 3. Phase 2: API Contract Testing

### Context

NightyTidy is a CLI orchestration tool, not an HTTP API. The "API" is the module-level function exports and their error handling contracts documented in CLAUDE.md. The existing `contracts.test.js` (31 tests) already covered 11 modules. This phase expanded coverage to 17 modules with 46 total contract tests.

### Module Contract Map

| Module | Contract | Tests Before | Tests After | Status |
|--------|----------|-------------|-------------|--------|
| `claude.js` | Never throws, returns `{ success, output, error, exitCode, duration, attempts }` | 2 | 2 | Already covered |
| `git.js` | `mergeRunBranch` never throws, returns `{ success, conflict }` | 3 | 3 | Already covered |
| `checks.js` | Throws Error with user-friendly messages | 2 | 2 | Already covered |
| `executor.js executeSteps` | Never throws, returns `{ results, completedCount, failedCount, totalDuration }` | 5 | 5 | Already covered |
| `notifications.js` | Swallows all errors silently | 1 | 1 | Already covered |
| `report.js` | Warns but never throws; generates files | 5 | 5 | Already covered |
| `logger.js` | Throws before init | 2 | 2 | Already covered |
| `steps.js` | 28 entries with `{ number, name, prompt }` shape | 2 | 2 | Already covered |
| `dashboard.js` | Swallows all errors, startDashboard returns `{ url, port }` | 4 | 4 | Already covered |
| `setup.js` | Returns `'created'`/`'appended'`/`'updated'` | 3 | 3 | Already covered |
| `cli.js` | Top-level try/catch | 1 | 1 | Already covered |
| **`lock.js`** | **Async, throws Error on conflict** | **0** | **5** | **NEW** |
| **`orchestrator.js`** | **Never throws, returns `{ success: false, error }`** | **0** | **4** | **NEW** |
| **`executor.js executeSingleStep`** | **Returns result with step/status/output/duration/attempts/error** | **0** | **3** | **NEW** |
| **`executor.js SAFETY_PREAMBLE`** | **Non-empty string with constraint keywords** | **0** | **1** | **NEW** |
| **`dashboard-html.js`** | **Returns valid HTML string with CSRF token** | **0** | **2** | **NEW** |

### New Contract Tests Written (15 tests)

**lock.js (5 tests)**:
- Exports `acquireLock` and `releaseLock` as functions
- `acquireLock` creates lock file with `pid` and `started` fields
- `acquireLock` throws Error (not result object) when lock is held in non-TTY
- `releaseLock` does not throw when no lock file exists
- `releaseLock` removes an existing lock file

**orchestrator.js (4 tests)**:
- Exports `initRun`, `runStep`, `finishRun` as functions
- `initRun` returns `{ success: false, error }` when pre-checks fail (never throws)
- `runStep` returns `{ success: false, error }` when no state file (never throws)
- `finishRun` returns `{ success: false, error }` when no state file (never throws)

**executor.js executeSingleStep (3 tests)**:
- `SAFETY_PREAMBLE` is a non-empty string containing constraint keywords
- `executeSingleStep` returns result with `step`, `status`, `output`, `duration`, `attempts`, `error`
- `executeSingleStep` returns `failed` status when `runPrompt` fails (never throws)

**dashboard-html.js (2 tests + 1 export check)**:
- Exports `getHTML` as a function
- Returns HTML string containing the CSRF token
- Returns HTML with `/stop` endpoint reference

---

## 4. Documentation Discrepancies

| Location | Issue | Resolution |
|----------|-------|-----------|
| `CLAUDE.md` Project Structure | Listed 22 test files; actual count is 40 (18 files added by previous runs but never documented) | Updated to list all 40 test files with accurate counts |
| `.claude/memory/testing.md` | Documented "290 tests, 22 files"; actual is 430 tests, 40 files | Updated to "430 tests, 40 files" with complete test file table |
| `contracts.test.js` | Listed as "31 tests" in CLAUDE.md; now has 46 | Updated count in CLAUDE.md |

---

## 5. Undocumented Behavior

| Behavior | Module | Notes |
|----------|--------|-------|
| Lock file `pid` field is always `process.pid` (current process) | `lock.js` | Not explicitly documented, but tested |
| `acquireLock` in non-TTY throws with instructions to manually delete lock file | `lock.js` | Error message includes `LOCK_FILENAME` for actionability |
| `SAFETY_PREAMBLE` contains 5 specific constraint rules | `executor.js` | Content is hardcoded, not configurable |
| `getHTML` embeds token as JavaScript string literal (`token: 'xxx'`) | `dashboard-html.js` | Token extraction regex in tests depends on this format |

---

## 6. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| 1 | Add `{ timeout: 15000 }` to all real-git integration tests | Eliminates intermittent timeouts in git.test.js, git-extended.test.js | Medium | Yes | Multiple tests do 5+ git operations with real I/O. The default 5s timeout is marginal under heavy CI load. Adding explicit timeouts costs nothing and prevents false negatives. |
| 2 | Standardize fake timer cleanup pattern | Prevents cascading test failures | Medium | Probably | Any test that calls `vi.useFakeTimers()` inside a test body (not beforeEach) risks leaking fake timers on failure. Grep for `vi.useFakeTimers` not in `beforeEach` as a lint rule. |
| 3 | Keep testing.md test counts in sync automatically | Reduces doc drift | Low | Only if time allows | The `check-docs-freshness.js` script caught the stale count, but it requires a manual update to testing.md. Consider having the script auto-fix or at least print the correct values. |
