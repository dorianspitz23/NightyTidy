import { readFileSync, writeFileSync, unlinkSync, openSync, closeSync } from 'fs';
import { createInterface } from 'readline';
import path from 'path';
import { debug, warn } from './logger.js';

const LOCK_FILENAME = 'nightytidy.lock';
const MAX_LOCK_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function writeLockFile(lockPath, content) {
  const fd = openSync(lockPath, 'wx');
  writeFileSync(fd, content);
  closeSync(fd);
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isLockStale(lockData) {
  // Process is dead — definitely stale.
  // Use explicit null/undefined check instead of `!lockData.pid` to avoid
  // treating PID 0 (Windows System process) as falsy/dead.
  if (lockData.pid == null || !isProcessAlive(lockData.pid)) return true;

  // Lock is older than 24 hours — treat as stale regardless of PID
  // (handles PID recycling on Windows where process.kill(pid,0) is unreliable)
  const age = lockData.started ? Date.now() - new Date(lockData.started).getTime() : 0;
  // Invalid/corrupt timestamp parses to NaN — treat as stale rather than blocking future runs
  if (Number.isNaN(age)) return true;
  return age > MAX_LOCK_AGE_MS;
}

function promptOverride(lockData) {
  if (!process.stdin.isTTY) {
    throw new Error(
      `Another NightyTidy run is already in progress (PID ${lockData.pid}, started ${lockData.started}).\n` +
      `If this is wrong, delete ${LOCK_FILENAME} and try again.`
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(
      `A lock file exists (PID ${lockData.pid}, started ${lockData.started}). Override it? [y/N] `,
      (answer) => {
        rl.close();
        resolve(answer.trim().toLowerCase() === 'y');
      },
    );
  });
}

function removeLockAndReacquire(lockPath, lockContent) {
  unlinkSync(lockPath);
  warn('Removed stale lock file from a previous run');
  try {
    writeLockFile(lockPath, lockContent);
  } catch (retryErr) {
    if (retryErr.code === 'EEXIST') {
      throw new Error(
        'Another NightyTidy run acquired the lock while cleaning up a stale lock file.\n' +
        `If this is wrong, delete ${LOCK_FILENAME} and try again.`
      );
    }
    throw retryErr;
  }
}

/**
 * Remove the lock file. Safe to call when no lock exists.
 * @param {string} projectDir - Absolute path to the target project directory.
 */
export function releaseLock(projectDir) {
  const lockPath = path.join(projectDir, LOCK_FILENAME);
  try { unlinkSync(lockPath); } catch { /* already gone */ }
}

/**
 * Acquire an atomic lock file to prevent concurrent runs.
 * Throws if the lock is held by another active process and the user declines override.
 * @param {string} projectDir - Absolute path to the target project directory.
 * @param {{ persistent?: boolean }} [opts] - Options. `persistent` skips auto-remove on process exit (for orchestrator mode).
 * @returns {Promise<void>}
 */
export async function acquireLock(projectDir, { persistent = false } = {}) {
  const lockPath = path.join(projectDir, LOCK_FILENAME);
  const lockContent = JSON.stringify({ pid: process.pid, started: new Date().toISOString() });

  // Try atomic create — O_WRONLY | O_CREAT | O_EXCL ('wx') fails if file exists
  try {
    writeLockFile(lockPath, lockContent);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;

    // Lock file exists — check staleness
    let lockData = {};
    try {
      lockData = JSON.parse(readFileSync(lockPath, 'utf8'));
    } catch {
      // Corrupt lock file — treat as stale
    }

    if (isLockStale(lockData)) {
      removeLockAndReacquire(lockPath, lockContent);
    } else {
      // Lock appears active — prompt user for override
      const override = await promptOverride(lockData);
      if (!override) {
        throw new Error('NightyTidy run cancelled — lock file was not overridden.');
      }
      removeLockAndReacquire(lockPath, lockContent);
      warn('Lock file overridden by user');
    }
  }

  debug(`Lock acquired (PID ${process.pid})`);

  // Auto-remove on any exit (skip in persistent mode for orchestrator)
  if (!persistent) {
    process.on('exit', () => {
      try { unlinkSync(lockPath); } catch { /* already gone */ }
    });
  }
}
