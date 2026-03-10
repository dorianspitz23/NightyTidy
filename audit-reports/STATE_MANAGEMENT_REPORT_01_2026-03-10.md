# State Management Audit Report — 2026-03-10

## 1. Executive Summary

**Health Rating: Solid**

NightyTidy's state management is well-designed for a CLI tool. Module-level singletons follow clear initialization sequences, file-based state uses atomic patterns, and error contracts are enforced consistently. Two genuine state validation bugs were found and fixed. Several minor maintenance risks were documented.

| Category | Findings | Fixed | Document-Only |
|----------|----------|-------|---------------|
| Duplicated State | 2 | 0 | 2 |
| Stale State | 1 | 0 | 1 |
| Missing State Handling | 0 | 0 | 0 |
| Lifecycle Bugs | 2 | 2 | 0 |
| Edge Cases | 3 | 0 | 3 |
| Architecture | 2 | 0 | 2 |

---

## 2. State Source Map

### Module-Level Singletons

| Module | Mutable State | Init Function | Reset Function | Lifecycle |
|--------|--------------|---------------|----------------|-----------|
| `logger.js` | `logFilePath`, `minLevel`, `logQuiet` | `initLogger()` | None | Process lifetime |
| `git.js` | `git`, `projectRoot` | `initGit()` | None | Process lifetime |
| `dashboard.js` | `server`, `sseClients`, `currentState`, `urlFilePath`, `progressFilePath`, `shutdownTimer`, `tuiProcess`, `csrfToken` | `startDashboard()` | `stopDashboard()` | Run lifetime |
| `report.js` | `cachedVersion` | Lazy on first `getVersion()` | None | Process lifetime |

### File-Based State

| File | Canonical Owner | Readers | Survives Process Exit? | Survives Run? |
|------|----------------|---------|----------------------|---------------|
| `nightytidy-run.log` | `logger.js` | User, Claude Code | Yes | No (ephemeral) |
| `nightytidy-progress.json` | `dashboard.js` / `orchestrator.js` | TUI, standalone dashboard | No (deleted on stop) | No |
| `nightytidy-dashboard.url` | `dashboard.js` / `orchestrator.js` | Claude Code | No (deleted on stop) | No |
| `nightytidy-run-state.json` | `orchestrator.js` | `orchestrator.js` (cross-process) | Yes (persistent lock mode) | No (deleted by --finish-run) |
| `nightytidy.lock` | `lock.js` | `lock.js` | No (auto-removed on exit) / Yes (persistent mode) | No |
| `NIGHTYTIDY-REPORT.md` | `report.js` | User, Claude Code | Yes | Yes (committed) |
| `.git/info/exclude` | `git.js` | Git | Yes | Yes (local, not committed) |

### Shared Object References

| Object | Created In | Mutated By | Read By |
|--------|-----------|-----------|---------|
| `dashState` | `cli.js:188` | `cli-ui.js` callbacks, `cli.js` lifecycle | `dashboard.js` (via `updateDashboard`), SSE clients |
| `AbortController` | `cli.js:126` | SIGINT handler, dashboard `/stop` | `executor.js`, `claude.js` |
| Orchestrator state object | `orchestrator.js` (`readState`) | `runStep` (push to arrays) | `writeState`, `buildProgressState` |

---

## 3. Duplicated State

### 3.1 Filename Constants (Low Risk)

`PROGRESS_FILENAME` and `URL_FILENAME` are defined independently in both `dashboard.js:12-13` and `orchestrator.js:17-18`. These are identical string constants (`'nightytidy-progress.json'` and `'nightytidy-dashboard.url'`).

- **Divergence risk**: If one changes without the other, the dashboard and orchestrator would write/read different files silently.
- **Status**: Document only. Extracting to a shared module would add a dependency for two strings. The values haven't changed since creation and are unlikely to.

### 3.2 Pass/Fail Counters (No Risk)

The same completion data is tracked in three independent locations:
1. `executor.js`: `completedCount` / `failedCount` — authoritative for final results
2. `cli-ui.js`: `passCount` / `failCountLocal` — terminal progress summaries
3. `dashState`: `completedCount` / `failedCount` — dashboard display

All three are incremented synchronously by the same callback events. Divergence is impossible under normal execution. The triplication exists because each consumer has a different lifecycle (executor outlives callbacks; dashState is a shared reference; local vars are closure-scoped).

- **Status**: Document only. Not worth refactoring — the separation is intentional.

---

## 4. Stale State Bugs

### 4.1 Version Cache (No Impact)

`report.js:cachedVersion` is set once on first call to `getVersion()` and never invalidated. If `package.json` were modified during a run, the cached version would be stale.

- **Impact**: None. NightyTidy is a CLI — `package.json` doesn't change during execution.
- **Status**: Document only.

---

## 5. Missing UI States

No gaps found. This is a CLI tool with no async UI states to manage. All async operations (subprocess execution, git operations, dashboard startup) have explicit error handling and timeout management.

---

## 6. Lifecycle Bugs — Fixed

### 6.1 Missing Branch Validation in `runStep` (Fixed)

**Bug**: `orchestrator.js:runStep()` read the state file (which records `runBranch`) and called `executeSingleStep()` without verifying the working tree was actually on that branch. If the branch changed between `--init-run` and `--run-step` (e.g., user ran `git checkout`, a crash left the tree on the wrong branch, or another tool switched branches), the step would execute on the wrong branch — changes would go to `master` or wherever HEAD pointed.

**Trigger**: `--init-run` creates branch `nightytidy/run-X` and checks it out. Later `--run-step` assumes it's still on that branch. Any git operation between these commands (including by Claude Code itself) could violate this assumption.

**Impact**: High — changes applied to wrong branch, bypassing the safety branch isolation.

