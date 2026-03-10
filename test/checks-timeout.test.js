import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock logger
vi.mock('../src/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  initLogger: vi.fn(),
}));

// Mock child_process.spawn to control subprocess behavior
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('checks.js — timeout and error paths', () => {
  let spawn;
  let info;
  let warnFn;

  // Create a fake child that resolves immediately via microtask
  function makeFakeChild({ exitCode = 0, stdout = '', stderr = '' } = {}) {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();

    Promise.resolve().then(() => {
      if (stdout) child.stdout.emit('data', Buffer.from(stdout));
      if (stderr) child.stderr.emit('data', Buffer.from(stderr));
      child.emit('close', exitCode);
    });

    return child;
  }

  function makeMockGit() {
    return {
      checkIsRepo: vi.fn().mockResolvedValue(true),
      log: vi.fn().mockResolvedValue({ latest: { hash: 'abc' } }),
      branch: vi.fn().mockResolvedValue({ all: [] }),
    };
  }

  // Command-based dispatch for parallel-safe spawn mocking.
  // Pre-checks run git/claude/disk chains in parallel, so spawn order
  // is non-deterministic. Dispatch by command name instead of call order.
  function setupSpawnDispatch({ diskOutput = '10737418240', diskError = false, diskUnparseable = false, claudeAuthFail = false, claudeAuthHang = false, claudeAuthFallbackOk = false, claudeAuthFallbackFail = false } = {}) {
    let claudeAuthCallCount = 0;

    spawn.mockImplementation((cmd, args) => {
      if (cmd === 'git') {
        return makeFakeChild({ stdout: 'git version 2.40.0' });
      }
      if (cmd === 'claude' && args?.includes('--version')) {
        return makeFakeChild({ stdout: 'claude 1.0.0' });
      }
      if (cmd === 'claude' && args?.includes('-p')) {
        claudeAuthCallCount++;

        if (claudeAuthHang && claudeAuthCallCount === 1) {
          // Never-completing child for timeout test
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.kill = vi.fn();
          return child;
        }

        if (claudeAuthFail) {
          return makeFakeChild({ stdout: '', exitCode: 1 });
        }

        // Silent auth fails, then interactive auth succeeds
        if (claudeAuthFallbackOk) {
          if (claudeAuthCallCount === 1) return makeFakeChild({ stdout: '', exitCode: 1 });
          return makeFakeChild({ exitCode: 0 });
        }

        // Silent auth fails, then interactive auth also fails
        if (claudeAuthFallbackFail) {
          if (claudeAuthCallCount === 1) return makeFakeChild({ stdout: '', exitCode: 1 });
          return makeFakeChild({ exitCode: 1 });
        }

        return makeFakeChild({ stdout: 'OK' });
      }
      // Disk space commands
      if (cmd === 'powershell') {
        if (diskError) {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.kill = vi.fn();
          Promise.resolve().then(() => child.emit('error', new Error('ENOENT')));
          return child;
        }
        if (diskUnparseable) {
          return makeFakeChild({ stdout: 'Error: no such drive', exitCode: 1 });
        }
        return makeFakeChild({ stdout: diskOutput });
      }
      if (cmd === 'wmic') {
        if (diskUnparseable) {
          return makeFakeChild({ stdout: 'FreeSpace\nNotANumber' });
        }
        return makeFakeChild({ stdout: `FreeSpace\n${diskOutput}\n` });
      }
      if (cmd === 'df') {
        if (diskError) {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.stderr = new EventEmitter();
          child.kill = vi.fn();
          Promise.resolve().then(() => child.emit('error', new Error('ENOENT')));
          return child;
        }
        return makeFakeChild({ stdout: 'Filesystem 1K-blocks Used Available\n/dev/sda1 100000000 50000000 50000000' });
      }
      return makeFakeChild({ stdout: 'ok' });
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    spawn = (await import('child_process')).spawn;
    const logger = await import('../src/logger.js');
    info = logger.info;
    warnFn = logger.warn;
    vi.clearAllMocks();
  });

  it('throws timeout error when Claude auth check exceeds 30 seconds', async () => {
    vi.useFakeTimers();

    // Suppress expected unhandled rejection from the timeout mechanism
    // The rejection is caught by our assertion but Vitest reports it as an error
    // because it propagates through the async chain after the test completes
    const suppressHandler = (err) => {
      if (err?.message?.includes('30 seconds')) return;
      throw err;
    };
    process.on('unhandledRejection', suppressHandler);

    try {
      const { runPreChecks } = await import('../src/checks.js');

      setupSpawnDispatch({ claudeAuthHang: true });

      const p = runPreChecks('/fake', makeMockGit());
      await vi.advanceTimersByTimeAsync(31000);
      await expect(p).rejects.toThrow(/didn't respond within 30 seconds/);
      await vi.runAllTimersAsync();
    } finally {
      vi.useRealTimers();
      process.removeListener('unhandledRejection', suppressHandler);
    }
  });

  it('checkDiskSpace reports OK on sufficient space', async () => {
    const { runPreChecks } = await import('../src/checks.js');

    setupSpawnDispatch({ diskOutput: '10737418240' }); // 10 GB

    await runPreChecks('C:\\fake', makeMockGit());

    expect(info).toHaveBeenCalledWith(expect.stringContaining('disk space OK'));
  });

  it('checkDiskSpace warns on low but not critical disk space', async () => {
    const { runPreChecks } = await import('../src/checks.js');

    setupSpawnDispatch({ diskOutput: '524288000' }); // ~500 MB

    await runPreChecks('C:\\fake', makeMockGit());

    expect(warnFn).toHaveBeenCalledWith(expect.stringContaining('Low disk space'));
  });

  it('checkDiskSpace throws on critically low disk space', async () => {
    const { runPreChecks } = await import('../src/checks.js');

    setupSpawnDispatch({ diskOutput: '52428800' }); // ~50 MB

    await expect(runPreChecks('C:\\fake', makeMockGit())).rejects.toThrow(/Very low disk space/);
  });

  it('checkDiskSpace skips when PowerShell and wmic return unparseable output', async () => {
    const { runPreChecks } = await import('../src/checks.js');

    setupSpawnDispatch({ diskUnparseable: true });

    await runPreChecks('C:\\fake', makeMockGit());

    // Should have called info with "skipped" for disk space
    const diskSpaceCalls = info.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('disk space')
    );
    expect(diskSpaceCalls.length).toBeGreaterThan(0);
  });

  it('checkClaudeAuthenticated falls through to interactive on failed silent auth', async () => {
    const { runPreChecks } = await import('../src/checks.js');

    setupSpawnDispatch({ claudeAuthFallbackOk: true });

    await runPreChecks('C:\\fake', makeMockGit());

    expect(info).toHaveBeenCalledWith(expect.stringContaining('Claude Code needs to sign in'));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('authenticated'));
  });

  it('checkClaudeAuthenticated throws when interactive auth also fails', async () => {
    const { runPreChecks } = await import('../src/checks.js');

    setupSpawnDispatch({ claudeAuthFallbackFail: true });

    await expect(runPreChecks('C:\\fake', makeMockGit())).rejects.toThrow(/sign-in did not complete/);
  });

  it('checkDiskSpace skips gracefully when spawn errors', async () => {
    const { runPreChecks } = await import('../src/checks.js');

    setupSpawnDispatch({ diskError: true });

    await runPreChecks('C:\\fake', makeMockGit());

    // Should skip disk space check rather than crash
    expect(info).toHaveBeenCalledWith(expect.stringContaining('disk space'));
  });
});
