# Type Safety & Error Handling Hardening Report

**Run**: 01
**Date**: 2026-03-10
**Project**: NightyTidy
**Language**: JavaScript (ESM, no TypeScript)
**Files audited**: 16 source files in `src/`
**Tests**: 430 passing (40 test files)

---

## 1. Summary

| Metric | Count |
|--------|-------|
| JSDoc annotations added | 44 (all exported functions + 1 constant) |
| Type coercion bugs fixed | 2 |
| `@ts-ignore` comments removed | 0 (n/a — JavaScript) |
| Return type annotations added | 44 (via `@returns` JSDoc) |
| Empty catch blocks fixed | 0 (all intentional and documented) |
| Unhandled async errors fixed | 0 (none found) |
| Error format inconsistencies fixed | 0 (none found) |
| Tests still passing | **yes** (430/430) |

---

## 2. Type Safety Improvements Made

### Code Fixes

| File | Change | Risk Level | Before | After |
|------|--------|-----------|--------|-------|
| `src/lock.js:26` | Fix PID 0 edge case in `isLockStale()` | Low | `!lockData.pid` (falsy — treats PID 0 as dead) | `lockData.pid == null` (only null/undefined) |
| `src/cli-ui.js:147` | Use strict NaN check in `selectSteps()` | Low | `isNaN(n)` (legacy, coerces input) | `Number.isNaN(n)` (strict, no coercion) |

### JSDoc Annotations Added (44 total)

| File | Functions Annotated | Notes |
|------|-------------------|-------|
| `src/logger.js` | 5 (`initLogger`, `debug`, `info`, `warn`, `error`) | Universal dependency — typed first |
| `src/lock.js` | 2 (`releaseLock`, `acquireLock`) | Async contract documented |
| `src/notifications.js` | 1 (`notify`) | Fire-and-forget contract noted |
| `src/git.js` | 10 (`initGit`, `excludeEphemeralFiles`, `getCurrentBranch`, `createPreRunTag`, `createRunBranch`, `getHeadHash`, `hasNewCommit`, `fallbackCommit`, `mergeRunBranch`, `getGitInstance`) | Return types include `string | null`, discriminated unions |
| `src/claude.js` | 2 (`cleanEnv`, `runPrompt`) | Full result object shape documented |
| `src/checks.js` | 1 (`runPreChecks`) | Throws contract documented |
| `src/report.js` | 3 (`getVersion`, `formatDuration`, `generateReport`) | Complex param shapes typed |
| `src/setup.js` | 2 (`generateIntegrationSnippet`, `setupProject`) | String literal return type documented |
| `src/cli-ui.js` | 6 (`extractStepDescription`, `buildStepCallbacks`, `printCompletionSummary`, `selectSteps`, `showWelcome`, `printStepList`) | Callback shapes typed |
| `src/dashboard.js` | 4 (`startDashboard`, `updateDashboard`, `stopDashboard`, `scheduleShutdown`) | Return type ambiguity documented |
| `src/dashboard-html.js` | 1 (`getHTML`) | CSRF token param typed |
| `src/dashboard-tui.js` | 3 (`formatMs`, `progressBar`, `render`) | TUI types documented |
| `src/executor.js` | 3 (`SAFETY_PREAMBLE`, `executeSingleStep`, `executeSteps`) | Full result shapes typed |
| `src/orchestrator.js` | 3 (`initRun`, `runStep`, `finishRun`) | Discriminated union returns documented |
| `src/cli.js` | 1 (`run`) | Entry point |

---

## 3. Type Safety Improvements Recommended (Not Implemented)

### Structural Improvements for Team Discussion

1. **TypeScript migration for `orchestrator.js` and `executor.js`**: These modules have the most complex return types (discriminated unions with many fields). TypeScript would catch shape mismatches at compile time. Estimated effort: medium (these two files + their test files).

2. **Branded types for step numbers**: Step numbers are plain `number` throughout. A branded type (e.g., `StepNumber`) would prevent accidentally passing an array index where a step number is expected.

