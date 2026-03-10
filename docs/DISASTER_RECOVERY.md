# NightyTidy — Disaster Recovery Procedures

> **Audience**: On-call engineer at 3am, stressed and tired. Step-by-step. No assumed knowledge.
>
> **Last updated**: 2026-03-10

---

## 1. Data Store Inventory

NightyTidy is a **local CLI tool** — it has no databases, no cloud infrastructure, and no external services. All data lives on the local filesystem and in git.

| Data Store | Type | Criticality | Backup Method | RPO | RTO |
|---|---|---|---|---|---|
| Source code (GitHub repo) | Git repository | **Irreplaceable** | GitHub (remote), local clones | Near-zero (last push) | < 10 min |
| npm dependencies | Package registry | **Reconstructable** | `package-lock.json` in repo | Near-zero | < 5 min |
| Target project changes | Git run branch | **Irreplaceable** (during run) | Safety tag + run branch | Per-commit | < 5 min |
| Orchestrator state file | JSON (`nightytidy-run-state.json`) | **Ephemeral** | None (atomic writes) | N/A | Restart run |
| Run log | Text file (`nightytidy-run.log`) | **Ephemeral** | None | N/A | N/A |
| Progress state | JSON (`nightytidy-progress.json`) | **Ephemeral** | None | N/A | N/A |
| Lock file | JSON (`nightytidy.lock`) | **Ephemeral** | None | N/A | Delete and retry |
| Dashboard URL file | Text (`nightytidy-dashboard.url`) | **Ephemeral** | None | N/A | N/A |
| CI/CD config | YAML (`.github/workflows/ci.yml`) | **Reconstructable** | In repo | Near-zero | < 5 min |
| Documentation | Markdown (`CLAUDE.md`, `docs/`) | **Reconstructable** | In repo | Near-zero | < 5 min |
| Audit reports | Markdown (`audit-reports/`) | **Reconstructable** | In repo | Near-zero | N/A |

---

## 2. Recovery Procedures

### 2.1 Source Code Loss (Repository Corruption/Deletion)

**Prerequisites**: Access to GitHub, or any machine with a local clone.

**Steps**:

1. **If GitHub is intact** (most common):
   ```bash
   git clone https://github.com/dorianspitz23/NightyTidy.git
   cd NightyTidy
   npm install
   ```
   Done. Full recovery in under 5 minutes.

2. **If GitHub is down but you have a local clone**:
   - Your local `.git` directory contains the full history
   - Push to a new remote when GitHub recovers:
     ```bash
     git remote set-url origin <new-remote-url>
     git push --all
     git push --tags
     ```

3. **If both GitHub and all local clones are lost**:
   - ⚠️ **TEAM INPUT NEEDED: Identify all team members who may have local clones**
   - Check CI runner caches (GitHub Actions caches `node_modules` but not the repo itself)
   - npm registry (if published) contains only `bin/` and `src/` — partial recovery

**Verification**:
```bash
npm test          # All 290 tests pass
npm run test:ci   # Coverage thresholds met
npm run check:docs # Documentation is fresh
```

### 2.2 Target Project Recovery (NightyTidy Corrupted a Target Project)

This is the most likely "disaster" — NightyTidy's AI-driven changes damaged a target project.

**Prerequisites**: The target project must have been run with NightyTidy (safety tag exists).

**Steps**:

1. **Find the safety tag**:
   ```bash
   cd /path/to/target-project
   git tag --list 'nightytidy-before-*'
   ```

2. **Reset to the safety tag** (undoes ALL NightyTidy changes):
   ```bash
   git reset --hard nightytidy-before-YYYY-MM-DD-HHMM
   ```

3. **If the run branch still exists** (selective recovery):
   ```bash
   git log nightytidy/run-YYYY-MM-DD-HHMM --oneline
   # Cherry-pick only the good commits:
   git cherry-pick <commit-hash>
   ```

4. **Clean up artifacts**:
   ```bash
   rm -f nightytidy-run.log nightytidy-progress.json nightytidy-dashboard.url
   rm -f nightytidy.lock nightytidy-run-state.json
   ```

