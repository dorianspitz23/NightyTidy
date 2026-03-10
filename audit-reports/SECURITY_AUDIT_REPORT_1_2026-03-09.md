# NightyTidy Security Audit Report

**Date**: 2026-03-09
**Auditor**: Claude Opus 4.6 (automated)
**Run**: 1
**Scope**: Full codebase (17 source files, 40 test files, CI/CD config, dependency tree)
**Test Suite**: 430 tests — all passing after fixes

---

## 1. Executive Summary

NightyTidy has a strong security posture for a CLI tool of its scope. No hardcoded secrets, no credentials in git history, and no critical vulnerabilities were found. The codebase demonstrates good security practices: CSRF protection on the dashboard, localhost-only binding, atomic lock files, and HTML escaping. Two mechanical fixes were applied (POST body size limits and SSE security headers). The primary architectural risk is the use of `--dangerously-skip-permissions` with a warn-only prompt integrity check, which is a documented design decision with appropriate mitigations.

---

## 2. Automated Security Scan Results

### Tools Discovered and Run

| Tool | Version | Findings | Critical | High | Medium | Low | False Positives |
|------|---------|----------|----------|------|--------|-----|-----------------|
| npm audit | npm 10.x | 6 | 0 | 0 | 6 | 0 | 0 |

### Tools Recommended but Unavailable

| Tool | What It Catches | Effort to Add | Priority |
|------|----------------|---------------|----------|
| Gitleaks | Secrets in git history | Low (npx one-off) | Low (no secrets found manually) |
| ESLint security plugin | JS security patterns | Low (eslint-plugin-security) | Medium |
| Socket.dev | Supply chain attacks | Low (GitHub app) | Medium |
| Snyk | Deeper dependency analysis | Low (CLI) | Low |

### Key npm audit Findings

| Finding | Tool | Severity | File | Verified? | Addressed In Phase |
|---------|------|----------|------|-----------|-------------------|
| esbuild <=0.24.2 dev server vulnerability (GHSA-67mh-4wv8-2f99) | npm audit | Moderate | devDependency (vitest) | Yes — dev-only, not in production | Phase 4A (document only) |

All 6 npm audit findings trace to the same esbuild vulnerability in vitest's dependency tree. This is a **dev-only** dependency — esbuild's development server is never exposed in NightyTidy's production code. The fix requires a vitest major version upgrade (v2 → v4).

### Security CI/CD Assessment

- **npm audit runs in CI**: Yes (`npm run check:security` in `.github/workflows/ci.yml` security job)
- **Blocking merges**: No — the security job is not a required check
- **Exception allowlists**: None configured
- **Last tooling review**: Unknown (no `.npmrc` audit config)

**Recommendation**: Make the security job a required status check for PR merges.

---

## 3. Fixes Applied

| Issue | Severity | Location | Fix Applied | Tests Pass? | Detected By |
|-------|----------|----------|-------------|-------------|-------------|
| Unbounded POST body on `/stop` endpoint | Medium | `dashboard.js:53-56`, `dashboard-standalone.js:69-71` | Added 1KB body size limit with truncation | Yes (430/430) | Manual |
| Missing security headers on SSE endpoint | Low | `dashboard.js:34-39`, `dashboard-standalone.js:57-61` | Added `X-Content-Type-Options: nosniff` to SSE responses | Yes (430/430) | Manual |

### Fix Details

**Unbounded POST body (Medium)**
- **What was changed**: Both `handleStop` functions now limit incoming request body to 1024 bytes. Additional data chunks are silently dropped after the limit is reached.
- **Why**: A local process could send an arbitrarily large POST body to `/stop`, consuming memory. While the server only listens on 127.0.0.1, this is still a DoS vector from local malware or scripts.
- **Tests passing**: Yes — all 430 tests pass, including 10 dashboard-standalone tests that exercise the stop endpoint directly.

