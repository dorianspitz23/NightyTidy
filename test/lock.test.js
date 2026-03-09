import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
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

describe('lock.js', () => {
  let tempDir;
  let debug;
  let warn;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-lock-'));
    const logger = await import('../src/logger.js');
    debug = logger.debug;
    warn = logger.warn;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await robustCleanup(tempDir);
  });

  describe('acquireLock', () => {
    it('creates a lock file with pid and timestamp', async () => {
      const { acquireLock } = await import('../src/lock.js');
      await acquireLock(tempDir);

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      expect(existsSync(lockPath)).toBe(true);

      const data = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(data.pid).toBe(process.pid);
      expect(data.started).toBeDefined();
      expect(new Date(data.started).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('logs debug message on successful lock acquisition', async () => {
      const { acquireLock } = await import('../src/lock.js');
      await acquireLock(tempDir);

      expect(debug).toHaveBeenCalledWith(expect.stringContaining(`Lock acquired (PID ${process.pid})`));
    });

    it('removes stale lock from dead process and re-acquires', async () => {
      const { acquireLock } = await import('../src/lock.js');

      // Write a lock file with a PID that definitely doesn't exist
      const lockPath = path.join(tempDir, 'nightytidy.lock');
      const stalePid = 999999999; // unlikely to exist
      await writeFile(lockPath, JSON.stringify({ pid: stalePid, started: new Date().toISOString() }));

      await acquireLock(tempDir);

      // Lock should now belong to our process
      const data = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(data.pid).toBe(process.pid);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale lock'));
    });

    it('removes lock older than 24 hours regardless of PID', async () => {
      const { acquireLock } = await import('../src/lock.js');

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      // Lock from 25 hours ago — even if PID happens to be alive, age makes it stale
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, started: oldDate }));

      await acquireLock(tempDir);

      const data = JSON.parse(readFileSync(lockPath, 'utf8'));
      // Should be re-acquired with fresh timestamp
      const age = Date.now() - new Date(data.started).getTime();
      expect(age).toBeLessThan(5000); // fresh lock, not the 25h-old one
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale lock'));
    });

    it('removes corrupt lock file and re-acquires', async () => {
      const { acquireLock } = await import('../src/lock.js');

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      await writeFile(lockPath, 'not-valid-json{{{');

      await acquireLock(tempDir);

      const data = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(data.pid).toBe(process.pid);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('stale lock'));
    });

    it('removes lock file with missing pid field (treated as stale)', async () => {
      const { acquireLock } = await import('../src/lock.js');

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      await writeFile(lockPath, JSON.stringify({ started: new Date().toISOString() }));

      await acquireLock(tempDir);

      const data = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(data.pid).toBe(process.pid);
    });

    it('throws for non-EEXIST errors from writeLockFile', async () => {
      const { acquireLock } = await import('../src/lock.js');

      // Use a directory that doesn't exist — openSync will fail with ENOENT, not EEXIST
      const badDir = path.join(tempDir, 'nonexistent-subdir');

      await expect(acquireLock(badDir)).rejects.toThrow();
    });

    it('registers exit handler for non-persistent mode', async () => {
      const onSpy = vi.spyOn(process, 'on');
      const { acquireLock } = await import('../src/lock.js');

      await acquireLock(tempDir);

      expect(onSpy).toHaveBeenCalledWith('exit', expect.any(Function));
      onSpy.mockRestore();
    });

    it('skips exit handler in persistent mode', async () => {
      const onSpy = vi.spyOn(process, 'on');
      const { acquireLock } = await import('../src/lock.js');

      // Clear existing calls
      onSpy.mockClear();
      await acquireLock(tempDir, { persistent: true });

      // In persistent mode, process.on('exit') should NOT be called for lock cleanup
      const exitCalls = onSpy.mock.calls.filter(([event]) => event === 'exit');
      expect(exitCalls.length).toBe(0);
      onSpy.mockRestore();
    });

    it('throws when active lock exists in non-TTY mode', async () => {
      const { acquireLock } = await import('../src/lock.js');

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      // Lock with our own PID (definitely alive) and fresh timestamp
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));

      // In test environment, process.stdin.isTTY is falsy, so promptOverride throws
      await expect(acquireLock(tempDir)).rejects.toThrow(/Another NightyTidy run is already in progress/);
    });

    it('includes PID and started time in non-TTY error message', async () => {
      const { acquireLock } = await import('../src/lock.js');

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      const started = new Date().toISOString();
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, started }));

      await expect(acquireLock(tempDir)).rejects.toThrow(new RegExp(`PID ${process.pid}`));
    });
  });

  describe('releaseLock', () => {
    it('removes the lock file', async () => {
      const { acquireLock, releaseLock } = await import('../src/lock.js');

      await acquireLock(tempDir);
      const lockPath = path.join(tempDir, 'nightytidy.lock');
      expect(existsSync(lockPath)).toBe(true);

      releaseLock(tempDir);
      expect(existsSync(lockPath)).toBe(false);
    });

    it('does not throw when lock file does not exist', async () => {
      const { releaseLock } = await import('../src/lock.js');

      expect(() => releaseLock(tempDir)).not.toThrow();
    });

    it('is idempotent — calling twice does not throw', async () => {
      const { acquireLock, releaseLock } = await import('../src/lock.js');

      await acquireLock(tempDir);
      releaseLock(tempDir);
      expect(() => releaseLock(tempDir)).not.toThrow();
    });
  });
});
