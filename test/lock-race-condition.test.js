import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
import { existsSync, readFileSync, openSync, writeFileSync, closeSync, unlinkSync } from 'fs';
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

describe('lock.js — race condition in removeLockAndReacquire', () => {
  let tempDir;
  let warn;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-lock-race-'));
    warn = (await import('../src/logger.js')).warn;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await robustCleanup(tempDir);
  });

  it('throws EEXIST race error when another process acquires lock during stale removal', async () => {
    // This test simulates the exact race condition:
    // 1. Process A finds stale lock → unlinkSync succeeds
    // 2. Process B creates a new lock in between
    // 3. Process A's writeLockFile fails with EEXIST

    const lockPath = path.join(tempDir, 'nightytidy.lock');

    // Write stale lock (dead PID)
    await writeFile(lockPath, JSON.stringify({ pid: 999999999, started: new Date().toISOString() }));

    // We need to mock fs.openSync to simulate the race.
    // On the first call it will succeed normally (or whatever happens during unlink+recreate).
    // Actually, we need a more targeted approach.

    vi.resetModules();

    // Use doMock to intercept openSync specifically for the lock file
    let openCallCount = 0;
    const realFs = await import('fs');
    const realOpenSync = realFs.openSync;
    const realWriteFileSync = realFs.writeFileSync;
    const realCloseSync = realFs.closeSync;

    vi.doMock('fs', async (importOriginal) => {
      const orig = await importOriginal();
      return {
        ...orig,
        openSync: vi.fn((filePath, flags) => {
          if (typeof filePath === 'string' && filePath.endsWith('nightytidy.lock') && flags === 'wx') {
            openCallCount++;
            if (openCallCount === 2) {
              // Second attempt (after stale removal) — simulate race
              const err = new Error('EEXIST: file already exists');
              err.code = 'EEXIST';
              throw err;
            }
          }
          return orig.openSync(filePath, flags);
        }),
        writeFileSync: orig.writeFileSync,
        closeSync: orig.closeSync,
        readFileSync: orig.readFileSync,
        unlinkSync: orig.unlinkSync,
        existsSync: orig.existsSync,
      };
    });

    const { acquireLock } = await import('../src/lock.js');

    await expect(acquireLock(tempDir)).rejects.toThrow(/Another NightyTidy run acquired the lock/);

    vi.doUnmock('fs');
  });

  it('rethrows non-EEXIST errors during reacquisition', async () => {
    const lockPath = path.join(tempDir, 'nightytidy.lock');

    // Write stale lock (dead PID)
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
            if (openCallCount === 2) {
              // Second attempt — throw a different error (e.g., EACCES)
              const err = new Error('EACCES: permission denied');
              err.code = 'EACCES';
              throw err;
            }
          }
          return orig.openSync(filePath, flags);
        }),
        writeFileSync: orig.writeFileSync,
        closeSync: orig.closeSync,
        readFileSync: orig.readFileSync,
        unlinkSync: orig.unlinkSync,
        existsSync: orig.existsSync,
      };
    });

    const { acquireLock } = await import('../src/lock.js');

    await expect(acquireLock(tempDir)).rejects.toThrow(/EACCES/);

    vi.doUnmock('fs');
  });

  it('exit handler cleans up lock file', async () => {
    const { acquireLock } = await import('../src/lock.js');

    const exitHandlers = [];
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event, handler) => {
      if (event === 'exit') exitHandlers.push(handler);
    });

    await acquireLock(tempDir);

    const lockPath = path.join(tempDir, 'nightytidy.lock');
    expect(existsSync(lockPath)).toBe(true);

    // Simulate process exit — call the registered handler
    expect(exitHandlers.length).toBeGreaterThan(0);
    exitHandlers[exitHandlers.length - 1]();

    expect(existsSync(lockPath)).toBe(false);

    onSpy.mockRestore();
  });

  it('exit handler does not throw when lock already removed', async () => {
    const { acquireLock, releaseLock } = await import('../src/lock.js');

    const exitHandlers = [];
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event, handler) => {
      if (event === 'exit') exitHandlers.push(handler);
    });

    await acquireLock(tempDir);

    // Release lock manually first
    releaseLock(tempDir);

    // Now simulate exit — handler should not throw
    expect(() => exitHandlers[exitHandlers.length - 1]()).not.toThrow();

    onSpy.mockRestore();
  });
});
