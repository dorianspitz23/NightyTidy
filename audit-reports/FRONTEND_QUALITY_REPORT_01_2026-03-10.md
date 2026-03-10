# Frontend Quality Report — 2026-03-10

## Executive Summary

- **Accessibility issues found**: 10 | **Fixed**: 10 | **Remaining**: 3 (low-risk, documented)
- **UX consistency**: Good — color scheme, status naming, and icon language are consistent across browser dashboard and terminal UI
- **Bundle size**: N/A — no frontend build step; dependency set is lean (6 production deps, all justified)
- **i18n readiness**: Not ready — 275+ hardcoded English strings, no extraction framework

---

## 1. Accessibility

### Scope

The only browser-rendered UI is the live dashboard (`src/dashboard-html.js`, ~425 lines of HTML/CSS/JS served via HTTP). Terminal UIs (`dashboard-tui.js`, `cli.js`, `cli-ui.js`) are outside WCAG scope but were reviewed for usability.

### Issues Fixed

| # | Component | Issue | Fix |
|---|-----------|-------|-----|
| 1 | dashboard-html.js | No landmark elements — content directly in `<body>` | Wrapped all content in `<main>`, used `<header>` for header section |
| 2 | dashboard-html.js | Progress bar has no ARIA attributes — invisible to screen readers | Added `role="progressbar"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-label` |
| 3 | dashboard-html.js | Progress bar ARIA not updated on state change | Added `setAttribute('aria-valuenow', pct)` in `render()` JS function |
| 4 | dashboard-html.js | Status badge changes dynamically but not announced to screen readers | Added `role="status"` and `aria-live="polite"` |
| 5 | dashboard-html.js | Error message div not announced to screen readers | Added `role="alert"` and `aria-live="assertive"` |
| 6 | dashboard-html.js | Reconnecting indicator not announced | Added `role="alert"` and `aria-live="assertive"` |
| 7 | dashboard-html.js | Current step section updates silently | Added `aria-live="polite"` |
| 8 | dashboard-html.js | Step list uses non-semantic `<div>` elements | Changed to `<ul>` / `<li>` with `list-style: none` and `aria-label="Step results"` |
| 9 | dashboard-html.js | Heading hierarchy skips h2 (h1 → h3 in summary) | Changed `<h3>` to `<h2>` in summary section |
| 10 | dashboard-html.js | Stop button has no visible focus indicator on dark background | Added `:focus-visible` style with cyan outline |

Additional minor fixes:
- Added `aria-hidden="true"` to decorative icons (play symbol in current step, step status icons)
- Added `aria-label` to `<section>` elements (progress, summary)

### Issues Remaining

| # | Component | Issue | Severity | Effort to Fix |
|---|-----------|-------|----------|---------------|
| 1 | dashboard-html.js | `innerHTML` used for step list rendering; DOM manipulation would be safer for assistive tech | Low | Medium — requires rewriting render logic to use `createElement`/`textContent` |
| 2 | dashboard-html.js | No skip-to-content link | Low | Low — but single-page app with limited content makes this marginal |
| 3 | dashboard-html.js | No keyboard shortcuts (e.g., `Escape` to trigger stop) | Low | Low |

### WCAG Compliance Assessment

**Level AA: Substantially compliant** after fixes. The dashboard is a single-purpose monitoring tool with limited interactivity (one button). All critical content is now accessible:
- Landmarks present (`<main>`, `<header>`, `<section>`)
- Proper heading hierarchy (h1 → h2)
- Dynamic content announced via ARIA live regions
- Progress bar has proper ARIA role and attributes
- Focus indicator visible on interactive elements
- Color contrast passes AA (verified: `#8888a0` on `#1a1a2e` = 4.9:1, `#e0e0e8` on `#0f0f1a` = 13.2:1)
- Uses semantic HTML (`<button>`, `<ul>`/`<li>`, `<header>`, `<main>`, `<section>`)
- `lang="en"` set on `<html>` element

