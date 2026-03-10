# File Decomposition Report — Run 03 (2026-03-10)

## 1. Executive Summary

- **Files analyzed**: 17 source files (src/ + bin/)
- **Files over 300 lines**: 4 (steps.js, cli.js, dashboard-html.js, orchestrator.js)
- **Files split**: 1 (cli.js → cli.js + cli-ui.js)
- **Files skipped**: 3 (with documented reasoning)
- **Splits attempted & reverted**: 0
- **All 430 tests passing**: Yes (40 test files, 0 failures)
- **Largest file reduction**: cli.js went from 529 → 319 lines (40% reduction)

## 2. File Size Inventory

### All Source Files (Before → After)

| File | Before (lines) | After (lines) | Action | New Files Created |
|------|----------------|---------------|--------|-------------------|
| `src/prompts/steps.js` | 5,422 | 5,422 | SKIP — auto-generated | — |
| `src/cli.js` | 529 | 319 | **SPLIT** | `src/cli-ui.js` (218 lines) |
| `src/dashboard-html.js` | 411 | 411 | SKIP — monolithic template | — |
| `src/orchestrator.js` | 400 | 400 | SKIP — single responsibility | — |
| `src/dashboard.js` | 238 | 238 | Under threshold | — |
| `src/checks.js` | 228 | 228 | Under threshold | — |
| `src/cli-ui.js` | — | 218 | **NEW** | — |
| `src/claude.js` | 200 | 200 | Under threshold | — |
| `src/dashboard-tui.js` | 184 | 184 | Under threshold | — |
| `src/report.js` | 162 | 162 | Under threshold | — |
| `src/git.js` | 144 | 144 | Under threshold | — |
| `src/executor.js` | 141 | 141 | Under threshold | — |
| `src/dashboard-standalone.js` | 124 | 124 | Under threshold | — |
| `src/lock.js` | 118 | 118 | Under threshold | — |
| `src/setup.js` | 99 | 99 | Under threshold | — |
| `src/logger.js` | 54 | 54 | Under threshold | — |
| `src/notifications.js` | 16 | 16 | Under threshold | — |
| `bin/nightytidy.js` | 3 | 3 | Under threshold | — |

## 3. Splits Executed

### cli.js → cli.js + cli-ui.js

- **Original**: `src/cli.js` — 529 lines, 1 export (`run()`)
- **Rationale**: File contained two clearly distinct responsibilities: (1) UI/display/interaction functions and (2) lifecycle orchestration logic

**New file: `src/cli-ui.js` (218 lines)**

Exports moved:
- `extractStepDescription(prompt)` — prompt text utility (pure function)
- `buildStepCallbacks(spinner, selected, dashState)` — dashboard/spinner callback factory
- `printCompletionSummary(executionResults, mergeResult, opts)` — completion output with notifications
- `selectSteps(opts)` — interactive/CLI step selection (checkbox or --all/--steps)
- `showWelcome()` — welcome banner display
- `printStepList()` — step listing with descriptions

Constants moved:
- `PROGRESS_SUMMARY_INTERVAL` (5)
- `DESC_MAX_LENGTH` (72)

**Remaining in `src/cli.js` (319 lines)**

- `handleAbortedRun()` — abort path with git operations + process.exit
- `run()` — main lifecycle orchestration (Commander setup, init sequence, execution, reporting, merge)

**Import references updated**: 1 (cli.js now imports from cli-ui.js)

**External import changes**: None. No test files required modification because:
- All dependencies (logger, notifications, dashboard, report, steps) are mocked at module level via `vi.mock()`, which applies regardless of which file imports them
- The only export from cli.js (`run()`) did not change
- No test files reference internal helper functions directly

**Test/build status**: All 430 tests pass. No regressions.

**Commit**: `4c53f1d` — `refactor: decompose cli.js into cli.js + cli-ui.js`

## 4. Splits Attempted but Reverted

None.

## 5. Files Skipped (Over 300 Lines)

### `src/prompts/steps.js` (5,422 lines) — DO NOT SPLIT

