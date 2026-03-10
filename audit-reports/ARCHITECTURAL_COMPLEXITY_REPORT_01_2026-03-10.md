# Architectural Complexity Report — 2026-03-10 (Run 01)

## Executive Summary

**Overall Assessment: LEAN**

NightyTidy is a well-structured, minimal-complexity codebase. With 17 source files (3,042 lines excluding prompts/steps.js data), a maximum dependency depth of 3, zero circular dependencies, and an average indirection ratio of 1.2 across all operations — the architecture is tighter than most projects of comparable scope.

**Biggest complexity tax**: The dashboard subsystem spans 4 files (dashboard.js, dashboard-standalone.js, dashboard-html.js, dashboard-tui.js) with ~35-40 lines of duplicated HTTP/SSE/CSRF logic between the interactive and standalone servers. This is the only area where structural simplification would measurably reduce maintenance burden.

**Top 3 simplification opportunities**:
1. Extract shared dashboard HTTP utilities (~50 lines of duplicated constants and handlers) — Effort: Trivial, Risk: Low
2. Consolidate time formatting functions (`formatDuration` in report.js and `formatMs` in dashboard-tui.js are 70% identical) — Effort: Trivial, Risk: Low
3. Move `SAFETY_PREAMBLE` to steps.js or a shared constants module (currently exported from executor.js, imported by cli.js and orchestrator.js) — Effort: Trivial, Risk: Low

---

## 1. Structural Complexity Map

### 1.1 Dependency Graph Summary

| Metric | Value |
|--------|-------|
| Total source files | 17 |
| Max dependency depth | 3 levels |
| Circular dependencies | **0** |
| Average import count | 2.3 |

#### Hub Modules (imported by 3+ files)

| Module | Import Count | Role |
|--------|-------------|------|
| logger.js | 11 | Universal logging — intentional hub |
| git.js | 4 | Shared git operations |
| notifications.js | 4 | Fire-and-forget notifications |
| prompts/steps.js | 4 | Prompt data (no dependencies) |
| claude.js | 3 | Subprocess wrapper |

All hubs are genuine shared utilities with clear single responsibilities. No "junk drawer" modules.

#### Orphaned Modules (not imported by other source files)

| Module | Purpose | Verdict |
|--------|---------|---------|
| bin/nightytidy.js | Entry point | Expected |
| dashboard-standalone.js | Spawned as detached process | Expected — standalone by design |
| dashboard-tui.js | Spawned in separate terminal | Expected — standalone by design |

No dead code detected.

### 1.2 Layer Analysis Per Operation

| Operation | Files Touched | Meaningful Layers | Indirection Ratio | Glue Code Lines |
|-----------|--------------|-------------------|-------------------|----------------|
| Interactive run (full) | 14 | 12 | **1.17** | ~15 |
| Orchestrator init | 9 | 8 | **1.13** | ~10 |
| Orchestrator run-step | 6 | 6 | **1.00** | 0 |
| Orchestrator finish | 8 | 8 | **1.00** | 0 |
| Single step execution | 4 | 4 | **1.00** | 0 |
| Dashboard start/stop | 4 | 3 | **1.33** | ~5 |
| Setup command | 2 | 2 | **1.00** | 0 |

**Interpretation**: Every file in every call chain does meaningful work. No forwarding layers, no pass-through abstractions. The highest ratio (1.33 for dashboard) is due to dashboard-html.js being a pure data template — still justified.

#### Detailed Call Chain: Interactive Run (the most complex operation)

```
bin/nightytidy.js → cli.js → [initLogger, acquireLock, initGit,
  excludeEphemeralFiles, runPreChecks, selectSteps, startDashboard,
  createPreRunTag, createRunBranch, executeSteps → executeSingleStep
  → runPrompt → spawnClaude → waitForChild, generateReport,
  mergeRunBranch, printCompletionSummary, scheduleShutdown]
```

Each module in this chain performs distinct work:
- **cli.js**: Commander parsing, lifecycle orchestration, SIGINT handling, spinner management
- **executor.js**: Step loop, integrity verification, result aggregation
- **claude.js**: Subprocess spawn, retry, timeout, signal, env cleanup
- **git.js**: Branch/tag creation with retry, commit verification, merge with conflict recovery
- **checks.js**: 7 environment validations with user-friendly error messages
- **dashboard.js**: HTTP server, SSE, CSRF, TUI spawning
- **lock.js**: Atomic file lock with staleness detection
- **report.js**: Markdown generation, CLAUDE.md update
- **notifications.js**: Desktop notification (fire-and-forget)
- **cli-ui.js**: Interactive selection, spinner callbacks, completion summary

