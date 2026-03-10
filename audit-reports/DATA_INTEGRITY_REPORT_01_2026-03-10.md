# Data Integrity & Validation Audit Report

**Date**: 2026-03-10
**Run**: 01
**Overall Health**: Fair
**Tests**: 430 passing (all green after fixes)

---

## 1. Executive Summary

NightyTidy is a CLI orchestration tool (no database, no web API), so the classic "database constraint" and "schema drift" phases don't apply. Instead, the audit focused on:

- **Input validation** at CLI argument boundaries, environment variables, subprocess outputs, and file I/O
- **Data file constraints** on the state file, progress JSON, lock file, and git exclude file
- **Orphan/cleanup risks** for spawned processes, ephemeral files, timers, and event listeners
- **Enum/status consistency** across 10+ modules using string-based status values

**Critical findings**: 2 bugs fixed (dashboard-standalone poll timer leak, lock file NaN timestamp), 6 validation gaps hardened, 8 orphan risks documented, 1 enum gap identified.

**Totals**:
- Input boundaries audited: 45+
- Validation gaps found: 14 (6 fixed, 8 documented)
- Orphan risks found: 8 significant
- Enum inconsistencies: 1

---

## 2. Input Validation

### 2.1 Fixes Implemented

| Location | Issue | Fix |
|----------|-------|-----|
| `src/cli.js:81-84` | `--timeout` had no upper bound (could overflow) | Added max 1440 minutes (24h) check |
| `src/report.js:28` | `formatDuration()` crashed on NaN/undefined/negative input | Guard returns `'0m 00s'` for invalid input |
| `src/dashboard-tui.js:39` | `formatMs()` crashed on NaN/undefined/negative input | Guard returns `'0s'` for invalid input |
| `src/dashboard-tui.js:55-57` | `progressBar()` produced NaN% on undefined done/total | Safe coercion to 0 for non-numeric inputs |
| `src/orchestrator.js:27-37` | State file had no schema validation beyond version check | Added required field validation (selectedSteps, completedSteps, failedSteps, startTime, runBranch, originalBranch) |
| `src/orchestrator.js:190-191` | `--steps` with all-non-numeric input silently produced empty array | Filter NaN values, return explicit error if no valid numbers remain |

### 2.2 Remaining Gaps (Documented, Not Fixed)

| Location | Issue | Severity | Reason Not Fixed |
|----------|-------|----------|------------------|
| `src/cli.js:65` | `parseInt("45min")` silently returns 45 (ignores trailing text) | Low | Commander's built-in `parseInt` coercion; changing would break the API |
| `src/cli.js:67` | `--json` flag is only meaningful with `--list` but accepted silently with other commands | Low | No user harm; documenting is sufficient |
| `src/checks.js:166-167` | `df -k` output parsing assumes GNU format (column 4 = free space) | Medium | Would require platform-specific refactoring; current fallback handles parse failure gracefully |
| `src/checks.js:159` | `wmic` output regex `/(\d+)/` matches any digit sequence, not just the correct column | Medium | wmic is deprecated fallback; PowerShell path is primary |
| `src/claude.js:44` | `STDIN_THRESHOLD` (8000 chars) is a magic constant, not configurable | Low | Internal implementation detail; no user exposure |
| `src/orchestrator.js:136` | Dashboard server JSON parse could crash on malformed output | Medium | Wrapped in try/catch at outer level; explicit inner guard would be defense-in-depth |
| `src/cli-ui.js:170` | `--steps` allows duplicate numbers (e.g., `--steps 1,1,1`) | Low | Duplicates are harmless (step runs once) |
| `src/cli-ui.js:199-202` | Zero interactive selections exits with code 0 instead of code 1 | Low | Intentional UX — user chose nothing, not an error |

### 2.3 Unvalidated Endpoints (N/A)

NightyTidy has no HTTP API endpoints for external consumers. The dashboard HTTP server (`dashboard.js`, `dashboard-standalone.js`) serves only `GET /`, `GET /events`, and `POST /stop` — all validated with CSRF tokens, body size limits, and security headers. No gaps found.