**Verification**:
- Run the target project's own test suite
- Check `git diff nightytidy-before-* HEAD` to confirm state

### 2.3 Interrupted Run Recovery

**Scenario**: NightyTidy crashed mid-run (power loss, process kill, OOM).

**Steps**:

1. **Check for orphaned lock file**:
   ```bash
   cat nightytidy.lock   # Shows PID and start time
   ```
   If the PID is dead, NightyTidy will auto-remove the lock on next run. Or delete manually:
   ```bash
   rm nightytidy.lock
   ```

2. **Check for orphaned state file** (orchestrator mode):
   ```bash
   cat nightytidy-run-state.json   # Shows completed/failed steps
   ```
   - If resumable: use `--run-step N` for remaining steps, then `--finish-run`
   - If not: delete state file and start fresh

3. **Check git state**:
   ```bash
   git status
   git branch --list 'nightytidy/*'
   ```
   - If on a run branch with uncommitted changes: commit or discard
   - If merge was in progress: `git merge --abort`

4. **Clean up ephemeral files**:
   ```bash
   rm -f nightytidy-run.log nightytidy-progress.json nightytidy-dashboard.url
   rm -f nightytidy.lock nightytidy-run-state.json nightytidy-run-state.json.tmp
   ```

5. **Kill orphaned dashboard process** (if running):
   ```bash
   # Find the process
   ps aux | grep dashboard-standalone
   # Or on Windows:
   tasklist | findstr node
   # Kill it
   kill <PID>
   ```

### 2.4 npm Dependency Recovery

**Scenario**: npm registry is down or a dependency is unpublished.

**Steps**:

1. **If `node_modules/` exists locally**: Tool still works. No action needed.

2. **If `node_modules/` is missing and npm is down**:
   - Wait for npm registry recovery (typically < 1 hour)
   - `package-lock.json` in the repo pins exact versions for reproducible installs

3. **If a dependency is unpublished** (left-pad scenario):
   - NightyTidy has only 6 runtime dependencies, all well-maintained
   - `simple-git`, `commander`, `chalk`, `ora`, `@inquirer/checkbox`, `node-notifier`
   - None are obscure single-maintainer packages
   - Fallback: fork the dependency from npm cache or GitHub

### 2.5 Claude Code CLI Unavailable

**Scenario**: Claude Code CLI is uninstalled, broken, or Anthropic service is down.

**Steps**:

1. **CLI not found**:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. **Authentication expired**:
   ```bash
   claude   # Interactive sign-in flow
   ```

3. **Anthropic service outage**:
   - NightyTidy cannot function without Claude Code — it IS the AI engine
   - Wait for service recovery
   - Check https://status.anthropic.com for status
   - NightyTidy's pre-checks will detect and report the issue clearly

---

## 3. Infrastructure Recreation

NightyTidy requires **no infrastructure** beyond a developer machine.

### From-Code (Fully Reproducible)

| Component | Source | Recreation Command |
|---|---|---|
| Application | `git clone` | `git clone <repo> && npm install` |
| CI/CD pipeline | `.github/workflows/ci.yml` | Automatic on push to GitHub |
| Test suite | `test/` directory | `npm test` |
| Documentation | `docs/`, `CLAUDE.md` | In repo |

### Manual Setup Required

| Component | What's Needed | How to Set Up |
|---|---|---|
| Node.js | v20.12.0+ | Download from nodejs.org or use `nvm` |
| Claude Code CLI | Latest version | `npm install -g @anthropic-ai/claude-code` |
| Claude Code auth | API key or OAuth | Run `claude` and follow sign-in prompts |
| Git | Any recent version | Install via OS package manager |
| GitHub repo access | Push permissions | ⚠️ TEAM INPUT NEEDED: Who has admin access? |

---

## 4. Credential Rotation Procedures

NightyTidy manages **zero credentials** directly. All authentication is delegated.