3. **`dashboard.js` return type normalization**: `startDashboard()` returns `{ url: null, port: null }` when only TUI is running vs `null` on complete failure. Consider a discriminated union like `{ mode: 'full', url, port } | { mode: 'tui-only' } | null` for clearer caller semantics. Current behavior is correct but requires reading the source to understand the distinction.

4. **State file schema validation**: `orchestrator.js` reads `nightytidy-run-state.json` and trusts the shape after a version check. A lightweight schema validator (or JSDoc `@typedef`) would catch corrupt state files earlier.

---

## 4. Error Handling Fixes Made

**None required.** Error handling audit found 100% compliance with documented contracts.

---

## 5. Error Handling Infrastructure Assessment

### Current State: Excellent (A grade)

**What's good:**
- Every module follows its documented error contract exactly (verified by `contracts.test.js` — 46 tests)
- All intentional error swallowing is documented with inline comments explaining *why*
- Consistent pattern: `claude.js`, `executor.js`, `orchestrator.js` use result objects; `checks.js`, `lock.js` throw with user-friendly messages
- Top-level boundary in `cli.js` catches everything with proper cleanup
- `unhandledRejection` safety net with informative error message
- Desktop notifications on both success and failure paths

**What's not needed:**
- Custom error classes: Not warranted. The codebase has a flat module structure with clear error contracts. Custom classes would add complexity without reducing bugs.
- Error reporting/monitoring: Not applicable for a CLI tool that runs locally.
- Global error handler: Already exists (`cli.js` master try/catch + `unhandledRejection` handler).

### Contract Compliance Table

| Module | Contract | Status |
|--------|----------|--------|
| `checks.js` | Throws with user-friendly messages | PASS |
| `lock.js` | Async, throws with user-friendly messages | PASS |
| `claude.js` | Never throws — returns result objects | PASS |
| `executor.js` | Never throws — failed steps recorded | PASS |
| `git.js` `mergeRunBranch` | Never throws — returns `{ success: false, conflict: true }` | PASS |
| `notifications.js` | Swallows all errors silently | PASS |
| `dashboard.js` | Swallows all errors silently | PASS |
| `report.js` | Warns but never throws | PASS |
| `orchestrator.js` | Never throws — returns `{ success: false, error }` | PASS |
| `cli.js` | Top-level try/catch | PASS |

---

## 6. Bugs Discovered

### Bug: `lock.js` PID 0 false positive (Fixed)

**Severity**: Low
**Location**: `src/lock.js:26` (`isLockStale()`)
**Description**: The falsy check `!lockData.pid` treated PID 0 as "no PID", causing the lock to be considered stale when PID 0 (Windows System process) was the lock holder. While PID 0 is extremely unlikely as a NightyTidy process, the fix is trivial and eliminates a class of bugs.
**Fix**: Changed to `lockData.pid == null` which only matches `null` and `undefined`, not `0`.

### Non-Bug: `cli-ui.js` `isNaN()` vs `Number.isNaN()` (Fixed)

**Severity**: Cosmetic
**Location**: `src/cli-ui.js:147`
**Description**: `isNaN()` was used to check `parseInt()` results. Since `parseInt()` only returns `NaN` or a number, both `isNaN()` and `Number.isNaN()` produce identical results here. Changed to `Number.isNaN()` for consistency with modern JavaScript best practices and to signal intent clearly.

---

## 7. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? |
|---|---|---|---|---|
| 1 | Add TypeScript to orchestrator.js + executor.js | Catches shape mismatches in complex return types | Low | Only if time allows |
| 2 | Normalize dashboard.js return type | Clearer caller semantics, less need to read source | Low | Probably |
| 3 | Add @typedef for state file schema | Catches corrupt state earlier, better IDE support | Low | Only if time allows |

The codebase is in excellent shape for a JavaScript project. The combination of JSDoc annotations (now complete), strict error contracts (verified by 46 contract tests), and defensive coding patterns makes it substantially more robust than typical JS codebases of this size.
