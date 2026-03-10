# Logging & Error Message Quality Report — Run 03 (2026-03-10)

## 1. Executive Summary

| Metric | Count |
|--------|-------|
| User-facing error messages audited | 42 |
| Developer-facing log statements audited | 76 |
| Error handlers/boundaries audited | 27 try/catch + 4 process handlers |
| Messages improved | 1 (orchestrator error passthrough) |
| Documentation sections added | 3 (Step Selection, Git Operations, Orchestrator Mode) |
| Sensitive data exposure instances | 0 |
| Tests passing after changes | 430/430 |

**Overall assessment**: This codebase has **exceptional** error message and logging quality. All user-facing messages follow the `docs/ERROR_MESSAGES.md` style guide: blame-free, specific, actionable, and consistent in tone. Log levels are correctly stratified. Error handlers follow their documented contracts precisely. One data-flow issue was fixed where the orchestrator dropped actual error messages from failed steps, replacing them with a generic placeholder in the report.

---

## 2. User-Facing Error Messages

### Leaked Internals Fixed

**None found.** No stack traces, DB errors, file paths, internal field names, or raw third-party service names are exposed to users.

### Critical-Path Message Assessment

All 8 critical-path checks (git installed, git repo, has commits, Claude CLI, Claude auth, disk space, lock file, step selection) have specific, actionable messages with recovery instructions.

### Generic Messages Replaced

| File | Line | Was | Now | Status |
|------|------|-----|-----|--------|
| `orchestrator.js` | 346 | `'Step failed during orchestrated run'` (always generic) | `s.error \|\| 'Step failed during orchestrated run'` (uses actual error when available) | **Fixed** |

### Messages Still Needing Work

**None.** All messages comply with the `[What happened] + [Why] + [What to do]` template.

### ERROR_MESSAGES.md Updates

Added 3 new sections to `docs/ERROR_MESSAGES.md` covering 14 previously undocumented messages:

- **Step Selection** (`src/cli-ui.js`) — 4 messages: invalid step numbers, non-TTY mode, no steps selected, invalid timeout
- **Git Operations** (`src/git.js`) — 2 messages: tag/branch collision retry exhaustion
- **Orchestrator Mode** (`src/orchestrator.js`) — 7 messages: state conflicts, validation errors, missing state

---

## 3. Sensitive Data in Logs (CRITICAL)

**None found.** Comprehensive review of all 76 log statements confirmed:

- No API keys, credentials, or auth tokens
- No PII or user-submitted content
- No session tokens or internal secrets
- Branch names, tag names, step numbers, durations, and file paths are safe contextual data
- The `cleanEnv()` function strips the `CLAUDECODE` environment variable before spawning subprocesses (prevents token leakage via env inheritance)

---

## 4. Log Level Corrections

**No misleveled logs found.** All levels follow the documented strategy:

| Level | Usage | Count | Appropriate? |
|-------|-------|-------|-------------|
| ERROR | Terminal failures needing attention | 5 | Yes — only unexpected/exhausted failures |
| WARN | Degraded operation, retries, recoverable issues | 24 | Yes — never used for expected conditions |
| INFO | Lifecycle events, state changes, completions | 42 | Yes — not per-request noise |
| DEBUG | Diagnostics for development | 9 | Yes — sparse, one-time per operation |

---

## 5. Log Message Quality Improvements

### Context Assessment

All log messages include sufficient context for 3am debugging:

- **Step operations**: Include step number, step name, attempt count, duration
- **Git operations**: Include branch names, tag names, step numbers
- **Claude subprocess**: Includes label, attempt counter, duration, error message
- **Dashboard**: Includes URL, PID, error messages
- **Lock file**: Includes PID, timestamp

### Noise Assessment

No hot-path logging issues. The highest-frequency messages are:
- `claude.js:191,194` — WARN on retry (max 3 retries per step, 10s apart). Intentional for visibility.
- `cli-ui.js:63` — Progress summary every 5 steps. Bounded and appropriate.

### Missing Logs on Critical Operations

**None found.** All significant operations have appropriate logging.

---

## 6. Error Handler Assessment

