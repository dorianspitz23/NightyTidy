# API Design & Consistency Audit Report — Run 01 (2026-03-09)

## Executive Summary

**Consistency Score: Good**

NightyTidy is a CLI tool with an internal localhost-only HTTP dashboard, not a public REST API. The "API surface" consists of:

- **6 HTTP endpoints** across 2 servers (interactive dashboard + standalone orchestrator dashboard)
- **12 CLI flags** via Commander
- **5 JSON output contracts** (orchestrator mode stdout)
- **18 exported module functions** across 10 source files

| Metric | Count |
|--------|-------|
| Total HTTP endpoints | 6 (3 per server) |
| Endpoints with issues | 2 (404 and POST /stop) |
| Issues fixed | 2 |
| Issues documented for review | 3 |

The API surface is small, well-structured, and internally consistent. The main findings are minor HTTP hygiene issues (missing headers on error responses) and code duplication between the two dashboard servers. No breaking changes needed.

---

## 1. API Surface Map

### HTTP Endpoints (Interactive Dashboard — `src/dashboard.js`)

| Method | Path | Auth | Validated? | Paginated? | Tested? | Documented? |
|--------|------|------|------------|------------|---------|-------------|
| GET | `/` | None | N/A | N/A | Yes (4 tests) | CLAUDE.md |
| GET | `/events` | None | N/A | N/A | Yes (3 tests) | CLAUDE.md |
| POST | `/stop` | CSRF token | Yes (JSON parse + token) | N/A | Yes (4 tests) | CLAUDE.md |
| * | `*` (404) | None | N/A | N/A | Yes (1 test) | Implicit |

### HTTP Endpoints (Standalone Dashboard — `src/dashboard-standalone.js`)

| Method | Path | Auth | Validated? | Paginated? | Tested? | Documented? |
|--------|------|------|------------|------------|---------|-------------|
| GET | `/` | None | N/A | N/A | Yes (2 tests) | CLAUDE.md |
| GET | `/events` | None | N/A | N/A | Yes (2 tests) | CLAUDE.md |
| POST | `/stop` | CSRF token | Yes (JSON parse + token) | N/A | Yes (3 tests) | CLAUDE.md |
| * | `*` (404) | None | N/A | N/A | Yes (1 test) | Implicit |

### CLI Interface (`src/cli.js`)

| Flag | Parameters | Mode | Tested? | Documented? |
|------|-----------|------|---------|-------------|
| `--all` | none | Interactive | Yes | CLAUDE.md, README |
| `--steps` | `<numbers>` | Both | Yes | CLAUDE.md, README |
| `--list` | none | Interactive | Yes | CLAUDE.md, README |
| `--setup` | none | Interactive | Yes | CLAUDE.md, README |
| `--timeout` | `<minutes>` | Both | Yes | CLAUDE.md, README |
| `--dry-run` | none | Interactive | Yes | CLAUDE.md, README |
| `--json` | none | Orchestrator | Yes | CLAUDE.md, README |
| `--init-run` | none | Orchestrator | Yes | CLAUDE.md, README |
| `--run-step` | `<N>` | Orchestrator | Yes | CLAUDE.md, README |
| `--finish-run` | none | Orchestrator | Yes | CLAUDE.md, README |
| `--version` | none | Both | Commander built-in | N/A |

### JSON Output Contracts (Orchestrator Mode)

| Command | Success Shape | Failure Shape | Tested? |
|---------|--------------|---------------|---------|
| `--list --json` | `{ steps: [{ number, name, description }] }` | N/A | Yes |
| `--init-run` | `{ success: true, runBranch, tagName, originalBranch, selectedSteps, dashboardUrl }` | `{ success: false, error }` | Yes |
| `--run-step` | `{ success: true, step, name, status, duration, durationFormatted, attempts, remainingSteps }` | `{ success: false, error }` | Yes |
| `--finish-run` | `{ success: true, completed, failed, totalDurationFormatted, merged, mergeConflict, reportPath, tagName, runBranch }` | `{ success: false, error }` | Yes |

### Endpoint Grouping Assessment

**Organization: By feature, well-structured.**

- HTTP endpoints are grouped into two purpose-built servers (interactive and standalone), each with identical routes
- CLI flags are logically grouped: information (`--list`), execution (`--all`, `--steps`, `--timeout`), orchestrator (`--init-run`, `--run-step`, `--finish-run`)
- No versioned/unversioned endpoint mixing (no versioning needed — internal tool)
- No scattered same-resource endpoints

---

## 2. Naming Conventions

### Dominant Conventions

