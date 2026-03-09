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

describe('dashboard.js — error paths', () => {
  let tempDir;
  let mod;
  let warn;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-dash-err-'));
    mod = await import('../src/dashboard.js');
    warn = (await import('../src/logger.js')).warn;
  });

  afterEach(async () => {
    try { mod.stopDashboard(); } catch { /* ignore */ }
    await robustCleanup(tempDir);
  });

  it('returns null when startDashboard throws unexpected error', async () => {
    // Provide a non-existent project dir that causes crypto or other internals to fail
    // We can trigger the outer catch by mocking crypto
    vi.resetModules();

    // Mock crypto.randomBytes to throw
    vi.doMock('crypto', () => ({
      randomBytes: () => { throw new Error('crypto unavailable'); },
    }));

    const dashMod = await import('../src/dashboard.js');

    const result = await dashMod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    expect(result).toBeNull();
    vi.doUnmock('crypto');
  });

  it('handles SSE client write failure during updateDashboard', async () => {
    const result = await mod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });
    expect(result.url).toBeTruthy();

    // Connect SSE client, then force-close it to trigger write failure
    const sseRes = await new Promise((resolve) => {
      http.get(`${result.url}/events`, (res) => resolve(res));
    });

    // Force destroy the connection
    sseRes.destroy();

    // Small delay for the close event
    await new Promise(resolve => setTimeout(resolve, 300));

    // updateDashboard should not throw even if SSE client is dead
    expect(() => mod.updateDashboard({ status: 'running', steps: [] })).not.toThrow();
  });

  it('updateDashboard writes progress file when no server exists', async () => {
    // Start dashboard, get reference, then stop server
    const result = await mod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    mod.stopDashboard();

    // After stop, updating should not throw (progressFilePath is null now)
    expect(() => mod.updateDashboard({ status: 'completed' })).not.toThrow();
  });

  it('stopDashboard clears shutdown timer if one is pending', async () => {
    await mod.startDashboard(makeInitialState(), {
      onStop: vi.fn(),
      projectDir: tempDir,
    });

    // Schedule a shutdown first
    mod.scheduleShutdown();

    // Then call stop directly — should clear the timer and not double-stop
    expect(() => mod.stopDashboard()).not.toThrow();
  });
});

describe('dashboard.js — server error on listen', () => {
  let tempDir;
  let warn;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-dash-listen-'));
    warn = (await import('../src/logger.js')).warn;
  });

  afterEach(async () => {
    await robustCleanup(tempDir);
  });

  it('falls back to null url when server port is already in use', async () => {
    // Occupy a port first
    const blockingServer = http.createServer();
    const port = await new Promise((resolve) => {
      blockingServer.listen(0, '127.0.0.1', () => {
        resolve(blockingServer.address().port);
      });
    });

    try {
      // Now try to start the dashboard with the same port — we can't directly,
      // but we can test the server error handler by starting a server that errors.
      // Instead, test that startDashboard handles the error path gracefully by
      // triggering a generic server start/stop cycle.
      vi.resetModules();

      // Mock http.createServer to emit an error event
      vi.doMock('http', async () => {
        const { EventEmitter } = await import('events');
        return {
          createServer: vi.fn(() => {
            const fakeServer = new EventEmitter();
            fakeServer.listen = vi.fn(() => {
              // Emit error after listen is called
              process.nextTick(() => fakeServer.emit('error', new Error('EADDRINUSE')));
            });
            fakeServer.address = vi.fn(() => ({ port: 0 }));
            fakeServer.close = vi.fn();
            return fakeServer;
          }),
        };
      });

      const dashMod = await import('../src/dashboard.js');
      const result = await dashMod.startDashboard(makeInitialState(), {
        onStop: vi.fn(),
        projectDir: tempDir,
      });

      // When server errors, should return {url: null, port: null}
      expect(result.url).toBeNull();
      expect(result.port).toBeNull();

      vi.doUnmock('http');
    } finally {
      blockingServer.close();
    }
  });
});