### 2.4 Frontend vs. Backend Consistency (N/A)

No frontend/backend split exists. The dashboard HTML is a read-only display with one CSRF-protected stop button.

---

## 3. Data File Constraints

NightyTidy uses file-based state instead of a database. The equivalent of "schema constraints" are the structural expectations each module has for the files it reads.

### 3.1 State File (`nightytidy-run-state.json`)

| Field | Type | Constraint | Enforced? | Notes |
|-------|------|-----------|-----------|-------|
| `version` | number | Must equal `STATE_VERSION` (1) | **Yes** — `readState()` returns null on mismatch | |
| `selectedSteps` | number[] | Must be array | **Yes** — added in this audit | |
| `completedSteps` | object[] | Must be array | **Yes** — added in this audit | |
| `failedSteps` | object[] | Must be array | **Yes** — added in this audit | |
| `startTime` | number | Must be number (ms timestamp) | **Yes** — added in this audit | |
| `runBranch` | string | Must be string | **Yes** — added in this audit | |
| `originalBranch` | string | Must be string | **Yes** — added in this audit | |
| `tagName` | string | Used in finishRun | **No** — not validated | Low risk: only used in report and merge |
| `timeout` | number\|null | Per-step timeout | **No** — not validated | Low risk: null falls through to default |
| `dashboardPid` | number\|null | Dashboard process PID | **No** — not validated | Low risk: null causes no-op in stopDashboardServer |
| `dashboardUrl` | string\|null | Dashboard URL | **No** — not validated | Low risk: informational only |

### 3.2 Lock File (`nightytidy.lock`)

| Field | Type | Constraint | Enforced? | Notes |
|-------|------|-----------|-----------|-------|
| `pid` | number | Process ID | **Partial** — null/undefined check, then `process.kill(pid, 0)` | PID 0 edge case handled with `== null` check |
| `started` | string (ISO) | ISO timestamp | **Yes** — NaN age now treated as stale (fixed in this audit) | Previously, invalid timestamp was treated as fresh lock |

### 3.3 Progress File (`nightytidy-progress.json`)

| Field | Type | Constraint | Enforced? | Notes |
|-------|------|-----------|-----------|-------|
| All fields | object | JSON parse | **Yes** — try/catch in all readers | |
| `status` | string | Enum value | **No** — falls through to defaults | See enum consistency section |
| `completedCount` | number | Non-negative | **No** — NaN propagation possible | Fixed in `progressBar()` with safe coercion |
| `totalSteps` | number | Positive | **No** — zero division guarded in `progressBar()` | |

### 3.4 Git Exclude File (`.git/info/exclude`)

| Aspect | Status | Notes |
|--------|--------|-------|
| Idempotent writes | **Yes** | `content.includes(f)` check before append |
| Line ending consistency | **Partial** | Adds separator if file doesn't end with `\n`, but doesn't normalize existing CRLF |
| Duplicate comment headers | **No** | Each `excludeEphemeralFiles()` call on a fresh file adds `# NightyTidy ephemeral files` comment; idempotency check prevents duplicate entries but not duplicate comments |

---

## 4. Orphaned Data & Cleanup Risks

### 4.1 Process Orphan Risks

| Spawned Process | Cleanup Mechanism | Orphan Risk | Severity |
|----------------|-------------------|-------------|----------|
| Dashboard standalone server | `stopDashboardServer(pid)` sends SIGTERM; `--finish-run` calls it | **FIXED**: Poll interval was leaked (function ref instead of interval ID passed to `clearInterval`) | **High** (fixed) |
| TUI terminal window | `unref()` — relies on user closing window | **Medium**: If progress file is deleted, TUI polls indefinitely without exiting | Medium |
| Claude Code subprocess | `forceKillChild()` — SIGTERM then SIGKILL after 5s | **Low-Medium**: SIGKILL timer may outlive parent process if parent exits first | Low-Medium |
| Dashboard spawn error path | Resolves promise without cleanup | **FIXED**: Added `removeAllListeners()` and `unref()` to error handler | Medium (fixed) |

