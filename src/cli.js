import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';

import { initLogger, info, error as logError, debug, warn } from './logger.js';
import { runPreChecks } from './checks.js';
import { initGit, excludeEphemeralFiles, getCurrentBranch, createPreRunTag, createRunBranch, mergeRunBranch, getGitInstance } from './git.js';
import { runPrompt } from './claude.js';
import { STEPS, CHANGELOG_PROMPT } from './prompts/steps.js';
import { executeSteps, SAFETY_PREAMBLE } from './executor.js';
import { notify } from './notifications.js';
import { generateReport, getVersion } from './report.js';
import { setupProject } from './setup.js';
import { startDashboard, updateDashboard, stopDashboard, scheduleShutdown } from './dashboard.js';
import { acquireLock } from './lock.js';
import { initRun, runStep, finishRun } from './orchestrator.js';
import { extractStepDescription, buildStepCallbacks, showWelcome, printStepList, selectSteps, printCompletionSummary } from './cli-ui.js';

function exitWithJson(result) {
  console.log(JSON.stringify(result));
  process.exit(result.success ? 0 : 1);
}

async function handleAbortedRun(executionResults, { projectDir, runBranch, tagName, originalBranch }) {
  info('Run interrupted by user');
  await generateReport(executionResults, null, {
    projectDir,
    branchName: runBranch,
    tagName,
    originalBranch,
    startTime: Date.now() - executionResults.totalDuration,
    endTime: Date.now(),
  });

  const gitInstance = getGitInstance();
  try {
    await gitInstance.add(['NIGHTYTIDY-REPORT.md']);
    await gitInstance.commit('NightyTidy: Add partial run report');
  } catch (err) { debug(`Could not commit partial report: ${err.message}`); }

  notify('NightyTidy Stopped', `${executionResults.completedCount} steps completed. Changes on branch ${runBranch}.`);

  console.log(chalk.yellow(
    `\n\u26a0\ufe0f  NightyTidy stopped. ${executionResults.completedCount} steps completed.\n` +
    `   Changes are on branch: ${runBranch}\n` +
    `   To merge what was done: git checkout ${originalBranch} && git merge ${runBranch}\n`
  ));
  process.exit(0);
}

/**
 * Main CLI entry point. Parses arguments, runs the full lifecycle, and handles all errors.
 * @returns {Promise<void>}
 */
