import { createServer } from 'http';
import { randomBytes } from 'crypto';
import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { info, warn } from './logger.js';
import { getHTML } from './dashboard-html.js';

const SHUTDOWN_DELAY = 3000;
const URL_FILENAME = 'nightytidy-dashboard.url';
const PROGRESS_FILENAME = 'nightytidy-progress.json';

let server = null;
let sseClients = new Set();
let currentState = null;
let urlFilePath = null;
let progressFilePath = null;
let shutdownTimer = null;
let tuiProcess = null;
let csrfToken = null;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
};

function serveHTML(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
  res.end(getHTML(csrfToken));
}

function handleSSE(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Content-Type-Options': 'nosniff',
  });

  // Send current state immediately
  if (currentState) {
    res.write(`event: state\ndata: ${JSON.stringify(currentState)}\n\n`);
  }

  sseClients.add(res);

  res.on('close', () => {
    sseClients.delete(res);
  });
}

function rejectCsrf(res) {
  res.writeHead(403, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify({ error: 'Invalid token' }));
}

function handleStop(req, res, onStop) {
  const MAX_BODY = 1024; // 1KB — more than enough for a JSON token payload
  let body = '';
  let truncated = false;
  req.on('data', chunk => {
    if (truncated) return;
    body += chunk;
    if (body.length > MAX_BODY) { truncated = true; body = body.slice(0, MAX_BODY); }
  });
  req.on('end', () => {
    // Verify CSRF token to prevent cross-origin stop requests
    try {
      const parsed = JSON.parse(body || '{}');
      if (parsed.token !== csrfToken) { rejectCsrf(res); return; }
    } catch {
      rejectCsrf(res); return;
    }
    try { onStop(); } catch { /* abort may throw if already aborted */ }
    res.writeHead(200, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify({ ok: true }));
  });
}

function handleRequest(req, res, onStop) {
  if (req.method === 'GET' && req.url === '/') {
    serveHTML(res);
  } else if (req.method === 'GET' && req.url === '/events') {
    handleSSE(res);
  } else if (req.method === 'POST' && req.url === '/stop') {
    handleStop(req, res, onStop);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' });
    res.end('Not found');
  }
}

function spawnTuiWindow() {
  if (!progressFilePath) return;
  try {
    const tuiScript = fileURLToPath(new URL('./dashboard-tui.js', import.meta.url));

    if (process.platform === 'win32') {
      // Use shell:true so Node.js invokes cmd.exe /d /s /c "..." which:
      //   /d — disables AutoRun registry interference
      //   /s — reliably strips only the outer wrapper quotes
      // This avoids Node.js argument-escaping edge cases with cmd.exe
      // that can misparse paths containing spaces.
      tuiProcess = spawn(
        `start "NightyTidy Progress" node "${tuiScript}" "${progressFilePath}"`,
        [],
        { shell: true, stdio: 'ignore', windowsHide: true },
      );
    } else if (process.platform === 'darwin') {
      tuiProcess = spawn('open', ['-a', 'Terminal', tuiScript, '--args', progressFilePath], {
        detached: true,
        stdio: 'ignore',
      });
    } else {
      // Linux — try common terminal emulators
      tuiProcess = spawn('x-terminal-emulator', ['-e', 'node', tuiScript, progressFilePath], {
        detached: true,
        stdio: 'ignore',
      });
    }

    tuiProcess.unref();
    info('Dashboard window opened');
  } catch (err) {
    warn(`Could not open dashboard window: ${err.message}`);
    tuiProcess = null;
  }
}

/**
 * Start the dashboard HTTP server and TUI window. Errors are swallowed — dashboard failure must not crash a run.
 * @param {object} initialState - Initial progress state to serve.
 * @param {{ onStop: () => void, projectDir: string }} opts - Stop callback and project directory.
 * @returns {Promise<{ url: string | null, port: number | null } | null>} Dashboard info, `{ url: null, port: null }` if only TUI is running, or `null` on complete failure.
 */
export async function startDashboard(initialState, { onStop, projectDir }) {
  try {
    csrfToken = randomBytes(16).toString('hex');
    currentState = initialState;
    urlFilePath = path.join(projectDir, URL_FILENAME);
    progressFilePath = path.join(projectDir, PROGRESS_FILENAME);

    // Write initial progress file and spawn TUI window
    try {
      writeFileSync(progressFilePath, JSON.stringify(initialState), 'utf8');
    } catch { /* non-critical */ }
    spawnTuiWindow();

    return await new Promise((resolve, reject) => {
      server = createServer((req, res) => handleRequest(req, res, onStop));

      server.on('error', (err) => {
        warn(`Dashboard server could not start: ${err.message}`);
        server = null;
        // TUI still works via file — return success
        resolve({ url: null, port: null });
      });

      server.listen(0, '127.0.0.1', () => {
        // Guard against stopDashboard() closing the server before this callback fires
        if (!server) { resolve({ url: null, port: null }); return; }
        const addr = server.address();
        if (!addr) { resolve({ url: null, port: null }); return; }
        const port = addr.port;
        const url = `http://localhost:${port}`;

        try {
          writeFileSync(urlFilePath, url + '\n', 'utf8');
        } catch { /* non-critical */ }

        info(`Dashboard server at ${url}`);
        resolve({ url, port });
      });
    });
  } catch (err) {
    warn(`Dashboard could not start: ${err.message}`);
    server = null;
    return null;
  }
}

/**
 * Push updated progress state to the TUI file and all SSE clients.
 * @param {object} state - Current progress state.
 */
export function updateDashboard(state) {
  currentState = state;

  const json = JSON.stringify(state);

  if (progressFilePath) {
    try {
      writeFileSync(progressFilePath, json, 'utf8');
    } catch { /* non-critical */ }
  }

  if (!server) return;

  const ssePayload = `event: state\ndata: ${json}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(ssePayload);
    } catch {
      sseClients.delete(client);
    }
  }
}

/**
 * Stop the dashboard: close HTTP server, clean up SSE connections, delete ephemeral files.
 * Safe to call multiple times or when no server is running.
 */
export function stopDashboard() {
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
  }

  // Always clean up ephemeral files, even if no HTTP server was started (TUI-only mode)
  if (urlFilePath) {
    try { unlinkSync(urlFilePath); } catch { /* already gone */ }
    urlFilePath = null;
  }

  if (progressFilePath) {
    try { unlinkSync(progressFilePath); } catch { /* already gone */ }
    progressFilePath = null;
  }

  csrfToken = null;

  if (!server) {
    currentState = null;
    return;
  }

  // Close all SSE connections
  for (const client of sseClients) {
    try { client.end(); } catch { /* ignore */ }
  }
  sseClients.clear();

  try {
    server.close();
  } catch { /* ignore */ }
  server = null;

  currentState = null;
}

/**
 * Schedule dashboard shutdown after a brief delay (allows final SSE events to reach clients).
 * Only used on the success path — error/abort paths call `stopDashboard()` directly.
 */
export function scheduleShutdown() {
  if (shutdownTimer) clearTimeout(shutdownTimer);
  shutdownTimer = setTimeout(() => stopDashboard(), SHUTDOWN_DELAY);
}
