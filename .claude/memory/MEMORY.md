# Project Memory — Index

NightyTidy: automated overnight codebase improvement via Claude Code subprocess orchestration. See CLAUDE.md for rules.

## Current State

- **Version**: 0.1.0
- **Test count**: 290 (22 test files, all passing)
- **Coverage**: 96% stmts, 90% branches, 94% functions (src/)
- **Last major change**: Orchestrator dashboard — `--init-run` spawns browser dashboard, `--finish-run` stops it

## Recent Changes

- Orchestrator mode with browser dashboard (`--init-run`, `--run-step`, `--finish-run`)
- State file persistence across process invocations
- Dashboard standalone server for non-TTY environments
- README.md and LICENSE (MIT) added
- Bug fixes: empty repo crash, tag/branch collision retry (up to 10), abort cleanup, dashboard file cleanup

## Topic Files

| File | When to load |
|------|-------------|
| `testing.md` | Writing or fixing tests |
| `claude-integration.md` | Changing Claude Code subprocess handling |
| `cli-lifecycle.md` | Modifying the CLI run() orchestration |
| `executor-loop.md` | Modifying step execution or doc-update flow |
| `git-workflow.md` | Changing branching, tagging, or merge logic |
| `dashboard.md` | Changing progress display (HTTP, TUI, SSE) |
| `orchestrator.md` | Changing orchestrator mode (JSON API, state file, dashboard) |
| `report-generation.md` | Changing report format or CLAUDE.md auto-update |
| `prompts.md` | Modifying or adding improvement prompts |
| `pitfalls.md` | Debugging platform-specific or subprocess issues |

## Memory File Rules

- One topic per file, 40-80 lines each
- Terse reference format: tables, bullets, code snippets — no prose
- Name files by topic (`testing.md`), not area (`backend-stuff.md`)
- Split any file that exceeds 80 lines
- Update this index when creating or removing files
