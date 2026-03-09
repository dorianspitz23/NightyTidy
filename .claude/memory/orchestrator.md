# Orchestrator Mode — Tier 2 Reference

Assumes CLAUDE.md loaded. Logic in `src/orchestrator.js` (399 lines). For non-TTY environments where Claude Code drives the workflow conversationally.

## Exports

| Function | Purpose |
|----------|---------|
| `initRun(projectDir, { steps, timeout })` | Pre-checks, git setup, state file, dashboard spawn |
| `runStep(projectDir, stepNumber, { timeout })` | Run one step, update state file + progress JSON |
| `finishRun(projectDir)` | Changelog, report, commit, merge, cleanup |

All three: **never throw** → return `{ success: true, ...data }` or `{ success: false, error }`.

## State File (`nightytidy-run-state.json`)

Created by `--init-run`, updated by `--run-step`, deleted by `--finish-run`.

```js
{
  version: 1,
  originalBranch, runBranch, tagName,
  selectedSteps: [1, 5, 12],
  completedSteps: [{ number, name, duration, attempts }],
  failedSteps: [{ number, name, error }],
  startTime, timeout,
  dashboardPid, dashboardUrl
}
```

## CLI Integration

| Command | Output | Exit |
|---------|--------|------|
| `--list --json` | JSON array of steps | 0 |
| `--init-run --steps 1,5,12` | JSON with branch, tag, dashboard URL | 0/1 |
| `--run-step N` | JSON with step result | 0/1 |
| `--finish-run` | JSON with report path, merge result | 0/1 |

Each command is a **separate process invocation**. All output exactly one JSON object to stdout.

## Logger and Lock Behavior

- `initLogger(dir, { quiet: true })` — suppresses stdout so JSON output is clean
- `acquireLock(dir, { persistent: true })` — lock survives across process invocations
- `releaseLock(dir)` called explicitly by `--finish-run`
- Each command re-calls `initLogger` and `initGit` (separate processes)

## Dashboard in Orchestrator Mode

- `--init-run` spawns detached `dashboard-standalone.js` (HTTP server polling `nightytidy-progress.json`)
- Dashboard PID + URL stored in state file
- `--run-step` writes progress JSON before/after each step (consumed by dashboard via polling)
- `--finish-run` sends SIGTERM to dashboard PID, cleans up ephemeral files
- `dashboardUrl` returned in `--init-run` JSON output for outer Claude Code to share with user
- Spawn timeout: 5 seconds to capture port JSON before unreffing child

## Progress File Updates

`writeProgress(projectDir, progressState)` called by `--run-step`:
- Before step: status `running`, current step set
- After step: status updated, completed/failed counts incremented
- On finish: status `finishing` → `completed`/`error`

## Error Handling

- Pre-check failures in `initRun` → `{ success: false, error: message }`
- Step execution failures in `runStep` → recorded in state file, step marked failed
- Merge conflicts in `finishRun` → `{ success: true, mergeConflict: true, ... }`
- Missing state file → `{ success: false, error: 'No active run...' }`
- 500ms delay before cleanup in `finishRun` to let last SSE event reach browser clients