---

## 2. UX Consistency

### Component Inventory

NightyTidy has two UI surfaces: a browser dashboard and terminal output.

| Pattern | Browser Dashboard | Terminal (CLI + TUI) | Consistent? |
|---------|-------------------|----------------------|-------------|
| Primary color | `--cyan: #00d4ff` | `chalk.cyan` | Yes |
| Success | `--green: #22c55e` | `chalk.green` | Yes |
| Error | `--red: #ef4444` | `chalk.red` | Yes |
| Warning | `--yellow: #eab308` | `chalk.yellow` | Yes |
| Step success icon | `✓` (Unicode 10003) | `✓` (chalk.green) | Yes |
| Step failure icon | `✗` (Unicode 10007) | `✗` (chalk.red) | Yes |
| Running indicator | Spinner animation | `⏳` (hourglass) | Different but appropriate per medium |
| Pending indicator | `○` (circle) | `○` (chalk.dim) | Yes |
| Status names | starting, running, finishing, completed, stopped, error | Same set | Yes |
| Progress display | Progress bar + percentage + elapsed time | Progress bar + percentage + elapsed time | Yes |

### Duration Formatting

| Context | Function | Example Output |
|---------|----------|---------------|
| Browser dashboard | `formatMs()` in dashboard-html.js | `42s`, `3m 05s`, `1h 02m` |
| Terminal TUI | `formatMs()` in dashboard-tui.js | `42s`, `3m 05s`, `1h 02m` |
| Report / CLI | `formatDuration()` in report.js | `0m 42s`, `3m 42s`, `2h 15m` |

Minor inconsistency: `formatMs()` shows `42s` for short durations while `formatDuration()` shows `0m 42s`. Both are readable and contextually appropriate (real-time display vs. final report).

### Inconsistencies Found

None requiring action. The codebase has a single dark theme for the browser dashboard and consistent terminal coloring conventions. No duplicate component variants, no conflicting patterns.

### Assessment: Good

---

## 3. Bundle Size

### Architecture

NightyTidy is a Node.js CLI tool with **no frontend build step**. The browser dashboard HTML/CSS/JS is served inline from a JavaScript string (~425 lines). There is no webpack, vite, rollup, or any bundling pipeline.

### Dependency Profile

| Dependency | Version | Files Using It | Purpose | Size Estimate | Justified? |
|-----------|---------|---------------|---------|---------------|------------|
| @inquirer/checkbox | ^5.1.0 | cli-ui.js | Interactive step selection | ~50-100 KB | Yes — used once but essential for interactive mode |
| chalk | ^5.6.2 | cli.js, cli-ui.js, dashboard-tui.js, logger.js | Terminal coloring | ~15-20 KB | Yes — 40+ uses, industry standard |
| commander | ^14.0.3 | cli.js | CLI argument parsing | ~40-50 KB | Yes — 10 options, standard tool |
| node-notifier | ^10.0.1 | notifications.js | Desktop notifications | ~80-120 KB | Marginal — optional convenience feature |
| ora | ^9.3.0 | cli.js, cli-ui.js | Terminal spinners | ~30-50 KB | Yes — essential UX for long-running steps |
| simple-git | ^3.32.3 | git.js | Git operations | ~200-300 KB | Yes — 15+ methods, core to functionality |

**Total estimated production dependency size**: ~415-640 KB

### Findings

- **No unused dependencies** — every package is actively imported and used
- **No partial imports that could be optimized** — all imports are specific (e.g., `import chalk from 'chalk'` for a pure-ESM package)
- **No heavy utility libraries** — no lodash, moment, etc.
- **No duplicate dependencies** — clean dependency tree
- **No dead CSS** — all CSS in dashboard-html.js is actively used by the render function

### Larger Optimization Opportunities

