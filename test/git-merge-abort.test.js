import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
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

describe('git.js — merge abort edge cases', () => {
  let tempDir;
  let git;
  let warn;
  let debug;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-git-merge-'));
    git = simpleGit(tempDir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
    await writeFile(path.join(tempDir, 'init.txt'), 'init');
    await git.add('.');
    await git.commit('initial commit');

    const logger = await import('../src/logger.js');
    warn = logger.warn;
    debug = logger.debug;
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await robustCleanup(tempDir);
  });

  it('mergeRunBranch returns conflict indicator when merge conflicts occur', async () => {
    const gitMod = await import('../src/git.js');
    gitMod.initGit(tempDir);

    // Create conflicting changes
    const file = path.join(tempDir, 'conflict.txt');
    await writeFile(file, 'original content');
    await git.add('.');
    await git.commit('add conflict file');

    // Create run branch with different change
    await git.checkoutLocalBranch('nightytidy/run-conflict');
    await writeFile(file, 'run branch change');
    await git.add('.');
    await git.commit('run change');

    // Make conflicting change on master
    await git.checkout('master');
    await writeFile(file, 'master change');
    await git.add('.');
    await git.commit('master change');

    const result = await gitMod.mergeRunBranch('master', 'nightytidy/run-conflict');
    expect(result.success).toBe(false);
    expect(result.conflict).toBe(true);

    // The warn should have been called about merge conflict
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('conflict'));
  });

  it('mergeRunBranch debug-logs the merge error message', async () => {
    const gitMod = await import('../src/git.js');
    gitMod.initGit(tempDir);

    const file = path.join(tempDir, 'conflict.txt');
    await writeFile(file, 'original');
    await git.add('.');
    await git.commit('add file');

    await git.checkoutLocalBranch('nightytidy/run-debug');
    await writeFile(file, 'change A');
    await git.add('.');
    await git.commit('change A');

    await git.checkout('master');
    await writeFile(file, 'change B');
    await git.add('.');
    await git.commit('change B');

    await gitMod.mergeRunBranch('master', 'nightytidy/run-debug');

    // The debug call should contain the actual git merge error
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('Merge error'));
  });

  it('mergeRunBranch handles clean merge correctly', async () => {
    const gitMod = await import('../src/git.js');
    gitMod.initGit(tempDir);

    // Create run branch with non-conflicting change
    await git.checkoutLocalBranch('nightytidy/run-clean');
    await writeFile(path.join(tempDir, 'new-file.txt'), 'content');
    await git.add('.');
    await git.commit('add new file');

    await git.checkout('master');

    const result = await gitMod.mergeRunBranch('master', 'nightytidy/run-clean');
    expect(result.success).toBe(true);
  });

  it('getCurrentBranch returns master for fresh repo', async () => {
    const gitMod = await import('../src/git.js');
    gitMod.initGit(tempDir);

    const branch = await gitMod.getCurrentBranch();
    expect(branch).toBe('master');
  });

  it('getGitInstance returns valid git instance after initGit', async () => {
    const gitMod = await import('../src/git.js');
    gitMod.initGit(tempDir);

    const instance = gitMod.getGitInstance();
    expect(instance).toBeDefined();
    expect(typeof instance.status).toBe('function');
  });

  it('excludeEphemeralFiles creates .git/info/exclude if missing', async () => {
    const gitMod = await import('../src/git.js');
    gitMod.initGit(tempDir);

    gitMod.excludeEphemeralFiles();

    const { readFileSync, existsSync } = await import('fs');
    const excludePath = path.join(tempDir, '.git', 'info', 'exclude');
    expect(existsSync(excludePath)).toBe(true);

    const content = readFileSync(excludePath, 'utf8');
    expect(content).toContain('nightytidy-run.log');
    expect(content).toContain('nightytidy-progress.json');
    expect(content).toContain('nightytidy-dashboard.url');
    expect(content).toContain('nightytidy-run-state.json');
  });
});
