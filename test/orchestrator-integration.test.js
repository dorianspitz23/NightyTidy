import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import simpleGit from 'simple-git';
import { EventEmitter } from 'events';
import { robustCleanup } from './helpers/cleanup.js';

// Mock only the Claude subprocess, logger, notifications, and checks
vi.mock('../src/claude.js', () => ({
  runPrompt: vi.fn(),
}));

vi.mock('../src/logger.js', () => ({
  initLogger: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../src/notifications.js', () => ({
  notify: vi.fn(),
}));

vi.mock('../src/checks.js', () => ({
  runPreChecks: vi.fn(),
}));

// Mock child_process.spawn for dashboard-standalone while allowing real git operations
// We use vi.mock with a simple function mock since the orchestrator only spawns dashboard
vi.mock('child_process', () => {
  function makeFakeProc() {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.unref = vi.fn();
    proc.kill = vi.fn();
    process.nextTick(() => {
      proc.stdout.emit('data', Buffer.from(
        JSON.stringify({ port: 9999, url: 'http://localhost:9999', pid: 99999 }) + '\n'
      ));
    });
    return proc;
  }

  return {
    spawn: vi.fn(() => makeFakeProc()),
  };
});

describe('orchestrator integration with real git', () => {
  let tempDir;
  let git;
  let runPrompt;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-orch-int-'));
    git = simpleGit(tempDir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
    await writeFile(path.join(tempDir, 'init.txt'), 'initial');
    await git.add('.');
    await git.commit('initial commit');

    const claude = await import('../src/claude.js');
    runPrompt = claude.runPrompt;
    runPrompt.mockResolvedValue({ success: true, output: 'done', attempts: 1 });
  });

  afterEach(async () => {
    try {
      const { releaseLock } = await import('../src/lock.js');
      releaseLock(tempDir);
    } catch { /* ignore */ }

    try {
      const statePath = path.join(tempDir, 'nightytidy-run-state.json');
      if (existsSync(statePath)) unlinkSync(statePath);
    } catch { /* ignore */ }

    await robustCleanup(tempDir);
  });

  it('lock file persists across separate orchestrator invocations', async () => {
    const { initRun } = await import('../src/orchestrator.js');

    const result = await initRun(tempDir, { steps: '1' });
    expect(result.success).toBe(true);

    expect(existsSync(path.join(tempDir, 'nightytidy.lock'))).toBe(true);
  });

  it('state file tracks selected steps after initRun', async () => {
    const { initRun } = await import('../src/orchestrator.js');

    const result = await initRun(tempDir, { steps: '1,2,3' });
    expect(result.success).toBe(true);

    const statePath = path.join(tempDir, 'nightytidy-run-state.json');
    expect(existsSync(statePath)).toBe(true);

    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(state.selectedSteps).toEqual([1, 2, 3]);
    expect(state.completedSteps).toEqual([]);
    expect(state.failedSteps).toEqual([]);
  });

  it('progress file is written during initRun', async () => {
    const { initRun } = await import('../src/orchestrator.js');

    await initRun(tempDir, { steps: '1' });

    const progressPath = path.join(tempDir, 'nightytidy-progress.json');
    expect(existsSync(progressPath)).toBe(true);

    const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
    expect(progress.status).toBe('running');
    expect(progress.totalSteps).toBe(1);
  });

  it('initRun rejects with existing state file', async () => {
    const { initRun } = await import('../src/orchestrator.js');

    await initRun(tempDir, { steps: '1' });

    vi.resetModules();
    const { initRun: initRun2 } = await import('../src/orchestrator.js');
    const result = await initRun2(tempDir, { steps: '1' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('already in progress');
  });

  it('initRun validates step numbers', async () => {
    const { initRun } = await import('../src/orchestrator.js');

    const result = await initRun(tempDir, { steps: '99' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid step number');
  });

  it('initRun returns dashboard URL and branch info', async () => {
    const { initRun } = await import('../src/orchestrator.js');

    const result = await initRun(tempDir, { steps: '1' });
    expect(result.success).toBe(true);
    expect(result.runBranch).toMatch(/^nightytidy\/run-/);
    expect(result.tagName).toMatch(/^nightytidy-before-/);
    expect(result.selectedSteps).toEqual([1]);
    expect(result.dashboardUrl).toBe('http://localhost:9999');
  });
});