| Credential | Owner | Rotation Procedure | Downtime |
|---|---|---|---|
| Claude Code auth token | Claude Code CLI | Run `claude` → sign in again | None (local tool) |
| Git credentials | OS keychain / SSH | Re-authenticate via `git credential` or regenerate SSH key | None (local tool) |
| GitHub Actions | GitHub (automatic) | N/A — uses `GITHUB_TOKEN` provided by Actions | None |
| npm registry token | npm CLI | `npm login` | None (only needed for publishing) |

⚠️ **TEAM INPUT NEEDED**: Are there any additional credentials not tracked in the codebase (e.g., deployment tokens, npm publish tokens)?

---

## 5. Disaster Response Playbooks

### Playbook 1: "NightyTidy broke the target project"

| Phase | Action |
|---|---|
| **Detection** | Target project tests fail, or code review reveals bad changes |
| **Triage** | Check `NIGHTYTIDY-REPORT.md` on the run branch for step results |
| **Recovery** | `git reset --hard nightytidy-before-<timestamp>` |
| **Verification** | Run target project's test suite |
| **Post-incident** | Review which step caused the damage; consider excluding it in future runs |

### Playbook 2: "NightyTidy hung and won't respond"

| Phase | Action |
|---|---|
| **Detection** | Process unresponsive, no log output, dashboard frozen |
| **Triage** | Check `nightytidy-run.log` for last activity; check process PID |
| **Recovery** | Send SIGINT (Ctrl+C) once — generates partial report. Second SIGINT force-exits |
| **Cleanup** | Remove lock file, check git state, kill orphaned dashboard |
| **Post-incident** | Check if timeout was too short (`--timeout`); check disk space |

### Playbook 3: "Merge conflict after run"

| Phase | Action |
|---|---|
| **Detection** | NightyTidy reports merge conflict at end of run |
| **Triage** | Run branch and original branch diverged (someone pushed during the run) |
| **Recovery** | Manually merge: `git checkout <original> && git merge nightytidy/run-<ts>` |
| **Verification** | Resolve conflicts, run tests, commit |
| **Prevention** | Run NightyTidy during low-activity periods (overnight) |

### Playbook 4: "Orchestrator state file corrupted"

| Phase | Action |
|---|---|
| **Detection** | `--run-step` or `--finish-run` reports invalid state |
| **Triage** | Check `nightytidy-run-state.json` — may be truncated or malformed |
| **Recovery** | Delete state file + lock file. Re-run from `--init-run` (or reset to safety tag and start over) |
| **Note** | State file uses atomic writes (temp → rename) so corruption should be rare |

---

## 6. Emergency Contacts & Access

⚠️ **TEAM INPUT NEEDED**: Fill in the following table.

| Role | Name | Contact | Access Level |
|---|---|---|---|
| Repository admin | ⚠️ TEAM INPUT NEEDED | ⚠️ TEAM INPUT NEEDED | GitHub admin |
| npm publish access | ⚠️ TEAM INPUT NEEDED | ⚠️ TEAM INPUT NEEDED | npm owner |
| Claude Code account | ⚠️ TEAM INPUT NEEDED | ⚠️ TEAM INPUT NEEDED | Anthropic account |
| CI/CD admin | ⚠️ TEAM INPUT NEEDED | ⚠️ TEAM INPUT NEEDED | GitHub Actions |

---

## Appendix: File Locations Quick Reference

```
Target project files (created during run):
  nightytidy-run.log              # Full run log
  nightytidy-progress.json        # Live progress (for dashboard)
  nightytidy-dashboard.url        # Dashboard HTTP URL
  nightytidy.lock                 # Atomic lock file
  nightytidy-run-state.json       # Orchestrator state
  NIGHTYTIDY-REPORT.md            # Run report (committed)

Git artifacts:
  nightytidy-before-*             # Safety tag (revert target)
  nightytidy/run-*                # Run branch (all changes)

NightyTidy installation:
  bin/nightytidy.js               # Entry point
  src/                            # All source modules
  test/                           # Test suite
  docs/                           # Documentation
```