| Handler | Location | Differentiates? | Logs Properly? | Has Ref ID? | Sanitizes? |
|---------|----------|-----------------|----------------|-------------|------------|
| Top-level catch-all | `cli.js:299` | No (catches all) | Yes (ERROR + DEBUG stack) | No (timestamp in log) | Yes (clean message to terminal) |
| Unhandled rejection | `cli.js:113` | Yes (Error vs other) | Yes (ERROR to file) | No | Yes (generic to terminal) |
| SIGINT handler | `cli.js:123` | Yes (first vs second) | Yes (INFO) | N/A | N/A |
| Pre-check validators | `checks.js` | Yes (7 distinct checks) | Yes (INFO per check) | N/A | Yes (user-friendly throws) |
| Claude subprocess | `claude.js:73-129` | Yes (6 error paths) | Yes (WARN per failure) | No | Yes (result objects) |
| Step execution | `executor.js:59-111` | Yes (prompt fail vs doc fail vs commit fail) | Yes (ERROR/WARN/INFO) | No | Yes (result objects) |
| Git merge | `git.js:168-185` | Yes (conflict vs other) | Yes (WARN + DEBUG) | No | Yes (result objects) |
| Lock acquisition | `lock.js:88-127` | Yes (EEXIST, stale, active, race) | Yes (DEBUG/WARN) | Yes (PID + timestamp) | Yes (user-friendly throws) |
| Orchestrator | `orchestrator.js` | Yes (state, validation) | Yes (INFO/WARN) | No | Yes (JSON result objects) |
| Notifications | `notifications.js` | No (swallows all) | Yes (WARN) | N/A | N/A |
| Dashboard | `dashboard.js` | No (swallows all) | Yes (WARN) | N/A | N/A |
| Report generation | `report.js` | No (warns and continues) | Yes (WARN) | N/A | N/A |

All handlers comply with their documented contracts in CLAUDE.md.

---

## 7. Consistency Findings

### Error Code Coverage

No machine-readable error codes are used (e.g., `CARD_DECLINED`, `EMAIL_TAKEN`). This is appropriate for a CLI tool — errors are human-readable strings, not API responses parsed by other systems.

### Log Format Assessment

- **Single logging library**: `logger.js` used consistently across all modules
- **Consistent field format**: `[ISO timestamp] [LEVEL] message`
- **No `console.log` in core modules**: Only in `cli.js`/`cli-ui.js` for terminal UX (per CLAUDE.md convention)
- **No raw `console.error` in core modules**: Logger's `error()` function handles file + stderr
- **No field name inconsistencies**: No competing formats (userId vs user_id vs uid)

### Standardization

No changes needed. The codebase already uses a single logging library with consistent formatting.

---

## 8. Logging Infrastructure Recommendations

**No immediate gaps.** The current infrastructure is appropriate for a CLI tool:

- **Structured logging**: Not needed — this is a CLI tool, not a server with log aggregation
- **Log correlation/request IDs**: Not needed — each run creates a fresh `nightytidy-run.log` that serves as the "session"
- **Centralized redaction**: Not needed — no sensitive data enters the logging pipeline
- **Hot-path sampling**: Not needed — no hot-path logging exists

---

## 9. Bugs Discovered

### BUG: Orchestrator drops actual error messages from failed steps

**Severity**: Medium — affects report quality for orchestrator-mode users
**Location**: `orchestrator.js:290,346`

**Root cause**: When `executeSingleStep()` returns a failed step with `result.error` (e.g., `"Failed after 4 attempts"` or `"Claude Code timed out after 45 minutes"`), the orchestrator's `runStep()` creates a state entry that omits the `error` field. Later, `finishRun()` constructs the report data and uses the hardcoded string `'Step failed during orchestrated run'` instead of the actual error.

**Impact**: NIGHTYTIDY-REPORT.md generated in orchestrator mode shows a generic "Step failed during orchestrated run" for every failed step, instead of the actual error (timeout, empty output, exit code, etc.). Interactive mode reports are unaffected.

**Fix applied**: Added `error: result.error || null` to the state entry in `runStep()`, and changed `finishRun()` to use `s.error || 'Step failed during orchestrated run'` (preserving the generic fallback for entries from runs before this fix).

---

## Changes Made

1. **`src/orchestrator.js:290`** — Added `error: result.error || null` to step state entry (captures actual error)
2. **`src/orchestrator.js:346`** — Changed to `s.error || 'Step failed during orchestrated run'` (forwards actual error to report)
3. **`docs/ERROR_MESSAGES.md`** — Added 3 new sections: Step Selection (4 messages), Git Operations (2 messages), Orchestrator Mode (7 messages)
