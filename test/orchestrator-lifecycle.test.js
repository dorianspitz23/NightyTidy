import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import simpleGit from 'simple-git';
import { EventEmitter } from 'events';
import { robustCleanup } from './helpers/cleanup.js';

// Mock Claude subprocess, logger, notifications, checks
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

// Mock child_process.spawn for dashboard
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

describe('orchestrator full lifecycle — init → runStep → finishRun', () => {
  let tempDir;
  let git;
  let runPrompt;
  let notify;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-orch-lifecycle-'));
    git = simpleGit(tempDir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
    await writeFile(path.join(tempDir, 'init.txt'), 'initial');
    await git.add('.');
    await git.commit('initial commit');

    const claude = await import('../src/claude.js');
    const notif = await import('../src/notifications.js');
    runPrompt = claude.runPrompt;
    notify = notif.notify;
    runPrompt.mockResolvedValue({ success: true, output: 'done', attempts: 1 });
  });

  afterEach(async () => {
    try {
      const { releaseLock } = await import('../src/lock.js');
      releaseLock(tempDir);
    } catch { /* ignore */ }

    for (const f of ['nightytidy-run-state.json', 'nightytidy-progress.json', 'nightytidy-dashboard.url']) {
      try { unlinkSync(path.join(tempDir, f)); } catch { /* ignore */ }
    }

    await robustCleanup(tempDir);
  });

  it('completes full lifecycle: init → run step 1 → finish', { timeout: 30000 }, async () => {
    const { initRun, runStep, finishRun } = await import('../src/orchestrator.js');

    // Phase 1: Init
    const initResult = await initRun(tempDir, { steps: '1' });
    expect(initResult.success).toBe(true);
    expect(initResult.runBranch).toMatch(/^nightytidy\/run-/);
    expect(initResult.tagName).toMatch(/^nightytidy-before-/);
    expect(initResult.dashboardUrl).toBe('http://localhost:9999');

    // State file should exist
    const statePath = path.join(tempDir, 'nightytidy-run-state.json');
    expect(existsSync(statePath)).toBe(true);
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(state.selectedSteps).toEqual([1]);
    expect(state.completedSteps).toEqual([]);

    // Lock should exist
    expect(existsSync(path.join(tempDir, 'nightytidy.lock'))).toBe(true);

    // Phase 2: Run step
    const stepResult = await runStep(tempDir, 1);
    expect(stepResult.success).toBe(true);
    expect(stepResult.status).toBe('completed');
    expect(stepResult.remainingSteps).toEqual([]);
    expect(stepResult.duration).toBeTypeOf('number');
    expect(stepResult.durationFormatted).toBeTypeOf('string');

    // State should be updated
    const updatedState = JSON.parse(readFileSync(statePath, 'utf8'));
    expect(updatedState.completedSteps).toHaveLength(1);
    expect(updatedState.completedSteps[0].number).toBe(1);

    // Phase 3: Finish
    const finishResult = await finishRun(tempDir);
    expect(finishResult.success).toBe(true);
    expect(finishResult.completed).toBe(1);
    expect(finishResult.failed).toBe(0);
    expect(finishResult.reportPath).toBe('NIGHTYTIDY-REPORT.md');

    // State file should be cleaned up
    expect(existsSync(statePath)).toBe(false);
    // Lock should be released
    expect(existsSync(path.join(tempDir, 'nightytidy.lock'))).toBe(false);

    // Notifications should have fired
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Started'),
      expect.any(String)
    );
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Complete'),
      expect.any(String)
    );
  });

  it('handles mixed success/failure across multiple steps', { timeout: 30000 }, async () => {
    const { initRun, runStep, finishRun } = await import('../src/orchestrator.js');

    // Step 1 succeeds, step 2 fails
    runPrompt
      .mockResolvedValueOnce({ success: true, output: 'done', attempts: 1 }) // step 1 improvement
      .mockResolvedValueOnce({ success: true, output: 'docs', attempts: 1 }) // step 1 doc update
      .mockResolvedValueOnce({ success: false, output: '', error: 'fail', attempts: 3 }) // step 2 fails
      .mockResolvedValueOnce({ success: false, output: '', error: 'changelog fail', attempts: 1 }); // changelog fails

    await initRun(tempDir, { steps: '1,2' });

    const step1 = await runStep(tempDir, 1);
    expect(step1.status).toBe('completed');
    expect(step1.remainingSteps).toEqual([2]);

    vi.resetModules();
    const { runStep: rs2 } = await import('../src/orchestrator.js');
    (await import('../src/claude.js')).runPrompt.mockResolvedValueOnce({ success: false, output: '', error: 'fail', attempts: 3 });

    const step2 = await rs2(tempDir, 2);
    expect(step2.status).toBe('failed');
    expect(step2.remainingSteps).toEqual([]);

    vi.resetModules();
    const { finishRun: fr } = await import('../src/orchestrator.js');
    (await import('../src/claude.js')).runPrompt.mockResolvedValue({ success: false, output: '', error: 'changelog fail', attempts: 1 });

    const result = await fr(tempDir);
    expect(result.success).toBe(true);
    expect(result.completed).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('progress JSON is created during init and updated during step', async () => {
    const { initRun, runStep } = await import('../src/orchestrator.js');

    await initRun(tempDir, { steps: '1' });

    const progressPath = path.join(tempDir, 'nightytidy-progress.json');

    // After init, progress should exist with initial state
    const initProgress = JSON.parse(readFileSync(progressPath, 'utf8'));
    expect(initProgress.status).toBe('running');
    expect(initProgress.totalSteps).toBe(1);
    expect(initProgress.completedCount).toBe(0);

    // After step 1, progress should be updated
    await runStep(tempDir, 1);
    const stepProgress = JSON.parse(readFileSync(progressPath, 'utf8'));
    // Step completed, so completedCount is at least 1
    expect(stepProgress.steps).toBeDefined();
    expect(stepProgress.steps.length).toBe(1);
  });

  it('prevents running the same step twice', { timeout: 15000 }, async () => {
    const { initRun, runStep } = await import('../src/orchestrator.js');

    await initRun(tempDir, { steps: '1' });
    await runStep(tempDir, 1);

    vi.resetModules();
    const { runStep: rs2 } = await import('../src/orchestrator.js');
    const result = await rs2(tempDir, 1);
    expect(result.success).toBe(false);
    expect(result.error).toContain('already been completed');
  });

  it('prevents double init without finish', async () => {
    const { initRun } = await import('../src/orchestrator.js');

    const first = await initRun(tempDir, { steps: '1' });
    expect(first.success).toBe(true);

    vi.resetModules();
    const { initRun: ir2 } = await import('../src/orchestrator.js');
    const second = await ir2(tempDir, { steps: '1' });
    expect(second.success).toBe(false);
    expect(second.error).toContain('already in progress');
  });
});
