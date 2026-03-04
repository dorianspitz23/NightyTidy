# Project Memory — Index

NightyTidy: automated overnight codebase improvement via Claude Code subprocess orchestration. See CLAUDE.md for rules.

## Current State

- **Version**: 0.1.0
- **Test count**: 188 (17 test files, all passing)
- **Coverage**: above thresholds (90/80/80)
- **Last major change**: GitHub-readiness — README, LICENSE, 4 bug fixes, 6 new tests

## Recent Changes

- README.md and LICENSE (MIT) added
- Bug fixes: empty repo crash, tag/branch collision retry (up to 10), abort cleanup, dashboard file cleanup
- Documentation overhaul: three-tier system (Tier 1 CLAUDE.md, Tier 2 memory files, Tier 3 human docs)

## Topic Files

| File | When to load |
|------|-------------|
| `testing.md` | Writing or fixing tests |
| `claude-integration.md` | Changing Claude Code subprocess handling |
| `cli-lifecycle.md` | Modifying the CLI run() orchestration |
| `executor-loop.md` | Modifying step execution or doc-update flow |
| `git-workflow.md` | Changing branching, tagging, or merge logic |
| `dashboard.md` | Changing progress display (HTTP, TUI, SSE) |
| `report-generation.md` | Changing report format or CLAUDE.md auto-update |
| `prompts.md` | Modifying or adding improvement prompts |
| `pitfalls.md` | Debugging platform-specific or subprocess issues |

## Memory File Rules

- One topic per file, 40-80 lines each
- Terse reference format: tables, bullets, code snippets — no prose
- Name files by topic (`testing.md`), not area (`backend-stuff.md`)
- Split any file that exceeds 80 lines
- Update this index when creating or removing files
