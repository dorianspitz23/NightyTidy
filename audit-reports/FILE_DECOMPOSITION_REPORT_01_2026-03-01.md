# File Decomposition Report — Run 01 — 2026-03-01

## Executive Summary

Analyzed 10 source files (6,474 LOC) and 18 test files (3,431 LOC) across the NightyTidy codebase. **No splits were executed** — the codebase is already well-decomposed. The only file exceeding the 300-line threshold is `src/prompts/steps.js` (5,422 lines), which is auto-generated data and explicitly excluded from manual editing. All 136 tests pass.

---

## File Size Inventory

### Source Files (src/ + bin/)

| File | Lines | Primary Responsibility | Exports | Imported By (files) | Classification |
|------|------:|----------------------|--------:|--------------------:|---------------|
| src/prompts/steps.js | 5,422 | Auto-generated prompt data (28 steps + 2 templates) | 3 | 3 | **Inherently monolithic** — auto-generated |
| src/cli.js | 282 | Full lifecycle orchestration (welcome → checks → execute → report → merge) | 1 | 2 | Under threshold |
| src/checks.js | 187 | Pre-run validation (5 checks: git, repo, CLI, auth, disk) | 1 | 4 | Under threshold |
| src/claude.js | 183 | Claude Code subprocess wrapper (spawn, retry, timeout) | 1 | 6 | Under threshold |
| src/report.js | 144 | Report generation + CLAUDE.md auto-update | 2 | 5 | Under threshold |
| src/git.js | 97 | Git operations via simple-git singleton | 9 | 7 | Under threshold |
| src/executor.js | 92 | Core step execution loop | 1 | 4 | Under threshold |
| src/logger.js | 48 | File + stdout logger with chalk coloring | 5 | 10 | Under threshold |
| src/notifications.js | 16 | Desktop notifications (fire-and-forget) | 1 | 5 | Under threshold |
| bin/nightytidy.js | 3 | Entry point — calls run() | 0 | 1 | Under threshold |

### Test Files (test/)

| File | Lines | Scope |
|------|------:|-------|
| test/cli.test.js | 522 | Full lifecycle orchestration (20 tests) |
| test/contracts.test.js | 508 | Module API contract verification (17 tests) |
| test/claude.test.js | 451 | Claude subprocess handling (15 tests) |
| test/integration.test.js | 262 | Multi-module integration (5 tests) |
| test/checks-extended.test.js | 248 | Auth paths, disk space, branch warnings (9 tests) |
| test/logger.test.js | 227 | Real file I/O, level filtering (10 tests) |
| test/git.test.js | 217 | Real git against temp dirs (11 tests) |
| test/report-extended.test.js | 207 | CLAUDE.md update, formatDuration edge cases (15 tests) |
| test/executor.test.js | 177 | Mocked claude/git/notifications (6 tests) |
| test/smoke.test.js | 142 | Structural integrity (6 tests) |
| test/report.test.js | 93 | Mock fs, verify report format (7 tests) |
| test/checks.test.js | 91 | Mock subprocess, mock git (4 tests) |
| test/helpers/mocks.js | 61 | Shared mock factories |
| test/git-extended.test.js | 59 | getGitInstance, getHeadHash (3 tests) |
| test/helpers/testdata.js | 47 | Shared test data factories |
| test/steps.test.js | 45 | Structural integrity of prompt data (6 tests) |
| test/notifications.test.js | 43 | Mock node-notifier (2 tests) |
| test/helpers/cleanup.js | 31 | Shared temp directory cleanup |

---

## Splits Executed

None. No source files met the criteria for splitting.

---

## Splits Attempted but Reverted

None.

---

## Files Skipped

### src/prompts/steps.js (5,422 lines) — Inherently Monolithic

**Reason**: Auto-generated data file. CLAUDE.md explicitly states: "Never edit src/prompts/steps.js manually — auto-generated from external extracted-prompts.json." The file contains 28 prompt step objects and 2 template strings — nearly all content is prompt text, not code logic. Splitting would either:
- Break the generation pipeline (external tool produces a single file)
- Create artificial boundaries within what is conceptually a single dataset

**Future action**: None needed. If the prompt count grows significantly, the generation tool could be updated to produce multiple files, but that's outside NightyTidy's scope.

### All other source files — Under 300-line threshold

No source file besides `steps.js` exceeds 300 lines. The largest non-generated file is `src/cli.js` at 282 lines. Each file has a single, clear responsibility:

| File | Lines | Single Responsibility? | Split Warranted? |
|------|------:|:---------------------:|:----------------:|
| src/cli.js | 282 | Yes — lifecycle orchestration | No |
| src/checks.js | 187 | Yes — pre-run validation | No |
| src/claude.js | 183 | Yes — subprocess wrapper | No |
| src/report.js | 144 | Yes — report generation | No |
| src/git.js | 97 | Yes — git operations | No |
| src/executor.js | 92 | Yes — step execution loop | No |
| src/logger.js | 48 | Yes — logging singleton | No |
| src/notifications.js | 16 | Yes — desktop notifications | No |
| bin/nightytidy.js | 3 | Yes — entry point | No |

### Test files — Excluded by policy

Test files are excluded from decomposition per task rules. Three test files exceed 300 lines (cli.test.js: 522, contracts.test.js: 508, claude.test.js: 451), but these are comprehensive test suites for their respective units — splitting would reduce test cohesion.

---

## Structural Observations (Documentation Only)

### Directory Structure

The project has a flat, clean structure:
```
bin/          → 1 file (entry point)
src/          → 8 files (core modules)
src/prompts/  → 1 file (step data)
test/         → 15 test files
test/helpers/ → 3 shared test utilities
```

This is appropriate for a 10-module project. No subdirectory reorganization needed.

### Barrel File Assessment

The project does not use barrel/index files. This is the correct choice for its size:
- 10 modules is small enough that direct imports are clear
- No external consumers need a simplified API surface
- No barrel files means no circular dependency masking

### Import Patterns

All imports are:
- Static ESM (`import`/`export`)
- Direct file references (no aliases, no path mapping)
- Ordered per convention: Node builtins → npm packages → local modules

No improvements needed.

### Dependency Graph

Clean DAG with `logger.js` as the universal hub:
- No circular dependencies
- Maximum depth: 3 (bin → cli → executor → claude)
- `logger.js` has the highest fan-in (10 importers) but is tiny (48 LOC) and stable

---

## File Size Distribution

| Range | Count | Files |
|-------|------:|-------|
| 0–100 lines | 5 | bin/nightytidy.js (3), notifications.js (16), logger.js (48), executor.js (92), git.js (97) |
| 100–200 lines | 3 | report.js (144), claude.js (183), checks.js (187) |
| 200–300 lines | 1 | cli.js (282) |
| 300–500 lines | 0 | — |
| 500+ lines | 1 | prompts/steps.js (5,422 — auto-generated) |

**Excluding generated files**: Largest file is 282 lines. Average source file size is 116 lines. Median is 97 lines.

---

## Recommendations

No file decomposition recommendations are warranted. The codebase is already well-structured:

- Every module has a single, clear responsibility
- No file exceeds the 300-line threshold (excluding auto-generated data)
- The dependency graph is a clean DAG with no circular references
- Import patterns are consistent and direct
- Directory structure matches project complexity

The prior codebase cleanup pass (2026-03-01) already extracted shared test helpers into `test/helpers/`, which was the most obvious decomposition opportunity. No further structural improvements are needed at this time.

---

## Test Verification

```
Test Files:  15 passed (15)
Tests:       136 passed (136)
Duration:    15.32s
```

All tests green. No regressions.
