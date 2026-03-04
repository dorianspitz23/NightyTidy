# Documentation Coverage Report — Run 002

**Date**: 2026-03-04
**Branch**: `documentation-2026-03-04`
**Scope**: Three-tier documentation system restructuring (CLAUDE.md + 9 memory files + MEMORY.md index)

---

## Executive Summary

Restructured NightyTidy's documentation from a flat, oversized system into an optimized three-tier architecture designed for AI coding agents. The primary goal: minimize token cost per conversation while maximizing correctness.

**Before**: CLAUDE.md (315 lines, ~10K tokens loaded every conversation) containing both cross-cutting rules and module-specific implementation details. 8 memory files (521 lines), most outdated.

**After**: CLAUDE.md (268 lines, ~8.5K tokens — 15% reduction) containing only cross-cutting rules. 9 memory files (615 lines), all current and accurate. New dashboard.md covers the previously undocumented 794-line dashboard subsystem.

---

## Token Budget Analysis

| Tier | Purpose | Lines | Est. Tokens | % of 200K |
|------|---------|-------|-------------|-----------|
| **Tier 1** (CLAUDE.md) | Always loaded — rules preventing mistakes on ANY task | 268 | ~8,500 | 4.3% |
| **Tier 1** (MEMORY.md) | Always loaded — index + state tracker | 38 | ~1,200 | 0.6% |
| **Tier 2** (1-2 files per task) | On-demand — module-specific patterns | 57-79 each | ~2,000-2,500 | 1.0-1.3% |
| **Typical total** | | 363-385 | ~11,700-12,200 | **5.9-6.1%** |

Target was 6-9% of context. Achieved 5.9-6.1% — at the efficient end of the range.

---

## Phase Results

### Phase 0: Check Existing Standards
- No `.cursorrules`, `CONTRIBUTING.md`, or other conflicting standard files
- Existing proto three-tier system (CLAUDE.md + 8 memory files) identified as foundation
- **Result**: No conflicts — proceeded with restructuring

### Phase 1: Codebase Discovery
- Full source mapping: 12 source files (2,428 lines excl. steps.js), 17 test files (188 tests)
- All exports, internals, magic values, error contracts, and naming conventions documented
- **Key finding**: CLAUDE.md contained ~47 lines of module-specific content that belonged in Tier 2
- **Key finding**: 6 of 8 memory files were outdated (wrong test counts, contradictory Windows shell mode info, wrong tag collision handling)

### Phase 2: CLAUDE.md Restructuring (Tier 1)
**Before**: 315 lines | **After**: 268 lines | **Reduction**: 47 lines (15%)

Content moved to Tier 2:
- Key Constants table (18 lines → distributed to module memory files)
- Claude Code Integration subsection (12 lines → `claude-integration.md`)
- Git Workflow subsection (7 lines → `git-workflow.md`)
- Execution Flow subsection (7 lines → `executor-loop.md`)

Content added:
- `dashboard.md` entry in sub-memory files table (+1 line)

**Inclusion test applied**: Every remaining line passes "If removed, would AI write incorrect code on an unrelated task?"

### Phase 3: Tier 2 Memory Files

| File | Before | After | Status | Key Changes |
|------|--------|-------|--------|-------------|
| `testing.md` | 69 lines | 79 lines | **Rewritten** | Test count 50→188, added 10 missing test files, helper docs, vi.doMock pattern, Windows EBUSY |
| `claude-integration.md` | 65 lines | 57 lines | **Rewritten** | Fixed Windows shell mode (removed ENOENT fallback), added cleanEnv, abort signal, safety preamble, auth check, permissions |
| `cli-lifecycle.md` | 70 lines | 73 lines | **Rewritten** | Added lock file, dashboard, --timeout/--setup/--list flags, non-TTY detection, line count 282→450 |
| `executor-loop.md` | 72 lines | 76 lines | **Rewritten** | Added SAFETY_PREAMBLE docs, signal threading diagram, corrected abort behavior |
| `git-workflow.md` | 59 lines | 64 lines | **Rewritten** | Fixed tag/branch collision (counter loop up to 10, not single -2 fallback), added getHeadHash null, excludeEphemeralFiles |
| `pitfalls.md` | 57 lines | 62 lines | **Rewritten** | Fixed Windows shell mode, added 8 pitfalls from MEMORY.md lessons (EBUSY, vi.doMock, CLAUDECODE, stdin, non-TTY, ESM guard, dashboard state, ephemeral files) |
| `report-generation.md` | 73 lines | 71 lines | **Updated** | Added getVersion() export, updated line count |
| `prompts.md` | 59 lines | 59 lines | **Unchanged** | Already current and accurate |
| `dashboard.md` | — | 74 lines | **NEW** | Full docs for 794-line dashboard subsystem (HTTP server, TUI, SSE, state management, platform-specific spawning) |

