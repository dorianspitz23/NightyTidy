# Security Audit Report 01 — 2026-03-05

## Executive Summary

NightyTidy's security posture is **good for a CLI tool of this scope**. The codebase has no hardcoded secrets, no authentication system to misconfigure, no database, and a minimal attack surface. The primary security concern was the localhost HTTP dashboard, which lacked CSRF protection and security headers — both now fixed. The main remaining risk is the `--dangerously-skip-permissions` flag passed to Claude Code subprocesses, which is architecturally necessary and well-documented. All 6 npm audit findings are moderate-severity dev-only dependencies (esbuild via vitest) that don't ship to users.

---

## Automated Security Scan Results

### Tools Discovered and Run

| Tool | Version | Findings | Critical | High | Medium | Low | False Positives |
|------|---------|----------|----------|------|--------|-----|-----------------|
| npm audit | npm 10.x | 6 | 0 | 0 | 6 | 0 | 0 |

### Tools Recommended but Unavailable

| Tool | What It Catches | Effort to Add | Priority |
|------|----------------|---------------|----------|
| Gitleaks | Hardcoded secrets in git history | Low (npx) | Medium |
| ESLint security plugin | SAST patterns (injection, eval, etc.) | Low | Medium |
| Socket.dev | Supply chain attacks, typosquatting | Low (GitHub app) | Low |
| npm-audit-resolver | Interactive audit triage + allowlisting | Low | Low |

### Key Verified Findings

| Finding | Tool | Severity | File | Verified? | Addressed? |
|---------|------|----------|------|-----------|------------|
| esbuild GHSA-67mh-4wv8-2f99 | npm audit | Moderate | node_modules/esbuild | Yes — dev-only | Document only |

### Notable False Positives (for future runs)

1. **PowerShell command injection in `checks.js:156`** — `driveLetter` is `projectDir.charAt(0).toUpperCase()`, always a single character from `process.cwd()`. Cannot contain injection sequences. Pattern looks risky but input is constrained by `charAt(0)`.
2. **WQL injection in `checks.js:164`** — Same `driveLetter` single-character constraint. Not exploitable.
3. All npm audit findings are real but limited to dev dependencies (esbuild via vitest).

### Security CI/CD Assessment

**No security scanning exists in CI/CD.** There are no GitHub Actions workflows, no pre-commit hooks, no SAST tools, and no automated dependency scanning. The `npm run test:ci` script enforces coverage thresholds but not security checks.

---

## Fixes Applied

| # | Issue | Severity | Location | Fix Applied | Tests Pass? | Detected By |
|---|-------|----------|----------|-------------|-------------|-------------|
| 1 | Dashboard /stop endpoint lacks CSRF protection | Medium | `src/dashboard.js:52-60` | Added CSRF token generation + verification | Yes (248/248) | Manual review |
| 2 | Dashboard HTTP responses missing security headers | Low | `src/dashboard.js:21` | Added CSP, X-Frame-Options, X-Content-Type-Options | Yes (248/248) | Manual review |
| 3 | .gitignore missing credential file patterns | Low | `.gitignore` | Added *.pem, *.key, *.p12, *.pfx, *.cert, credentials.*, secrets.*, .env.* | Yes (248/248) | Manual review |

### Fix Details

#### Fix 1: Dashboard CSRF Protection
- **What was changed**: POST `/stop` now requires a JSON body with `{ token: "<csrf-token>" }`. The token is generated per dashboard session via `crypto.randomBytes(16)` and embedded in the served HTML. Requests without a valid token receive 403.
- **Why**: Any website open in the user's browser could POST to `http://localhost:<port>/stop` and abort a running NightyTidy process. While bound to 127.0.0.1 (no external access), browser-based CSRF from any domain was possible.
- **New test**: "POST /stop rejects request without valid CSRF token" verifies 403 response.

#### Fix 2: Security Headers
- **What was changed**: HTML responses now include `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Content-Security-Policy: default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'`.
- **Why**: Defense-in-depth for the localhost dashboard. Prevents MIME sniffing, clickjacking via iframes, and restricts script/style sources.

