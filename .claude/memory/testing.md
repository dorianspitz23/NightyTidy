# Testing — Tier 2 Reference

Assumes CLAUDE.md loaded. 430 tests, 40 files, Vitest v2.

## Test File → Module Coverage

| Test File | Module | Tests | Type |
|-----------|--------|-------|------|
| `smoke.test.js` | All (structural) | 6 | Smoke — deploy verification |
| `cli.test.js` | `cli.js` | 27 | Unit (mocked lifecycle) |
| `cli-extended.test.js` | `cli.js` | 31 | Unit (dashboard state, abort, orchestrator pass-through) |
| `dashboard.test.js` | `dashboard.js` | 15 | Unit + Integration (real HTTP) |
| `dashboard-extended.test.js` | `dashboard.js` | 3 | Unit (scheduleShutdown timer) |
| `dashboard-standalone.test.js` | `dashboard-standalone.js` | 10 | Integration (real HTTP server) |
| `dashboard-security.test.js` | `dashboard.js` | 7 | Unit (security headers, CSRF) |
| `dashboard-error-paths.test.js` | `dashboard.js` | 5 | Unit (error recovery, SSE failures) |
| `dashboard-tui.test.js` | `dashboard-tui.js` | 18 | Unit (TUI rendering, chalk proxy) |
| `dashboard-tui-extended.test.js` | `dashboard-tui.js` | 10 | Unit (render edge cases) |
| `dashboard-tui-polling.test.js` | `dashboard-tui.js` | 8 | Unit (polling, elapsed time) |
| `logger.test.js` | `logger.js` | 10 | Integration (real file I/O) |
| `checks.test.js` | `checks.js` | 4 | Unit (mocked subprocess) |
| `checks-extended.test.js` | `checks.js` | 13 | Unit (auth, disk, empty repo) |
| `checks-timeout.test.js` | `checks.js` | 8 | Unit (timeout, disk space edge cases) |
| `claude.test.js` | `claude.js` | 21 | Unit (fake process, fake timers) |
| `claude-spawn-error.test.js` | `claude.js` | 4 | Unit (spawn error paths, retry) |
| `executor.test.js` | `executor.js` | 9 | Unit (mocked claude, git) |
| `executor-extended.test.js` | `executor.js` | 7 | Unit (fallback commit, doc update) |
| `executor-integrity.test.js` | `executor.js` | 2 | Unit (prompt integrity hash) |
| `git.test.js` | `git.js` | 16 | Integration (real git, temp dirs) |
| `git-extended.test.js` | `git.js` | 7 | Integration (collision, empty repo) |
| `git-retry.test.js` | `git.js` | 7 | Integration (tag/branch retry loops) |
| `git-merge-abort.test.js` | `git.js` | 6 | Integration (merge conflict abort) |
| `notifications.test.js` | `notifications.js` | 2 | Unit (mock notifier) |
| `report.test.js` | `report.js` | 7 | Unit (mock fs) |
| `report-extended.test.js` | `report.js` | 15 | Unit (CLAUDE.md update, edge cases) |
| `steps.test.js` | `prompts/steps.js` | 6 | Structural integrity |
| `integration.test.js` | Multi-module | 5 | Integration (real git + fs) |
| `integration-extended.test.js` | Multi-module | 6 | Integration (abort, ephemeral, report) |
| `setup.test.js` | `setup.js` | 7 | Unit (mock fs) |
| `lock.test.js` | `lock.js` | 14 | Unit (atomic lock, stale detection) |
| `lock-extended.test.js` | `lock.js` | 7 | Unit (persistent mode, edge cases) |
| `lock-interactive.test.js` | `lock.js` | 5 | Unit (TTY override prompt) |
| `lock-race-condition.test.js` | `lock.js` | 4 | Unit (concurrent lock races) |
| `orchestrator.test.js` | `orchestrator.js` | 31 | Unit (initRun, runStep, finishRun, dashboard) |
| `orchestrator-error-paths.test.js` | `orchestrator.js` | 10 | Unit (error recovery paths) |
| `orchestrator-integration.test.js` | `orchestrator.js` | 6 | Integration (real state file ops) |
| `orchestrator-lifecycle.test.js` | `orchestrator.js` | 5 | Integration (full lifecycle) |
| `contracts.test.js` | All modules | 46 | Contract verification vs CLAUDE.md |

## Test Helpers (`test/helpers/`)

| File | Exports | Used By |
|------|---------|---------|
| `cleanup.js` | `robustCleanup(dir, maxAttempts?, delay?)` | All integration tests with temp dirs |
| `mocks.js` | `createMockProcess()`, `createErrorProcess()`, `createTimeoutProcess()`, `createMockGit()` | checks tests, contracts tests |
| `testdata.js` | `makeMetadata(overrides)`, `makeResults({ completedCount, failedCount })` | report tests |

## Universal Logger Mock

```js
vi.mock('../src/logger.js', () => ({
  initLogger: vi.fn(), info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
}));
```

Without this: tests crash writing `nightytidy-run.log`. Exception: `logger.test.js` tests real logger.

## Mock Patterns

### Fake ChildProcess (claude.test.js)
- `createFakeChild()` → EventEmitter with `.stdout`, `.stderr`, `.stdin`, `.kill`
- `setupSpawnSequence(...behaviors)` configures multiple spawn calls in order
- Schedule events via `queueMicrotask()` — listeners attach before events fire
- `vi.useFakeTimers({ shouldAdvanceTime: true })` for retry/timeout tests

### Mock subprocess (checks tests)
- `createMockProcess({ code, stdout, stderr })` from `test/helpers/mocks.js`
- Conditional mock: `spawn.mockImplementation((cmd, args) => { if (cmd === 'git') ... })`

### Real git integration (git tests, integration tests)
- Create temp dir: `mkdtemp(path.join(tmpdir(), 'nightytidy-test-'))`
- Init repo: `git init` + config `user.email`/`user.name` + initial commit
- Call `initGit(tempDir)` to set module singleton per test
- Cleanup: `robustCleanup(tempDir)` — NEVER raw `rm()`

### vi.doMock isolation (contracts.test.js)
- `vi.resetModules()` + `vi.doMock()` in `beforeEach`
- **Must** `vi.doUnmock()` in `afterEach` — registrations persist across `resetModules()`
- Dynamic import AFTER mocks: `const { fn } = await import('../src/module.js')`

## Common Pitfalls

See `pitfalls.md` for full list. Key testing-specific ones:
- **Windows EBUSY**: Always `robustCleanup()`, never raw `rm()` in temp dir tests
- **Fake timers**: `vi.useFakeTimers({ shouldAdvanceTime: true })` or retry tests hang
- **`vi.clearAllMocks()` ≠ `vi.resetAllMocks()`**: clear resets calls, reset also clears implementations
