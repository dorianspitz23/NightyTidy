#!/usr/bin/env node

// Standalone dashboard HTTP server for orchestrator mode.
// Spawned as a detached process by orchestrator.js during --init-run.
// Polls nightytidy-progress.json for state updates and serves the
// browser dashboard with SSE push. Killed by --finish-run via PID.

import { createServer } from 'http';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { randomBytes } from 'crypto';
import { getHTML } from './dashboard-html.js';

const POLL_INTERVAL = 500;

const projectDir = process.argv[2];
if (!projectDir) {
  process.stderr.write('Usage: dashboard-standalone.js <projectDir>\n');
  process.exit(1);
}

const progressPath = `${projectDir}/nightytidy-progress.json`;
const urlFilePath = `${projectDir}/nightytidy-dashboard.url`;
const csrfToken = randomBytes(16).toString('hex');

let currentState = null;
let currentStateJson = null;
const sseClients = new Set();

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
};

function pollProgress() {
  try {
    if (!existsSync(progressPath)) return;
    const raw = readFileSync(progressPath, 'utf8');
    const state = JSON.parse(raw);

    // Only push if state actually changed (compare serialized strings to avoid
    // redundant broadcasts). Cache the JSON to avoid double-stringify per tick.
    const stateJson = JSON.stringify(state);
    if (stateJson === currentStateJson) return;

    currentState = state;
    currentStateJson = stateJson;
    const payload = `event: state\ndata: ${stateJson}\n\n`;
    for (const client of sseClients) {
      try { client.write(payload); } catch { sseClients.delete(client); }
    }
  } catch { /* file being written or invalid — skip this tick */ }
}

function handleRequest(req, res) {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', ...SECURITY_HEADERS });
    res.end(getHTML(csrfToken));
  } else if (req.method === 'GET' && req.url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    });
    if (currentState) {
      res.write(`event: state\ndata: ${JSON.stringify(currentState)}\n\n`);
    }
    sseClients.add(res);
    res.on('close', () => sseClients.delete(res));
  } else if (req.method === 'POST' && req.url === '/stop') {
    // CSRF-protected stop endpoint — no-op in orchestrator mode (abort is handled externally)
    const MAX_BODY = 1024;
    let body = '';
    let truncated = false;
    req.on('data', chunk => {
      if (truncated) return;
      body += chunk;
      if (body.length > MAX_BODY) { truncated = true; body = body.slice(0, MAX_BODY); }
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body || '{}');
        if (parsed.token !== csrfToken) {
          res.writeHead(403, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
          res.end(JSON.stringify({ error: 'Invalid token' }));
          return;
        }
      } catch {
        res.writeHead(403, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
        res.end(JSON.stringify({ error: 'Invalid token' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify({ ok: true, message: 'Stop not supported in orchestrator mode' }));
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain', 'X-Content-Type-Options': 'nosniff' });
    res.end('Not found');
  }
}

const server = createServer(handleRequest);

server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const url = `http://localhost:${port}`;

  try { writeFileSync(urlFilePath, url + '\n', 'utf8'); } catch { /* non-critical */ }

  // Write port to stdout so the spawning process can capture it
  process.stdout.write(JSON.stringify({ port, url, pid: process.pid }) + '\n');

  pollTimer = setInterval(pollProgress, POLL_INTERVAL);
});

let pollTimer = null;

server.on('error', (err) => {
  process.stderr.write(`Dashboard server error: ${err.message}\n`);
  process.exit(1);
});

// Graceful shutdown with force-kill timeout
process.on('SIGTERM', () => {
  if (pollTimer) clearInterval(pollTimer);
  for (const client of sseClients) { try { client.end(); } catch { /* ignore */ } }
  // Force exit after 5s if server.close() blocks on lingering connections
  const forceTimer = setTimeout(() => process.exit(0), 5000);
  forceTimer.unref();
  server.close(() => { clearTimeout(forceTimer); process.exit(0); });
});