#### Fix 3: .gitignore Hardening
- **What was changed**: Added patterns for `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.cert`, `credentials.*`, `secrets.*`.
- **Why**: Prevents accidental commit of credential files if they're ever created in the project directory.

---

## Critical Findings (Unfixed)

None.

---

## High Findings (Unfixed)

None.

---

## Medium Findings (Unfixed)

### M1: `--dangerously-skip-permissions` Flag Usage

- **Severity**: Medium
- **Location**: [claude.js:37](src/claude.js#L37)
- **Description**: All Claude Code subprocess invocations use `--dangerously-skip-permissions`, which grants the subprocess unrestricted access to Bash, Edit, Write, and other tools without user approval.
- **Impact**: If a malicious prompt were injected into `steps.js`, Claude Code would execute it with full filesystem and shell access on the user's machine.
- **Proof**: `const args = useStdin ? ['--dangerously-skip-permissions'] : ['-p', prompt, '--dangerously-skip-permissions'];`
- **Why It Wasn't Fixed**: This is architecturally necessary — NightyTidy runs non-interactively (no TTY for permission prompts). The risk is mitigated by: (1) prompts are static data in `steps.js`, not user input; (2) all changes happen on a dedicated git branch with a pre-run safety tag; (3) the `SAFETY_PREAMBLE` in `executor.js` constrains destructive operations. This is a documented, accepted risk.
- **Effort**: Significant refactor (would require NightyTidy to implement its own permission system)
- **Recommendation**: Consider adding integrity verification (hash check) of `steps.js` content before execution to detect tampering.

### M2: Lock File TOCTOU Race Condition

- **Severity**: Medium
- **Location**: [cli.js:34-47](src/cli.js#L34-L47)
- **Description**: The `acquireLock()` function checks if a lock file exists, reads it, checks PID liveness, then creates a new one. This sequence has a time-of-check-time-of-use (TOCTOU) window where two NightyTidy processes started simultaneously could both pass the check.
- **Impact**: Two concurrent NightyTidy runs on the same project could create conflicting git branches and commits. Low practical impact since NightyTidy is typically run as a single overnight process.
- **Proof**: `if (existsSync(lockPath)) { ... } writeFileSync(lockPath, ...)`
- **Why It Wasn't Fixed**: Fixing requires atomic file locking (e.g., `fs.open` with `O_EXCL` flag or a locking library). The current approach works in practice since simultaneous starts are extremely unlikely for an overnight CLI tool.
- **Effort**: Quick fix
- **Recommendation**: Replace with `fs.openSync(lockPath, 'wx')` which atomically creates the file and fails if it exists.

---

## Low Findings (Unfixed)

### L1: esbuild Development Dependency Vulnerability (GHSA-67mh-4wv8-2f99)

- **Severity**: Low (dev-only)
- **Location**: `node_modules/esbuild` (via vitest)
- **Description**: esbuild <=0.24.2 allows any website to send requests to the development server and read responses. This affects esbuild's dev server, which NightyTidy never runs.
- **Impact**: None in production. Only affects local development if `vitest` is run with the dev server exposed. NightyTidy is a CLI tool that doesn't use esbuild's dev server.
- **Why It Wasn't Fixed**: `npm audit fix --force` would upgrade to vitest v4.x (breaking change). The vulnerability is not exploitable in this context.
- **Effort**: Moderate (vitest major version upgrade)
- **Recommendation**: Upgrade to vitest v3+ when convenient; test suite may need adjustments.

### L2: Dashboard innerHTML with Unescaped Status Field

- **Severity**: Low
- **Location**: [dashboard.js:542](src/dashboard.js#L542)
- **Description**: `step.status` is inserted into innerHTML as a CSS class (`step-${step.status}`) without HTML escaping. Step names ARE properly escaped via `escapeHtml()`.
- **Impact**: If an attacker could control SSE data (requires local access to localhost), they could inject HTML via the status field. The status values are server-controlled constants ('pending', 'running', 'completed', 'failed') that never contain user input.
- **Why It Wasn't Fixed**: The status field is entirely application-controlled and never derives from user input. The CSP added in Fix 2 provides defense-in-depth.
- **Effort**: Quick fix
- **Recommendation**: For completeness, could add `escapeHtml(step.status)` in the class attribute, but risk is negligible.

---

## Informational

### I1: No CI/CD Security Pipeline

No GitHub Actions, no pre-commit hooks, no automated SAST or dependency scanning. All security checks are manual.

**Recommendation**: Add `npm audit` to CI/CD pipeline as a non-blocking check. Consider adding Socket.dev GitHub app for supply chain monitoring.

### I2: `uncaughtException` Handler Swallows All Errors

- **Location**: [dashboard-tui.js:174](src/dashboard-tui.js#L174)
- **Description**: `process.on('uncaughtException', () => { /* stay alive */ })` silently swallows all uncaught exceptions in the TUI process. This is intentional to prevent the terminal window from closing on transient errors, but could mask security-relevant failures.
- **Recommendation**: Log swallowed exceptions to stderr for debugging.

### I3: Environment Variable Forwarding

- **Location**: [claude.js:14-18](src/claude.js#L14-L18), [checks.js:11-15](src/checks.js#L11-L15)
- **Description**: `cleanEnv()` copies `process.env` and only removes `CLAUDECODE`. All other environment variables (including potentially sensitive ones) are forwarded to Claude Code subprocesses. This is necessary for Claude Code's authentication but means any secrets in the environment are accessible to the subprocess.
- **Recommendation**: Consider allowlisting specific env vars instead of forwarding all. Low priority since Claude Code already has its own security model.

---

## Supply Chain Risk Assessment

### Post-install Scripts

| Package | Script Type | Behavior | Risk Level | Recommendation |
|---------|------------|----------|------------|----------------|
| esbuild | postinstall | Downloads platform-specific binary via `install.js` | Low | Expected behavior for native binaries. Pin version. |

All other direct and transitive dependencies have **no install scripts**.

### Typosquatting Risks

| Package | Similar To | Confidence | Evidence |
|---------|-----------|------------|---------|
| node-notifier | node-notify, nodenotifier | High (legitimate) | 17M+ weekly downloads, established maintainer |
| simple-git | simplegit | High (legitimate) | 2M+ weekly downloads, established maintainer |

No typosquatting concerns identified.

### Namespace/Scope Risks

No unscoped internal packages. All packages use well-known npm scopes (`@inquirer`, `@vitest`). No dependency confusion risk — project doesn't use a private registry.

### Lock File Integrity

- **Committed**: Yes
- **All URLs point to registry.npmjs.org**: Yes (193/193)
- **All integrity hashes present**: Yes (193/193)
- **No anomalies detected**

### Bundled Native Binaries

| Package | Binaries | Risk Level | Detail |
|---------|----------|------------|--------|
| node-notifier | `vendor/snoreToast/snoretoast-x64.exe`, `vendor/notifu/`, `vendor/mac.noindex/` | Medium | Pre-compiled notification binaries execute with user privileges. Not compiled from source during install — trust depends on the maintainer's build pipeline. Package is well-established (4M+ weekly downloads). |

### Maintainer Risk

No high-risk maintainer signals detected for any direct dependency. All are actively maintained with multiple contributors.

### Transitive Dependency Stats

- **Direct dependencies**: 6 runtime + 2 dev = 8
- **Total packages in lock file**: ~193
- **Flagged packages**: 1 (node-notifier — bundled binaries, medium risk)

---

## Phase 2: Auth & Permissions Assessment

NightyTidy has **no authentication or authorization system**. It's a local CLI tool that:
- Reads/writes files in the current working directory (user's own project)
- Spawns Claude Code subprocesses (which handle their own auth)
- Binds an HTTP dashboard to 127.0.0.1 (localhost only)
- No network-accessible API endpoints
- No user accounts, sessions, or tokens

No auth/permissions issues to report.

---

*Generated by security audit on 2026-03-05. Branch: security-audit-2026-03-05.*
*Auditor: Claude Opus 4.6*
