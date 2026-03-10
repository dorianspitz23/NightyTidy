# Error Recovery and Resilience Audit Report

**Date**: 2026-03-10
**Run**: 01
**Auditor**: NightyTidy automated audit (Claude Code)
**Resilience Maturity**: Basic → Moderate (after fixes applied)

---

## 1. Executive Summary

NightyTidy is a CLI tool that orchestrates Claude Code subprocesses against target codebases. Its external dependencies are: the Claude Code CLI (subprocess), git (via simple-git), the local filesystem, and node-notifier. There are no databases, HTTP APIs, caches, or message queues.

**What happens if Claude Code is down for 10 minutes?** Each step attempt times out after 45 minutes (configurable), retries 3 times, then records as failed and continues to the next step. The run completes with partial results. This is the strongest resilience path in the codebase.

**What happens if git hangs?** Before this audit: the process hangs indefinitely. simple-git has no built-in timeout and NightyTidy added none. This remains the largest unmitigated risk (see Recommendations).

**Top 5 resilience gaps (before fixes):**

1. **MEDIUM**: Pre-check commands (`git --version`, `claude --version`, disk space) had no timeouts — a hanging subprocess blocked the entire run indefinitely. **FIXED.**
2. **MEDIUM**: Interactive auth (`runInteractiveAuth()`) had no timeout — could block forever waiting for browser callback. **FIXED.**
3. **MEDIUM**: Orchestrator `initRun()` leaked persistent lock files on failure after lock acquisition — blocking all future runs until manual cleanup. **FIXED.**
4. **MEDIUM**: Orchestrator `finishRun()` leaked lock files, state files, and dashboard processes on unexpected errors. **FIXED.**
5. **LOW**: `report.js generateReport()` could throw on disk-full despite its documented "warns but never throws" contract, crashing callers that relied on the contract. **FIXED.**

---

## 2. Timeout Audit

### External Call Inventory

| # | Operation | File:Line | Type | Timeout Before | Timeout After | Notes |
|---|-----------|-----------|------|---------------|--------------|-------|
| 1 | `claude -p` (step execution) | claude.js:58 | subprocess | 45m (configurable) | 45m (configurable) | OK — includes SIGKILL fallback |
| 2 | `git --version` | checks.js:42 | subprocess | **None** | **15s** | **FIXED** — was infinite hang risk |
| 3 | `claude --version` | checks.js:80 | subprocess | **None** | **15s** | **FIXED** |
| 4 | `claude -p 'Say OK'` (silent auth) | checks.js:109 | subprocess | 30s | 30s | OK |
| 5 | `claude -p 'Say OK'` (interactive auth) | checks.js:92 | subprocess | **None** | **2m** | **FIXED** — was infinite hang risk |
| 6 | PowerShell `Get-PSDrive` | checks.js:149 | subprocess | **None** | **15s** | **FIXED** |
| 7 | `wmic logicaldisk` | checks.js:157 | subprocess | **None** | **15s** | **FIXED** |
| 8 | `df -k` | checks.js:165 | subprocess | **None** | **15s** | **FIXED** |
| 9 | `git.status()` | git.js:63 | simple-git | None | None | See recommendations |
| 10 | `git.tag()` | git.js:89 | simple-git | None | None | See recommendations |
| 11 | `git.checkoutLocalBranch()` | git.js:106 | simple-git | None | None | See recommendations |
| 12 | `git.log()` | git.js:119 | simple-git | None | None | See recommendations |
| 13 | `git.raw(['add', '-A'])` | git.js:148 | simple-git | None | None | See recommendations |
| 14 | `git.commit()` | git.js:157 | simple-git | None | None | See recommendations |
| 15 | `git.checkout()` | git.js:170 | simple-git | None | None | See recommendations |
| 16 | `git.merge()` | git.js:171 | simple-git | None | None | See recommendations |
| 17 | `git.branch()` | checks.js:201 | simple-git | None | None | See recommendations |
| 18 | `git.checkIsRepo()` | checks.js:53 | simple-git | None | None | See recommendations |
| 19 | Dashboard server start | dashboard.js:161 | local TCP | Implicit (fast) | Implicit | OK — localhost only |
| 20 | Dashboard standalone spawn | orchestrator.js:130 | subprocess | 5s | 5s | OK |
| 21 | `node-notifier.notify()` | notifications.js:11 | IPC | None (fire-and-forget) | None | OK — swallowed errors |
| 22 | TUI window spawn | dashboard.js:106 | subprocess | None (detached) | None | OK — unref'd, non-blocking |

