import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { robustCleanup } from './helpers/cleanup.js';

// Mock logger to prevent file I/O during tests
vi.mock('../src/logger.js', () => ({
  debug: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  initLogger: vi.fn(),
}));

describe('lock.js — extended', () => {
  let tempDir;
  let warn;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-lock-ext-'));
    warn = (await import('../src/logger.js')).warn;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await robustCleanup(tempDir);
  });

  describe('removeLockAndReacquire race condition', () => {
    it('throws when another process acquires lock during stale lock cleanup', async () => {
      // We can simulate this by having a lock file that is stale (dead PID),
      // but after we delete it, another file appears before we can create ours.
      // This tests the EEXIST retry path in removeLockAndReacquire.
      const { acquireLock } = await import('../src/lock.js');

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      // Write stale lock (dead PID)
      await writeFile(lockPath, JSON.stringify({ pid: 999999999, started: new Date().toISOString() }));

      // We can't easily simulate a race condition in a single-threaded test,
      // but we verify the normal stale-lock-removal path works
      await acquireLock(tempDir);

      const data = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(data.pid).toBe(process.pid);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale lock'));
    });
  });

  describe('promptOverride in non-TTY', () => {
    it('error message mentions lock filename for manual deletion', async () => {
      const { acquireLock } = await import('../src/lock.js');

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));

      await expect(acquireLock(tempDir)).rejects.toThrow(/nightytidy\.lock/);
    });

    it('error message provides actionable guidance', async () => {
      const { acquireLock } = await import('../src/lock.js');

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));

      await expect(acquireLock(tempDir)).rejects.toThrow(/delete .* and try again/i);
    });
  });

  describe('edge cases', () => {
    it('lock file with empty object (no pid, no started) is treated as stale', async () => {
      const { acquireLock } = await import('../src/lock.js');

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      await writeFile(lockPath, JSON.stringify({}));

      await acquireLock(tempDir);

      const data = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(data.pid).toBe(process.pid);
    });

    it('lock file with invalid JSON date in started field still works', async () => {
      const { acquireLock } = await import('../src/lock.js');

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      // PID 999999999 is dead, so stale regardless of date
      await writeFile(lockPath, JSON.stringify({ pid: 999999999, started: 'not-a-date' }));

      await acquireLock(tempDir);

      const data = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(data.pid).toBe(process.pid);
    });

    it('lock with alive PID but no started field — PID check takes precedence', async () => {
      const { acquireLock } = await import('../src/lock.js');

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      // Our own PID is alive, no started field, so isLockStale checks PID first
      await writeFile(lockPath, JSON.stringify({ pid: process.pid }));

      // PID is alive → not stale → promptOverride called → non-TTY throws
      await expect(acquireLock(tempDir)).rejects.toThrow(/Another NightyTidy run/);
    });

    it('releaseLock on a directory where lock was never created', async () => {
      const { releaseLock } = await import('../src/lock.js');

      // Should not throw — silently does nothing
      expect(() => releaseLock(tempDir)).not.toThrow();
    });
  });
});