### 1.3 Abstraction Inventory

| Abstraction | Type | Location | Implementations | Justification | Verdict |
|-------------|------|----------|----------------|---------------|---------|
| Logger singleton | Module-level state | logger.js | 1 | Universal dependency, init guard prevents usage before setup | **Keep** |
| Git singleton | Module-level state | git.js | 1 | Synchronized git state across 4 consumers | **Keep** |
| `runPrompt()` retry wrapper | Function abstraction | claude.js:150 | 1 | 150+ lines of subprocess + retry + timeout + signal handling | **Keep** |
| `retryWithSuffix()` | Helper extraction | git.js:54 | 2 callers | Eliminates duplication in tag/branch creation | **Keep** |
| `ok()`/`fail()` response constructors | Helper extraction | orchestrator.js:47-53 | 9 callers | Minimal cost, standardizes JSON response shape | **Keep** |
| `makeStepResult()` | Factory function | executor.js:38 | 2 callers | Standardizes result shape for success/failure paths | **Keep** |
| `buildProgressState()` | Projection function | orchestrator.js:71 | 3 callers | Non-trivial mapping from state to display format | **Keep** |
| Dashboard callback strategy | Callbacks in executor | executor.js:103 | 2 modes (interactive, orchestrator) | UI-agnostic execution — good separation | **Keep** |
| `SECURITY_HEADERS` constant | Duplicated constant | dashboard.js:23, dashboard-standalone.js:28 | 2 (identical) | **Should be shared** | **Extract** |
| `formatDuration`/`formatMs` | Near-duplicate functions | report.js:18, dashboard-tui.js:33 | 2 (70% overlap) | Intentionally different output for <60s, but shared algorithm | **Consider consolidating** |

**Total abstractions with 1 implementation**: 6 — all justified by either complexity encapsulation or testability.

**Interfaces/abstract patterns with no alternate implementation and no test mock alternative**: 0.

### 1.4 Directory Structure Assessment

```
bin/               # Entry point (1 file) — appropriate
src/               # All source (16 files) — flat, but correct for this size
  prompts/         # Data only (1 file) — appropriate nesting
test/              # Tests (40 files) — flat
  helpers/         # Shared test utilities (3 files) — appropriate
audit-reports/     # Generated reports — appropriate
docs/              # Reference docs — appropriate
scripts/           # CI/dev scripts — appropriate
```

**Assessment**: The directory structure accurately reflects the architecture. All source files are in `src/` because the architecture is a single-layer orchestration tool — there are no sub-domains that warrant feature grouping. The flat structure is correct: with 16 files averaging 190 lines each, adding subdirectories (`src/dashboard/`, `src/git/`, etc.) would add navigation overhead without clarity benefit.

No catch-all directories (`/utils`, `/helpers`, `/common`) in source. Test helpers are appropriately scoped.

---

## 2. Data Flow Complexity

### 2.1 Core Data Transformations

NightyTidy has three core data types that flow through the system:

#### Step Data (STEPS → selection → execution → results → report)

```
STEPS[] (steps.js, static data)
  ↓ selectSteps() — filter by user selection
selectedSteps[] (same shape, subset)
  ↓ executeSteps() — run each through Claude subprocess
stepResult { step: {number, name}, status, output, duration, attempts, error }
  ↓ aggregate
executionResults { results[], completedCount, failedCount, totalDuration }
  ↓ generateReport() — format to markdown
NIGHTYTIDY-REPORT.md (file output)
```

**Reshaping count**: 3 (selection → execution → report)
**Meaningful reshaping**: All 3 — each transformation does real work (filtering, execution with subprocess IO, markdown formatting)
**Unnecessary reshaping**: 0

#### Orchestrator State (init → step updates → finish)

```
initRun() creates state file:
  { version, originalBranch, runBranch, tagName, selectedSteps[],
    completedSteps[], failedSteps[], startTime, timeout,
    dashboardPid, dashboardUrl }
  ↓ runStep() appends to completedSteps/failedSteps
  ↓ finishRun() reads final state, builds executionResults, deletes state
```

**Sources of truth**: 1 (the state file). Progress JSON is a derived projection.
**Manual sync**: `writeProgress()` is called after every state update — mechanical but necessary because progress JSON serves the dashboard (separate process).

#### Dashboard State (dashState object in interactive mode)

```
cli.js creates dashState object
  ↓ buildStepCallbacks() mutates in-place on each step event
  ↓ updateDashboard() writes to progress JSON + broadcasts SSE
  ↓ stopDashboard() cleans up
```

