import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
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

describe('dashboard-tui.js — readState and startPolling', () => {
  let tempDir;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-tui-poll-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await robustCleanup(tempDir);
  });

  it('render writes clear screen escape sequence', async () => {
    const { render } = await import('../src/dashboard-tui.js');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    render({
      status: 'running',
      startTime: Date.now(),
      completedCount: 0,
      failedCount: 0,
      totalSteps: 1,
      currentStepIndex: 0,
      steps: [{ number: 1, name: 'Test', status: 'running' }],
      error: null,
    });

    // First call should be the clear screen escape
    expect(writeSpy.mock.calls[0][0]).toBe('\x1B[2J\x1B[H');

    writeSpy.mockRestore();
  });

  it('render shows step durations when available', async () => {
    const { render } = await import('../src/dashboard-tui.js');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    render({
      status: 'running',
      startTime: Date.now() - 120000,
      completedCount: 1,
      failedCount: 0,
      totalSteps: 2,
      currentStepIndex: 1,
      steps: [
        { number: 1, name: 'Lint', status: 'completed', duration: 45000 },
        { number: 2, name: 'Tests', status: 'running' },
      ],
      error: null,
    });

    const output = writeSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('45s');
    expect(output).toContain('running');

    writeSpy.mockRestore();
  });

  it('render shows no startTime as 0s', async () => {
    const { render } = await import('../src/dashboard-tui.js');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    render({
      status: 'starting',
      startTime: null,
      completedCount: 0,
      failedCount: 0,
      totalSteps: 1,
      currentStepIndex: -1,
      steps: [],
      error: null,
    });

    const output = writeSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('0s');

    writeSpy.mockRestore();
  });

  it('render shows both completed and failed counts', async () => {
    const { render } = await import('../src/dashboard-tui.js');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    render({
      status: 'completed',
      startTime: Date.now() - 300000,
      completedCount: 3,
      failedCount: 2,
      totalSteps: 5,
      currentStepIndex: -1,
      steps: [],
      error: null,
    });

    const output = writeSpy.mock.calls.map(c => c[0]).join('');
    expect(output).toContain('3 passed');
    expect(output).toContain('2 failed');

    writeSpy.mockRestore();
  });

  it('render handles missing steps gracefully', async () => {
    const { render } = await import('../src/dashboard-tui.js');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // No steps property — should default to empty array
    expect(() => render({
      status: 'running',
      startTime: Date.now(),
      completedCount: 0,
      failedCount: 0,
      totalSteps: 0,
      currentStepIndex: -1,
      error: null,
    })).not.toThrow();

    writeSpy.mockRestore();
  });

  it('progressBar shows half-filled indicator when hasActive=true', async () => {
    const { progressBar } = await import('../src/dashboard-tui.js');

    const withActive = progressBar(2, 5, true);
    const withoutActive = progressBar(2, 5, false);

    // Active should show ~50% (2.5/5), without should show ~40% (2/5)
    expect(withActive).toContain('2/5');
    expect(withoutActive).toContain('2/5');
    // The percentage should differ
    expect(withActive).toContain('50%');
    expect(withoutActive).toContain('40%');
  });

  it('formatMs handles exact minute boundary', async () => {
    const { formatMs } = await import('../src/dashboard-tui.js');
    expect(formatMs(60000)).toBe('1m 00s');
    expect(formatMs(119999)).toBe('1m 59s');
  });

  it('stepIcon renders correct icons for all statuses', async () => {
    const { render } = await import('../src/dashboard-tui.js');
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    render({
      status: 'running',
      startTime: Date.now(),
      completedCount: 1,
      failedCount: 1,
      totalSteps: 4,
      currentStepIndex: 2,
      steps: [
        { number: 1, name: 'Completed', status: 'completed', duration: 10000 },
        { number: 2, name: 'Failed', status: 'failed', duration: 5000 },
        { number: 3, name: 'Running', status: 'running' },
        { number: 4, name: 'Pending', status: 'pending' },
      ],
      error: null,
    });

    const output = writeSpy.mock.calls.map(c => c[0]).join('');
    // All step names should be present
    expect(output).toContain('Completed');
    expect(output).toContain('Failed');
    expect(output).toContain('Running');
    expect(output).toContain('Pending');
    // Unicode icons should be present (passed through by mock chalk)
    expect(output).toContain('\u2713'); // check
    expect(output).toContain('\u2717'); // X
    expect(output).toContain('\u23f3'); // hourglass
    expect(output).toContain('\u25cb'); // circle

    writeSpy.mockRestore();
  });
});
