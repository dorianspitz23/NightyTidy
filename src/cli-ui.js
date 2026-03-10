import checkbox from '@inquirer/checkbox';
import chalk from 'chalk';

import { info } from './logger.js';
import { STEPS } from './prompts/steps.js';
import { notify } from './notifications.js';
import { formatDuration } from './report.js';
import { updateDashboard } from './dashboard.js';

const PROGRESS_SUMMARY_INTERVAL = 5; // Print a summary every N completed steps
const DESC_MAX_LENGTH = 72;

/**
 * Extract a brief description from a step prompt (first sentence, truncated to 72 chars).
 * @param {string} prompt - The full prompt text.
 * @returns {string} Brief description or empty string.
 */
export function extractStepDescription(prompt) {
  // Grab the first two sentences from the prompt to use as a brief description.
  // Strip markdown heading prefixes and common prompt preambles.
  const cleaned = prompt.replace(/^#+\s*/m, '').replace(/^You are running an overnight\s+/i, '');
  const sentences = cleaned.match(/[^.!?\n]+[.!?]/g);
  if (!sentences || sentences.length === 0) return '';
  let desc = sentences[0].trim();
  if (desc.length > DESC_MAX_LENGTH) desc = desc.slice(0, DESC_MAX_LENGTH - 1) + '\u2026';
  return desc;
}

/**
 * Build step lifecycle callbacks for the executor loop (spinner updates, progress summaries, dashboard state).
 * @param {import('ora').Ora} spinner - Active ora spinner instance.
 * @param {Array<{ number: number, name: string }>} selected - Selected steps array.
 * @param {object | null} dashState - Mutable dashboard state object, or null if no dashboard.
 * @returns {{ onStepStart: Function, onStepComplete: Function, onStepFail: Function }}
 */
export function buildStepCallbacks(spinner, selected, dashState) {
  const stepStartTimes = new Map();
  let runStartTime = null;
  let doneCount = 0;
  let passCount = 0;
  let failCountLocal = 0;

  function updateStepDash(idx, status) {
    if (!dashState) return;
    dashState.steps[idx].status = status;
    dashState.steps[idx].duration = Date.now() - (stepStartTimes.get(idx) || Date.now());
    if (status === 'completed') dashState.completedCount++;
    if (status === 'failed') dashState.failedCount++;
    updateDashboard(dashState);
  }

  function startNextSpinner(idx, total) {
    if (idx + 1 < total) {
      spinner.start(`\u23f3 Step ${idx + 2}/${total}: ${selected[idx + 1].name}...`);
    }
  }

  function maybePrintProgressSummary(total) {
    if (total <= PROGRESS_SUMMARY_INTERVAL) return;
    if (doneCount % PROGRESS_SUMMARY_INTERVAL !== 0) return;
    const elapsed = formatDuration(Date.now() - runStartTime);
    const remaining = total - doneCount;
    console.log(chalk.dim(
      `\n   Progress: ${doneCount}/${total} done (${passCount} passed, ${failCountLocal} failed) \u2014 ${elapsed} elapsed, ${remaining} remaining\n`
    ));
  }

  return {
    onStepStart: (step, idx, total) => {
      spinner.text = `\u23f3 Step ${idx + 1}/${total}: ${step.name}...`;
      stepStartTimes.set(idx, Date.now());
      if (!runStartTime) runStartTime = Date.now();
      if (dashState) {
        dashState.status = 'running';
        dashState.currentStepIndex = idx;
        dashState.currentStepName = step.name;
        dashState.steps[idx].status = 'running';
        if (!dashState.startTime) dashState.startTime = Date.now();
        updateDashboard(dashState);
      }
    },
    onStepComplete: (step, idx, total) => {
      spinner.stop();
      console.log(chalk.green(`\u2713 Step ${idx + 1}/${total}: ${step.name} \u2014 done`));
      doneCount++;
      passCount++;
      maybePrintProgressSummary(total);
      startNextSpinner(idx, total);
      updateStepDash(idx, 'completed');
    },
    onStepFail: (step, idx, total) => {
      spinner.stop();
      console.log(chalk.red(`\u2717 Step ${idx + 1}/${total}: ${step.name} \u2014 failed`));
      doneCount++;
      failCountLocal++;
      maybePrintProgressSummary(total);
      startNextSpinner(idx, total);
      updateStepDash(idx, 'failed');
    },
  };
}

/**
 * Print the final completion summary to the terminal and send desktop notifications.
 * @param {{ completedCount: number, failedCount: number, totalDuration: number, results: Array<{ status: string, step: { name: string } }> }} executionResults
 * @param {{ success: boolean, conflict?: boolean }} mergeResult
 * @param {{ runBranch: string, tagName: string }} opts
 */
export function printCompletionSummary(executionResults, mergeResult, { runBranch, tagName }) {
  const totalSteps = executionResults.completedCount + executionResults.failedCount;
  const durationStr = formatDuration(executionResults.totalDuration);

  if (mergeResult.success) {
    if (executionResults.failedCount === 0) {
      notify('NightyTidy Complete \u2713', `All ${executionResults.completedCount} steps succeeded. See NIGHTYTIDY-REPORT.md`);
    } else {
      notify('NightyTidy Complete', `${executionResults.completedCount}/${totalSteps} succeeded, ${executionResults.failedCount} failed. See NIGHTYTIDY-REPORT.md`);
    }
  } else {
    notify('NightyTidy Complete', `${executionResults.completedCount}/${totalSteps} steps done. Merge needs attention \u2014 see terminal.`);
    notify('NightyTidy: Merge Conflict', `Changes are on branch ${runBranch}. See NIGHTYTIDY-REPORT.md for resolution steps.`);
  }

  if (mergeResult.success) {
    if (executionResults.failedCount === 0) {
      console.log(chalk.green(`\n\u2705 NightyTidy complete \u2014 ${executionResults.completedCount}/${totalSteps} steps succeeded (${durationStr})`));
    } else {
      console.log(chalk.yellow(`\n\u26a0\ufe0f  NightyTidy complete \u2014 ${executionResults.completedCount}/${totalSteps} steps succeeded, ${executionResults.failedCount} failed (${durationStr})`));
    }
    console.log(chalk.dim(`\ud83d\udcc4 Report: NIGHTYTIDY-REPORT.md`));
    console.log(chalk.dim(`\ud83c\udff7\ufe0f  Safety tag: ${tagName}`));

    if (executionResults.failedCount > 0) {
      const failedNames = executionResults.results
        .filter(r => r.status === 'failed')
        .map(r => r.step.name);
      console.log(chalk.yellow(`\n   Failed steps: ${failedNames.join(', ')}`));
      console.log(chalk.dim('   See NIGHTYTIDY-REPORT.md for details and retry suggestions.'));
    }
  } else {
    console.log(chalk.yellow(`\n\u26a0\ufe0f  NightyTidy complete \u2014 ${executionResults.completedCount}/${totalSteps} steps succeeded, but merge needs attention.`));
    console.log(chalk.dim(`\ud83d\udcc4 Changes on branch: ${runBranch}`));
    console.log(chalk.dim(`\ud83c\udff7\ufe0f  Safety tag: ${tagName}`));
    console.log(chalk.yellow(
      `\n   Your improvements are safe on: ${runBranch}\n\n` +
      `   To merge manually:\n` +
      `     git merge ${runBranch}\n` +
      `     (resolve conflicts)\n` +
      `     git commit\n\n` +
      `   Or ask Claude Code:\n` +
      `     "Merge the branch ${runBranch} into my current branch\n` +
      `      and resolve any conflicts."\n`
    ));
  }
}

/**
 * Determine which steps to run based on CLI options or interactive selection.
 * Exits the process if no valid steps are selected or if non-TTY mode lacks required flags.
 * @param {{ all?: boolean, steps?: string }} opts - CLI options from Commander.
 * @returns {Promise<Array<{ number: number, name: string, prompt: string }>>} Selected steps.
 */
export async function selectSteps(opts) {
  if (opts.all) {
    info(`Running all ${STEPS.length} steps (--all)`);
    return STEPS;
  }

  if (opts.steps) {
    const requestedNums = opts.steps.split(',').map(s => parseInt(s.trim(), 10));
    const invalid = requestedNums.filter(n => Number.isNaN(n) || n < 1 || n > STEPS.length);
    if (invalid.length > 0) {
      console.log(chalk.red(`Invalid step number(s): ${invalid.join(', ')}. Valid range: 1-${STEPS.length}.`));
      process.exit(1);
    }
    const selected = STEPS.filter(step => requestedNums.includes(step.number));
    info(`Running ${selected.length} selected step(s) (--steps ${opts.steps})`);
    return selected;
  }

  if (!process.stdin.isTTY) {
    console.log(chalk.red('Non-interactive mode requires --all or --steps <numbers>.'));
    console.log(chalk.dim('  Example: npx nightytidy --all'));
    console.log(chalk.dim('  Example: npx nightytidy --steps 1,5,12'));
    console.log(chalk.dim('  Run npx nightytidy --list to see available steps.'));
    process.exit(1);
  }

  const selected = await checkbox({
    message: 'Select steps to run (Enter to run all):',
    choices: STEPS.map(step => ({
      name: `${step.number}. ${step.name}`,
      value: step,
      checked: true,
    })),
    pageSize: 15,
  });

  if (!selected || selected.length === 0) {
    console.log(chalk.yellow('No steps selected. Select at least one step to continue.'));
    process.exit(0);
  }

  return selected;
}

/** Print the welcome banner to stdout. */
export function showWelcome() {
  console.log(chalk.cyan(
    '\n' +
    '\u256d\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256e\n' +
    '\u2502                                                              \u2502\n' +
    '\u2502  Welcome to NightyTidy!                                      \u2502\n' +
    '\u2502                                                              \u2502\n' +
    '\u2502  NightyTidy will run 28 codebase improvement steps through   \u2502\n' +
    '\u2502  Claude Code. This typically takes 4-8 hours.                \u2502\n' +
    '\u2502                                                              \u2502\n' +
    '\u2502  All changes happen on a dedicated branch and are            \u2502\n' +
    '\u2502  automatically merged when done. You can check progress      \u2502\n' +
    '\u2502  anytime in nightytidy-run.log.                              \u2502\n' +
    '\u2502                                                              \u2502\n' +
    '\u2502  A safety snapshot is created before starting \u2014 you can      \u2502\n' +
    '\u2502  always undo everything if needed.                           \u2502\n' +
    '\u2502                                                              \u2502\n' +
    '\u2570\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u256f\n'
  ));
}

/** Print all available steps with descriptions to stdout. */
export function printStepList() {
  console.log(chalk.cyan(`\nAvailable steps (${STEPS.length} total):\n`));
  const numWidth = String(STEPS.length).length;
  for (const step of STEPS) {
    const num = String(step.number).padStart(numWidth);
    console.log(`  ${num}. ${step.name}`);
    const desc = extractStepDescription(step.prompt);
    if (desc) console.log(chalk.dim(`      ${desc}`));
  }
  console.log(chalk.dim(`\nUse --steps 1,5,12 to run specific steps, or --all to run everything.`));
}
