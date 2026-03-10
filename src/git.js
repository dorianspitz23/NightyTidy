import { readFileSync, appendFileSync, existsSync } from 'fs';
import path from 'path';
import simpleGit from 'simple-git';
import { info, debug, warn } from './logger.js';

const EPHEMERAL_FILES = ['nightytidy-run.log', 'nightytidy-progress.json', 'nightytidy-dashboard.url', 'nightytidy-run-state.json'];

const MAX_NAME_RETRIES = 10;

let git = null;
let projectRoot = null;

function getTimestamp() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${hh}${min}`;
}

/**
 * Initialize the simple-git instance for the given project directory.
 * @param {string} projectDir - Absolute path to the target project directory.
 * @returns {import('simple-git').SimpleGit} The initialized git instance.
 */
export function initGit(projectDir) {
  projectRoot = projectDir;
  git = simpleGit(projectDir);
  return git;
}

/**
 * Add NightyTidy ephemeral files to `.git/info/exclude` so they are never tracked.
 * Safe to call multiple times — skips files already listed.
 */
export function excludeEphemeralFiles() {
  try {
    const excludePath = path.join(projectRoot, '.git', 'info', 'exclude');

    let content = '';
    if (existsSync(excludePath)) {
      content = readFileSync(excludePath, 'utf8');
    }

    const toAdd = EPHEMERAL_FILES.filter(f => !content.includes(f));
    if (toAdd.length === 0) return;

    const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
    appendFileSync(excludePath, separator + '# NightyTidy ephemeral files\n' + toAdd.join('\n') + '\n', 'utf8');
    debug('Added ephemeral file exclusions to .git/info/exclude');
  } catch (err) {
    warn(`Could not add ephemeral file exclusions: ${err.message}`);
  }
}

/**
 * Get the name of the currently checked-out branch.
 * @returns {Promise<string>} Current branch name.
 */
export async function getCurrentBranch() {
  const status = await git.status();
  return status.current;
}

async function retryWithSuffix(baseName, operationFn, errorMessage) {
  let name = baseName;
  for (let attempt = 0; attempt < MAX_NAME_RETRIES; attempt++) {
    try {
      await operationFn(name);
      return name;
    } catch {
      name = `${baseName}-${attempt + 2}`;
    }
  }
  throw new Error(errorMessage);
}

/**
 * Create a safety tag at the current HEAD before the run starts.
 * Retries with numeric suffix if the tag name collides.
 * @returns {Promise<string>} The created tag name.
 */
export async function createPreRunTag() {
  const baseName = `nightytidy-before-${getTimestamp()}`;
  const tagName = await retryWithSuffix(
    baseName,
    (name) => git.tag([name]),
    'Could not create safety tag — too many runs within the same minute. Try again shortly.',
  );
  info(`Created pre-run safety tag: ${tagName}`);
  return tagName;
}

/**
 * Create and checkout a new run branch from the current HEAD.
 * Retries with numeric suffix if the branch name collides.
 * @param {string} sourceBranch - The branch being branched off (for log message).
 * @returns {Promise<string>} The created branch name.
 */
export async function createRunBranch(sourceBranch) {
  const baseName = `nightytidy/run-${getTimestamp()}`;
  const branchName = await retryWithSuffix(
    baseName,
    (name) => git.checkoutLocalBranch(name),
    'Could not create run branch — too many runs within the same minute. Try again shortly.',
  );
  info(`Created run branch: ${branchName} (from ${sourceBranch})`);
  return branchName;
}

/**
 * Get the SHA hash of the current HEAD commit.
 * @returns {Promise<string | null>} The hash, or null if the repo has no commits.
 */
export async function getHeadHash() {
  try {
    const log = await git.log({ maxCount: 1 });
    return log.latest ? log.latest.hash : null;
  } catch {
    // Empty repo — git.log throws "does not have any commits yet"
    return null;
  }
}

/**
 * Check whether a new commit has been made since the given hash.
 * @param {string | null} sinceHash - The hash to compare against.
 * @returns {Promise<boolean>} True if HEAD differs from sinceHash.
 */
export async function hasNewCommit(sinceHash) {
  const currentHash = await getHeadHash();
  return currentHash !== sinceHash;
}

/**
 * Stage all changes and create a fallback commit if Claude didn't commit.
 * @param {number} stepNumber - Step number for the commit message.
 * @param {string} stepName - Step name for the commit message.
 * @returns {Promise<boolean>} True if a commit was made, false if nothing to commit.
 */
export async function fallbackCommit(stepNumber, stepName) {
  // Ephemeral files are already excluded via .git/info/exclude
  // (set up by excludeEphemeralFiles). Plain `git add -A` respects that.
  // Do NOT use `:!` pathspec exclusions — git 2.53+ errors when the
  // excluded file also matches a .gitignore pattern in the target project.
  await git.raw(['add', '-A']);

  const status = await git.status();
  if (status.staged.length === 0) {
    info(`Step ${stepNumber}: No changes detected — skipping fallback commit`);
    return false;
  }

  const message = `NightyTidy: Step ${stepNumber} \u2014 ${stepName} complete`;
  await git.commit(message);
  info(`Step ${stepNumber}: fallback commit made \u2713`);
  return true;
}

/**
 * Merge the run branch back into the original branch. Never throws.
 * @param {string} originalBranch - The branch to merge into.
 * @param {string} runBranch - The branch to merge from.
 * @returns {Promise<{ success: true } | { success: false, conflict: true }>}
 */
export async function mergeRunBranch(originalBranch, runBranch) {
  try {
    await git.checkout(originalBranch);
    await git.merge([runBranch, '--no-ff']);
    info(`Merged ${runBranch} into ${originalBranch}`);
    return { success: true };
  } catch (err) {
    // Merge conflict — abort and return conflict indicator
    try {
      await git.merge(['--abort']);
    } catch {
      // Abort may fail if not in merge state
    }
    warn(`Merge conflict merging ${runBranch} into ${originalBranch}`);
    debug(`Merge error: ${err.message}`);
    return { success: false, conflict: true };
  }
}

/**
 * Return the module-level git instance. Null before `initGit()` is called.
 * @returns {import('simple-git').SimpleGit | null}
 */
export function getGitInstance() {
  return git;
}
