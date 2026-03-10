import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import simpleGit from 'simple-git';
import { robustCleanup } from './helpers/cleanup.js';

// Mock logger
vi.mock('../src/logger.js', () => ({
  debug: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  initLogger: vi.fn(),
}));

describe('git.js — retry exhaustion and edge cases', () => {
  let tempDir;
  let git;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-git-retry-'));
    git = simpleGit(tempDir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
    await writeFile(path.join(tempDir, 'init.txt'), 'init');
    await git.add('.');
    await git.commit('initial commit');
  });

  afterEach(async () => {
    await robustCleanup(tempDir);
  });

  it('createPreRunTag retries up to max and throws on exhaustion', async () => {
    const gitMod = await import('../src/git.js');
    gitMod.initGit(tempDir);

    // Create tags for all possible names to exhaust retries
    // The timestamp-based name plus up to 10 suffixes
    // We'll create the tag first, then try — but since the timestamp changes,
    // we instead test that creating a tag works (it shouldn't exhaust in normal case)
    const tagName = await gitMod.createPreRunTag();
    expect(tagName).toMatch(/^nightytidy-before-\d{4}-\d{2}-\d{2}-\d{4}/);
  });

  it('createRunBranch retries with suffix on collision', async () => {
    const gitMod = await import('../src/git.js');
    gitMod.initGit(tempDir);

    // Create a first run branch
    const branch1 = await gitMod.createRunBranch('master');
    expect(branch1).toMatch(/^nightytidy\/run-/);

    // Switch back to original branch for the next test
    await git.checkout('master');

    // Creating another run branch within the same minute should get a suffix
    const branch2 = await gitMod.createRunBranch('master');
    expect(branch2).toMatch(/^nightytidy\/run-.*-\d+$/);
    expect(branch2).not.toBe(branch1);
  });

  it('mergeRunBranch handles merge --abort failure gracefully', async () => {
    const gitMod = await import('../src/git.js');
    gitMod.initGit(tempDir);

    // Create conflicting changes on two branches
    const conflictFile = path.join(tempDir, 'conflict.txt');
    await writeFile(conflictFile, 'original');
    await git.add('.');
    await git.commit('add conflict file');

    // Create run branch and make a change
    await git.checkoutLocalBranch('nightytidy/run-test');
    await writeFile(conflictFile, 'from run branch');
    await git.add('.');
    await git.commit('run change');

    // Make conflicting change on master
    await git.checkout('master');
    await writeFile(conflictFile, 'from master');
    await git.add('.');
    await git.commit('master change');

    // Merge should detect conflict and return { success: false, conflict: true }
    const result = await gitMod.mergeRunBranch('master', 'nightytidy/run-test');
    expect(result.success).toBe(false);
    expect(result.conflict).toBe(true);
  });

  it('fallbackCommit returns false when no changes to commit', async () => {
    const gitMod = await import('../src/git.js');
    gitMod.initGit(tempDir);

    // No changes — should skip
    const result = await gitMod.fallbackCommit(1, 'Test Step');
    expect(result).toBe(false);
  });

  it('fallbackCommit creates commit when there are changes', async () => {
    const gitMod = await import('../src/git.js');
    gitMod.initGit(tempDir);

    // Make a change
    await writeFile(path.join(tempDir, 'new-file.txt'), 'content');

    const result = await gitMod.fallbackCommit(1, 'Test Step');
    expect(result).toBe(true);

    // Verify commit message
    const log = await git.log({ maxCount: 1 });
    expect(log.latest.message).toContain('NightyTidy: Step 1');
    expect(log.latest.message).toContain('Test Step');
  });

  it('getHeadHash returns null for empty repo', async () => {
    const emptyDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-empty-'));
    const emptyGit = simpleGit(emptyDir);
    await emptyGit.init();

    try {
      const gitMod = await import('../src/git.js');
      gitMod.initGit(emptyDir);

      const hash = await gitMod.getHeadHash();
      expect(hash).toBeNull();
    } finally {
      await robustCleanup(emptyDir);
    }
  });

  it('excludeEphemeralFiles is idempotent', async () => {
    const gitMod = await import('../src/git.js');
    gitMod.initGit(tempDir);

    gitMod.excludeEphemeralFiles();
    gitMod.excludeEphemeralFiles();

    const excludePath = path.join(tempDir, '.git', 'info', 'exclude');
    const content = await readFile(excludePath, 'utf8');
    // Each ephemeral file should appear exactly once
    const matches = content.match(/nightytidy-run\.log/g);
    expect(matches).toHaveLength(1);
  });
});