**Sources of truth**: 1 (the in-memory dashState object). Progress JSON and SSE are projections.

### 2.2 State Management Assessment

| State | Source of Truth | Duplicated? | Sync Method |
|-------|----------------|-------------|-------------|
| Run state (orchestrator) | nightytidy-run-state.json | No | File read/write per operation |
| Progress display | nightytidy-progress.json | Derived from run state | Written after every state change |
| Dashboard state (interactive) | In-memory dashState | No | Mutated in-place |
| SSE clients | In-memory Set | No | Managed by dashboard module |
| Git state | simple-git instance | No | Singleton, initialized once |
| Lock | nightytidy.lock file | No | Atomic O_EXCL |

**Assessment**: Clean state management. One source of truth per concern. No state duplication that requires manual sync (progress JSON is explicitly derived, not a parallel truth).

### 2.3 Configuration Complexity

NightyTidy has exactly **one configuration layer**:

| Config Source | What It Controls |
|---------------|-----------------|
| CLI flags (Commander) | --all, --steps, --timeout, --dry-run, --setup, orchestrator commands |
| Environment variable | NIGHTYTIDY_LOG_LEVEL (debug/info/warn/error) |

No config files, no runtime config, no feature flags, no database-driven settings, no config override chains.

**Assessment**: Configuration is minimal and unambiguous. Every setting is either a CLI flag or an env var. No precedence confusion.

---

## 3. Pattern Complexity

### 3.1 Premature Generalization

**None found.** Every abstraction in the codebase has 2+ concrete usages or encapsulates genuine complexity:

- No multi-provider abstractions (there's only one AI engine: Claude Code)
- No plugin systems
- No configurable pipelines
- No schema versioning
- No i18n wrapping
- No abstract base classes

The project follows YAGNI rigorously. Based on git history, features were added incrementally (orchestrator mode added 2026-03-09, dashboard added same day) without pre-building unused infrastructure.

### 3.2 Unnecessary Indirection

**One minor finding**: `SAFETY_PREAMBLE` is exported from `executor.js` but is a cross-cutting concern used by `cli.js` (changelog), `orchestrator.js` (changelog), and `executor.js` (step execution). It's a constant, not execution logic — it belongs closer to the prompt data.

**No other indirection issues**:
- No event buses (all communication is direct function calls or callbacks)
- No message queues
- No HTTP calls between co-located modules
- No database as message broker
- No over-normalized or over-denormalized data

### 3.3 Cargo-Culted Patterns

**None found.** The codebase uses patterns appropriate to its complexity level:

- Plain module-level functions instead of classes (appropriate for a CLI tool)
- Callbacks for UI decoupling instead of event systems (appropriate scale)
- File-based state for cross-process communication instead of IPC (appropriate for detached processes)
- Singleton modules instead of DI containers (appropriate — only one "configuration" per process)

### 3.4 Organic Growth Observations

Based on git history, the project grew in a disciplined sequence:
1. Core CLI + executor + claude subprocess (initial)
2. Dashboard (interactive TUI + HTTP) added as a feature
3. Orchestrator mode added for Claude Code integration
4. Dashboard standalone added for orchestrator mode

The standalone dashboard (`dashboard-standalone.js`) was written as a separate file rather than refactoring the existing `dashboard.js` to support both modes. This created the only meaningful code duplication in the project (~35-40 lines of HTTP/SSE/CSRF logic). This is a classic organic growth pattern — "copy and adapt" when adding a parallel deployment mode.

**Not a red flag** — the duplication is small, well-contained, and both files are stable. But it's the top extraction candidate.

---

## 4. Complexity Quantification

### 4.1 Indirection Scores Per Operation

| Operation | Files | Meaningful | Ratio | Rating |
|-----------|-------|-----------|-------|--------|
| Interactive run | 14 | 12 | 1.17 | **Green** |
| Orchestrator init | 9 | 8 | 1.13 | **Green** |
| Orchestrator run-step | 6 | 6 | 1.00 | **Green** |
| Orchestrator finish | 8 | 8 | 1.00 | **Green** |
| Single step execution | 4 | 4 | 1.00 | **Green** |
| Dashboard start/stop | 4 | 3 | 1.33 | **Green** |
| Setup command | 2 | 2 | 1.00 | **Green** |

**All operations are green** (ratio < 2.0). No yellow or red flags.

### 4.2 Abstraction Overhead Inventory

| Category | Count | Est. Lines |
|----------|-------|-----------|
| Interfaces with 1 implementation | 0 | 0 |
| Factories creating 1 type | 0 | 0 |
| Wrapper classes that don't transform | 0 | 0 |
| Generic types with 1 instantiation | 0 | 0 |
| Event emissions with 1 listener | 0 | 0 |
| Config options that never varied | 0 | 0 |
| Duplicated dashboard HTTP logic | 1 area | ~35 |
| Near-duplicate time formatters | 1 pair | ~8 |

**Total abstraction tax**: ~43 lines out of 3,042 source lines = **1.4%**

### 4.3 Onboarding Complexity Estimate

| Area | Files to Read | Layers | Patterns | Rating |
|------|--------------|--------|----------|--------|
| CLI lifecycle | 3 (cli.js, cli-ui.js, executor.js) | 2 | Commander, ora, callbacks | **Simple** |
| Step execution | 2 (executor.js, claude.js) | 2 | Subprocess spawn, retry | **Simple** |
| Git operations | 1 (git.js) | 1 | simple-git wrapper | **Simple** |
| Dashboard (interactive) | 3 (dashboard.js, dashboard-html.js, dashboard-tui.js) | 2 | HTTP server, SSE, TUI spawn | **Moderate** |
| Dashboard (orchestrator) | 2 (orchestrator.js, dashboard-standalone.js) | 2 | File polling, detached process | **Moderate** |
| Orchestrator mode | 2 (orchestrator.js, cli.js routing) | 2 | State file, JSON API | **Simple** |
| Lock mechanism | 1 (lock.js) | 1 | Atomic O_EXCL, PID check | **Simple** |
| Pre-checks | 1 (checks.js) | 1 | Sequential validation | **Simple** |

**"You just have to know" conventions**:
1. `initLogger()` must be called first (enforced by throw)
2. `initGit()` before git operations (enforced by null reference)
3. Ephemeral files must be excluded before git operations (code does this automatically)
4. Lock must be acquired before execution (code does this automatically)

All 4 are enforced by the code itself — no tribal knowledge needed.

---

## 5. Simplification Roadmap

### Full Finding List

| # | Finding | Category | Effort | Risk | Impact | Priority |
|---|---------|----------|--------|------|--------|----------|
| 1 | Dashboard HTTP/SSE/CSRF logic duplicated across dashboard.js and dashboard-standalone.js (~35 lines) | **Extract** | Trivial | Low | Low — saves ~35 lines, single source for security headers | This week |
| 2 | `formatDuration()` and `formatMs()` are 70% identical with different edge behavior for <60s | **Collapse** | Trivial | Low | Low — eliminates maintenance risk of parallel implementations | This week |
| 3 | `SAFETY_PREAMBLE` exported from executor.js but used by 3 modules across 2 files — belongs closer to prompt data | **Move** | Trivial | Low | Minimal — better code organization | This week |
| 4 | `dashboard-standalone.js` inlines CSRF rejection twice (lines 82-84 and 87-89) | **Remove** (internal duplication) | Trivial | Low | Minimal — cleaner code | This week |

### This Week (Trivial, feed into next Code Elegance or Cleanup run)

1. **Extract dashboard-shared.js** — Move `SECURITY_HEADERS`, `URL_FILENAME`, `PROGRESS_FILENAME`, and core SSE/CSRF handler logic to a shared module. Both `dashboard.js` and `dashboard-standalone.js` import from it. ~35 lines saved, security headers maintained in one place.

2. **Consolidate time formatters** — Either: (a) make `formatDuration()` accept an option for compact sub-minute display and use it in dashboard-tui.js, or (b) extract shared `formatTime(ms, {compact})` to a utility. Currently both functions are independently tested, so migration is safe.

3. **Move `SAFETY_PREAMBLE`** to `prompts/steps.js` alongside the other prompt constants. Update imports in executor.js, cli.js, and orchestrator.js.

4. **DRY the standalone CSRF rejection** — Extract the `res.writeHead(403, ...)` pattern to a local helper in dashboard-standalone.js (similar to the existing `rejectCsrf()` in dashboard.js).

### This Month

Nothing. The codebase doesn't have medium-effort simplification opportunities. All findings are trivial.

### This Quarter

Nothing. No architectural restructuring needed.

### Backlog

Nothing. The architecture is appropriately simple for the problem domain.

### Dependencies Between Simplifications

```
Finding #1 (extract dashboard-shared.js) — independent
Finding #2 (consolidate formatters) — independent
Finding #3 (move SAFETY_PREAMBLE) — independent
Finding #4 (DRY CSRF rejection) — subsumed by #1 if done
```

All findings are independent and can be done in any order.

---

## 6. Accepted Complexity

These areas were evaluated and determined to be justified:

### 6.1 Dashboard Subsystem (4 files, ~966 lines)

The dashboard spans `dashboard.js` (237 lines), `dashboard-standalone.js` (124 lines), `dashboard-html.js` (411 lines), and `dashboard-tui.js` (184 lines). Four files for "show progress" might seem heavy, but each serves a distinct deployment context:

- **dashboard.js**: In-process HTTP server for interactive terminal mode (integrated lifecycle)
- **dashboard-standalone.js**: Detached HTTP server for orchestrator mode (file-polled, cross-process)
- **dashboard-html.js**: HTML template (pure data, no logic)
- **dashboard-tui.js**: Terminal UI (separate window, standalone process)

These cannot be trivially collapsed because they run in different process contexts with different lifecycle requirements. The duplication between dashboard.js and dashboard-standalone.js (~35 lines) is the only simplification opportunity.

### 6.2 Orchestrator Mode Parallel to Interactive Mode

`orchestrator.js` (403 lines) partially reimplements the lifecycle in `cli.js` (318 lines) for a different execution model (JSON API per process vs. single long-running process). This is not duplication — it's two distinct execution strategies:

- Interactive mode: single process, in-memory state, spinner UI, SIGINT handling
- Orchestrator mode: multi-process, file-based state, JSON output, persistent lock

Merging them would create a god object with mode-switching throughout. The current separation is cleaner.

### 6.3 cli.js Size (318 lines)

After the decomposition of `cli-ui.js` (commit `4c53f1d`), `cli.js` is a clean lifecycle orchestrator. Every line does meaningful work. The function is long because the lifecycle has many steps — not because of unnecessary abstraction.

### 6.4 Claude Subprocess Wrapper (200 lines)

`claude.js` encapsulates retry logic, timeout management, signal handling, platform-specific shell detection, stdin/flag prompt delivery, and CLAUDECODE env cleanup. This complexity is essential — subprocess management for a CLI tool on Windows + Unix with retry + timeout + abort is genuinely this complex.

### 6.5 Module-Level Singletons (logger.js, git.js)

Both use module-level mutable state initialized once per process. This is appropriate for a CLI tool that runs as a single process with a defined init sequence. DI containers or factory patterns would add complexity without benefit.

### 6.6 Lock Mechanism (114 lines)

Atomic O_EXCL, PID-based staleness detection, 24-hour timeout, TTY override prompt, persistent mode for orchestrator. Each feature exists because of a real failure mode:
- O_EXCL: prevents TOCTOU races
- PID check: detects crashed processes
- 24h timeout: handles PID recycling on Windows
- TTY prompt: recovers from false positives
- Persistent mode: orchestrator spans multiple process invocations

---

## 7. Recommendations

### Priority-Ordered Next Steps

1. **Run Code Elegance or Cleanup prompt targeting dashboard duplication** — Extract `dashboard-shared.js` with constants and core HTTP handler logic
2. **Consolidate time formatters** — Low risk, prevents future divergence
3. **Move SAFETY_PREAMBLE to steps.js** — Better code organization

### Which Overnight Prompts Should Run Next

- **Codebase Cleanup** is the best fit — it targets cross-file duplication and DRY violations. Feed it the dashboard extraction finding.
- **Code Elegance** could address the internal CSRF duplication in dashboard-standalone.js.
- **File Decomposition** is not needed — file sizes are appropriate (largest non-data file is orchestrator.js at 403 lines, well within bounds).

### Conventions to Prevent New Complexity

The project already follows strong conventions (documented in CLAUDE.md). No new conventions needed. The key existing convention that prevented over-engineering: **"No TypeScript, no build step — plain JavaScript ESM, runs directly."** This constraint naturally prevents over-abstraction.

### Decision Framework: "Should We Add This Abstraction?"

When considering a new abstraction, ask:
1. **Does it have 2+ concrete usages today?** If not, don't extract it.
2. **Does removing it change behavior?** If the layer just forwards calls, don't add it.
3. **Would a new developer understand the code better with or without it?** If the extraction makes the parent function harder to follow (requires jumping to another file), keep it inline.
4. **Is the duplication it eliminates actually harmful?** Two 3-line patterns that differ in one parameter are fine to duplicate. Two 30-line blocks with identical logic should be extracted.

This codebase consistently passes all 4 questions — no unnecessary abstractions were found.

---

*Generated by NightyTidy Architectural Complexity Audit — Run 01, 2026-03-10*