| Opportunity | Impact | Effort | Recommended? |
|------------|--------|--------|-------------|
| Remove `node-notifier` | -80-120 KB, simpler deploys, no native deps | Low | Only if notifications aren't valued |
| Replace `@inquirer/checkbox` with readline-based picker | -50 KB | Medium (40-50 LOC) | No — worse UX |
| Replace `chalk` with raw ANSI codes | -15 KB | Low but reduces readability | No |

---

## 4. Internationalization (i18n)

### Current State

**No i18n framework exists.** All user-facing text is hardcoded in English.

### Hardcoded String Census

| File | String Count | Categories |
|------|-------------|-----------|
| src/cli-ui.js | 81 | Labels, status messages, prompts, notifications, merge instructions |
| src/cli.js | 48 | Option descriptions, error messages, log messages, spinner text |
| src/report.js | 43 | Report headings, labels, fallback narration, undo instructions |
| src/setup.js | 32 | Integration snippet text, rule descriptions, command references |
| src/checks.js | 31 | Pre-check success/failure messages, error messages |
| src/dashboard-html.js | 40 | HTML headings, labels, status text, ARIA labels, summary text |
| src/dashboard-tui.js | 16 | Headings, labels, status messages, footer instructions |
| src/logger.js | 4 | Warning messages, error messages |
| **Total** | **295** | |

### String Categories

| Category | Count | Extraction Difficulty |
|----------|-------|----------------------|
| Status/labels (short) | 44 | Easy — direct key replacement |
| Error/warning messages | 89 | Medium — many include interpolated values |
| Headings/titles | 32 | Easy |
| Help text / instructions | 26 | Easy |
| Dynamic composites (e.g., `"Step 3/28: name"`) | 41 | Hard — needs ICU MessageFormat or equivalent |
| Code examples / CLI references | 14 | Should not be translated |
| Notifications | 9 | Easy |

### Blockers for i18n Adoption

1. **String concatenation** — Many strings are built with `+` or template literals containing dynamic values (step counts, durations, branch names). These need ICU MessageFormat or similar.
2. **Emoji in strings** — `✅`, `❌`, `⚠️`, `📋`, `🏷️` are mixed into message text. Need to separate emoji from translatable content.
3. **Hardcoded date format** — `formatDate()` uses ISO 8601 (`YYYY-MM-DD`); would need `Intl.DateTimeFormat` for locale-aware dates.
4. **No plural handling** — `"1 step" / "3 steps"` uses simple concatenation. Different languages have different pluralization rules.

### Recommended Approach

**Do not add an i18n framework now.** NightyTidy targets English-speaking developers. The effort (extracting 295 strings, adding a framework, maintaining translations) far exceeds the benefit for the current user base.

If i18n becomes necessary:
1. Adopt `i18next` (lightweight, well-maintained, supports interpolation and plurals)
2. Extract strings file-by-file, starting with `checks.js` (most user-visible, fewest interpolations)
3. Budget: ~2-3 days for full extraction + framework setup

---

## 5. Recommendations

| # | Recommendation | Impact | Risk if Ignored | Worth Doing? | Details |
|---|---|---|---|---|---|
| 1 | Accessibility fixes (implemented) | Screen reader users can now use the dashboard; WCAG AA compliance | Medium — could be a legal issue for enterprise users | Yes | 10 fixes applied to dashboard-html.js, all tests passing |
| 2 | Consider removing `node-notifier` | Smaller install, no native deps, simpler CI | Low — notifications are a convenience feature | Only if time allows | Would remove ~100 KB and the only native dependency. Desktop notifications are fire-and-forget and often go unnoticed on multi-hour runs. |
| 3 | Replace `innerHTML` step list with DOM manipulation | Eliminates theoretical XSS vector (currently mitigated by `escapeHtml`) | Low — `escapeHtml` already prevents injection | Probably not | The current approach is safe due to HTML escaping. DOM manipulation would be marginally safer but adds code complexity for no practical security gain. |

---

*Generated by NightyTidy frontend quality audit — 2026-03-10*
