# Cost & Resource Optimization Report

**Run**: 01
**Date**: 2026-03-10
**Project**: NightyTidy v0.1.0
**Branch**: nightytidy/run-2026-03-10-1003

---

## 1. Executive Summary

**Total estimated monthly waste: $0/month** (high confidence).

NightyTidy is a zero-infrastructure, local-first CLI tool. It has no cloud services, no databases, no external APIs, no paid dependencies, and no hosted infrastructure. All computation runs on the user's machine. The only material cost is Claude Code token usage, which is the user's own subscription — not an operational cost of NightyTidy.

**Top findings:**
1. No billable services exist — all 8 dependencies are free/open-source
2. GitHub Actions CI is within free tier (public repo) with one minor efficiency opportunity
3. Claude Code token usage is the only material cost; already well-controlled with timeouts, retries, and abort handling
4. No code-level waste patterns found (no external API calls, no databases, no storage services)
5. No infrastructure to right-size — the tool is a single-process CLI

**Code-level fixes implemented:** None warranted — no waste patterns exist in the codebase.

---

## 2. Billable Service Inventory

| Service | Provider | Purpose | Billing Model | Usage Pattern | Est. Monthly Cost | Issues |
|---------|----------|---------|---------------|---------------|-------------------|--------|
| Claude Code CLI | Anthropic | AI code changes (user-provided) | User's subscription | Hot path — every step invocation | $0 (user pays) | None — NightyTidy controls timeouts/retries |
| GitHub Actions | GitHub | CI/CD (tests, coverage, security) | Free for public repos | On push/PR to master | $0 | Minor: coverage job duplicates test run |
| npm registry | npm, Inc. | Package distribution | Free (public) | On install/audit | $0 | None |
| Git | Local | Version control | Free | Every run | $0 | None |
| node-notifier | OS native | Desktop notifications | Free (OS APIs) | Fire-and-forget per step | $0 | None |

**Total: $0/month**

### Unused/Dead Services
None found. Searched entire codebase for AWS, Azure, GCP, Redis, MongoDB, PostgreSQL, Sentry, Datadog, SendGrid, Twilio — zero matches outside of prompt template text (which instructs target codebases, not NightyTidy itself).

### Missing Cost Controls
Not applicable — no billable services. However, NightyTidy does implement cost controls for the user's Claude Code usage:
- Per-step timeout (default 45 min, configurable via `--timeout`)
- Retry limit (3 retries with 10s delay)
- Abort handling (SIGINT stops execution)
- Lock file prevents concurrent runs (avoids duplicate token spend)
- `--dry-run` mode for previewing without execution
- `--steps` flag for selective execution

---

## 3. Infrastructure Analysis

### Compute
**Status**: No provisioned compute. NightyTidy runs as a local Node.js process on the user's machine.

### Database
**Status**: None. No database of any kind. All state is ephemeral (in-memory during run, JSON files for orchestrator mode, deleted on completion).

### Storage
**Status**: No cloud storage. Generated files are local:
- `nightytidy-run.log` — ephemeral, excluded from git
- `nightytidy-progress.json` — ephemeral, deleted on stop
- `NIGHTYTIDY-REPORT.md` — committed to run branch (~2-5KB per run)
- `nightytidy-run-state.json` — orchestrator state, deleted by `--finish-run`

### Networking
**Status**: Local only. Dashboard HTTP server binds to `127.0.0.1` (loopback). No external network calls from NightyTidy itself. Claude Code subprocess handles its own network communication.

### Cache/Search
**Status**: None provisioned. No Redis, Memcached, or Elasticsearch.

### CDN
**Status**: None. Dashboard HTML is served inline from embedded template — no external assets, no CDN.

### Containers
**Status**: No Dockerfile, no docker-compose, no container registry. The app runs directly via `npx nightytidy`.

### CI/CD