| Category | Convention | Consistency |
|----------|-----------|-------------|
| URL paths | Lowercase, single-word (`/events`, `/stop`) | 100% consistent |
| URL casing | Lowercase | 100% consistent |
| Request/response field casing | camelCase | 100% consistent |
| Boolean naming | Bare adjective (`success`, `merged`) | 100% consistent |
| Collection naming | Plural noun (`steps`, `selectedSteps`, `completedSteps`, `failedSteps`, `remainingSteps`) | 100% consistent |
| Timestamp naming | `startTime`, `endTime` | 100% consistent |
| Duration naming | `duration` (ms), `durationFormatted` (human) | 100% consistent |
| Count naming | `*Count` (`completedCount`, `failedCount`) | 100% consistent |

### URL Path Analysis

Only 3 unique paths: `/`, `/events`, `/stop`. All lowercase, no parameters, no nesting. No inconsistencies possible at this scale.

### Field Name Analysis

All JSON output uses camelCase exclusively:
- `currentStepIndex`, `currentStepName`, `totalSteps` — dashboard state
- `runBranch`, `tagName`, `originalBranch`, `selectedSteps` — orchestrator init
- `durationFormatted`, `totalDurationFormatted`, `remainingSteps` — orchestrator step
- `mergeConflict`, `reportPath` — orchestrator finish

**No inconsistencies found.** All fields follow camelCase naming throughout.

---

## 3. HTTP Method & Status Code Correctness

### Method Audit

| Method | Path | Correct? | Notes |
|--------|------|----------|-------|
| GET | `/` | ✓ | Read-only, returns HTML |
| GET | `/events` | ✓ | Read-only, establishes SSE stream |
| POST | `/stop` | ✓ | Triggers action (abort), correctly uses POST for side effects |

All HTTP methods are semantically correct. No GETs with side effects, no POSTs used for reads.

### Status Code Audit

| Endpoint | Status | Correct? | Notes |
|----------|--------|----------|-------|
| GET `/` | 200 | ✓ | Returns HTML body |
| GET `/events` | 200 | ✓ | SSE stream |
| POST `/stop` (valid token) | 200 | ✓ | Returns `{ ok: true }` confirmation |
| POST `/stop` (invalid token) | 403 | ✓ | Forbidden — correct for CSRF failure |
| POST `/stop` (malformed JSON) | 403 | ✓ | Consistent with invalid token path |
| Unknown route | 404 | ✓ | Correct |

**No status code misuse found.**

---

## 4. Error Response Consistency

### Error Response Formats

| Context | Format | Consistent? |
|---------|--------|-------------|
| HTTP 403 (CSRF) | `{ error: "Invalid token" }` | Yes — same across both servers |
| HTTP 404 | `"Not found"` (plain text) | Yes — same across both servers |
| Orchestrator failure | `{ success: false, error: "descriptive message" }` | Yes — all 3 orchestrator commands |

### Deviation: Standalone POST /stop Success Response

The **interactive** dashboard returns `{ ok: true }` on POST /stop success.
The **standalone** dashboard returns `{ ok: true, message: "Stop not supported in orchestrator mode" }`.

This is an additive difference (superset response), not a breaking one. The client-side JavaScript in `dashboard-html.js` does not inspect the response body at all. The extra `message` field in standalone mode provides useful context (stop has no effect in orchestrator mode where abort is handled externally).

**Assessment**: Deliberate design difference, tested explicitly in `dashboard-standalone.test.js:255`. No action needed.

### Error Quality Assessment

- **Specific and actionable**: Yes — orchestrator errors like `"Step X is not in the selected steps for this run. Selected: 1, 5, 12"` include context
- **All errors at once vs fail-on-first**: Fail-on-first (single error returned per request)
- **Machine-readable codes**: No — errors are human-readable strings only. Acceptable for a CLI tool; would need improvement if this became a public API
- **Sensitive info leakage**: No — error messages contain no stack traces, internal paths, or system details

---

## 5. Pagination

**Not applicable.** NightyTidy has no list endpoints that return variable-size collections over HTTP.

The `--list --json` CLI command returns all 28 steps at once — this is a fixed, small dataset (28 items) that does not require pagination.

The SSE `/events` endpoint streams state updates in real-time — this is event-driven, not paginated.

---

## 6. Request Validation

### Validation Coverage

| Endpoint | Validation | Library | Location |
|----------|-----------|---------|----------|
| POST `/stop` | CSRF token in JSON body | Manual (`JSON.parse` + string equality) | Handler function |
| `--steps` (CLI) | Number range 1-28, comma-separated integers | Manual (`parseInt` + range check) | `cli.js:182-187` and `orchestrator.js:54-61` |
| `--timeout` (CLI) | Positive integer | Commander `parseInt` + manual check | `cli.js:278-281` |
| `--run-step` (CLI) | Integer, valid step, not already completed/failed | Manual | `orchestrator.js:237-251` |

### Validation Behavior

