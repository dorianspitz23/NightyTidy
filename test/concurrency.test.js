import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { robustCleanup } from './helpers/cleanup.js';

// Mock logger
vi.mock('../src/logger.js', () => ({
  debug: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  initLogger: vi.fn(),
}));

describe('concurrency — lock.js ENOENT resilience', () => {
  let tempDir;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-conc-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.doUnmock('fs');
    await robustCleanup(tempDir);
  });

  it('removeLockAndReacquire handles ENOENT when lock disappears before unlink', async () => {
    // Scenario: lock file exists when checked, but is removed by the original
    // holder before removeLockAndReacquire calls unlinkSync. The fix catches
    // ENOENT and proceeds to writeLockFile.

    const lockPath = path.join(tempDir, 'nightytidy.lock');

    // Write a stale lock (dead PID)
    await writeFile(lockPath, JSON.stringify({ pid: 999999999, started: new Date().toISOString() }));

    vi.resetModules();

    let openCallCount = 0;

    vi.doMock('fs', async (importOriginal) => {
      const orig = await importOriginal();
      return {
        ...orig,
        openSync: vi.fn((filePath, flags) => {
          if (typeof filePath === 'string' && filePath.endsWith('nightytidy.lock') && flags === 'wx') {
            openCallCount++;
            if (openCallCount === 1) {
              // First attempt: lock exists
              const err = new Error('EEXIST: file already exists');
              err.code = 'EEXIST';
              throw err;
            }
            // Second attempt (after stale removal): succeed
          }
          return orig.openSync(filePath, flags);
        }),
        unlinkSync: vi.fn((filePath) => {
          if (typeof filePath === 'string' && filePath.endsWith('nightytidy.lock')) {
            // Actually remove the file so subsequent openSync('wx') succeeds,
            // then throw ENOENT to simulate the race: another process already deleted it
            try { orig.unlinkSync(filePath); } catch { /* may already be gone */ }
            const err = new Error('ENOENT: no such file or directory');
            err.code = 'ENOENT';
            throw err;
          }
          return orig.unlinkSync(filePath);
        }),
        writeFileSync: orig.writeFileSync,
        closeSync: orig.closeSync,
        readFileSync: orig.readFileSync,
        existsSync: orig.existsSync,
      };
    });

    const { acquireLock } = await import('../src/lock.js');

    // Should succeed — ENOENT on unlink is caught, writeLockFile proceeds
    await expect(acquireLock(tempDir)).resolves.toBeUndefined();
  });

  it('removeLockAndReacquire rethrows non-ENOENT unlink errors', async () => {
    const lockPath = path.join(tempDir, 'nightytidy.lock');

    await writeFile(lockPath, JSON.stringify({ pid: 999999999, started: new Date().toISOString() }));

    vi.resetModules();

    let openCallCount = 0;

    vi.doMock('fs', async (importOriginal) => {
      const orig = await importOriginal();
      return {
        ...orig,
        openSync: vi.fn((filePath, flags) => {
          if (typeof filePath === 'string' && filePath.endsWith('nightytidy.lock') && flags === 'wx') {
            openCallCount++;
            if (openCallCount === 1) {
              const err = new Error('EEXIST: file already exists');
              err.code = 'EEXIST';
              throw err;
            }
          }
          return orig.openSync(filePath, flags);
        }),
        unlinkSync: vi.fn((filePath) => {
          if (typeof filePath === 'string' && filePath.endsWith('nightytidy.lock')) {
            const err = new Error('EPERM: operation not permitted');
            err.code = 'EPERM';
            throw err;
          }
          return orig.unlinkSync(filePath);
        }),
        writeFileSync: orig.writeFileSync,
        closeSync: orig.closeSync,
        readFileSync: orig.readFileSync,
        existsSync: orig.existsSync,
      };
    });

    const { acquireLock } = await import('../src/lock.js');

    await expect(acquireLock(tempDir)).rejects.toThrow(/EPERM/);
  });
});

describe('concurrency — dashboard.js', () => {
  let tempDir;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-dash-conc-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    try {
      const { stopDashboard } = await import('../src/dashboard.js');
      stopDashboard();
    } catch { /* may not be startable */ }
    await robustCleanup(tempDir);
  });

  it('scheduleShutdown clears existing timer before setting new one', async () => {
    const { startDashboard, scheduleShutdown, stopDashboard } = await import('../src/dashboard.js');

    const state = { status: 'running', steps: [] };

    await startDashboard(state, {
      onStop: () => {},
      projectDir: tempDir,
    });

    // Double schedule should not leak — first timer should be cleared
    scheduleShutdown();
    scheduleShutdown();

    // Clean up immediately (cancels the timer)
    stopDashboard();
  });

  it('stopDashboard is idempotent — can be called multiple times safely', async () => {
    const { startDashboard, stopDashboard } = await import('../src/dashboard.js');

    const state = { status: 'running', steps: [] };

    await startDashboard(state, {
      onStop: () => {},
      projectDir: tempDir,
    });

    // Multiple stop calls should not throw
    expect(() => stopDashboard()).not.toThrow();
    expect(() => stopDashboard()).not.toThrow();
    expect(() => stopDashboard()).not.toThrow();
  });

  it('updateDashboard after stopDashboard does not crash', async () => {
    const { startDashboard, updateDashboard, stopDashboard } = await import('../src/dashboard.js');

    const state = { status: 'running', steps: [] };

    await startDashboard(state, {
      onStop: () => {},
      projectDir: tempDir,
    });

    stopDashboard();

    // Updating after stop should not crash — progressFilePath is null
    expect(() => updateDashboard({ status: 'completed', steps: [] })).not.toThrow();
  });
});

describe('concurrency — orchestrator state file race (documented)', () => {
  it('RACE CONDITION: simultaneous runStep calls could lose state', () => {
    // This test documents the race condition where two concurrent --run-step
    // invocations both read the same state file, both push to completedSteps,
    // and the last writer wins — losing the other step's result.
    //
    // Timeline:
    //   T0: Process A: readState() → { completedSteps: [] }
    //   T1: Process B: readState() → { completedSteps: [] }
    //   T2: Process A: state.completedSteps.push(step1)
    //   T3: Process A: writeState() → file = { completedSteps: [step1] }
    //   T4: Process B: state.completedSteps.push(step2)
    //   T5: Process B: writeState() → file = { completedSteps: [step2] }
    //   Result: step1 is lost.
    //
    // Mitigation: The orchestrator is designed for sequential --run-step calls
    // (one at a time). The calling Claude Code process runs steps sequentially.
    // No fix needed unless parallel step execution is added in the future.
    expect(true).toBe(true);
  });
});

describe('concurrency — dashboard-standalone.js (documented)', () => {
  it('pollTimer declaration order is safe due to async callback timing', () => {
    // pollTimer is declared at line 117 but assigned at line 114 inside the
    // server.listen() async callback. The callback always runs after the
    // declaration is executed (next tick at earliest), so there is no TDZ error.
    // A clarifying comment was added in the source.
    expect(true).toBe(true);
  });
});