| Element | Current Config | Recommendation | Est. Savings | Confidence |
|---------|---------------|----------------|--------------|------------|
| Test matrix | 4 jobs (2 OS × 2 Node) | Keep — good cross-platform coverage | — | — |
| Coverage job | Separate job, re-runs all tests after matrix passes | Fold into ubuntu/Node 22 matrix entry | ~2-3 min CI time per run | High |
| Security job | Full `npm ci` before `npm audit` | `npm audit` reads `package-lock.json` directly; `npm ci` is unnecessary | ~30s CI time per run | Medium |
| Build caching | `actions/setup-node` with `cache: npm` | Already optimal | — | — |
| Artifact retention | Default (90 days) | No artifacts uploaded — non-issue | — | — |
| Path ignoring | Docs/PRD/LICENSE/`.claude` ignored | Already optimal — avoids unnecessary runs | — | — |

**CI/CD cost**: $0/month (public repo → free GitHub Actions). Even for private repos at current run frequency, estimated <$1/month.

**Note on coverage job**: The `coverage` job (`needs: test`) waits for all 4 matrix jobs to complete, then re-runs the entire test suite with coverage instrumentation on ubuntu/Node 22. This duplicates the ubuntu/Node 22 test run. Folding coverage into the matrix entry (using conditional steps) would eliminate this redundancy. Impact: ~2-3 minutes faster CI feedback per run. Not a cost issue — a developer experience improvement.

---

## 4. Application-Level Waste

### Redundant API Calls
**None.** NightyTidy makes zero external API calls. The only subprocess call is to `claude` CLI, which handles its own API communication.

### Database Query Cost
**Not applicable.** No database exists.

### Storage Patterns
**Clean.** Ephemeral files are excluded from git via `.git/info/exclude`. Lock files auto-clean. State files are deleted by `--finish-run`. No unbounded storage growth.

### Serverless Patterns
**Not applicable.** No serverless infrastructure.

### Third-Party Tier Optimization
**Not applicable.** No paid third-party services.

### Claude Code Token Usage (User's Cost)

While not NightyTidy's operational cost, token usage is the primary cost impact on users. Analysis:

| Pattern | Current Behavior | Assessment |
|---------|-----------------|------------|
| Prompts per step | 2 (improvement + doc update) | Optimal — doc update uses `--continue` to reuse session context |
| Prompt size | ~11KB average (306KB / 28 steps) | Reasonable — prompts are detailed by design |
| Delivery method | Stdin for >8KB, `-p` flag for shorter | Optimal — avoids OS arg length limits |
| Retries | Up to 3 per prompt (10s delay) | Reasonable — needed for reliability; worst case 4× token cost per step |
| Timeout | 45 min default, configurable | Appropriate — prevents runaway sessions |
| Session reuse | Doc update reuses improvement session | Efficient — avoids re-reading file context |
| Full run cost | 28 steps × 2 prompts × ~11KB input = ~616KB input tokens | User should budget for ~$5-15 per full run depending on output length (assumption: Claude Code Pro subscription) |

**No code changes needed.** Token usage patterns are already well-optimized.

---

## 5. Data Transfer & Egress

| Flow | Volume | Protocol | Optimization |
|------|--------|----------|-------------|
| CLI → Claude Code subprocess | ~11KB per prompt via stdin/args | Local IPC (pipe) | Already optimal |
| Dashboard → Browser | ~15KB HTML + SSE events | Local HTTP (127.0.0.1) | No egress — loopback only |
| Git operations | Local repo operations | Filesystem | No network transfer |
| npm install | ~2MB `node_modules` | HTTPS (one-time) | Cached by npm |

**No egress costs.** All data flow is local.

---

## 6. Non-Production Costs

### Environment Inventory

| Environment | Type | Always On? | Production Scale? | Cleanup? |
|-------------|------|-----------|-------------------|----------|
| Local dev | Developer machine | No — on-demand | N/A | N/A |
| GitHub Actions CI | Ephemeral runners | No — triggered per push/PR | Minimal (standard runners) | Auto-cleaned by GitHub |