- **Consistent failure format**: HTTP errors return JSON `{ error }` with 403; CLI errors print to stderr and exit with code 1
- **All errors returned at once?**: No — fail-on-first (appropriate for this use case)
- **Same fields validated the same way?**: Yes — step numbers validated identically in `cli.js` and `orchestrator.js`

### Unprotected Endpoints (by design)

| Endpoint | Unprotected? | Risk | Notes |
|----------|-------------|------|-------|
| GET `/` | Yes | None | Read-only HTML, localhost-only |
| GET `/events` | Yes | Low | SSE stream, localhost-only, no sensitive data |
| POST `/stop` | CSRF-protected | None | Requires per-session token |

### Missing Validation

1. **POST `/stop` does not check `Content-Type` header** — accepts any content type, relies on `JSON.parse` to reject non-JSON. Low risk (localhost-only, CSRF-protected).
2. **POST `/stop` has no request body size limit** — `body += chunk` concatenates without bound. Low risk (localhost-only), but could cause memory exhaustion if a malicious local process sends a large body.

---

## 7. Miscellaneous API Quality

### Rate Limiting

No rate limiting on any HTTP endpoint. **Acceptable** — the dashboard is localhost-only (`127.0.0.1`), not exposed to the network. Adding rate limiting would be over-engineering.

### Versioning

No API versioning. **Acceptable** — the HTTP endpoints are internal-use only (consumed by the dashboard's own JavaScript). There are no external consumers that would need backward compatibility through versioning.

### Content Types

| Endpoint | Response Content-Type | Correct? |
|----------|----------------------|----------|
| GET `/` | `text/html; charset=utf-8` | ✓ |
| GET `/events` | `text/event-stream` | ✓ |
| POST `/stop` (success) | `application/json` | ✓ |
| POST `/stop` (error) | `application/json` | ✓ |
| 404 | `text/plain` | ✓ **(FIXED — was missing)** |

### Security Headers

| Header | GET `/` | GET `/events` | POST `/stop` | 404 |
|--------|---------|---------------|-------------|-----|
| `X-Content-Type-Options: nosniff` | ✓ | ✗ | ✓ **(FIXED)** | ✓ **(FIXED)** |
| `X-Frame-Options: DENY` | ✓ | ✗ | ✗ | ✗ |
| `Content-Security-Policy` | ✓ | ✗ | ✗ | ✗ |

**Note**: `X-Frame-Options` and CSP are only relevant for HTML responses. Their absence on JSON/SSE/text responses is correct. `X-Content-Type-Options: nosniff` is universally applicable but missing from SSE responses — documented as recommendation.

### Idempotency

POST `/stop` is effectively idempotent — it calls `abortController.abort()` which is safe to call multiple times. The second call has no effect.

### Discoverability

No API index endpoint or HATEOAS links. **Acceptable** — with only 3 endpoints consumed by a single embedded JavaScript client, discoverability features would be over-engineering.

---

## 8. Changes Applied

### Fix 1: Add `Content-Type: text/plain` to 404 responses

**Files**: `src/dashboard.js:84`, `src/dashboard-standalone.js:88`

Before: `res.writeHead(404)` — no Content-Type header, browser may sniff content.
After: `res.writeHead(404, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' })` — explicit content type prevents MIME sniffing.

### Fix 2: Add `X-Content-Type-Options: nosniff` to all JSON responses

**Files**: `src/dashboard.js:61,66,71`, `src/dashboard-standalone.js:75,80,84`

Before: JSON responses on POST `/stop` (both 403 and 200) had `Content-Type: application/json` but no `nosniff` header.
After: All JSON responses include `X-Content-Type-Options: nosniff` to prevent browsers from MIME-type sniffing.

---

## 9. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| 1 | Add `nosniff` to SSE `/events` response | Prevents MIME sniffing on event stream | Low | Only if time allows | SSE connections are same-origin only (CSP on the HTML page enforces this), and browsers already handle `text/event-stream` correctly. The risk is theoretical. |
| 2 | Add request body size limit to POST `/stop` | Prevents memory exhaustion from oversized requests | Low | Only if time allows | The endpoint is localhost-only and CSRF-protected, making exploitation require local access. A simple `if (body.length > 1024) return` guard would suffice. |
| 3 | Extract shared HTTP handler logic from dashboard servers | Reduces code duplication between `dashboard.js` and `dashboard-standalone.js` | Low | Probably | Both servers duplicate the same route handling, security headers, CSRF validation, and SSE management. A shared module (`dashboard-shared.js` or similar) would keep them in sync. Currently ~60 lines duplicated. This is a refactoring task, not a bug. |

---

## 10. API Style Guide

See `docs/API_DESIGN_GUIDE.md` for the codified conventions.