**Fix**: Added `getCurrentBranch()` check at the start of `runStep()`. Returns a clear error with recovery instructions if the branch doesn't match.

**File**: `src/orchestrator.js:288-296`
**Test**: `test/orchestrator.test.js` — "fails when current branch does not match run branch"

### 6.2 Non-Atomic State File Writes (Fixed)

**Bug**: `orchestrator.js:writeState()` used `writeFileSync()` directly to write the state file. If the process crashed mid-write (e.g., SIGKILL, power loss, disk full), the file would contain partial JSON. On the next `--run-step` or `--finish-run`, `readState()` would parse the partial JSON, hit the try/catch, return `null`, and report "No active orchestrator run" — losing track of the entire run's progress.

**Trigger**: Process kill during `writeState()`. More likely during `--run-step` which writes state after each step completion.

**Impact**: Medium — orchestrator loses track of run progress. Steps already committed to git are preserved, but the orchestrator can't continue the run. User would need to manually create a new state file or start over.

**Fix**: Changed to write-to-temp-then-rename pattern: `writeFileSync(path + '.tmp', ...)` followed by `renameSync(tmp, path)`. `renameSync` is atomic on NTFS (Windows) and most Unix filesystems when source and destination are in the same directory. Also added `.tmp` file to `EPHEMERAL_FILES` in `git.js`.

**File**: `src/orchestrator.js:43-48`, `src/git.js:6`
**Test**: All 53 orchestrator tests pass.

---

## 7. Hydration Mismatches

Not applicable — NightyTidy is a CLI tool with no SSR.

---

## 8. Edge Cases

### 8.1 Concurrent Process Access to State File

**Scenario**: Two terminal sessions run `--run-step` simultaneously against the same project.
**Current behavior**: Lock file prevents this — `acquireLock()` with `persistent: true` creates an atomic lock. Second process fails with "Another NightyTidy run is already in progress."
**Assessment**: Correctly handled.

### 8.2 Orchestrator Dashboard Shutdown Race

**Scenario**: `--finish-run` sends SIGTERM to the dashboard process, waits 500ms, then deletes ephemeral files. The dashboard process could write one more progress update after files are deleted.
**Current behavior**: Dashboard's `pollProgress()` interval (500ms) may fire once more before SIGTERM handler runs. The deleted progress file would be re-created briefly, then the dashboard exits.
**Impact**: Cosmetic — orphaned progress file. Not harmful since `deleteState()` cleans up the state file, and the progress file is read-only by the dashboard.
**Status**: Document only. Adding a longer delay would slow down `--finish-run` for a cosmetic issue.

### 8.3 Orphaned Run Branch on Init Crash

**Scenario**: `--init-run` creates the run branch via `createRunBranch()` but crashes before `writeState()`.
**Current behavior**: Branch exists in git but no state file. Next `--init-run` creates a new branch. Old branch is orphaned.
**Impact**: Low — orphaned branch. Informational check in `checkExistingBranches()` already warns about old NightyTidy branches.
**Status**: Document only.

---

## 9. Re-render Hot Spots

Not applicable — NightyTidy is a CLI tool. The TUI and HTML dashboards are separate processes with their own polling loops. No re-render optimization is needed.

---

## 10. Architecture Assessment

### 10.1 Dual Dashboard Paths

`dashboard.js` manages the in-process HTTP server + TUI for interactive mode. `orchestrator.js` manages a detached `dashboard-standalone.js` process for orchestrator mode. Both write `nightytidy-progress.json` and `nightytidy-dashboard.url`, but with different mechanisms:
- Interactive: `dashboard.js` writes directly + pushes via SSE
- Orchestrator: `orchestrator.js` writes progress, standalone server polls the file

This is intentional — interactive mode needs in-process SSE push for real-time updates, while orchestrator mode needs a detached process that survives between separate CLI invocations. The filename constants are duplicated (see 3.1) but the mechanisms are correctly separated.

### 10.2 Singleton State Without Reset

`logger.js`, `git.js`, and `dashboard.js` use module-level mutable state initialized once per process. None have a `reset()` or `destroy()` function. This is correct for a CLI (each run = one process) but makes unit testing harder — tests must mock the modules or use `vi.resetModules()` for isolation.

The integration tests in `orchestrator-error-paths.test.js` and `orchestrator-lifecycle.test.js` work around this by using `vi.resetModules()` + dynamic `import()` for each test case.

---

## 11. Fixes Applied

| # | File | Issue | Fix | Tests | Commit |
|---|------|-------|-----|-------|--------|
| 1 | `src/orchestrator.js` | `runStep` runs on wrong branch if git state changed | Added `getCurrentBranch()` validation before step execution | 32/32 pass + 1 new test | `fix: add branch validation in orchestrator runStep` |
| 2 | `src/orchestrator.js`, `src/git.js` | `writeState()` can corrupt state file on crash | Write-to-temp-then-rename atomic pattern | 53/53 pass | `fix: atomic state file writes in orchestrator` |

Full suite: **438 tests passing** across 41 test files.

---

## 12. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---------------|--------|----------------|-------------|---------|
| 1 | Extract `PROGRESS_FILENAME`/`URL_FILENAME` to shared constants | Prevents filename divergence between dashboard and orchestrator | Low — values are stable and unlikely to change | Maybe — only if the constants need changing | Define once in a constants module imported by both |
| 2 | Add branch check to `finishRun` before merge | Catches wrong-branch state on finish path too | Low — `finishRun` does `checkout(originalBranch)` which works regardless | No — current behavior is safe |
| 3 | Add `SIGTERM` handler to main process for orchestrator mode cleanup | Currently if parent process is killed, lock file persists | Low — stale lock auto-detected after 24h or PID check | Maybe — only if users report stale lock issues |
