# Dashboard — Tier 2 Reference

Assumes CLAUDE.md loaded. Three display systems across `src/dashboard.js`, `src/dashboard-tui.js`, `src/dashboard-standalone.js`.

## Constants

| Constant | Value | File |
|----------|-------|------|
| `SHUTDOWN_DELAY` | 3,000 ms | dashboard.js |
| `POLL_INTERVAL` | 1,000 ms | dashboard-tui.js |
| `EXIT_DELAY` | 5,000 ms | dashboard-tui.js |
| `BAR_WIDTH` | 30 chars | dashboard-tui.js |
| `MAX_VISIBLE_STEPS` | 16 | dashboard-tui.js |
| `POLL_INTERVAL` | 500 ms | dashboard-standalone.js |

## Architecture

1. **TUI window**: Standalone `dashboard-tui.js` spawned in separate terminal, reads `nightytidy-progress.json`
2. **HTTP server (interactive)**: In-process server in `dashboard.js` — serves HTML + SSE, push-based via `updateDashboard()`
3. **HTTP server (orchestrator)**: Detached `dashboard-standalone.js` — polls progress JSON. See `orchestrator.md`.

Interactive mode uses #1 + #2. Orchestrator mode uses #3 only. All fire-and-forget — failure must not crash the run.

## Exports (dashboard.js)

| Function | Purpose |
|----------|---------|
| `startDashboard(state, { onStop, projectDir })` | Start TUI + HTTP, write progress file |
| `updateDashboard(state)` | Write progress file + broadcast SSE |
| `stopDashboard()` | Clean up files, close server, kill TUI |
| `scheduleShutdown()` | 3s delay then `stopDashboard()` |

## Exports (dashboard-tui.js — for testing)

`formatMs(ms)`, `progressBar(done, total, hasActive)`, `render(state)`

Main entry guarded: `process.argv[1]?.endsWith('dashboard-tui.js')` — prevents side effects on import.

## State Object (shared mutable reference)

```js
{ status, currentStep, completedCount, failedCount, totalSteps, steps: [...], startTime, elapsed }
```

Updated by `cli.js` callbacks → passed to `updateDashboard()` → written to JSON + SSE broadcast.

## Startup Sequence

1. Write initial `nightytidy-progress.json`
2. Spawn TUI window (platform-specific, detached)
3. Start HTTP server on port 0 (random)
4. Write `nightytidy-dashboard.url` for Claude to read
5. Return `{ url, port }` (or `{ url: null, port: null }` on failure)

## HTTP Endpoints

- `GET /` → HTML dashboard (inline CSS/JS, dark theme, real-time updates)
- `GET /events` → SSE stream (current state on connect, then updates)
- `POST /stop` → triggers `onStop` callback (CSRF-protected)

## TUI Spawn (Platform-Specific)

- **Windows**: `spawn('start "NightyTidy" node "tui.js" "progress.json"', [], { shell: true })`
- **macOS**: `spawn('open', ['-a', 'Terminal', tuiScript, '--args', filePath])`
- **Linux**: `spawn('x-terminal-emulator', ['-e', 'node', tuiScript, filePath])`

## Shutdown

- `stopDashboard()`: delete ephemeral files → close SSE clients → close HTTP server → reset state
- Called directly on abort/error path (not `scheduleShutdown()` — `process.exit` kills timers)
- Ephemeral file cleanup happens even without HTTP server (TUI-only mode)

## Error Handling

All errors swallowed. Server fail → TUI-only. TUI fail → HTTP-only. Both fail → run continues.
