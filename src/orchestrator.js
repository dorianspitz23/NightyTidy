import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import path from 'path';

import { initLogger, info, warn, error as logError } from './logger.js';
import { runPreChecks } from './checks.js';
import { initGit, excludeEphemeralFiles, getCurrentBranch, createPreRunTag, createRunBranch, mergeRunBranch, getGitInstance } from './git.js';
import { runPrompt } from './claude.js';
import { STEPS, CHANGELOG_PROMPT } from './prompts/steps.js';
import { executeSingleStep, SAFETY_PREAMBLE } from './executor.js';
import { notify } from './notifications.js';
import { generateReport, formatDuration } from './report.js';
import { acquireLock, releaseLock } from './lock.js';

const STATE_FILENAME = 'nightytidy-run-state.json';
const STATE_VERSION = 1;

function statePath(projectDir) {
  return path.join(projectDir, STATE_FILENAME);
}

function readState(projectDir) {
  const fp = statePath(projectDir);
  if (!existsSync(fp)) return null;
  try {
    const data = JSON.parse(readFileSync(fp, 'utf8'));
    if (data.version !== STATE_VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

function writeState(projectDir, state) {
  writeFileSync(statePath(projectDir), JSON.stringify(state, null, 2), 'utf8');
}

function deleteState(projectDir) {
  try { unlinkSync(statePath(projectDir)); } catch { /* already gone */ }
}

function ok(data) {
  return { success: true, ...data };
}

function fail(error) {
  return { success: false, error };
}

function validateStepNumbers(numbers) {
  const valid = STEPS.map(s => s.number);
  const invalid = numbers.filter(n => !valid.includes(n));
  if (invalid.length > 0) {
    return fail(`Invalid step number(s): ${invalid.join(', ')}. Valid range: 1-${STEPS.length}.`);
  }
  return null;
}

export async function initRun(projectDir, { steps, timeout } = {}) {
  try {
    initLogger(projectDir, { quiet: true });
    info('NightyTidy orchestrator: init-run starting');

    // Check for existing run
    if (readState(projectDir)) {
      return fail('A run is already in progress. Call --finish-run first, or delete nightytidy-run-state.json to reset.');
    }

    await acquireLock(projectDir, { persistent: true });

    const git = initGit(projectDir);
    excludeEphemeralFiles();
    await runPreChecks(projectDir, git);

    // Validate and select steps
    let selectedNums;
    if (steps) {
      const nums = steps.split(',').map(s => parseInt(s.trim(), 10));
      const err = validateStepNumbers(nums);
      if (err) return err;
      selectedNums = nums;
    } else {
      selectedNums = STEPS.map(s => s.number);
    }

    const originalBranch = await getCurrentBranch();
    const tagName = await createPreRunTag();
    const runBranch = await createRunBranch(originalBranch);

    const state = {
      version: STATE_VERSION,
      originalBranch,
      runBranch,
      tagName,
      selectedSteps: selectedNums,
      completedSteps: [],
      failedSteps: [],
      startTime: Date.now(),
      timeout: timeout || null,
    };
    writeState(projectDir, state);

    notify('NightyTidy Started', `Orchestrator run initialized with ${selectedNums.length} steps.`);
    info(`Orchestrator init complete: branch=${runBranch}, tag=${tagName}, steps=${selectedNums.join(',')}`);

    return ok({
      runBranch,
      tagName,
      originalBranch,
      selectedSteps: selectedNums,
    });
  } catch (err) {
    return fail(err.message);
  }
}

export async function runStep(projectDir, stepNumber, { timeout } = {}) {
  try {
    initLogger(projectDir, { quiet: true });

    const state = readState(projectDir);
    if (!state) {
      return fail('No active orchestrator run. Call --init-run first.');
    }

    if (!state.selectedSteps.includes(stepNumber)) {
      return fail(`Step ${stepNumber} is not in the selected steps for this run. Selected: ${state.selectedSteps.join(', ')}`);
    }

    if (state.completedSteps.some(s => s.number === stepNumber)) {
      return fail(`Step ${stepNumber} has already been completed in this run.`);
    }
    if (state.failedSteps.some(s => s.number === stepNumber)) {
      return fail(`Step ${stepNumber} has already been attempted and failed in this run.`);
    }

    const step = STEPS.find(s => s.number === stepNumber);
    if (!step) {
      return fail(`Step ${stepNumber} not found in available steps.`);
    }

    initGit(projectDir);

    const stepTimeout = timeout || state.timeout || undefined;

    info(`Orchestrator: running step ${stepNumber} — ${step.name}`);
    const result = await executeSingleStep(step, projectDir, { timeout: stepTimeout });

    // Update state
    const entry = { number: step.number, name: step.name, status: result.status, duration: result.duration, attempts: result.attempts };
    if (result.status === 'completed') {
      state.completedSteps.push(entry);
    } else {
      state.failedSteps.push(entry);
    }
    writeState(projectDir, state);

    // Compute remaining
    const doneNums = new Set([...state.completedSteps.map(s => s.number), ...state.failedSteps.map(s => s.number)]);
    const remaining = state.selectedSteps.filter(n => !doneNums.has(n));

    return ok({
      step: stepNumber,
      name: step.name,
      status: result.status,
      duration: result.duration,
      durationFormatted: formatDuration(result.duration),
      attempts: result.attempts,
      remainingSteps: remaining,
    });
  } catch (err) {
    return fail(err.message);
  }
}

export async function finishRun(projectDir) {
  try {
    initLogger(projectDir, { quiet: true });

    const state = readState(projectDir);
    if (!state) {
      return fail('No active orchestrator run. Nothing to finish.');
    }

    initGit(projectDir);
    info('Orchestrator: finishing run');

    // Build execution results from accumulated state
    const allStepResults = [...state.completedSteps, ...state.failedSteps]
      .sort((a, b) => state.selectedSteps.indexOf(a.number) - state.selectedSteps.indexOf(b.number));

    const executionResults = {
      results: allStepResults.map(s => ({
        step: { number: s.number, name: s.name },
        status: s.status,
        output: '',
        duration: s.duration,
        attempts: s.attempts,
        error: s.status === 'failed' ? 'Step failed during orchestrated run' : null,
      })),
      completedCount: state.completedSteps.length,
      failedCount: state.failedSteps.length,
    };

    const totalDuration = Date.now() - state.startTime;

    // Generate changelog
    let narration = null;
    if (executionResults.completedCount > 0) {
      info('Generating narrated changelog...');
      const changelogResult = await runPrompt(SAFETY_PREAMBLE + CHANGELOG_PROMPT, projectDir, {
        label: 'Narrated changelog',
        timeout: state.timeout || undefined,
      });
      narration = changelogResult.success ? changelogResult.output : null;
      if (!narration) warn('Narrated changelog generation failed — using fallback text');
    }

    // Generate report
    generateReport(executionResults, narration, {
      projectDir,
      branchName: state.runBranch,
      tagName: state.tagName,
      originalBranch: state.originalBranch,
      startTime: state.startTime,
      endTime: Date.now(),
    });

    // Commit report
    const gitInstance = getGitInstance();
    try {
      await gitInstance.add(['NIGHTYTIDY-REPORT.md', 'CLAUDE.md']);
      await gitInstance.commit('NightyTidy: Add run report and update CLAUDE.md');
    } catch (err) {
      warn(`Failed to commit report: ${err.message}`);
    }

    // Merge
    const mergeResult = await mergeRunBranch(state.originalBranch, state.runBranch);

    // Cleanup
    releaseLock(projectDir);
    deleteState(projectDir);

    const completionMsg = mergeResult.success
      ? `Run complete: ${executionResults.completedCount} completed, ${executionResults.failedCount} failed.`
      : `Run complete but merge needs attention. Changes on branch: ${state.runBranch}`;
    notify('NightyTidy Complete', completionMsg);

    info(`Orchestrator finish complete: ${executionResults.completedCount} completed, ${executionResults.failedCount} failed`);

    return ok({
      completed: executionResults.completedCount,
      failed: executionResults.failedCount,
      totalDurationFormatted: formatDuration(totalDuration),
      merged: mergeResult.success,
      mergeConflict: mergeResult.conflict || false,
      reportPath: 'NIGHTYTIDY-REPORT.md',
      tagName: state.tagName,
      runBranch: state.runBranch,
    });
  } catch (err) {
    return fail(err.message);
  }
}
