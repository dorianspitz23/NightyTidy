/**
 * Return the complete dashboard HTML page with embedded CSS and JavaScript.
 * @param {string} csrfToken - CSRF token to embed in the page for the stop button.
 * @returns {string} Complete HTML document.
 */
export function getHTML(csrfToken) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NightyTidy — Live Dashboard</title>
<style>
  :root {
    --bg: #0f0f1a;
    --surface: #1a1a2e;
    --border: #2a2a3e;
    --text: #e0e0e8;
    --text-dim: #8888a0;
    --cyan: #00d4ff;
    --green: #22c55e;
    --red: #ef4444;
    --yellow: #eab308;
    --blue: #3b82f6;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    min-height: 100vh;
    padding: 24px;
  }

  .header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 24px;
  }
  .header h1 {
    font-size: 1.5rem;
    color: var(--cyan);
    font-weight: 600;
  }
  .header .version {
    color: var(--text-dim);
    font-size: 0.85rem;
  }

  .status-badge {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 12px;
    font-size: 0.8rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 20px;
    transition: background-color 0.3s ease, color 0.3s ease;
  }
  .status-starting  { background: #1e3a5f; color: var(--blue); }
  .status-running   { background: #1e3a5f; color: var(--blue); }
  .status-finishing  { background: #1e3a5f; color: var(--cyan); }
  .status-completed  { background: #14532d; color: var(--green); }
  .status-stopped    { background: #422006; color: var(--yellow); }
  .status-error      { background: #450a0a; color: var(--red); }

  .progress-section {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .progress-bar-track {
    width: 100%;
    height: 8px;
    background: var(--border);
    border-radius: 4px;
    overflow: hidden;
    margin: 8px 0;
  }
  .progress-bar-fill {
    height: 100%;
    background: var(--cyan);
    border-radius: 4px;
    transition: width 0.5s ease;
    will-change: width;
  }
  .progress-stats {
    display: flex;
    justify-content: space-between;
    font-size: 0.85rem;
    color: var(--text-dim);
  }

  .current-step {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .current-step .label { color: var(--text-dim); font-size: 0.85rem; }
  .current-step .name { font-weight: 500; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  .pulse { animation: pulse 1.5s ease-in-out infinite; color: var(--cyan); }

  .step-list {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 8px;
    margin-bottom: 16px;
    max-height: 400px;
    overflow-y: auto;
    list-style: none;
  }
  .step-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 0.9rem;
    transition: background-color 0.3s ease;
  }
  .step-item:hover { background: rgba(255,255,255,0.03); }
  .step-running { background: rgba(59, 130, 246, 0.08); }
  .step-completed { background: rgba(34, 197, 94, 0.04); }
  .step-failed { background: rgba(239, 68, 68, 0.06); }
  .step-icon {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    font-size: 0.8rem;
  }
  .step-pending .step-icon { color: var(--text-dim); }
  .step-running .step-icon { color: var(--blue); }
  .step-completed .step-icon { color: var(--green); }
  .step-failed .step-icon { color: var(--red); }
  .step-name { flex: 1; }
  .step-duration { color: var(--text-dim); font-size: 0.8rem; }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  .spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    border: 2px solid var(--border);
    border-top-color: var(--blue);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  .actions {
    margin-bottom: 16px;
  }
  .stop-btn {
    background: var(--red);
    color: white;
    border: none;
    padding: 10px 24px;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.2s;
  }
  .stop-btn:hover { opacity: 0.85; }
  .stop-btn:focus-visible {
    outline: 2px solid var(--cyan);
    outline-offset: 2px;
  }
  .stop-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .summary {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    display: none;
  }
  .summary.visible { display: block; }
  .summary h2 { margin-bottom: 8px; font-size: 1rem; font-weight: 600; }
  .summary .stat { color: var(--text-dim); font-size: 0.9rem; margin: 4px 0; }

  .elapsed { font-variant-numeric: tabular-nums; }

  .error-msg {
    background: #450a0a;
    border: 1px solid var(--red);
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 16px;
    color: var(--red);
    font-size: 0.9rem;
    display: none;
  }
  .error-msg.visible { display: block; }

  .reconnecting {
    position: fixed;
    top: 12px;
    right: 12px;
    background: var(--yellow);
    color: #000;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 600;
    display: none;
  }
  .reconnecting.visible { display: block; }
</style>
</head>
<body>

<div class="reconnecting" id="reconnecting" role="alert" aria-live="assertive">Reconnecting...</div>

<main>
<header class="header">
  <h1>NightyTidy</h1>
  <span class="version">Live Dashboard</span>
</header>

<div id="status-badge" class="status-badge status-starting" role="status" aria-live="polite">Starting</div>

<section class="progress-section" aria-label="Run progress">
  <div class="progress-stats">
    <span id="progress-text">0 / 0 steps</span>
    <span class="elapsed" id="elapsed">0m 00s</span>
  </div>
  <div class="progress-bar-track" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" aria-label="Step completion progress" id="progress-bar">
    <div class="progress-bar-fill" id="progress-fill" style="width: 0%"></div>
  </div>
  <div class="progress-stats">
    <span id="counts"></span>
    <span id="percentage">0%</span>
  </div>
</section>

<div class="current-step" id="current-step" style="display:none" aria-live="polite">
  <span class="pulse" aria-hidden="true">&#9654;</span>
  <div>
    <div class="label">Running now</div>
    <div class="name" id="current-step-name"></div>
  </div>
</div>

<div class="error-msg" id="error-msg" role="alert" aria-live="assertive"></div>

<ul class="step-list" id="step-list" aria-label="Step results"></ul>

<div class="actions" id="actions">
  <button class="stop-btn" id="stop-btn" onclick="stopRun()">Stop Run</button>
</div>

<section class="summary" id="summary" aria-label="Run summary">
  <h2 id="summary-title">Run Complete</h2>
  <div class="stat" id="summary-steps"></div>
  <div class="stat" id="summary-duration"></div>
  <div class="stat" id="summary-outcome"></div>
</section>
</main>

<script>
let state = null;
let elapsedInterval = null;
let rafPending = null;

const evtSource = new EventSource('/events');

evtSource.addEventListener('state', (e) => {
  try {
    state = JSON.parse(e.data);
    // Debounce renders via requestAnimationFrame — prevents layout thrashing
    // if multiple SSE events arrive in the same frame
    if (!rafPending) {
      rafPending = requestAnimationFrame(() => {
        rafPending = null;
        if (state) render(state);
      });
    }
  } catch { /* malformed SSE data — skip this event */ }
});

evtSource.onerror = () => {
  document.getElementById('reconnecting').classList.add('visible');
};

evtSource.onopen = () => {
  document.getElementById('reconnecting').classList.remove('visible');
};

// Reusable DOM element for HTML escaping (avoids creating a new element per call)
const escapeEl = document.createElement('div');
function escapeHtml(str) {
  escapeEl.textContent = str;
  return escapeEl.innerHTML;
}

function stepIcon(status) {
  if (status === 'running') return '<span class="spinner"></span>';
  if (status === 'completed') return '&#10003;';
  if (status === 'failed') return '&#10007;';
  return '&#9675;';
}

// Delta-update the step list: create/update DOM elements in-place instead of
// rebuilding innerHTML. This preserves CSS transitions on status changes and
// avoids destroying/recreating 28 DOM nodes on every SSE event.
function renderStepList(steps) {
  const listEl = document.getElementById('step-list');

  // Remove excess items
  while (listEl.children.length > steps.length) {
    listEl.removeChild(listEl.lastChild);
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let item = listEl.children[i];

    if (!item) {
      // Create new step item
      item = document.createElement('li');
      item.innerHTML =
        '<span class="step-icon" aria-hidden="true"></span>' +
        '<span class="step-name"></span>' +
        '<span class="step-duration"></span>';
      listEl.appendChild(item);
    }

    // Update class (triggers CSS transition for background color)
    const cls = 'step-item step-' + step.status;
    if (item.className !== cls) item.className = cls;

    // Update icon
    const iconEl = item.children[0];
    const newIcon = stepIcon(step.status);
    if (iconEl.innerHTML !== newIcon) iconEl.innerHTML = newIcon;

    // Update name
    const nameEl = item.children[1];
    const nameText = step.number + '. ' + escapeHtml(step.name);
    if (nameEl.innerHTML !== nameText) nameEl.innerHTML = nameText;

    // Update duration
    const durEl = item.children[2];
    const durText = step.duration ? formatMs(step.duration) : '';
    if (durEl.textContent !== durText) durEl.textContent = durText;
  }

  // Auto-scroll to keep the running step visible
  const runningItem = listEl.querySelector('.step-running');
  if (runningItem) {
    runningItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function render(s) {
  // Status badge
  const badge = document.getElementById('status-badge');
  badge.className = 'status-badge status-' + s.status;
  badge.textContent = s.status.charAt(0).toUpperCase() + s.status.slice(1);

  // Progress — count the running step as partial progress
  const done = s.completedCount + s.failedCount;
  const active = (s.status === 'running' && s.currentStepIndex >= 0) ? 1 : 0;
  const pct = s.totalSteps > 0 ? Math.round(((done + active * 0.5) / s.totalSteps) * 100) : 0;
  document.getElementById('progress-text').textContent = done + ' / ' + s.totalSteps + ' steps';
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-bar').setAttribute('aria-valuenow', pct);
  document.getElementById('percentage').textContent = pct + '%';

  const parts = [];
  if (s.completedCount > 0) parts.push(s.completedCount + ' passed');
  if (s.failedCount > 0) parts.push(s.failedCount + ' failed');
  document.getElementById('counts').textContent = parts.join(', ');

  // Elapsed time
  if (s.startTime && !elapsedInterval) {
    elapsedInterval = setInterval(() => updateElapsed(s.startTime), 1000);
    updateElapsed(s.startTime);
  }

  // Current step
  const curEl = document.getElementById('current-step');
  if (s.status === 'running' && s.currentStepIndex >= 0) {
    curEl.style.display = 'flex';
    document.getElementById('current-step-name').textContent =
      'Step ' + (s.currentStepIndex + 1) + '/' + s.totalSteps + ': ' + s.currentStepName;
  } else {
    curEl.style.display = 'none';
  }

  // Error
  const errEl = document.getElementById('error-msg');
  if (s.error) {
    errEl.textContent = s.error;
    errEl.classList.add('visible');
  } else {
    errEl.classList.remove('visible');
  }

  // Step list — delta update for smooth CSS transitions
  renderStepList(s.steps);

  // Actions
  const finished = ['completed', 'stopped', 'error'].includes(s.status);
  document.getElementById('actions').style.display = finished ? 'none' : 'block';

  // Summary
  const sumEl = document.getElementById('summary');
  if (finished) {
    sumEl.classList.add('visible');
    const titles = { completed: 'Run Complete', stopped: 'Run Stopped', error: 'Run Failed' };
    document.getElementById('summary-title').textContent = titles[s.status] || 'Done';
    document.getElementById('summary-steps').textContent =
      s.completedCount + ' passed, ' + s.failedCount + ' failed out of ' + s.totalSteps + ' steps';
    document.getElementById('summary-outcome').textContent =
      s.status === 'completed' && s.failedCount === 0 ? 'All steps succeeded!'
      : s.status === 'error' ? 'Error: ' + (s.error || 'No error details available')
      : '';

    if (elapsedInterval) {
      clearInterval(elapsedInterval);
      elapsedInterval = null;
    }
    if (s.startTime) {
      const totalMs = Date.now() - s.startTime;
      document.getElementById('summary-duration').textContent = 'Total time: ' + formatMs(totalMs);
      document.getElementById('elapsed').textContent = formatMs(totalMs);
    }
  } else {
    sumEl.classList.remove('visible');
  }
}

function updateElapsed(startTime) {
  const ms = Date.now() - startTime;
  document.getElementById('elapsed').textContent = formatMs(ms);
}

function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
  const h = Math.floor(m / 60);
  return h + 'h ' + String(m % 60).padStart(2, '0') + 'm';
}

async function stopRun() {
  const btn = document.getElementById('stop-btn');
  btn.disabled = true;
  btn.textContent = 'Stopping...';
  try {
    await fetch('/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: '${csrfToken}' }),
    });
  } catch { /* server may already be stopping */ }
}
</script>

</body>
</html>`;
}