### Additional fix: `runCommand()` race condition

`checks.js:runCommand()` could resolve/reject twice if both `error` and `close` events fired. Added `settled` guard to prevent double-settlement.

### Additional fix: `runCommand()` force-kill

After timeout fires and SIGTERM is sent, added SIGKILL fallback after 5s grace period (matching `claude.js` pattern) to prevent zombie processes if SIGTERM is ignored.

---

## 3. Retry Logic

### Existing Retries

| Operation | File | Strategy | Max Retries | Backoff | Jitter | Correct? | Issues | Fix |
|-----------|------|----------|-------------|---------|--------|----------|--------|-----|
| Claude Code prompt | claude.js:174 | Linear + delay | 3 (configurable) | Fixed 10s | **None** → **Added** | Mostly | Retries ALL errors (including permanent); no jitter | Added jitter (0-50% of base delay) |
| Tag name collision | git.js:67 | Counter suffix | 10 | None needed | N/A | Yes | N/A | N/A |
| Branch name collision | git.js:67 | Counter suffix | 10 | None needed | N/A | Yes | N/A | N/A |
| Lock reacquire | lock.js:58 | Single retry | 1 | None | N/A | Yes | N/A | N/A |

### Retries Added

| Operation | Strategy | Max Retries | Errors Retried | Notes |
|-----------|----------|-------------|----------------|-------|
| Claude Code retry delay | Added jitter | (unchanged) | (unchanged) | 0-50% random jitter on 10s base delay prevents synchronized retries |

### Retries Needed But Not Added

| Operation | Why Not | Risk |
|-----------|---------|------|
| `claude.js` retry: distinguish transient vs permanent errors | Claude Code exit codes are not standardized enough to reliably classify. Retrying auth errors wastes time but doesn't cause harm. | Low — at most 30s wasted on non-retryable failures |
| `git.js` operations (fallbackCommit, merge) | Git failures during a run are typically permanent (lock contention, disk full). The executor already handles failure gracefully. | Low — git operations happen locally, transient failures are rare |

---

## 4. Circuit Breaker & Fallback Assessment

NightyTidy is a single-process CLI tool with no concurrent request handling, no connection pools, and no cascading failure paths. Circuit breaker patterns do not apply.

**Existing fallback behaviors (all adequate):**

| Dependency | Current Fallback | Adequate? |
|-----------|-----------------|-----------|
| Claude Code CLI | Step marked failed, run continues with remaining steps | Yes |
| Git | Pre-checks catch unavailability; merge conflicts return indicator | Yes |
| node-notifier | Errors swallowed silently; notifications are non-critical | Yes |
| Dashboard HTTP server | Falls back to TUI-only mode; dashboard failure never crashes run | Yes |
| Dashboard TUI window | Spawn failure logged and ignored; progress still in log file | Yes |
| Filesystem (report/log) | Report: now warns instead of throwing. Log: falls back to stderr. | Yes (after fix) |

---

## 5. Partial Failure & Data Consistency

### Multi-Step Operations Analyzed

| Operation | Steps | Failure Mode | Current Handling | Fixes Applied | Remaining Risk |
|-----------|-------|-------------|-----------------|---------------|----------------|
| CLI `run()`: tag → branch → execute → report → merge | 5 sequential | Tag succeeds, branch fails → error handler doesn't mention tag | Catch block shows tag name only if `runStarted` (set after branch) | None — edge case, tag is harmless | Negligible |
| `initRun()`: lock → prechecks → git → state → dashboard | 5 sequential | Pre-checks fail → persistent lock leaked | Lock released on any failure path | **FIXED** | None |
| `finishRun()`: changelog → report → commit → merge → cleanup | 6 sequential | Report throws → lock/state/dashboard leaked | Catch block now always cleans up resources | **FIXED** | None |
| `executeSingleStep()`: prompt → doc update → commit check → fallback | 4 sequential | Prompt fails → step marked failed, run continues | Already robust — doc update failure is warned, fallback commit failure is warned | None needed | None |
| `handleAbortedRun()`: report → commit → notify → exit | 4 sequential | Report commit fails → debug logged, continues | Already robust | None needed | None |