### 4.2 Ephemeral File Lifecycle

| File | Created | Deleted | Crash Risk |
|------|---------|---------|------------|
| `nightytidy-run.log` | `initLogger()` | Never (user reviews it) | None — intentionally persistent |
| `nightytidy-progress.json` | `startDashboard()` / `writeProgress()` | `stopDashboard()` / `cleanupDashboard()` | Left behind on crash — harmless, overwritten next run |
| `nightytidy-dashboard.url` | `startDashboard()` | `stopDashboard()` / `cleanupDashboard()` | Left behind on crash — harmless, overwritten next run |
| `nightytidy.lock` | `acquireLock()` | `process.on('exit')` / `releaseLock()` | Left behind on SIGKILL — stale detection handles it (24h timeout or dead PID) |
| `nightytidy-run-state.json` | `initRun()` | `finishRun()` via `deleteState()` | Left behind if orchestrator crashes — user must delete manually or call `--finish-run` |

### 4.3 Timer/Listener Leaks

| Resource | Location | Cleanup | Risk |
|----------|----------|---------|------|
| `process.on('SIGINT')` | `cli.js:123` | Never removed | Multiple registrations if `run()` called multiple times (test scenario only) |
| `process.on('unhandledRejection')` | `cli.js:113` | Never removed | Same as above |
| `process.on('exit')` | `lock.js:123` | Never removed | Accumulates if `acquireLock()` called multiple times |
| `shutdownTimer` | `dashboard.js:254` | Cleared in `stopDashboard()` | Safe — idempotent cleanup |
| SSE clients | `dashboard.js:47` | Cleared in `stopDashboard()` | Safe — closed and cleared |

### 4.4 Diagnostic Queries (Manual Review)

These are file-system equivalents of "diagnostic queries" for detecting orphaned data:

```bash
# Find orphaned lock files (should be empty if no run is active)
find . -name "nightytidy.lock" -mmin +1440

# Find orphaned state files (should not exist outside an active orchestrator run)
find . -name "nightytidy-run-state.json"

# Find orphaned dashboard files (should be cleaned up by stopDashboard)
find . -name "nightytidy-dashboard.url" -o -name "nightytidy-progress.json"

# Find orphaned dashboard processes
ps aux | grep dashboard-standalone
```

---

## 5. Schema Drift (N/A for CLI tool)

NightyTidy has no database or ORM. The equivalent analysis was performed on the state file schema (Section 3.1) and the progress file schema (Section 3.3).

### 5.1 Raw Data Access

All file reads use `JSON.parse()` wrapped in try/catch. No raw SQL or unparameterized queries exist.

### 5.2 Enum/Status Consistency

**Run-level status values** (8 values used across 6 modules):

| Status | Set In | Checked In | Consistent? |
|--------|--------|-----------|-------------|
| `'starting'` | `cli.js:187` | `dashboard-tui.js` STATUS_COLORS | Yes |
| `'running'` | `cli-ui.js:74`, `orchestrator.js:77` | `dashboard-tui.js`, `dashboard-html.js` | Yes |
| `'finishing'` | `cli.js:251` | `dashboard-tui.js` STATUS_COLORS | Yes |
| `'completed'` | `cli.js:298`, `orchestrator.js:394` | `dashboard-tui.js`, `dashboard-html.js` | Yes |
| `'stopped'` | `cli.js:242` | `dashboard-tui.js`, `dashboard-html.js` | Yes |
| `'error'` | `cli.js:313` | `dashboard-tui.js`, `dashboard-html.js` | Yes |

**Step-level status values** (4 values used across 5 modules):

