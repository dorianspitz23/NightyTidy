# NightyTidy — API Design Guide

Codified conventions for NightyTidy's API surfaces: HTTP dashboard endpoints, CLI interface, orchestrator JSON contracts, and module-level exports. Follow these patterns when adding or modifying interfaces.

---

## URL Naming

- **Casing**: Lowercase only (`/events`, `/stop`). No camelCase or snake_case in URLs.
- **Pluralization**: Use singular nouns for action endpoints (`/stop`), plural for resource collections if ever needed.
- **Depth**: Maximum 1 segment deep. No nested paths (no `/api/v1/dashboard/events`).
- **Parameters**: No URL parameters currently. If added, use `:paramName` in camelCase.

## Field Naming

- **Casing**: camelCase for all JSON fields. No exceptions.
  - `currentStepIndex`, `completedCount`, `runBranch`, `dashboardUrl`
- **Booleans**: Bare adjective or past participle — `success`, `merged`, `mergeConflict`. No `is`/`has` prefix.
- **Collections**: Plural nouns — `steps`, `selectedSteps`, `completedSteps`, `remainingSteps`.
- **Timestamps**: `*Time` suffix in epoch milliseconds — `startTime`, `endTime`.
- **Durations**: `duration` (milliseconds as number), `*Formatted` suffix for human-readable strings (`durationFormatted`, `totalDurationFormatted`).
- **Counts**: `*Count` suffix — `completedCount`, `failedCount`, `totalSteps`.

## Status Codes

| Scenario | Code | Body |
|----------|------|------|
| Successful HTML response | 200 | HTML |
| Successful JSON response | 200 | `{ ok: true }` or result object |
| SSE stream established | 200 | `text/event-stream` |
| CSRF / auth failure | 403 | `{ error: "reason" }` |
| Unknown route | 404 | `"Not found"` (plain text) |

- Never use 401 (there is no authentication layer — CSRF is authorization).
- Never use 204 for success — always return a body for JSON endpoints (even `{ ok: true }`).
- Never return 5xx for expected errors — the dashboard should never crash.

## Error Format

### HTTP Errors

```json
{ "error": "Human-readable description" }
```

- Always returned with `Content-Type: application/json`.
- Always include `X-Content-Type-Options: nosniff`.
- Error messages should be specific but not leak internals.

### Orchestrator JSON Errors

```json
{ "success": false, "error": "Human-readable description with context" }
```

- Include relevant context: `"Step 5 is not in the selected steps for this run. Selected: 1, 3, 12"`
- Include actionable guidance when possible: `"Call --finish-run first, or delete nightytidy-run-state.json to reset."`

### CLI Errors

- Print to stderr via `chalk.red()` + `console.error()`
- Exit with code 1
- Include resolution steps in dim text below the error

## Response Headers

### HTML Responses (GET `/`)

```
Content-Type: text/html; charset=utf-8
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'
```

### JSON Responses (POST `/stop`, both success and error)

```
Content-Type: application/json
X-Content-Type-Options: nosniff
```

### SSE Responses (GET `/events`)

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### Error Responses (404)

```
Content-Type: text/plain
X-Content-Type-Options: nosniff
```

## SSE Events

- Event type: `state`
- Data format: JSON stringified dashboard state object
- Sent on: initial connection (current state) + every state update
- Reconnection: handled by `EventSource` built-in behavior

### Dashboard State Schema

```json
{
  "status": "starting | running | finishing | completed | stopped | error",
  "totalSteps": 3,
  "currentStepIndex": 0,
  "currentStepName": "Step name",
  "steps": [
    { "number": 1, "name": "Step name", "status": "pending | running | completed | failed", "duration": null }
  ],
  "completedCount": 0,
  "failedCount": 0,
  "startTime": 1709999999999,
  "error": null
}
```

## Orchestrator JSON Contracts

All orchestrator commands output exactly **one JSON object** to stdout and exit.

### Success Pattern

```json
{ "success": true, ...resultFields }
```

### Failure Pattern

```json
{ "success": false, "error": "description" }
```

### Exit Codes

- `0` on success (`result.success === true`)
- `1` on failure (`result.success === false`)

## CSRF Protection

- Generate per-session token: `crypto.randomBytes(16).toString('hex')`
- Embed in HTML template (client extracts and sends with POST)
- Verify in POST handler body: `parsed.token !== csrfToken` → 403
- Handle JSON parse errors as CSRF failures (same 403 response)

## Module Export Conventions

### Error Contracts (do not change without updating all callers)

| Pattern | Modules | When to use |
|---------|---------|-------------|
| **Throws** with user-friendly Error | checks.js, lock.js, git.js (most functions) | Validation and pre-condition failures that should abort the current flow |
| **Returns result object** `{ success, error, ... }` | claude.js, executor.js, orchestrator.js | Long-running operations where failure is expected and should not crash |
| **Swallows errors silently** | notifications.js, dashboard.js, report.js | Fire-and-forget operations that must never crash the main flow |
| **Returns merge result** `{ success, conflict }` | git.js `mergeRunBranch` | Specific merge operation where conflict is an expected outcome |

### Function Signatures

- Export only the public API; keep helpers as unexported module-level functions
- Use options objects for 3+ optional parameters: `runPrompt(prompt, cwd, { timeout, retries, label, signal })`
- Callbacks in options: `onStepStart`, `onStepComplete`, `onStepFail`

---

*Generated by NightyTidy API Design Audit (Run 01, 2026-03-09)*