export async function run() {
  const program = new Command();
  program
    .name('nightytidy')
    .description('Automated overnight codebase improvement through Claude Code')
    .version(getVersion())
    .option('--all', 'Run all steps without interactive selection')
    .option('--steps <numbers>', 'Run specific steps by number (comma-separated, e.g. --steps 1,5,12)')
    .option('--list', 'List all available steps and exit')
    .option('--setup', 'Add NightyTidy integration to this project\u2019s CLAUDE.md so Claude Code knows how to use it')
    .option('--timeout <minutes>', 'Timeout per step in minutes (default: 45)', parseInt)
    .option('--dry-run', 'Run pre-checks and show selected steps without executing')
    .option('--json', 'Output as JSON (use with --list)')
    .option('--init-run', 'Initialize an orchestrated run (pre-checks, git setup, state file)')
    .option('--run-step <N>', 'Run a single step in an orchestrated run', parseInt)
    .option('--finish-run', 'Finish an orchestrated run (report, merge, cleanup)');

  program.parse();
  const opts = program.opts();

  const projectDir = process.cwd();
  const timeoutMs = opts.timeout ? opts.timeout * 60 * 1000 : undefined;
  if (opts.timeout !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    console.error(chalk.red(`--timeout must be a positive number of minutes (got "${opts.timeout}")`));
    process.exit(1);
  }

  // Orchestrator commands — output JSON and exit
  if (opts.list && opts.json) {
    const steps = STEPS.map(s => ({
      number: s.number,
      name: s.name,
      description: extractStepDescription(s.prompt),
    }));
    console.log(JSON.stringify({ steps }));
    process.exit(0);
  }

  if (opts.initRun) {
    exitWithJson(await initRun(projectDir, { steps: opts.steps, timeout: timeoutMs }));
  }

  if (opts.runStep !== undefined) {
    exitWithJson(await runStep(projectDir, opts.runStep, { timeout: timeoutMs }));
  }

  if (opts.finishRun) {
    exitWithJson(await finishRun(projectDir));
  }

  let spinner;
  let runStarted = false;
  let tagName = '';
  let runBranch = '';
  let originalBranch = '';
  let dashState = null;

  // Unhandled rejection safety net
  process.on('unhandledRejection', (reason) => {
    try { logError(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`); } catch { /* logger may not be init */ }
    console.error(chalk.red('\n\u274c An unexpected error occurred. Check nightytidy-run.log for details.'));
    process.exit(1);
  });

  // Ctrl+C handling
  let interrupted = false;
  const abortController = new AbortController();

  process.on('SIGINT', () => {
    if (interrupted) {
      console.log('\nForce stopping.');
      process.exit(1);
    }
    interrupted = true;
    console.log(chalk.yellow('\n\u26a0\ufe0f  Stopping NightyTidy... finishing current step.'));
    abortController.abort();
  });

  try {
    // 1. Initialize logger
    initLogger(projectDir);
    info('NightyTidy starting');

    // 2. Prevent concurrent runs
    await acquireLock(projectDir);

    // 3a. List steps and exit (no git or pre-checks needed)
    if (opts.list) {
      printStepList();
      process.exit(0);
    }

    // 3b. Setup mode — add CLAUDE.md integration and exit
    if (opts.setup) {
      const result = setupProject(projectDir);
      const action = result === 'created' ? 'Created CLAUDE.md with' : 'Added';
      console.log(chalk.green(`\u2713 ${action} NightyTidy integration to this project.`));
      console.log(chalk.dim('  Claude Code now knows how to run NightyTidy in this project.'));
      process.exit(0);
    }

    // 4. Show first-run welcome
    showWelcome();

    // 5. Initialize git and run pre-checks
    const git = initGit(projectDir);
    excludeEphemeralFiles();
    await runPreChecks(projectDir, git);

    // 6. Step selector
    const selected = await selectSteps(opts);

    // 6b. Dry run — show plan and exit
    if (opts.dryRun) {
      console.log(chalk.cyan(`\n--- Dry Run ---\n`));
      console.log(`Pre-checks: ${chalk.green('passed')}`);
      console.log(`Steps selected: ${selected.length}`);
      console.log(`Estimated time: ${Math.ceil(selected.length * 15)}\u2013${selected.length * 30} minutes`);
      console.log(`Timeout per step: ${opts.timeout ? `${opts.timeout} min` : '45 min (default)'}\n`);
      for (const step of selected) {
        console.log(`  ${step.number}. ${step.name}`);
      }
      console.log(chalk.dim(`\nRemove --dry-run to start the actual run.`));
      process.exit(0);
    }

    // 7. Start live dashboard
    dashState = {
      status: 'starting',
      totalSteps: selected.length,
      currentStepIndex: -1,
      currentStepName: '',
      steps: selected.map(s => ({ number: s.number, name: s.name, status: 'pending', duration: null })),
      completedCount: 0,
      failedCount: 0,
      startTime: null,
      error: null,
    };
    const dashboard = await startDashboard(dashState, {
      onStop: () => abortController.abort(),
      projectDir,
    });
    if (dashboard) {
      console.log(chalk.cyan('\n\ud83d\udcca Progress window opened.'));
      if (dashboard.url) {
        console.log(chalk.cyan(`\n\ud83c\udf10 Live dashboard: ${dashboard.url}`));
        console.log(chalk.dim('   Open this link in your browser to monitor progress in real time.'));
      }
    }

    // 8. Sleep tip
    console.log(chalk.dim(
      '\n\ud83d\udca1 Tip: Make sure your computer won\'t go to sleep during the run.\n' +
      '   This typically takes 4-8 hours. Disable sleep in your power settings.\n'
    ));

    // 9. Git setup
    originalBranch = await getCurrentBranch();
    tagName = await createPreRunTag();
    runBranch = await createRunBranch(originalBranch);
    runStarted = true;

    // 10. Run started notification
    notify('NightyTidy Started', `Running ${selected.length} steps. Check nightytidy-run.log for progress.`);

    // 11. Spinner
    spinner = ora({
      text: `\u23f3 Step 1/${selected.length}: ${selected[0].name}...`,
      color: 'cyan',
    }).start();

    // 12. Execute steps
    const executionResults = await executeSteps(selected, projectDir, {
      signal: abortController.signal,
      timeout: timeoutMs,
      ...buildStepCallbacks(spinner, selected, dashState),
    });

    spinner.stop();

    // Handle interrupted run
    if (abortController.signal.aborted) {
      if (dashState) {
        dashState.status = 'stopped';
        updateDashboard(dashState);
      }
      stopDashboard();
      await handleAbortedRun(executionResults, { projectDir, runBranch, tagName, originalBranch });
    }

    // Update dashboard to finishing state
    if (dashState) {
      dashState.status = 'finishing';
      dashState.currentStepIndex = -1;
      dashState.currentStepName = '';
      updateDashboard(dashState);
    }

    // 13. Narrated changelog
    info('Generating narrated changelog...');
    spinner = ora({ text: 'Generating changelog...', color: 'cyan' }).start();

    const changelogResult = await runPrompt(SAFETY_PREAMBLE + CHANGELOG_PROMPT, projectDir, {
      label: 'Narrated changelog',
      timeout: timeoutMs,
    });
    const narration = changelogResult.success ? changelogResult.output : null;
    if (!narration) warn('Narrated changelog generation failed — using fallback text');

    spinner.stop();

    // 14. Generate report
    const startTime = Date.now() - executionResults.totalDuration;
    await generateReport(executionResults, narration, {
      projectDir,
      branchName: runBranch,
      tagName,
      originalBranch,
      startTime,
      endTime: Date.now(),
    });

    // 15. Commit report on run branch
    const gitInstance = getGitInstance();
    try {
      await gitInstance.add(['NIGHTYTIDY-REPORT.md', 'CLAUDE.md']);
      await gitInstance.commit('NightyTidy: Add run report and update CLAUDE.md');
    } catch (err) {
      warn(`Failed to commit report: ${err.message}`);
    }

    // 16. Merge run branch
    const mergeResult = await mergeRunBranch(originalBranch, runBranch);

    // 17. Completion notification + terminal summary
    printCompletionSummary(executionResults, mergeResult, { runBranch, tagName });

    // Update dashboard to completed and schedule shutdown
    if (dashState) {
      dashState.status = 'completed';
      updateDashboard(dashState);
    }
    scheduleShutdown();

  } catch (err) {
    spinner?.stop();
    console.error(chalk.red(`\n\u274c ${err.message}`));

    try {
      logError(`Fatal: ${err.message}`);
      debug(`Stack: ${err.stack}`);
    } catch { /* logger may not be initialized */ }

    if (dashState) {
      dashState.status = 'error';
      dashState.error = err.message;
      updateDashboard(dashState);
    }
    stopDashboard();

    if (runStarted) {
      notify('NightyTidy Error', `Run stopped: ${err.message}. Check nightytidy-run.log.`);
      console.error(chalk.yellow(`\n\ud83d\udca1 Your code is safe. Reset to tag ${tagName} to undo any changes.`));
    }

    process.exit(1);
  }
}
