# NightyTidy — Backup & Resilience Recommendations

> **Context**: NightyTidy is a local CLI tool with no databases, cloud infrastructure, or external services.
> The traditional "backup" concerns (database snapshots, cloud storage replication) do not apply.
> These recommendations focus on the actual risk vectors for this project type.
>
> **Last updated**: 2026-03-10

---

## Priority 1: Source Code Protection (Low Effort)

### 1.1 Ensure GitHub Repository Is the Authoritative Source

**Current state**: Repository exists at `https://github.com/dorianspitz23/NightyTidy.git`.

**Recommendation**: Verify that all branches and tags are pushed regularly. The safety tags (`nightytidy-before-*`) created during runs against this repo itself are local-only by default.

**Action**:
```bash
# Push all tags (including safety tags) to remote
git push --tags

# Verify remote has all branches
git push --all
```

**Effort**: Trivial (one-time + habit)

### 1.2 Consider a Mirror Repository

**Why**: Single-remote repos have a single point of failure (GitHub outage, accidental deletion, account compromise).

**Options**:
- GitLab mirror (free, automatic sync)
- Bitbucket mirror (free for small teams)
- Self-hosted Gitea instance

**Effort**: ~30 minutes to set up, then automatic

**Worth doing?**: Only if the project becomes business-critical. For a personal/small-team tool, GitHub alone is sufficient.

---

## Priority 2: Target Project Safety (Already Implemented)

NightyTidy already has strong safety mechanisms for target projects:

| Mechanism | Status | Notes |
|---|---|---|
| Safety tag before run | ✅ Implemented | `nightytidy-before-*` tag at HEAD |
| Dedicated run branch | ✅ Implemented | `nightytidy/run-*` — changes never go to main directly |
| Atomic lock file | ✅ Implemented | Prevents concurrent runs |
| Atomic state file writes | ✅ Implemented | Temp → rename pattern |
| Ephemeral file exclusion | ✅ Implemented | `.git/info/exclude` entries |
| Merge conflict detection | ✅ Implemented | `mergeRunBranch()` returns `{ conflict: true }` |
| SIGINT partial report | ✅ Implemented | First Ctrl+C generates report before exit |
| Fallback commits | ✅ Implemented | If Claude doesn't commit, NightyTidy does |

**No additional backup mechanisms needed for target projects.** The git-based safety model is sound.

---

## Priority 3: CI/CD Resilience (Low Effort)

### 3.1 Pin GitHub Actions Versions to SHA

**Current state**: Uses `actions/checkout@v4` and `actions/setup-node@v4` (tag-based).

**Risk**: Tag-based references can be force-pushed by upstream. SHA pinning prevents supply chain attacks.

**Action**: In `.github/workflows/ci.yml`, replace:
```yaml
- uses: actions/checkout@v4
```
with:
```yaml
- uses: actions/checkout@<full-sha>  # v4.x.x
```

**Effort**: ~15 minutes
**Worth doing?**: Yes — low effort, meaningful security improvement.

### 3.2 Cache npm Dependencies in CI

**Current state**: Uses `cache: npm` in `actions/setup-node`, which caches the npm cache directory.

**Status**: ✅ Already implemented. No action needed.

---

## Priority 4: Operational Improvements (Medium Effort)

### 4.1 Add `--verify` Command for Post-Run Validation

**Why**: After a NightyTidy run, there's no automated way to verify the target project is still healthy (beyond the safety tag).

**Idea**: A `--verify` flag that runs the target project's test suite (if detectable) after the run completes.

**Effort**: ~2-4 hours
**Worth doing?**: Probably — but depends on how diverse the target projects are.

### 4.2 Document Rollback Procedure in NIGHTYTIDY-REPORT.md

**Current state**: The report includes an "undo" section referencing the safety tag.

**Status**: ✅ Already implemented.

---

## Priority 5: Dependency Health (Ongoing)

### 5.1 Regular Dependency Audits

**Current state**: `npm run check:security` runs `npm audit --audit-level=high` in CI.

**Status**: ✅ Already implemented and enforced in CI.

### 5.2 Dependabot or Renovate for Auto-Updates

**Why**: Automated PR creation for dependency updates catches vulnerabilities faster.

**Action**: Add `.github/dependabot.yml`:
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
```

**Effort**: ~5 minutes
**Worth doing?**: Yes — trivial setup, ongoing value.

---

## What's NOT Needed

These are common backup recommendations that **do not apply** to NightyTidy:

| Recommendation | Why Not Applicable |
|---|---|
| Database backups | No database — filesystem only |
| Cloud storage replication | No cloud storage |
| Redis/cache backup | No cache layer |
| Search index rebuild procedures | No search indexes |
| Message queue persistence | No message queues |
| Session storage backup | No sessions (CLI tool) |
| Log aggregation backup | Logs are ephemeral, per-run |
| Secrets vault backup | No secrets managed |
| Container image backup | No containers |
| Infrastructure state backup | No infrastructure (local CLI) |

---

## Summary

NightyTidy's backup posture is **appropriate for its architecture**. It's a local CLI tool that:

1. **Source code** is protected by git + GitHub (standard, sufficient)
2. **Target projects** are protected by safety tags + dedicated branches (well-implemented)
3. **State files** use atomic writes to prevent corruption (well-implemented)
4. **Ephemeral data** is intentionally disposable (correct design)

The main risks are operational (interrupted runs, merge conflicts, Claude Code failures) rather than data loss — and these are already covered by the existing runbook documentation in `docs/RUNBOOKS.md`.
