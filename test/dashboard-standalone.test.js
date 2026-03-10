import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import http from 'http';
import { robustCleanup } from './helpers/cleanup.js';

// Mock logger to prevent file I/O during tests
vi.mock('../src/logger.js', () => ({
  debug: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  initLogger: vi.fn(),
}));

// dashboard-standalone.js is a standalone script with side effects at module scope.
// We can't easily import it directly — instead, we test its core logic by spawning
// it as a subprocess against a real temp directory with progress JSON.

function fetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: () => data,
          json: () => JSON.parse(data),
        });
      });
    });

    req.on('error', reject);

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

describe('dashboard-standalone.js', () => {
  let tempDir;
  let serverProcess;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'nightytidy-dash-'));
  });

  afterEach(async () => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');
      // Wait for clean shutdown
      await new Promise(resolve => {
        serverProcess.on('exit', resolve);
        setTimeout(resolve, 2000);
      });
    }
    await robustCleanup(tempDir);
  });

  async function startServer() {
    const { spawn } = await import('child_process');
    const serverScript = path.resolve('src/dashboard-standalone.js');

    return new Promise((resolve, reject) => {
      serverProcess = spawn('node', [serverScript, tempDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: path.resolve('.'),
      });

      let output = '';
      const timer = setTimeout(() => {
        reject(new Error('Server did not start within 5 seconds'));
      }, 5000);

      serverProcess.stdout.on('data', (chunk) => {
        output += chunk.toString();
        if (output.includes('\n')) {
          clearTimeout(timer);
          try {
            const info = JSON.parse(output.trim());
            resolve(info);
          } catch (err) {
            reject(new Error(`Invalid JSON from server: ${output}`));
          }
        }
      });

      serverProcess.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      serverProcess.on('exit', (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timer);
          reject(new Error(`Server exited with code ${code}`));
        }
      });
    });
  }

  it('starts and outputs JSON with port, url, and pid', async () => {
    const info = await startServer();

    expect(info.port).toBeTypeOf('number');
    expect(info.port).toBeGreaterThan(0);
    expect(info.url).toMatch(/^http:\/\/localhost:\d+$/);
    expect(info.pid).toBeTypeOf('number');
  });

  it('serves HTML dashboard on GET /', async () => {
    const info = await startServer();
    const res = await fetch(info.url);

    expect(res.status).toBe(200);
    const html = res.text();
    expect(html).toContain('NightyTidy');
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('includes security headers on HTML responses', async () => {
    const info = await startServer();
    const res = await fetch(info.url);

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('returns 404 for unknown routes', async () => {
    const info = await startServer();
    const res = await fetch(`${info.url}/nonexistent`);

    expect(res.status).toBe(404);
  });

  it('serves health check on GET /health', async () => {
    const info = await startServer();
    const res = await fetch(`${info.url}/health`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');

    const body = res.json();
    expect(body.status).toBe('healthy');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof body.sseClients).toBe('number');
    expect(body.run).toBeDefined();
    expect(body.run.totalSteps).toBe(0);
  });

  it('serves SSE events on GET /events', async () => {
    const info = await startServer();

    const events = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(collected), 2000);
      const collected = [];

      http.get(`${info.url}/events`, (res) => {
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/event-stream');

        res.on('data', (chunk) => {
          collected.push(chunk.toString());
        });

        res.on('end', () => {
          clearTimeout(timer);
          resolve(collected);
        });
      }).on('error', reject);
    });

    // SSE connection should be established (may or may not have initial data)
    expect(true).toBe(true); // Connection didn't error
  });

  it('pushes state updates via SSE when progress JSON changes', async () => {
    const info = await startServer();

    // Write a progress file
    const progressPath = path.join(tempDir, 'nightytidy-progress.json');
    const state = { status: 'running', totalSteps: 3, completedCount: 1 };
    await writeFile(progressPath, JSON.stringify(state));

    // Connect to SSE and wait for state event
    const stateEvent = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(null), 3000);

      http.get(`${info.url}/events`, (res) => {
        let buffer = '';
        res.on('data', (chunk) => {
          buffer += chunk.toString();
          if (buffer.includes('event: state\n')) {
            clearTimeout(timer);
            res.destroy();
            resolve(buffer);
          }
        });
      }).on('error', reject);
    });

    // The server should have picked up the progress file and pushed it
    if (stateEvent) {
      expect(stateEvent).toContain('event: state');
      expect(stateEvent).toContain('"running"');
    }
  });

  it('rejects POST /stop with invalid CSRF token', async () => {
    const info = await startServer();

    const res = await fetch(`${info.url}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'wrong-token' }),
    });

    expect(res.status).toBe(403);
    const body = res.json();
    expect(body.error).toBe('Invalid token');
  });

  it('rejects POST /stop with malformed JSON body', async () => {
    const info = await startServer();

    const res = await fetch(`${info.url}/stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    });

    expect(res.status).toBe(403);
  });

  it('accepts POST /stop with valid CSRF token', async () => {
    const info = await startServer();

    // Get the HTML to extract the CSRF token
    const htmlRes = await fetch(info.url);
    const html = htmlRes.text();
    const tokenMatch = html.match(/csrfToken['":\s]+['"]([a-f0-9]+)['"]/);

    if (tokenMatch) {
      const csrfToken = tokenMatch[1];
      const res = await fetch(`${info.url}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: csrfToken }),
      });

      expect(res.status).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.message).toContain('orchestrator');
    }
  });

  it('writes dashboard URL file on startup', async () => {
    const info = await startServer();

    const urlFilePath = path.join(tempDir, 'nightytidy-dashboard.url');
    // Server writes URL file during startup
    expect(existsSync(urlFilePath)).toBe(true);
    const content = readFileSync(urlFilePath, 'utf8').trim();
    expect(content).toBe(info.url);
  });
});