---

## 6. Graceful Shutdown

### Before/After State

| Aspect | Before | After |
|--------|--------|-------|
| SIGINT handler (cli.js) | First: abort signal. Second: force exit | Unchanged — already good |
| unhandledRejection (cli.js) | Logs error, exits. **Dashboard not cleaned up** | **FIXED**: calls `stopDashboard()` before exit |
| Dashboard standalone SIGTERM | `server.close()` blocks indefinitely on lingering connections | **FIXED**: force exit after 5s timeout |
| Dashboard in-process (`stopDashboard()`) | Closes server without waiting for callback | Unchanged — acceptable for in-process server |

### Resource Cleanup Checklist

| Resource | Cleaned Up on Normal Exit? | Cleaned Up on Error? | Cleaned Up on SIGINT? |
|----------|---------------------------|---------------------|----------------------|
| Lock file (interactive mode) | Yes (process.on('exit')) | Yes (process.on('exit')) | Yes (process.on('exit')) |
| Lock file (orchestrator mode) | Yes (finishRun explicit) | **Yes (after fix)** | N/A (separate processes) |
| Dashboard HTTP server | Yes (scheduleShutdown) | Yes (stopDashboard) | Yes (stopDashboard) |
| Dashboard TUI window | Exits on its own (polls for status) | Exits on its own | Exits on its own |
| Dashboard standalone server | Yes (SIGTERM from finishRun) | **Yes (after fix)** | N/A |
| Ephemeral files (.url, .json) | Yes (stopDashboard) | Yes (stopDashboard) | Yes (stopDashboard) |
| State file (orchestrator) | Yes (finishRun explicit) | **Yes (after fix)** | N/A |
| Log file | Persists (by design) | Persists | Persists |

---

## 7. Queue & Job Resilience

N/A — NightyTidy has no message queues, background job systems, or async task queues. All work is sequential subprocess execution.

---

## 8. Cascading Failure Risk Map

```
NightyTidy CLI
├── Claude Code CLI (subprocess)
│   ├── Failure: step fails, retried 3x, then skipped
│   ├── Hang: 45m timeout, force-killed
│   └── Blast radius: single step only
├── Git (simple-git / local)
│   ├── Failure: pre-checks catch; merge returns conflict indicator
│   ├── Hang: ⚠ NO TIMEOUT — process hangs indefinitely
│   └── Blast radius: entire run
├── Filesystem (local)
│   ├── Failure: report warns; log falls back to stderr
│   └── Blast radius: reporting only (run still succeeds)
├── node-notifier (IPC)
│   ├── Failure: silently swallowed
│   └── Blast radius: none
└── Dashboard (HTTP/TUI)
    ├── Failure: falls back to TUI; TUI failure ignored
    └── Blast radius: none (monitoring only)
```

**Critical path with no fallback**: Git operations. If git hangs (e.g., credential helper waiting for input, NFS mount stalled, index.lock contention), the entire process blocks indefinitely with no timeout or recovery path.

---

## 9. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---------------|--------|-----------------|--------------|---------|
| 1 | Add timeouts to simple-git operations | Prevents indefinite hangs on git commands | Medium | Yes | `simple-git` supports a `timeout` option in its configuration. Add `simpleGit(dir, { timeout: { block: 120000 } })` in `initGit()` to set a 2-minute timeout on all git operations. This catches NFS stalls, credential helper hangs, and lock contention without affecting normal operation. |
| 2 | Classify Claude Code retry errors | Avoids wasting 30s retrying permanent failures (e.g., auth expired) | Low | Only if time allows | Check exit codes or error patterns to skip retries on auth/config errors (exit code 1 with "not authenticated" in stderr). Current behavior wastes time but doesn't cause harm since each retry is capped at 45m timeout. |
| 3 | Add SIGINT handler to orchestrator mode | Enables clean abort during `--run-step` | Low | Probably | Currently, Ctrl+C during orchestrator step execution kills the process without updating the state file. The step shows as "in progress" forever. Adding an abort signal + state update on SIGINT would give cleaner behavior. |

---

*Generated by NightyTidy resilience audit v0.1.0*
