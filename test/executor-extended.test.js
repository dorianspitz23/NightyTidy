import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all dependencies
vi.mock('../src/logger.js', () => ({
  debug: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  initLogger: vi.fn(),
}));

vi.mock('../src/claude.js', () => ({
  runPrompt: vi.fn(),
}));

vi.mock('../src/git.js', () => ({
  getHeadHash: vi.fn(),
  hasNewCommit: vi.fn(),
  fallbackCommit: vi.fn(),
}));

vi.mock('../src/notifications.js', () => ({
  notify: vi.fn(),
}));

vi.mock('../src/prompts/steps.js', () => ({
  STEPS: [],
  DOC_UPDATE_PROMPT: 'Update docs',
  CHANGELOG_PROMPT: 'Generate changelog',
}));

describe('executor.js — extended', () => {
  let runPrompt;
  let getHeadHash;
  let hasNewCommit;
  let fallbackCommit;
  let warn;

  beforeEach(async () => {
    vi.resetAllMocks();
    const claude = await import('../src/claude.js');
    const git = await import('../src/git.js');
    const logger = await import('../src/logger.js');
    runPrompt = claude.runPrompt;
    getHeadHash = git.getHeadHash;
    hasNewCommit = git.hasNewCommit;
    fallbackCommit = git.fallbackCommit;
    warn = logger.warn;
  });

  describe('executeSingleStep', () => {
    it('warns when fallback commit throws', async () => {
      const { executeSingleStep } = await import('../src/executor.js');

      const step = { number: 1, name: 'Test', prompt: 'do it' };

      // Step succeeds
      runPrompt
        .mockResolvedValueOnce({ success: true, output: 'done', attempts: 1 }) // improvement
        .mockResolvedValueOnce({ success: true, output: 'docs updated', attempts: 1 }); // doc update

      getHeadHash.mockResolvedValue('abc123');
      hasNewCommit.mockResolvedValue(false); // no commit by Claude
      fallbackCommit.mockRejectedValue(new Error('git add failed'));

      const result = await executeSingleStep(step, '/fake', {});

      // Should still return completed (fallback failure is non-fatal)
      expect(result.status).toBe('completed');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('fallback commit failed'));
    });

    it('skips fallback commit when Claude committed', async () => {
      const { executeSingleStep } = await import('../src/executor.js');

      const step = { number: 2, name: 'Lint', prompt: 'lint it' };

      runPrompt
        .mockResolvedValueOnce({ success: true, output: 'fixed', attempts: 1 })
        .mockResolvedValueOnce({ success: true, output: 'docs', attempts: 1 });

      getHeadHash.mockResolvedValue('abc123');
      hasNewCommit.mockResolvedValue(true); // Claude committed

      const result = await executeSingleStep(step, '/fake', {});

      expect(result.status).toBe('completed');
      expect(fallbackCommit).not.toHaveBeenCalled();
    });

    it('continues when doc update fails', async () => {
      const { executeSingleStep } = await import('../src/executor.js');

      const step = { number: 3, name: 'Refactor', prompt: 'refactor it' };

      runPrompt
        .mockResolvedValueOnce({ success: true, output: 'refactored', attempts: 1 })
        .mockResolvedValueOnce({ success: false, output: '', error: 'timeout', attempts: 3 }); // doc update fails

      getHeadHash.mockResolvedValue('abc123');
      hasNewCommit.mockResolvedValue(true);

      const result = await executeSingleStep(step, '/fake', {});

      expect(result.status).toBe('completed');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Doc update failed'));
    });

    it('returns failed status when improvement prompt fails', async () => {
      const { executeSingleStep } = await import('../src/executor.js');

      const step = { number: 4, name: 'Types', prompt: 'add types' };

      runPrompt.mockResolvedValueOnce({
        success: false,
        output: '',
        error: 'all attempts exhausted',
        attempts: 4,
      });

      getHeadHash.mockResolvedValue('abc123');

      const result = await executeSingleStep(step, '/fake', {});

      expect(result.status).toBe('failed');
      expect(result.attempts).toBe(4);
    });
  });

  describe('executeSteps', () => {
    it('stops on abort signal between steps', async () => {
      const { executeSteps } = await import('../src/executor.js');

      const steps = [
        { number: 1, name: 'A', prompt: 'a' },
        { number: 2, name: 'B', prompt: 'b' },
      ];

      const ac = new AbortController();

      runPrompt
        .mockResolvedValueOnce({ success: true, output: 'done', attempts: 1 })
        .mockResolvedValueOnce({ success: true, output: 'docs', attempts: 1 });

      getHeadHash.mockResolvedValue('abc');
      hasNewCommit.mockResolvedValue(true);

      // Abort after first step completes
      const onStepComplete = vi.fn(() => ac.abort());

      const result = await executeSteps(steps, '/fake', {
        signal: ac.signal,
        onStepComplete,
      });

      // Only first step should have been executed
      expect(result.results).toHaveLength(1);
      expect(result.completedCount).toBe(1);
    });

    it('records mixed results (completed and failed)', async () => {
      const { executeSteps } = await import('../src/executor.js');

      const steps = [
        { number: 1, name: 'A', prompt: 'a' },
        { number: 2, name: 'B', prompt: 'b' },
      ];

      // Step 1 succeeds, step 2 fails
      runPrompt
        .mockResolvedValueOnce({ success: true, output: 'done', attempts: 1 })
        .mockResolvedValueOnce({ success: true, output: 'docs', attempts: 1 })
        .mockResolvedValueOnce({ success: false, output: '', error: 'fail', attempts: 4 });

      getHeadHash.mockResolvedValue('abc');
      hasNewCommit.mockResolvedValue(true);

      const onStepComplete = vi.fn();
      const onStepFail = vi.fn();

      const result = await executeSteps(steps, '/fake', {
        onStepComplete,
        onStepFail,
      });

      expect(result.completedCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(onStepComplete).toHaveBeenCalledOnce();
      expect(onStepFail).toHaveBeenCalledOnce();
    });

    it('calls callbacks with correct arguments', async () => {
      const { executeSteps } = await import('../src/executor.js');

      const steps = [{ number: 1, name: 'Solo', prompt: 'solo' }];

      runPrompt
        .mockResolvedValueOnce({ success: true, output: 'ok', attempts: 1 })
        .mockResolvedValueOnce({ success: true, output: 'docs', attempts: 1 });

      getHeadHash.mockResolvedValue('abc');
      hasNewCommit.mockResolvedValue(true);

      const onStepStart = vi.fn();
      const onStepComplete = vi.fn();

      await executeSteps(steps, '/fake', { onStepStart, onStepComplete });

      expect(onStepStart).toHaveBeenCalledWith(
        expect.objectContaining({ number: 1, name: 'Solo' }),
        0,
        1,
      );
      expect(onStepComplete).toHaveBeenCalledWith(
        expect.objectContaining({ number: 1, name: 'Solo' }),
        0,
        1,
      );
    });
  });
});