| Status | Set In | Checked In | Consistent? |
|--------|--------|-----------|-------------|
| `'pending'` | `cli.js:191`, `orchestrator.js:88` | `dashboard-tui.js` (fallback only), `dashboard-html.js` (fallback only) | **Partial** — no explicit handling, relies on default fallback |
| `'running'` | `cli-ui.js:77`, `orchestrator.js:287` | `dashboard-tui.js:82`, `dashboard-html.js:337` | Yes |
| `'completed'` | `executor.js:110`, `cli-ui.js:89`, `orchestrator.js:296` | `executor.js:141`, `report.js:74`, `dashboard-tui.js:79`, `dashboard-html.js:338` | Yes |
| `'failed'` | `executor.js:80`, `cli-ui.js:98`, `orchestrator.js:298` | `executor.js:141`, `report.js:86`, `dashboard-tui.js:80`, `dashboard-html.js:339` | Yes |

**Gap found**: `'pending'` step status has no explicit color in `dashboard-tui.js` STATUS_COLORS and no explicit icon case in `stepIcon()`. Falls through to white color and dim circle. Functionally correct but fragile — any new status would silently use the same defaults.

**Case consistency**: All status values are lowercase throughout. No case mismatches found.

---

## 6. Business Invariants

| # | Invariant | Currently Enforced? | Diagnostic | Recommendation |
|---|-----------|---------------------|-----------|----------------|
| 1 | Logger must be initialized before any module logs | **Partial** — convention, not enforced | Call `info()` before `initLogger()` → throws | Consider a "not initialized" guard in logger that throws with clear message |
| 2 | Git must be initialized before git operations | **No** — null reference error | Call `getHeadHash()` before `initGit()` → crash | Document in CLAUDE.md (already documented) |
| 3 | Lock must be acquired before execution starts | **Yes** — enforced in both `cli.js` and orchestrator | Attempt concurrent runs → lock error | Atomic O_EXCL |
| 4 | Ephemeral files must be excluded before git operations | **Yes** — `excludeEphemeralFiles()` called before execution | Check `.git/info/exclude` | Idempotent |
| 5 | Step numbers must be in range 1-28 | **Yes** — `validateStepNumbers()` in orchestrator, `selectSteps()` in CLI | Pass out-of-range number | Error returned |
| 6 | A step can only be run once per orchestrator run | **Yes** — `completedSteps`/`failedSteps` membership check | Attempt duplicate step | Error returned |
| 7 | State file must exist for `--run-step` and `--finish-run` | **Yes** — `readState()` returns null → error | Delete state file mid-run | Error returned |
| 8 | All status transitions follow: pending → running → completed\|failed | **Partial** — no state machine enforcement | Set status to invalid value | Silent; dashboard shows fallback color |
| 9 | `STEPS_HASH` must match prompt content | **Warn only** — does not block execution | Modify a prompt → hash mismatch warning | By design: allows legitimate prompt changes |
| 10 | Safety tag must be created before run branch | **Yes** — sequential calls in init | Tag creation failure → throws | Caught by top-level try/catch |

---

## 7. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| 1 | Add `'pending'` to `dashboard-tui.js` STATUS_COLORS | Consistent step coloring in TUI | Low | Only if time allows | Functional fallback exists (white color). Adding explicit entry prevents future confusion and makes the status enum self-documenting. |
| 2 | Centralize status constants in a shared module | Prevents typos and drift as codebase grows | Medium | Probably | Currently 8 run statuses and 4 step statuses are string literals scattered across 10 modules. A `src/constants.js` with exported enums would catch typos at import time. |
| 3 | Add fallback exit to dashboard-tui polling | Prevents TUI window from hanging indefinitely | Medium | Yes | If the progress file is missing for 60+ seconds, the TUI should exit gracefully instead of polling forever. |
| 4 | Guard `formatDate()` in report.js against invalid timestamps | Prevents crash during report generation | High | Yes | `new Date(undefined).toISOString()` throws. If metadata.startTime is ever invalid, report generation crashes. Add a `typeof` guard similar to `formatDuration()`. |
| 5 | Add EventSource close on page unload in dashboard HTML | Prevents reconnection storms on browser close | Low | Only if time allows | Browser EventSource auto-reconnects; closing on `beforeunload` is cleaner but not critical since the server handles dead connections. |

---

*Generated by NightyTidy Data Integrity Audit, run 01, 2026-03-10*
