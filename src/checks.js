import { spawn } from 'child_process';
import { platform } from 'os';
import { info, debug, warn } from './logger.js';
import { cleanEnv } from './claude.js';

const AUTH_TIMEOUT_MS = 30000;
const CMD_TIMEOUT_MS = 15000; // 15s for simple commands (git --version, claude --version, df/wmic)
const AUTH_INTERACTIVE_TIMEOUT_MS = 120000; // 2 minutes for interactive auth flow
const SIGKILL_DELAY = 5000; // grace period before SIGKILL after initial kill
const CRITICAL_DISK_MB = 100;
const LOW_DISK_MB = 1024;

function runCommand(cmd, args, { timeoutMs, ...spawnOptions } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: platform() === 'win32',
      ...spawnOptions,
    });

    const stdoutChunks = [];
    const stderrChunks = [];
    let timer;
    let settled = false;

    if (timeoutMs) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        // Force-kill if SIGTERM is ignored (e.g., frozen process)
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already dead */ } }, SIGKILL_DELAY);
        reject(new Error('timeout'));
      }, timeoutMs);
    }

    child.stdout?.on('data', (chunk) => { stdoutChunks.push(chunk.toString()); });
    child.stderr?.on('data', (chunk) => { stderrChunks.push(chunk.toString()); });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stdout: stdoutChunks.join(''), stderr: stderrChunks.join('') });
    });
  });
}

async function checkGitInstalled() {
  try {
    const result = await runCommand('git', ['--version'], { timeoutMs: CMD_TIMEOUT_MS });
    if (result.code !== 0) throw new Error();
    info('Pre-check: git installed \u2713');
  } catch (err) {
    throw new Error(
      err.message === 'timeout'
        ? 'Git did not respond within 15 seconds. It may be hanging — check for git credential prompts or lock files.'
        : 'Git is not installed or not on your PATH.\nInstall it from https://git-scm.com and try again.'
    );
  }
}

async function checkGitRepo(git) {
  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    throw new Error(
      "This folder isn't a git project. Navigate to your project folder and try again.\n" +
      'If you need to set one up, run: git init'
    );
  }
  info('Pre-check: git repository \u2713');
}

async function checkHasCommits(git) {
  try {
    const log = await git.log({ maxCount: 1 });
    if (!log.latest) throw new Error('no commits');
  } catch {
    throw new Error(
      "Your project has no commits yet. NightyTidy needs at least one commit to create a safety tag.\n" +
      'Make an initial commit and try again: git add -A && git commit -m "Initial commit"'
    );
  }
  info('Pre-check: has commits \u2713');
}

async function checkClaudeInstalled() {
  try {
    const result = await runCommand('claude', ['--version'], { env: cleanEnv(), timeoutMs: CMD_TIMEOUT_MS });
    if (result.code !== 0) throw new Error();
    info('Pre-check: Claude Code installed \u2713');
  } catch (err) {
    throw new Error(
      err.message === 'timeout'
        ? 'Claude Code did not respond within 15 seconds. It may be hanging or misconfigured.'
        : 'Claude Code not detected.\nInstall it from https://docs.anthropic.com/en/docs/claude-code and sign in before running NightyTidy.'
    );
  }
}

function runInteractiveAuth() {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', 'Say OK'], {
      stdio: 'inherit',
      shell: platform() === 'win32',
      env: cleanEnv(),
    });
    const timer = setTimeout(() => {
      child.kill();
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already dead */ } }, SIGKILL_DELAY);
      reject(new Error('Interactive auth timed out after 2 minutes. Check your network connection and try again.'));
    }, AUTH_INTERACTIVE_TIMEOUT_MS);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`claude exited with code ${code}`));
    });
  });
}

