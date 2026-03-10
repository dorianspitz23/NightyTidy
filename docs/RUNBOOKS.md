# NightyTidy Operational Runbooks

Actionable procedures for diagnosing and resolving common failures during overnight runs. Each runbook covers a specific failure mode, its symptoms, diagnosis, resolution, and prevention.

---

## Table of Contents

1. [Claude Code Subprocess Timeout](#1-claude-code-subprocess-timeout)
2. [Claude Code Authentication Failure](#2-claude-code-authentication-failure)
3. [Git Branch Collision](#3-git-branch-collision)
4. [Merge Conflict on Run Completion](#4-merge-conflict-on-run-completion)
5. [Lock File Prevents Run Start](#5-lock-file-prevents-run-start)
6. [Dashboard Server Fails to Start](#6-dashboard-server-fails-to-start)
7. [Disk Space Exhaustion](#7-disk-space-exhaustion)
8. [Empty Repository Error](#8-empty-repository-error)
9. [Orphaned Run Branch](#9-orphaned-run-branch)
10. [All Steps Fail Consecutively](#10-all-steps-fail-consecutively)
11. [Orchestrator State File Corruption](#11-orchestrator-state-file-corruption)
12. [Claude Code CLI Not Found](#12-claude-code-cli-not-found)
13. [Process Hangs During Run](#13-process-hangs-during-run)

---

## 1. Claude Code Subprocess Timeout

### Symptoms
- Log: `Claude Code timed out after 45 minutes`
- Step status: `failed` with `exitCode: -1`
- Desktop notification: "Step N Failed — timed out after 3 attempts"

### Diagnosis
1. Check `nightytidy-run.log` for the step that timed out:
   ```
   grep "timed out" nightytidy-run.log
   ```
2. Identify which step number consistently times out — some prompts (security audit, test generation) are heavier than others.
3. Check if the target project is unusually large (>1000 files, >100k LOC) — larger codebases take longer per step.

### Resolution
1. **Immediate**: Re-run the failed step with a longer timeout:
   ```bash
   npx nightytidy --steps <N> --timeout 90
   ```
2. **Orchestrator mode**: Use `--run-step N` with `--timeout 90` for the specific step.
3. If the step consistently fails, skip it and file a note for manual review.

### Prevention
- For large codebases, use `--timeout 90` (90 minutes) by default.
- Run fewer steps per session (e.g., `--steps 1,2,3,4,5` then `--steps 6,7,8,9,10`) to reduce cumulative resource pressure.

### Escalation
Contact: _(team to fill in)_

---

## 2. Claude Code Authentication Failure

### Symptoms
- Pre-check failure: `Claude Code is not authenticated`
- Log: `checkClaudeAuthenticated failed`
- Exit code: 1 (run never starts)

### Diagnosis
1. Verify Claude Code is logged in:
   ```bash
   claude -p "Say OK"
   ```
2. If that times out or returns an error, authentication has expired.
3. Check if `CLAUDECODE` env var is set (blocks nested sessions — NightyTidy strips it, but check manually).

### Resolution
1. Re-authenticate Claude Code:
   ```bash
   claude
   ```
   Follow the interactive login flow.
2. Verify authentication:
   ```bash
   claude -p "Say OK"
   ```
   Should return "OK" within seconds.
3. Re-run NightyTidy.

### Prevention
- Ensure Claude Code authentication doesn't expire during overnight runs.
- Run a quick auth check before scheduling overnight runs.

### Escalation
Contact: _(team to fill in)_

---

## 3. Git Branch Collision

### Symptoms
- Error: `Could not create run branch — too many runs within same minute`
- Error: `Could not create safety tag — too many runs within same minute`
- Exit code: 1

### Diagnosis
1. List existing NightyTidy branches:
   ```bash
   git branch | grep nightytidy
   ```
2. List existing safety tags:
   ```bash
   git tag | grep nightytidy-before
   ```
3. Branch/tag names include timestamps to the minute (`nightytidy/run-2026-03-10-1003`). Collision means 10+ runs started in the same minute.

### Resolution
1. Clean up old branches that are fully merged:
   ```bash
   git branch -d nightytidy/run-2026-03-09-0800
   ```
2. Clean up old tags after verifying they're no longer needed:
   ```bash
   git tag -d nightytidy-before-2026-03-09-0800
   ```
3. Re-run NightyTidy.

### Prevention
- Periodically clean up merged NightyTidy branches and old safety tags.
- Don't start multiple runs within the same minute.

### Escalation
Contact: _(team to fill in)_

---

## 4. Merge Conflict on Run Completion

### Symptoms
- Log: `Merge conflict — changes preserved on branch`
- Report states: `mergeConflict: true`
- Notification: "Run complete but merge needs attention"

### Diagnosis
1. The original branch had commits added while NightyTidy was running.
2. Check the conflict:
   ```bash
   git checkout <original-branch>
   git merge nightytidy/run-<date> --no-ff
   ```
3. Inspect conflicting files.

### Resolution
1. Resolve conflicts manually:
   ```bash
   git checkout <original-branch>
   git merge nightytidy/run-<date> --no-ff
   # Resolve conflicts in editor
   git add <resolved-files>
   git commit
   ```
2. Or cherry-pick specific commits from the run branch.
3. Or discard the run entirely:
   ```bash
   git branch -D nightytidy/run-<date>
   ```

### Prevention
- Don't push to the target branch while NightyTidy is running.
- Schedule overnight runs when no developers are committing.

### Escalation
Contact: _(team to fill in)_

---

## 5. Lock File Prevents Run Start

### Symptoms
- Error: `Another NightyTidy run is already in progress (PID <N>)`
- Or: `nightytidy.lock exists but the process (PID <N>) appears to still be running`
- Exit code: 1

### Diagnosis
1. Check if the PID in the lock is actually running:
   ```bash
   # Linux/macOS
   ps -p <PID>
   # Windows
   tasklist /FI "PID eq <PID>"
   ```
2. Read the lock file:
   ```bash
   cat nightytidy.lock
   ```
   Contains `{ "pid": <N>, "started": "<ISO timestamp>" }`.
3. If the PID is dead or the timestamp is >24 hours old, the lock is stale.

### Resolution
1. **Stale lock (process dead)**: NightyTidy auto-removes stale locks. If it doesn't:
   ```bash
   rm nightytidy.lock
   ```
2. **Active lock**: Wait for the other run to finish, or override in interactive mode (answer 'y' when prompted).
3. **Orchestrator mode**: Run `--finish-run` to clean up the previous run's state, then start a new one.

### Prevention
- Always let runs complete or use Ctrl+C for clean abort (generates partial report and releases lock).
- Don't kill NightyTidy with `kill -9` — it prevents lock cleanup.

### Escalation
Contact: _(team to fill in)_

---

## 6. Dashboard Server Fails to Start

### Symptoms
- Log: `Dashboard server could not start: <error>`
- Or: `Dashboard server did not respond in time`
- Run continues normally — dashboard is non-critical.

### Diagnosis
1. Check if another process is using the same port (unlikely — random port assignment).
2. Check system resources — low memory can prevent server creation.
3. Check firewall rules — localhost binding should always work.

### Resolution
1. The run continues without the dashboard. Progress is still tracked via `nightytidy-progress.json`.
2. The TUI window still works independently (polls the progress file).
3. No action needed unless dashboard is specifically required.

### Prevention
- Ensure the system has sufficient resources before starting a run.
- Dashboard failures are by design non-blocking.

### Escalation
Not required — this is a non-critical failure.

---

## 7. Disk Space Exhaustion

### Symptoms
- Pre-check error: `Critical: Only <N> MB of disk space available. At least 100 MB is required.`
- Or: warning `Low disk space: <N> MB remaining (< 1 GB). Run may fail.`
- During run: Claude Code subprocess failures with write errors.

### Diagnosis
1. Check disk space:
   ```bash
   df -h .
   ```
2. Check the size of the target project:
   ```bash
   du -sh .
   ```
3. NightyTidy runs can generate significant git history (28 commits per full run).

### Resolution
1. Free disk space before running.
2. If mid-run: the run will continue until a step actually fails. The safety tag preserves the pre-run state.
3. If the run must be aborted: Ctrl+C generates a partial report.

### Prevention
- Ensure >2 GB free disk space before starting overnight runs.
- Periodically clean up old run branches and tags.

### Escalation
Contact: _(team to fill in)_

---

## 8. Empty Repository Error

### Symptoms
- Pre-check error: `This git repository has no commits yet. Make at least one commit before running NightyTidy.`
- Exit code: 1

### Diagnosis
1. Verify:
   ```bash
   git log --oneline -1
   ```
   If this fails, the repo has no commits.

### Resolution
1. Make an initial commit:
   ```bash
   git add .
   git commit -m "Initial commit"
   ```
2. Re-run NightyTidy.

### Prevention
- Only run NightyTidy on repositories with existing code and history.

### Escalation
Not required — user action needed.

---

## 9. Orphaned Run Branch

### Symptoms
- Pre-check warning: `Found existing NightyTidy branch(es): nightytidy/run-<date>`
- This is a warning, not a blocking error.
- Indicates a previous run didn't merge or clean up.

### Diagnosis
1. List orphaned branches:
   ```bash
   git branch | grep nightytidy/run-
   ```
2. Check if they have useful commits:
   ```bash
   git log nightytidy/run-<date> --oneline -10
   ```
3. Check if a `NIGHTYTIDY-REPORT.md` exists on the branch.

### Resolution
1. If the changes are valuable, merge manually:
   ```bash
   git merge nightytidy/run-<date> --no-ff
   ```
2. If the changes aren't needed:
   ```bash
   git branch -D nightytidy/run-<date>
   ```
3. The new run will create a fresh branch regardless.

### Prevention
- Let runs complete fully (report + merge + cleanup).
- After a crash or force-kill, clean up manually.

### Escalation
Contact: _(team to fill in)_

---

## 10. All Steps Fail Consecutively

### Symptoms
- All step results show `status: 'failed'`
- Log shows repeated timeout or error patterns
- Report shows `completedCount: 0`

### Diagnosis
1. Check if Claude Code is working at all:
   ```bash
   claude -p "Say OK"
   ```
2. Check `nightytidy-run.log` for the first error — subsequent failures may be cascading.
3. Common causes:
   - Claude Code API is down (check status page)
   - Network connectivity issues
   - The target project has a configuration that confuses Claude Code

### Resolution
1. Verify Claude Code works independently.
2. Check the Anthropic API status page.
3. Try running a single step to isolate:
   ```bash
   npx nightytidy --steps 1 --timeout 90
   ```
4. Roll back to the safety tag:
   ```bash
   git reset --hard nightytidy-before-<date>
   ```

### Prevention
- Verify Claude Code is operational before starting overnight runs.
- Use `--dry-run` to validate the environment without executing steps.

### Escalation
Contact: _(team to fill in)_

---

## 11. Orchestrator State File Corruption

### Symptoms
- Error: `No active orchestrator run. Call --init-run first.` (when a run is expected to be active)
- State file exists but contains invalid JSON or missing fields.

### Diagnosis
1. Check the state file:
   ```bash
   cat nightytidy-run-state.json
   ```
2. If it's empty or malformed: a crash occurred during an atomic write (unlikely — writes go to `.tmp` then rename).
3. Check if `.tmp` file exists:
   ```bash
   ls nightytidy-run-state.json*
   ```

### Resolution
1. If the `.tmp` file is valid, rename it:
   ```bash
   mv nightytidy-run-state.json.tmp nightytidy-run-state.json
   ```
2. If both are corrupt, clean up and start fresh:
   ```bash
   rm nightytidy-run-state.json nightytidy-run-state.json.tmp
   rm nightytidy.lock
   ```
3. The run branch still has all committed changes — they aren't lost.

### Prevention
- State file writes are atomic (write-to-temp-then-rename). Corruption is extremely unlikely.
- Don't manually edit the state file.

### Escalation
Contact: _(team to fill in)_

---

## 12. Claude Code CLI Not Found

### Symptoms
- Pre-check error: `Claude Code CLI not found. Install it: npm install -g @anthropic-ai/claude-code`
- Exit code: 1

### Diagnosis
1. Verify Claude Code is installed:
   ```bash
   claude --version
   ```
2. Check if it's in the PATH:
   ```bash
   which claude  # Unix
   where claude   # Windows
   ```
3. On Windows, `claude` is a `.cmd` script — verify the npm global bin directory is in PATH.

### Resolution
1. Install Claude Code:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
2. Verify installation:
   ```bash
   claude --version
   ```
3. If installed but not found, add the npm global bin to PATH:
   ```bash
   npm bin -g  # Shows the global bin directory
   ```

### Prevention
- Include Claude Code installation in project setup documentation.
- Verify installation before scheduling overnight runs.

### Escalation
Contact: _(team to fill in)_

---

## 13. Process Hangs During Run

### Symptoms
- No log output for extended period (>60 minutes)
- Dashboard shows step as "running" with no progress
- No desktop notifications

### Diagnosis
1. Check if the Claude Code subprocess is still alive:
   ```bash
   # Find the claude process
   ps aux | grep claude  # Unix
   tasklist | findstr claude  # Windows
   ```
2. Check `nightytidy-run.log` for the last entry — timestamps show when activity stopped.
3. Check `nightytidy-progress.json` for the current step status.

### Resolution
1. **First Ctrl+C**: NightyTidy generates a partial report and exits cleanly.
2. **Second Ctrl+C**: Force-exits immediately.
3. If unresponsive to signals:
   ```bash
   # Kill the NightyTidy process
   kill <nightytidy-pid>  # Unix
   taskkill /PID <nightytidy-pid>  # Windows
   ```
4. Clean up:
   ```bash
   rm nightytidy.lock
   ```
5. The safety tag preserves pre-run state. Committed step changes are on the run branch.

### Prevention
- Use `--timeout` to set a per-step ceiling (default: 45 minutes).
- Monitor the dashboard or TUI window for progress.
- Consider running fewer steps per session.

### Escalation
Contact: _(team to fill in)_

---

## General Recovery

For any unexpected failure, the safety tag provides a guaranteed rollback path:

```bash
# 1. Find the safety tag
git tag | grep nightytidy-before

# 2. Reset to pre-run state
git reset --hard nightytidy-before-<date>

# 3. Clean up ephemeral files
rm -f nightytidy.lock nightytidy-run.log nightytidy-progress.json nightytidy-dashboard.url nightytidy-run-state.json

# 4. Clean up the run branch
git branch -D nightytidy/run-<date>
```

All committed changes from the run are also preserved on the `nightytidy/run-<date>` branch for selective cherry-picking if needed.
