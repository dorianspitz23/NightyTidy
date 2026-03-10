import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
import { readFileSync, existsSync } from 'fs';
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

// Mock readline to simulate user input
vi.mock('readline', () => ({
  createInterface: vi.fn(),
}));

describe('lock.js — interactive override', () => {
  let tempDir;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-lock-int-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await robustCleanup(tempDir);
  });

  it('user confirms override — lock is re-acquired', async () => {
    const readline = await import('readline');
    const closeFn = vi.fn();
    readline.createInterface.mockReturnValue({
      question: (prompt, cb) => {
        // Simulate user typing 'y'
        process.nextTick(() => cb('y'));
      },
      close: closeFn,
    });

    // Temporarily make process.stdin.isTTY truthy
    const origTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;

    try {
      const { acquireLock } = await import('../src/lock.js');
      const { warn } = await import('../src/logger.js');

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      // Active lock (our own PID — definitely alive, fresh timestamp)
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));

      await acquireLock(tempDir);

      // Lock should be re-acquired
      const data = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(data.pid).toBe(process.pid);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('overridden by user'));
      expect(closeFn).toHaveBeenCalled();
    } finally {
      process.stdin.isTTY = origTTY;
    }
  });

  it('user declines override — throws cancellation error', async () => {
    const readline = await import('readline');
    readline.createInterface.mockReturnValue({
      question: (prompt, cb) => {
        // Simulate user typing 'n'
        process.nextTick(() => cb('n'));
      },
      close: vi.fn(),
    });

    const origTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;

    try {
      const { acquireLock } = await import('../src/lock.js');

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));

      await expect(acquireLock(tempDir)).rejects.toThrow(/cancelled/i);
    } finally {
      process.stdin.isTTY = origTTY;
    }
  });

  it('user presses Enter (empty input) — treated as N', async () => {
    const readline = await import('readline');
    readline.createInterface.mockReturnValue({
      question: (prompt, cb) => {
        process.nextTick(() => cb(''));
      },
      close: vi.fn(),
    });

    const origTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;

    try {
      const { acquireLock } = await import('../src/lock.js');

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));

      await expect(acquireLock(tempDir)).rejects.toThrow(/cancelled/i);
    } finally {
      process.stdin.isTTY = origTTY;
    }
  });

  it('user enters Y (uppercase) — override accepted', async () => {
    const readline = await import('readline');
    readline.createInterface.mockReturnValue({
      question: (prompt, cb) => {
        process.nextTick(() => cb('Y'));
      },
      close: vi.fn(),
    });

    const origTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;

    try {
      const { acquireLock } = await import('../src/lock.js');

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));

      await acquireLock(tempDir);

      const data = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(data.pid).toBe(process.pid);
    } finally {
      process.stdin.isTTY = origTTY;
    }
  });

  it('user enters whitespace-padded y — still accepted', async () => {
    const readline = await import('readline');
    readline.createInterface.mockReturnValue({
      question: (prompt, cb) => {
        process.nextTick(() => cb('  y  '));
      },
      close: vi.fn(),
    });

    const origTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;

    try {
      const { acquireLock } = await import('../src/lock.js');

      const lockPath = path.join(tempDir, 'nightytidy.lock');
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));

      await acquireLock(tempDir);

      const data = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(data.pid).toBe(process.pid);
    } finally {
      process.stdin.isTTY = origTTY;
    }
  });
});
