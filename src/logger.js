import { appendFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import path from 'path';
import chalk from 'chalk';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_COLORS = { debug: 'dim', warn: 'yellow', error: 'red' };

let logFilePath = null;
let minLevel = LEVELS.info;
let logQuiet = false;
let runId = null;

/**
 * Initialize the file logger. Must be called before any other module logs.
 * @param {string} projectDir - Absolute path to the target project directory.
 * @param {{ quiet?: boolean }} [opts] - Options. `quiet` suppresses stdout (for orchestrator JSON mode).
 */
export function initLogger(projectDir, { quiet = false } = {}) {
  logFilePath = path.join(projectDir, 'nightytidy-run.log');
  logQuiet = quiet;
  runId = randomUUID().slice(0, 8);
  writeFileSync(logFilePath, `# NightyTidy run ${runId} — ${new Date().toISOString()}\n`, 'utf8');

  const envLevel = (process.env.NIGHTYTIDY_LOG_LEVEL || 'info').toLowerCase();
  if (process.env.NIGHTYTIDY_LOG_LEVEL && !(envLevel in LEVELS)) {
    process.stderr.write(
      `[warn] Unknown NIGHTYTIDY_LOG_LEVEL="${process.env.NIGHTYTIDY_LOG_LEVEL}" — ` +
      `valid values: ${Object.keys(LEVELS).join(', ')}. Defaulting to "info".\n`
    );
  }
  minLevel = LEVELS[envLevel] ?? LEVELS.info;
}

function log(level, message) {
  if (!logFilePath) {
    throw new Error('Logger not initialized. Call initLogger(projectDir) first.');
  }

  if (LEVELS[level] < minLevel) return;

  const timestamp = new Date().toISOString();
  const tag = level.toUpperCase().padEnd(5);
  const line = `[${timestamp}] [${tag}] ${message}\n`;

  try {
    appendFileSync(logFilePath, line, 'utf8');
  } catch {
    // If file write fails, still print to stderr
    process.stderr.write(`[logger file error] ${line}`);
  }

  if (!logQuiet) {
    const colorFn = LEVEL_COLORS[level] ? chalk[LEVEL_COLORS[level]] : chalk.white;
    process.stdout.write(colorFn(line));
  }
}

/** @param {string} message */
export function debug(message) { log('debug', message); }
/** @param {string} message */
export function info(message)  { log('info', message); }
/** @param {string} message */
export function warn(message)  { log('warn', message); }
/** @param {string} message */
export function error(message) { log('error', message); }

/** @returns {string | null} The 8-char run correlation ID, or null if logger not initialized. */
export function getRunId() { return runId; }
