import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';
import { mkdtemp } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { robustCleanup } from './helpers/cleanup.js';

vi.mock('../src/logger.js', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  initLogger: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

const { warn } = await import('../src/logger.js');

function makeInitialState() {
  return {
    status: 'starting',
    totalSteps: 2,
    currentStepIndex: -1,
    currentStepName: '',
    steps: [
      { number: 1, name: 'A', status: 'pending', duration: null },
      { number: 2, name: 'B', status: 'pending', duration: null },
    ],
    completedCount: 0,
    failedCount: 0,
    startTime: null,
    error: null,
  };
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

function httpPost(url, body = '') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : {},
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

describe('dashboard security headers', () => {
  let tempDir;
  let mod;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-dash-sec-'));
    mod = await import('../src/dashboard.js');
  });

  afterEach(async () => {
    try { mod.stopDashboard(); } catch { /* ignore */ }
    await robustCleanup(tempDir);
  });

  it('includes X-Content-Type-Options: nosniff header', async () => {
    const result = await mod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    const res = await httpGet(result.url);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('includes X-Frame-Options: DENY header', async () => {
    const result = await mod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    const res = await httpGet(result.url);
    expect(res.headers['x-frame-options']).toBe('DENY');
  });

  it('includes Content-Security-Policy header', async () => {
    const result = await mod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    const res = await httpGet(result.url);
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('POST /stop with invalid JSON body returns 403', async () => {
    const onStop = vi.fn();
    const result = await mod.startDashboard(makeInitialState(), {
      onStop,
      projectDir: tempDir,
    });

    const res = await httpPost(`${result.url}/stop`, 'not-json{{{');
    expect(res.status).toBe(403);
    expect(onStop).not.toHaveBeenCalled();
  });

  it('POST /stop with wrong token returns 403 with error message', async () => {
    const onStop = vi.fn();
    const result = await mod.startDashboard(makeInitialState(), {
      onStop,
      projectDir: tempDir,
    });

    const res = await httpPost(`${result.url}/stop`, JSON.stringify({ token: 'invalid-token' }));
    expect(res.status).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.error).toBe('Invalid token');
    expect(onStop).not.toHaveBeenCalled();
  });

  it('POST /stop swallows onStop callback errors', async () => {
    const onStop = vi.fn(() => { throw new Error('abort already fired'); });
    const result = await mod.startDashboard(makeInitialState(), {
      onStop,
      projectDir: tempDir,
    });

    // Get CSRF token
    const htmlRes = await httpGet(result.url);
    const tokenMatch = htmlRes.body.match(/token:\s*'([a-f0-9]+)'/);
    expect(tokenMatch).toBeTruthy();

    const res = await httpPost(`${result.url}/stop`, JSON.stringify({ token: tokenMatch[1] }));
    // Should still return 200 despite onStop throwing
    expect(res.status).toBe(200);
  });
});

describe('dashboard updateDashboard edge cases', () => {
  let tempDir;
  let mod;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-dash-upd-'));
    mod = await import('../src/dashboard.js');
  });

  afterEach(async () => {
    try { mod.stopDashboard(); } catch { /* ignore */ }
    await robustCleanup(tempDir);
  });

  it('handles SSE client write failures gracefully', async () => {
    const result = await mod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    // Connect an SSE client then destroy it
    const sseRes = await new Promise((resolve) => {
      http.get(`${result.url}/events`, (res) => {
        resolve(res);
      });
    });

    // Immediately destroy the connection
    sseRes.destroy();

    // Give it a tick for close event
    await new Promise(resolve => setTimeout(resolve, 100));

    // updateDashboard should not throw when writing to dead SSE clients
    expect(() => mod.updateDashboard({ status: 'running' })).not.toThrow();
  });
});
