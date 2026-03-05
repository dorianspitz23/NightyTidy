#!/usr/bin/env node

// Runs the test suite multiple times to detect flaky tests.
// Usage: node scripts/run-flaky-check.js [runs]
// Default: 3 runs. Exit code 1 if any run fails.

import { execSync } from 'child_process';

const runs = parseInt(process.argv[2], 10) || 3;

console.log(`Running test suite ${runs} times to detect flaky tests...\n`);

for (let i = 1; i <= runs; i++) {
  console.log(`── Run ${i}/${runs} ──`);
  try {
    execSync('npx vitest run', { stdio: 'inherit', cwd: process.cwd() });
    console.log(`Run ${i}/${runs} passed.\n`);
  } catch {
    console.error(`\nRun ${i}/${runs} FAILED. Flaky test detected.`);
    process.exit(1);
  }
}

console.log(`All ${runs} runs passed. No flaky tests detected.`);