**Missing SSE security headers (Low)**
- **What was changed**: Added `X-Content-Type-Options: nosniff` to the `GET /events` SSE response headers in both `dashboard.js` and `dashboard-standalone.js`.
- **Why**: Without `nosniff`, browsers could MIME-sniff the `text/event-stream` response. While not directly exploitable (SSE isn't rendered as HTML), it's a defense-in-depth best practice that was already applied to all other endpoints.
- **Tests passing**: Yes — all 430 tests pass.

---

## 4. Critical Findings (Unfixed)

*None.*

The `--dangerously-skip-permissions` flag (discussed in Section 7) is an architectural design decision, not a vulnerability. It is required for NightyTidy to function and is documented with appropriate mitigations.

---

## 5. High Findings (Unfixed)

*None.*

---

## 6. Medium Findings (Unfixed)

### 6.1 CSP Allows `unsafe-inline` for Scripts

- **Severity**: Medium
- **Location**: `dashboard.js:26`, `dashboard-standalone.js:31`
- **Description**: The Content-Security-Policy header uses `script-src 'unsafe-inline'`, which weakens XSS protection. If an XSS vector were found in the dashboard HTML, the CSP would not block inline script execution.
- **Impact**: Reduced defense-in-depth against XSS. Currently no known XSS vector exists — step names are escaped via `escapeHtml()` (DOM-based), and the CSRF token is hex-only.
- **Proof**: `'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'"`
- **Recommendation**: Migrate to nonce-based CSP. Generate a random nonce per request, include it in the `<script>` tag as `<script nonce="...">`, and set `script-src 'nonce-...'`.
- **Why It Wasn't Fixed**: Requires refactoring the HTML template to inject nonces, and the `style-src 'unsafe-inline'` would also need attention (inline styles in `<style>` tags). Significant refactor for a localhost-only dashboard.
- **Effort**: Moderate
- **Detected By**: Manual

### 6.2 Prompt Integrity Check Is Warn-Only

- **Severity**: Medium
- **Location**: `executor.js:13-26`, `executor.js:104`
- **Description**: `verifyStepsIntegrity()` computes a SHA-256 hash of all step prompts and compares against `STEPS_HASH`. On mismatch, it warns but execution continues. The return value is not checked by `executeSteps()`.
- **Impact**: If `steps.js` is tampered with (supply chain attack or malicious modification), the modified prompts will still be executed with `--dangerously-skip-permissions`. The warning will appear in logs but won't stop execution.
- **Proof**:
  ```javascript
  verifyStepsIntegrity(STEPS); // return value unused
  ```
- **Recommendation**: Consider making this a blocking check with an explicit `--skip-integrity-check` override flag for legitimate prompt changes.
- **Why It Wasn't Fixed**: Changing from warn to block is a behavioral change that could break legitimate workflows (users regenerating prompts from external sources). This is an architectural decision for the maintainer.
- **Effort**: Quick fix (add throw + override flag), but requires user/maintainer decision
- **Detected By**: Manual

### 6.3 CSRF Token Embedded via Template Literal

- **Severity**: Medium (theoretical)
- **Location**: `dashboard-html.js:403`
- **Description**: The CSRF token is interpolated directly into an inline `<script>` block via JavaScript template literal: `body: JSON.stringify({ token: '${csrfToken}' })`. Currently safe because the token is generated from `randomBytes(16).toString('hex')` which only produces `[0-9a-f]` characters.
- **Impact**: If the token generation ever changes to produce characters like `'`, `\`, or `</script>`, it could create an XSS vector. This is a fragility concern, not a current vulnerability.
- **Proof**: `body: JSON.stringify({ token: '${csrfToken}' }),`
- **Recommendation**: Pass the token via a `<meta>` tag (`<meta name="csrf-token" content="${csrfToken}">`) and read it from JavaScript via `document.querySelector('meta[name=csrf-token]').content`.
- **Why It Wasn't Fixed**: Currently not exploitable (hex encoding guarantees safety). The fix is simple but touches the HTML template structure.
- **Effort**: Quick fix
- **Detected By**: Manual

---

## 7. Low Findings (Unfixed)

### 7.1 `git add -A` in fallbackCommit Stages Everything

- **Severity**: Low
- **Location**: `git.js:109`
- **Description**: `fallbackCommit` runs `git add -A` which stages all changes in the working tree. If the Claude Code subprocess creates a file containing secrets, and the target project's `.gitignore` doesn't exclude it, the secrets would be committed.
- **Impact**: Potential secret exposure on the run branch. Mitigated by `.git/info/exclude` for NightyTidy's own ephemeral files, and the target project's `.gitignore` for its own patterns.
- **Recommendation**: Add a pre-check or warning about `.gitignore` coverage during `runPreChecks`.
- **Why It Wasn't Fixed**: This is by design — NightyTidy needs to commit whatever Claude changes. Adding file-by-file staging would require parsing Claude's output for changed files, which is fragile.
- **Effort**: Moderate
- **Detected By**: Manual

### 7.2 PID-Based Liveness Check Subject to PID Recycling

- **Severity**: Low
- **Location**: `lock.js:15-22`
- **Description**: `isProcessAlive(pid)` uses `process.kill(pid, 0)` to check if a process exists. PIDs can be recycled by the OS, causing a stale lock to appear active if its PID is reused by an unrelated process.
- **Impact**: Lock would not be auto-removed; user would be prompted to override. Not a security issue per se, but a reliability concern.
- **Recommendation**: None needed — the 24-hour max age fallback (`MAX_LOCK_AGE_MS`) handles this edge case.
- **Effort**: N/A
- **Detected By**: Manual

### 7.3 `dashboard-standalone.js` Missing isMain Guard

- **Severity**: Low
- **Location**: `dashboard-standalone.js:15-19`
- **Description**: Unlike `dashboard-tui.js`, this file has no `isMain` guard. Top-level code (including `process.exit(1)`) runs on import. This could crash processes that import it for testing.
- **Impact**: Development/testing concern only. The Vitest strip-shebang plugin handles the shebang, and tests spawn it as a subprocess rather than importing.
- **Recommendation**: Add an isMain guard consistent with `dashboard-tui.js`.
- **Why It Wasn't Fixed**: The current test approach (subprocess spawning) works correctly. Adding the guard is a minor refactor.
- **Effort**: Quick fix
- **Detected By**: Manual

### 7.4 Swallowed Exceptions in dashboard-tui.js

- **Severity**: Low
- **Location**: `dashboard-tui.js:176`
- **Description**: `process.on('uncaughtException', () => {})` silently swallows all uncaught exceptions to keep the TUI alive across poll iterations.
- **Impact**: Could mask security-relevant exceptions or crash indicators. The TUI is a display-only process with no write capabilities, so exploitation potential is minimal.
- **Recommendation**: Log exceptions to stderr before swallowing: `process.on('uncaughtException', (err) => { process.stderr.write(err.message + '\n'); })`.
- **Why It Wasn't Fixed**: This is documented in MEMORY.md as an intentional design choice for TUI resilience.
- **Effort**: Quick fix
- **Detected By**: Manual

---

## 8. Informational

### 8.1 Design: `--dangerously-skip-permissions`

NightyTidy uses `--dangerously-skip-permissions` when spawning Claude Code subprocesses. This grants Claude Code full, unrestricted access to the filesystem and shell within the target project. This is a **required architectural decision** — without it, Claude Code blocks on every tool permission prompt in non-interactive mode.

**Mitigations in place**:
- SAFETY_PREAMBLE instructs Claude not to perform destructive operations
- All work happens on a dedicated git branch with a pre-run safety tag
- Prompt integrity hash provides tamper detection (warn-only)
- NightyTidy controls what prompts are sent to Claude Code
- Lock file prevents concurrent runs

This is not a vulnerability — it's the core mechanism by which NightyTidy operates. The risk is accepted and documented.

### 8.2 Environment Variable Passthrough

`cleanEnv()` in `claude.js` and `checks.js` strips `CLAUDECODE` but passes all other environment variables to spawned subprocesses. This means any sensitive environment variables (API keys, tokens, database URLs) are inherited by Claude Code. This is by design — Claude Code needs its own authentication environment.

### 8.3 No Rate Limiting on Dashboard HTTP Server

The dashboard HTTP server has no rate limiting. A local process could flood endpoints to consume resources. The server binds to `127.0.0.1` only, limiting exposure to local processes. Given the dashboard's localhost-only scope and short lifespan (one run), this is not worth adding complexity for.

### 8.4 Error Messages May Contain Internal Paths

Error messages from exceptions may include full filesystem paths and stack traces. These are displayed to the terminal and written to log files. For a CLI tool running locally, this is expected and useful behavior.

### 8.5 Positive Security Patterns

The codebase demonstrates several good security practices:

| Pattern | Location | Notes |
|---------|----------|-------|
| CSRF token on state-changing endpoint | `dashboard.js:128`, `dashboard-standalone.js:23` | `randomBytes(16)` per session |
| Localhost-only binding | `dashboard.js:149`, `dashboard-standalone.js:95` | `127.0.0.1` prevents network exposure |
| Atomic lock file creation | `lock.js:10` | `O_EXCL` flag prevents TOCTOU races |
| HTML escaping | `dashboard-html.js:389-393` | DOM-based `escapeHtml()` for step names |
| Security headers | `dashboard.js:23-27` | CSP, X-Frame-Options, X-Content-Type-Options |
| No hardcoded secrets | Entire codebase | Auth delegated to Claude Code |
| Safety branch isolation | `git.js:78-87` | Dedicated branch + safety tag |
| Ephemeral file exclusion | `git.js:29-47` | `.git/info/exclude` prevents accidental commits |
| Error contract adherence | All modules | Each module follows documented error handling |

---

## 9. Supply Chain Risk Assessment

### Post-Install Scripts

| Package | Script Type | Behavior | Risk Level | Recommendation |
|---------|------------|----------|------------|----------------|
| esbuild | postinstall | Downloads platform-specific binary | Low | Well-known, 60M+ weekly downloads, Evan Wallace (Figma CTO) maintained |
| fsevents | postinstall | Native macOS file watching addon | Low | macOS-only, 90M+ weekly downloads, part of Node.js ecosystem |

Only 2 of 194 packages have install scripts. Both are well-known, high-download-count packages with established maintainers.

### Typosquatting Risks

| Package | Similar To | Confidence | Evidence |
|---------|-----------|------------|---------|
| None found | — | — | All 6 direct dependencies are well-known packages with correct names |

All direct dependencies are scoped (`@inquirer/checkbox`, `@vitest/coverage-v8`) or established packages (`chalk`, `commander`, `ora`, `simple-git`, `node-notifier`, `vitest`). No typosquatting risk detected.

### Namespace/Scope Risks

No unscoped internal packages. No references to unowned scopes. No private registry configuration. No dependency confusion risk detected.

### Lock File Integrity

| Check | Result |
|-------|--------|
| Lock file committed | Yes |
| lockfileVersion | 3 |
| Total packages | 194 |
| Missing integrity hashes | 0 |
| Unexpected registries | 0 |
| All resolved to registry.npmjs.org | Yes |

**Pass** — lock file is healthy with full integrity coverage.

### Maintainer Risk

No concerns identified for direct dependencies. All are actively maintained with multiple contributors:
- `chalk` (sindresorhus) — 260M+ weekly downloads
- `commander` (tj) — 120M+ weekly downloads
- `ora` (sindresorhus) — 30M+ weekly downloads
- `simple-git` (steveukx) — 3M+ weekly downloads
- `node-notifier` (mikaelbr) — 8M+ weekly downloads
- `@inquirer/checkbox` (SBoudrias) — part of Inquirer.js monorepo
- `vitest` (vitest-dev) — 14M+ weekly downloads

### Transitive Dependency Stats

| Metric | Value |
|--------|-------|
| Total packages | 194 |
| Direct production dependencies | 6 |
| Direct dev dependencies | 2 |
| Max dependency depth | 6 |
| Flagged packages | 0 |

No `.npmrc` file exists. Consider adding one with `ignore-scripts=true` and explicitly allowing `esbuild` and `fsevents` install scripts.

---

## Appendix: Files Reviewed

All 17 source files, 40 test files, `package.json`, `package-lock.json`, `.gitignore`, `.github/workflows/ci.yml`, and `vitest.config.js` were reviewed.
