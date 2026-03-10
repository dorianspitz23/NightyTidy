import { describe, it, expect, vi, beforeEach } from 'vitest';

// This test uses the REAL steps.js (not mocked) to verify that
// verifyStepsIntegrity passes when prompt data is authentic.
// This kills the mutation: `hash !== STEPS_HASH` → `hash === STEPS_HASH`

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

vi.mock('../src/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

// NOTE: We do NOT mock src/prompts/steps.js — use real data

describe('executor integrity check with real steps', () => {
  let runPrompt;
  let getHeadHash;
  let hasNewCommit;
  let info;
  let warn;

  beforeEach(async () => {
    vi.clearAllMocks();
    const claude = await import('../src/claude.js');
    const git = await import('../src/git.js');
    const logger = await import('../src/logger.js');
    runPrompt = claude.runPrompt;
    getHeadHash = git.getHeadHash;
    hasNewCommit = git.hasNewCommit;
    info = logger.info;
    warn = logger.warn;

    getHeadHash.mockResolvedValue('abc123');
    hasNewCommit.mockResolvedValue(true);

    // Prompt succeeds
    runPrompt.mockResolvedValue({ success: true, output: 'done', attempts: 1 });
  });

  it('verifyStepsIntegrity passes with authentic STEPS data (no warn)', async () => {
    const { executeSteps } = await import('../src/executor.js');
    const { STEPS } = await import('../src/prompts/steps.js');

    // Run a single step — executeSteps calls verifyStepsIntegrity(STEPS) at the top
    const selected = [STEPS[0]];
    await executeSteps(selected, '/fake', {});

    // With real STEPS, the hash should match — integrity check passes
    expect(info).toHaveBeenCalledWith('Steps integrity check passed');

    // The warn for hash mismatch should NOT be called
    const hashMismatchWarns = warn.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('hash mismatch')
    );
    expect(hashMismatchWarns).toHaveLength(0);
  });

  it('verifyStepsIntegrity warns when prompts are tampered', async () => {
    vi.resetModules();

    // Now mock steps with tampered data
    vi.doMock('../src/prompts/steps.js', () => ({
      STEPS: [{ number: 1, name: 'Fake', prompt: 'tampered prompt content that does not match hash' }],
      DOC_UPDATE_PROMPT: 'mock doc update prompt',
      CHANGELOG_PROMPT: 'mock changelog',
    }));

    // Re-import executor with the tampered steps
    const claude = await import('../src/claude.js');
    const git = await import('../src/git.js');
    const logger = await import('../src/logger.js');
    claude.runPrompt.mockResolvedValue({ success: true, output: 'done', attempts: 1 });
    git.getHeadHash.mockResolvedValue('abc123');
    git.hasNewCommit.mockResolvedValue(true);

    const { executeSteps } = await import('../src/executor.js');

    const selected = [{ number: 1, name: 'Fake', prompt: 'tampered' }];
    await executeSteps(selected, '/fake', {});

    // With tampered STEPS, the hash should NOT match — warn should fire
    const hashWarns = logger.warn.mock.calls.filter(
      ([msg]) => typeof msg === 'string' && msg.includes('hash mismatch')
    );
    expect(hashWarns.length).toBeGreaterThan(0);

    vi.doUnmock('../src/prompts/steps.js');
  });
});