CLAUDE.md explicitly states: "Never edit `src/prompts/steps.js` manually — auto-generated from external `extracted-prompts.json`". This is a data-only file containing 28 improvement prompts plus 2 special prompts. Splitting auto-generated content would create maintenance overhead and conflict with the generation pipeline.

### `src/dashboard-html.js` (411 lines) — Inherently Monolithic

Single function `getHTML(csrfToken)` returning a complete HTML document with embedded CSS and client-side JavaScript. Splitting this template into separate CSS/JS files would:
- Break the self-contained nature of the template (it's served as a single response)
- Add import complexity for no readability gain
- Require a build/bundling step that doesn't exist in this project

The file is well-organized with clear sections (CSS → HTML → JS) and is easy to navigate as-is.

### `src/orchestrator.js` (400 lines) — Single Responsibility, Helpers Too Small

Contains 3 exports (`initRun`, `runStep`, `finishRun`) plus internal helpers:
- State management (`readState`, `writeState`, `deleteState`) — ~25 lines
- Result helpers (`ok`, `fail`, `validateStepNumbers`) — ~18 lines
- Progress/dashboard (`buildProgressState`, `writeProgress`, `cleanupDashboard`, `spawnDashboardServer`, `stopDashboardServer`) — ~90 lines

While these represent distinct concerns, each group is too small (18-90 lines) to justify a separate module. All helpers are private (unexported) and used only within orchestrator.js. Splitting would create 2-3 tiny modules each with a single consumer, adding import indirection without meaningful separation of concerns. The file is well-organized with clear section boundaries.

## 6. Structural Observations (Documentation Only)

### Directory Structure

The project has a flat `src/` directory with 16 files. This is appropriate for the current size. The `dashboard-*` family (4 files: dashboard.js, dashboard-html.js, dashboard-standalone.js, dashboard-tui.js) could potentially be grouped into a `src/dashboard/` subdirectory, but this would:
- Require updating 6+ import paths across the codebase
- Require updating all test mock paths
- Not provide meaningful organizational benefit at 4 files

**Recommendation**: Not worth doing now. Revisit if the dashboard family grows to 6+ files.

### Barrel Files

The project does not use barrel files (index.js re-exports), which is the correct choice for this codebase:
- Internal-only consumption (no external library consumers)
- Each module has a clear, small API surface
- Direct imports make dependency tracking trivial
- No tree-shaking concerns (not a library)

### Shared Module Opportunities

No shared module extraction needed. `logger.js` already serves as the universal shared dependency. The split did not reveal any duplicated utility code between modules.

### Import Fan-Out Analysis

| Module | Importers | Risk Level |
|--------|-----------|------------|
| `logger.js` | 11 | Stable — universal dependency, rarely changes |
| `git.js` | 7 | Moderate — 10 exports, used across orchestration layer |
| `claude.js` | 7 | Low — single export, stable API |
| `executor.js` | 6 | Low — 3 exports, stable API |
| `cli-ui.js` (new) | 1 | Very low — single consumer (cli.js) |

## 7. File Size Distribution

| Range | Before | After |
|-------|--------|-------|
| 0-100 lines | 4 | 4 |
| 100-200 lines | 7 | 7 |
| 200-300 lines | 2 | 3 |
| 300-500 lines | 2 | 2 |
| 500+ lines (excl. generated) | 1 | 0 |
| Generated (>1000) | 1 | 1 |

**Key improvement**: The only non-generated file over 500 lines (cli.js at 529) has been reduced to 319 lines. The largest non-generated file is now orchestrator.js at 400 lines.

## 8. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| 1 | Group dashboard-* into subdirectory | Improved discoverability | Low | Only if time allows | 4 related files (dashboard.js, dashboard-html.js, dashboard-standalone.js, dashboard-tui.js) share a common concern. Would require updating ~10 import paths. Not urgent at current project size. |

No critical or high-risk recommendations. The codebase has good module boundaries with most files well under 300 lines. The remaining >300-line files (orchestrator.js at 400, dashboard-html.js at 411) have legitimate structural reasons for their size.