async function checkClaudeAuthenticated() {
  // First try silently (captured output) — fast path for already-authenticated
  try {
    const result = await runCommand('claude', ['-p', 'Say OK'], {
      timeoutMs: AUTH_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cleanEnv(),
    });
    if (result.code !== 0 || !result.stdout.trim()) {
      throw new Error('auth-failed');
    }
    info('Pre-check: Claude Code authenticated \u2713');
    return;
  } catch (err) {
    if (err.message === 'timeout') {
      throw new Error(
        "Claude Code didn't respond within 30 seconds. It may be experiencing an outage.\n" +
        'Check https://status.anthropic.com and try again later.'
      );
    }
    // Fall through to interactive sign-in attempt
  }

  // Silent check failed — launch Claude with terminal access for sign-in
  info('Claude Code needs to sign in. Launching sign-in now...');
  try {
    await runInteractiveAuth();
    info('Pre-check: Claude Code authenticated \u2713');
  } catch {
    throw new Error(
      "Claude Code sign-in did not complete successfully.\n" +
      'If this keeps happening, check https://status.anthropic.com for outages.'
    );
  }
}

async function checkDiskSpace(projectDir) {
  let freeBytes = null;

  try {
    if (platform() === 'win32') {
      const driveLetter = projectDir.charAt(0).toUpperCase();
      // Try PowerShell first (wmic is deprecated on newer Windows)
      const psResult = await runCommand('powershell', [
        '-NoProfile', '-Command',
        `(Get-PSDrive ${driveLetter}).Free`,
      ], { timeoutMs: CMD_TIMEOUT_MS });
      const psMatch = psResult.stdout.trim().match(/^(\d+)$/);
      if (psResult.code === 0 && psMatch) {
        freeBytes = parseInt(psMatch[1], 10);
      } else {
        // Fallback to wmic for older Windows
        const result = await runCommand('wmic', [
          'logicaldisk', 'where', `DeviceID='${driveLetter}:'`, 'get', 'FreeSpace',
        ], { timeoutMs: CMD_TIMEOUT_MS });
        const match = result.stdout.match(/(\d+)/);
        if (match) freeBytes = parseInt(match[1], 10);
      }
    } else {
      const result = await runCommand('df', ['-k', projectDir], { timeoutMs: CMD_TIMEOUT_MS });
      const lines = result.stdout.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 4) freeBytes = parseInt(parts[3], 10) * 1024;
      }
    }
  } catch {
    debug('Disk space check failed — skipping');
    info('Pre-check: disk space (skipped) \u2713');
    return;
  }

  if (freeBytes === null) {
    debug('Could not parse disk space — skipping');
    info('Pre-check: disk space (skipped) \u2713');
    return;
  }

  const freeMB = Math.round(freeBytes / (1024 * 1024));
  const freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(1);

  if (freeMB < CRITICAL_DISK_MB) {
    throw new Error(
      `Very low disk space (${freeMB} MB free). NightyTidy needs room for git operations.\n` +
      'Free up some space and try again.'
    );
  }

  if (freeMB < LOW_DISK_MB) {
    warn(`Low disk space (${freeMB} MB free). NightyTidy may fail if your project generates large diffs. Continuing anyway...`);
  }

  info(`Pre-check: disk space OK (${freeGB} GB free) \u2713`);
}

async function checkExistingBranches(git) {
  try {
    const branches = await git.branch();
    const nightyBranches = branches.all.filter(b => b.startsWith('nightytidy/run-'));
    if (nightyBranches.length > 0) {
      info(`Note: Found ${nightyBranches.length} existing NightyTidy branch(es) from previous run(s). These won't affect this run.`);
    }
  } catch {
    // Non-critical — ignore
  }
  info('Pre-check: no branch conflicts \u2713');
}

/**
 * Run all pre-flight checks. Throws with user-friendly messages on failure.
 * Checks: git installed, git repo, has commits, Claude CLI installed, Claude authenticated, disk space, existing branches.
 * @param {string} projectDir - Absolute path to the target project directory.
 * @param {import('simple-git').SimpleGit} git - Initialized simple-git instance.
 * @returns {Promise<void>}
 */
export async function runPreChecks(projectDir, git) {
  await checkGitInstalled();
  await checkGitRepo(git);
  await checkHasCommits(git);
  await checkClaudeInstalled();
  await checkClaudeAuthenticated();
  await checkDiskSpace(projectDir);
  await checkExistingBranches(git);
  info('All pre-run checks passed');
}