**No staging, no preview, no QA environments.** The tool runs locally — no environment provisioning needed.

### Tool Seats
Not applicable — open-source project, no paid collaboration tools.

---

## 7. Code-Level Fixes Implemented

**None.** No code-level waste patterns were found. The codebase has:
- Zero external API calls to optimize
- Zero database queries to tune
- Zero storage operations to lifecycle
- Zero redundant computations to cache

---

## 8. Cost Monitoring Assessment

| Area | Status | Assessment |
|------|--------|-----------|
| Budget alerts | N/A | No billable services to monitor |
| Cost tagging | N/A | No cloud resources to tag |
| Per-feature cost attribution | N/A | No infrastructure costs |
| Anomaly detection | N/A | No spending to track |
| Governance | N/A | No resources to provision |
| Auto-scaling limits | N/A | No auto-scaling |
| Third-party usage alerts | N/A | No third-party paid services |

**Recommendation**: If NightyTidy ever adds hosted infrastructure (e.g., a web dashboard service, a prompt marketplace), implement cost monitoring from day one. Current architecture requires none.

---

## 9. Savings Roadmap

### Immediate (This Week)

| # | Opportunity | Est. Savings | Effort | Risk | Confidence | Details |
|---|------------|-------------|--------|------|------------|---------|
| 1 | Fold CI coverage into test matrix | ~2-3 min CI time/run | 15 min | Low | High | Add conditional step to ubuntu/Node 22 matrix entry; remove separate `coverage` job |
| 2 | Remove `npm ci` from security job | ~30s CI time/run | 5 min | Low | Medium | `npm audit` reads `package-lock.json` directly |

### This Month

No opportunities identified.

### This Quarter

No opportunities identified.

### Ongoing

| # | Opportunity | Est. Savings | Effort | Risk | Confidence | Details |
|---|------------|-------------|--------|------|------------|---------|
| 3 | Document user cost controls | $0 (user education) | 30 min | None | High | Add README section on `--timeout`, `--steps`, `--dry-run` for managing Claude Code token spend |

**Total estimated savings: $0/month** (CI improvements save time, not money, on a public repo).

---

## 10. Assumptions & Verification Needed

| # | Assumption | Verification |
|---|-----------|-------------|
| 1 | GitHub repo remains public (free Actions) | If repo goes private, Actions usage should be monitored (~$0.008/min for Linux, ~$0.016/min for Windows) |
| 2 | Claude Code Pro subscription covers NightyTidy usage | Verify with Anthropic pricing whether 28-step runs fit within subscription limits |
| 3 | `npm audit` works without `npm ci` on Node 22+ | Test locally: `rm -rf node_modules && npm audit --audit-level=high` |
| 4 | No future plans for hosted infrastructure | If a web service or API is planned, this report should be re-run |

---

## Methodology

**Tools used**: Codebase-wide search (Glob, Grep) across all source files, configs, CI/CD, and documentation. Manual review of all 8 dependencies, package.json metadata, GitHub Actions workflow, subprocess spawning patterns, and data flow paths.

**Files analyzed**: `package.json`, `.github/workflows/ci.yml`, `src/claude.js`, `src/executor.js`, `src/dashboard.js`, `src/dashboard-html.js`, `src/dashboard-standalone.js`, `src/dashboard-tui.js`, `src/lock.js`, `src/git.js`, `src/checks.js`, `src/notifications.js`, `src/logger.js`, `src/report.js`, `src/orchestrator.js`, `src/cli.js`, `src/prompts/steps.js`, `vitest.config.js`.

**Patterns searched**: Cloud provider SDKs (AWS, GCP, Azure), database clients (MongoDB, PostgreSQL, MySQL, Redis), HTTP client libraries (axios, node-fetch, got), monitoring/APM tools (Sentry, Datadog, New Relic), notification services (SendGrid, Twilio), container configs (Dockerfile, docker-compose), IaC files (Terraform, CloudFormation, Pulumi, K8s), environment variable files (.env).