### Phase 4: MEMORY.md Index
**Before**: 41 lines (outdated test count 135, stale "last major change")
**After**: 38 lines (current: 188 tests, recent changes, 9 topic files including dashboard.md)

### Phase 5: Version Control
- Branch: `documentation-2026-03-04`
- Commit: `aa12039` — "docs: restructure documentation into three-tier system"
- Tests: 188/188 passing (1 intermittent timeout on integration test — pre-existing flake, unrelated to doc changes)

---

## Issues Found During Audit

### CRITICAL: Windows Shell Mode Contradiction (FIXED)
- **claude-integration.md** and **pitfalls.md** documented an ENOENT fallback pattern that was removed months ago
- CLAUDE.md correctly said "upfront shell: true, no fallback" but memory files contradicted it
- **Risk**: Agent modifying `claude.js` would follow outdated Tier 2 docs and reintroduce the bug
- **Fix**: Both files rewritten with correct upfront pattern and warning against fallback

### HIGH: Tag/Branch Collision Handling Wrong (FIXED)
- **git-workflow.md** documented single `-2` suffix retry with "no further retry"
- Actual code uses counter loop up to 10 attempts (implemented in GitHub-readiness fix)
- **Risk**: Agent would write incorrect collision handling
- **Fix**: Documented counter loop with correct RETRY_LIMIT = 10

### HIGH: Test Count Drift — 50 vs 188 (FIXED)
- **testing.md** documented 50 tests across 7 files
- Actual: 188 tests across 17 files
- 10 test files completely undocumented (including contracts.test.js, cli.test.js, dashboard.test.js)
- **Risk**: Agent wouldn't know about existing test patterns/helpers
- **Fix**: Complete rewrite with all 17 files and 3 helper files documented

### MEDIUM: Dashboard Subsystem Undocumented (FIXED)
- 794 lines of code (dashboard.js + dashboard-tui.js) with zero documentation in any memory file
- **Risk**: Agent modifying dashboard would work without reference material
- **Fix**: New `dashboard.md` covering architecture, exports, state, endpoints, platform spawning

### LOW: Pre-existing Integration Test Flake
- `integration.test.js` "executes steps on a run branch" intermittently times out (5s limit, actual ~7s)
- Only occurs during full suite run (resource contention on Windows)
- Passes reliably in isolation
- **Not fixed**: Would require increasing test timeout, not a documentation issue

---

## Documentation Coverage Matrix

| Source File | Lines | CLAUDE.md | Memory File | Coverage |
|-------------|-------|-----------|-------------|----------|
| `cli.js` | 450 | Module map, init sequence, core workflow | cli-lifecycle.md | Full |
| `executor.js` | 105 | Error contract | executor-loop.md | Full |
| `claude.js` | 193 | Error contract | claude-integration.md | Full |
| `git.js` | 143 | Error contract | git-workflow.md | Full |
| `checks.js` | 228 | Error contract, pre-check list | claude-integration.md (auth), pitfalls.md | Full |
| `notifications.js` | 16 | Error contract, "Don't make blocking" | — | Full (trivial module) |
| `dashboard.js` | 612 | Error contract, module map | dashboard.md | Full |
| `dashboard-tui.js` | 182 | Module map | dashboard.md | Full |
| `logger.js` | 48 | Init sequence, "Logger must be first" | — | Full (trivial module) |
| `report.js` | 158 | Error contract | report-generation.md | Full |
| `setup.js` | 100 | Error contract, module map | — | Adequate (simple module) |
| `prompts/steps.js` | 5422 | "Never edit manually" | prompts.md | Full |

**Coverage**: 12/12 source modules documented. 0 gaps.

---

## Metrics Summary

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| CLAUDE.md lines | 315 | 268 | -15% |
| CLAUDE.md est. tokens | ~10,000 | ~8,500 | -15% |
| Memory files | 8 | 9 | +1 (dashboard.md) |
| Memory file total lines | 521 | 615 | +18% |
| Outdated memory files | 6/8 | 0/9 | Fixed all |
| Undocumented modules | 1 (dashboard) | 0 | Fixed |
| Documentation contradictions | 2 (shell mode, collision) | 0 | Fixed |
| Typical context cost | ~12K tokens (6.0%) | ~12K tokens (5.9%) | Stable, but correct |
| Tests passing | 188/188 | 188/188 | No regression |

---

*Generated by NightyTidy documentation audit — Run 002*
