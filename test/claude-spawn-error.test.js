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

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('claude.js — spawn error path', () => {
  let spawn;
  let warn;

  beforeEach(async () => {
    vi.resetModules();
    spawn = (await import('child_process')).spawn;
    warn = (await import('../src/logger.js')).warn;
    vi.clearAllMocks();
  });

  it('returns error result when spawn throws', async () => {
    spawn.mockImplementation(() => {
      throw new Error('ENOENT: spawn failed');
    });

    const { runPrompt } = await import('../src/claude.js');

    const result = await runPrompt('test prompt', '/fake', {
      label: 'test',
      retries: 0,
    });

    expect(result.success).toBe(false);
    // runPrompt wraps runOnce failures in retry loop — final error is "Failed after N attempts"
    // The inner ENOENT error is logged via warn() but the result uses the loop's summary
    expect(result.error).toContain('Failed after');
    expect(result.exitCode).toBe(-1);
    // The warn should have been called with the spawn error
    const logger = await import('../src/logger.js');
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
  });

  it('returns failure when spawn throws empty error object', async () => {
    spawn.mockImplementation(() => {
      throw {};
    });

    const { runPrompt } = await import('../src/claude.js');

    const result = await runPrompt('test prompt', '/fake', {
      label: 'test',
      retries: 0,
    });

    expect(result.success).toBe(false);
    // The inner error is "Failed to start Claude Code" but runPrompt returns loop summary
    expect(result.error).toContain('Failed after');
    expect(result.exitCode).toBe(-1);
  });

  describe('retry with fake timers', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('retries on spawn failure and eventually succeeds', async () => {
      let callCount = 0;
      spawn.mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          throw new Error('Temporary ENOENT');
        }
        // Third call succeeds
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.stdin = { write: vi.fn(), end: vi.fn() };
        child.kill = vi.fn();
        process.nextTick(() => {
          child.stdout.emit('data', Buffer.from('Success output'));
          child.emit('close', 0);
        });
        return child;
      });

      const { runPrompt } = await import('../src/claude.js');

      const resultPromise = runPrompt('test prompt', '/fake', {
        label: 'test',
        retries: 3,
      });

      // Advance through the retry delays (10s base + up to 5s jitter each)
      await vi.advanceTimersByTimeAsync(16000);
      await vi.advanceTimersByTimeAsync(16000);

      const result = await resultPromise;

      // First two attempts fail with spawn error, third succeeds
      expect(result.success).toBe(true);
      expect(result.attempts).toBe(3);
    });
  });

  it('includes duration in spawn error result', async () => {
    spawn.mockImplementation(() => {
      throw new Error('spawn failed');
    });

    const { runPrompt } = await import('../src/claude.js');

    const before = Date.now();
    const result = await runPrompt('test prompt', '/fake', {
      label: 'test',
      retries: 0,
    });

    expect(result.duration).toBeTypeOf('number');
    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(result.duration).toBeLessThan(5000); // should be near-instant
  });
});
