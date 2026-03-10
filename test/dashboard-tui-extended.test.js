import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
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

// Mock chalk with chainable proxy
function createChainable() {
  const fn = (text) => text;
  return new Proxy(fn, {
    get: () => createChainable(),
    apply: (target, thisArg, args) => args[0],
  });
}

vi.mock('chalk', () => ({
  default: createChainable(),
}));

describe('dashboard-tui.js — extended', () => {
  describe('render edge cases', () => {
    it('renders error state with error message', async () => {
      const { render } = await import('../src/dashboard-tui.js');
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      render({
        status: 'error',
        startTime: Date.now() - 60000,
        completedCount: 1,
        failedCount: 1,
        totalSteps: 3,
        currentStepIndex: -1,
        steps: [
          { number: 1, name: 'Lint', status: 'completed', duration: 30000 },
          { number: 2, name: 'Tests', status: 'failed', duration: 20000 },
          { number: 3, name: 'Docs', status: 'pending' },
        ],
        error: 'Connection timed out',
      });

      const output = writeSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('Connection timed out');
      expect(output).toContain('Run finished');

      writeSpy.mockRestore();
    });

    it('renders stopped state correctly', async () => {
      const { render } = await import('../src/dashboard-tui.js');
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      render({
        status: 'stopped',
        startTime: Date.now() - 120000,
        completedCount: 2,
        failedCount: 0,
        totalSteps: 5,
        currentStepIndex: -1,
        steps: [],
        error: null,
      });

      const output = writeSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('Run finished');
      // Should NOT contain the "Press Ctrl+C" message for stopped state
      expect(output).not.toContain('Press Ctrl+C');

      writeSpy.mockRestore();
    });

    it('renders with zero completedCount and failedCount', async () => {
      const { render } = await import('../src/dashboard-tui.js');
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      render({
        status: 'running',
        startTime: Date.now(),
        completedCount: 0,
        failedCount: 0,
        totalSteps: 3,
        currentStepIndex: 0,
        steps: [
          { number: 1, name: 'Step1', status: 'running' },
        ],
        error: null,
      });

      const output = writeSpy.mock.calls.map(c => c[0]).join('');
      // Should contain step info but no "passed"/"failed" count line
      expect(output).toContain('Step1');

      writeSpy.mockRestore();
    });

    it('truncates step list when > 16 steps', async () => {
      const { render } = await import('../src/dashboard-tui.js');
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const steps = Array.from({ length: 20 }, (_, i) => ({
        number: i + 1,
        name: `Step ${i + 1}`,
        status: 'pending',
      }));

      render({
        status: 'running',
        startTime: Date.now(),
        completedCount: 0,
        failedCount: 0,
        totalSteps: 20,
        currentStepIndex: 0,
        steps,
        error: null,
      });

      const output = writeSpy.mock.calls.map(c => c[0]).join('');
      expect(output).toContain('4 more');

      writeSpy.mockRestore();
    });

    it('renders status colors for all known statuses', async () => {
      const { render } = await import('../src/dashboard-tui.js');
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const statuses = ['starting', 'running', 'finishing', 'completed', 'stopped', 'error'];
      for (const status of statuses) {
        writeSpy.mockClear();
        render({
          status,
          startTime: Date.now(),
          completedCount: 0,
          failedCount: 0,
          totalSteps: 1,
          currentStepIndex: -1,
          steps: [],
          error: status === 'error' ? 'test error' : null,
        });
        const output = writeSpy.mock.calls.map(c => c[0]).join('');
        // Status should appear capitalized somewhere in the output
        expect(output).toContain(status.charAt(0).toUpperCase() + status.slice(1));
      }

      writeSpy.mockRestore();
    });

    it('renders unknown status without crashing', async () => {
      const { render } = await import('../src/dashboard-tui.js');
      const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      expect(() => render({
        status: 'unknown-status',
        startTime: Date.now(),
        completedCount: 0,
        failedCount: 0,
        totalSteps: 1,
        currentStepIndex: -1,
        steps: [],
        error: null,
      })).not.toThrow();

      writeSpy.mockRestore();
    });
  });

  describe('formatMs edge cases', () => {
    it('formats hours correctly', async () => {
      const { formatMs } = await import('../src/dashboard-tui.js');
      expect(formatMs(3600000)).toBe('1h 00m');
      expect(formatMs(7200000 + 1800000)).toBe('2h 30m');
    });

    it('formats sub-second as 0s', async () => {
      const { formatMs } = await import('../src/dashboard-tui.js');
      expect(formatMs(500)).toBe('0s');
      expect(formatMs(0)).toBe('0s');
    });
  });

  describe('progressBar edge cases', () => {
    it('shows 0% for zero total', async () => {
      const { progressBar } = await import('../src/dashboard-tui.js');
      const result = progressBar(0, 0);
      expect(result).toContain('0/0');
      expect(result).toContain('0%');
    });

    it('shows 100% when all done', async () => {
      const { progressBar } = await import('../src/dashboard-tui.js');
      const result = progressBar(5, 5);
      expect(result).toContain('5/5');
      expect(result).toContain('100%');
    });
  });
});
