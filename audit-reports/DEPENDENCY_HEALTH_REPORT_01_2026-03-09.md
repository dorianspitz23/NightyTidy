# Dependency Health Report — 2026-03-09

## Executive Summary

| Metric | Count |
|--------|-------|
| **Total dependencies** | 130 installed (8 direct: 6 runtime + 2 dev) |
| **Transitive dependencies** | 268 in full tree |
| **Dependencies with known vulnerabilities** | 1 (esbuild — dev-only, moderate severity) |
| **Dependencies 1+ major versions behind** | 3 (vitest, @vitest/coverage-v8, node-notifier) |
| **Potentially abandoned dependencies** | 1 (node-notifier — last release 2022) |
| **License risks found** | 0 |
| **Upgrades applied** | 2 (commander 12→14, ora 8→9) |
| **Dependencies removed** | 0 |

---

## 1. Vulnerability Report

### Active Vulnerabilities

| Package | Advisory | Severity | Used in Project? | Fix Available? | Fix Applied? |
|---------|----------|----------|-----------------|----------------|-------------|
| esbuild ≤0.24.2 | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) | Moderate | No — dev-only (transitive via vitest→vite) | Yes — via vitest 4.x (breaking) | No — requires vitest major upgrade |

**Details**: The esbuild vulnerability allows any website to send requests to the development server and read the response. This is a **dev-only** dependency pulled in by vitest→vite→esbuild. It does not affect production runtime. The vulnerability is exploitable only when a dev server is running (not applicable to NightyTidy — it's a CLI tool that runs tests, not a dev server).

**Mitigation**: The fix requires upgrading to vitest 4.x (which uses vite 6.x with esbuild >0.24.2). This is documented in the Major Upgrades section below.

### Supply Chain Incident (Historical)

The `chalk` package was targeted in a supply chain attack on September 8, 2025. Malicious versions were published for ~2 hours. NightyTidy's current version (5.6.2) is the clean release published after the incident. **No action needed.**

---

## 2. License Compliance

### License Inventory Summary

| License | Count | Risk Level |
|---------|-------|-----------|
| MIT | 105 | None |
| ISC | 13 | None |
| BSD-3-Clause | 5 | None |
| BlueOak-1.0.0 | 5 | None |
| Apache-2.0 | 2 | None |

**Total: 130 packages, all with permissive licenses.**

All licenses are compatible with the project's MIT license. No GPL/AGPL/SSPL/BSL/unlicensed packages found. No license risks requiring legal review.

### Full License Inventory (Direct Dependencies)

| Package | Version | License |
|---------|---------|---------|
| @inquirer/checkbox | 5.1.0 | MIT |
| chalk | 5.6.2 | MIT |
| commander | 14.0.3 | MIT |
| node-notifier | 10.0.1 | MIT |
| ora | 9.3.0 | MIT |
| simple-git | 3.32.3 | MIT |
| vitest | 2.1.9 | MIT |
| @vitest/coverage-v8 | 2.1.9 | MIT |

---

## 3. Staleness Report

| Package | Current | Latest | Behind | Last Published | Health |
|---------|---------|--------|--------|---------------|--------|
| vitest | 2.1.9 | 4.0.18 | 2 major | Feb 2026 | Active |
| @vitest/coverage-v8 | 2.1.9 | 4.0.18 | 2 major | Feb 2026 | Active |
| node-notifier | 10.0.1 | 10.0.1 | Up to date | 2022 | **Inactive** |
| @inquirer/checkbox | 5.1.0 | 5.1.0 | Up to date | Feb 2026 | Active |
| chalk | 5.6.2 | 5.6.2 | Up to date | Sep 2025 | Stable/Mature |
| commander | 14.0.3 | 14.0.3 | Up to date | Feb 2026 | Active |
| ora | 9.3.0 | 9.3.0 | Up to date | Feb 2026 | Active |
| simple-git | 3.32.3 | 3.32.3 | Up to date | Feb 2026 | Active |

---

## 4. Upgrades Applied

| Package | From | To | Type | Tests Pass? |
|---------|------|----|------|------------|
| commander | 12.1.0 | 14.0.3 | Major (12→14) | Yes — 430/430 |
| ora | 8.2.0 | 9.3.0 | Major (8→9) | Yes — 430/430 |

### Commander 12 → 14 Details

**Breaking changes assessed (none affect NightyTidy):**
- v13: `allowExcessArguments` defaults to `false` — NightyTidy declares no positional arguments, so this is a behavioral improvement (errors on accidental positional args)
- v13: Stricter option flag validation — NightyTidy uses only long flags (`--all`, `--steps`, etc.), no short flags affected
- v13: `Help.wrap()` refactored — NightyTidy doesn't subclass Help
- v14: Requires Node.js ≥20 — NightyTidy already requires ≥20.12.0

### Ora 8 → 9 Details

**Only breaking change:** Node.js minimum raised from 18 to 20. NightyTidy already requires ≥20.12.0. No API changes. Brings bug fixes for multiline text rendering and reduced spinner flicker.

---

## 5. Major Upgrades Needed (Not Applied)

| Package | Current | Target | Breaking Changes | Effort | Priority |
|---------|---------|--------|-----------------|--------|----------|
| vitest + @vitest/coverage-v8 | 2.1.9 | 4.0.18 | Significant — mock behavior changes, config options removed | **Significant** | Medium |
| node-notifier | 10.0.1 | N/A (abandoned) | Replacement needed | **Low** (fire-and-forget usage) | Low |

### Vitest 2.x → 4.x Migration Notes

This is a **substantial** upgrade spanning two major versions. Key breaking changes:

1. **Requires Node.js ≥20 and Vite ≥6.0.0** — Node.js ✓, Vite will auto-upgrade
2. **Config changes**: `deps.external`, `deps.inline`, `deps.fallbackCJS` removed (use `server.deps.*`)
3. **Mock behavior**: `vi.fn().getMockName()` returns `'vi.fn()'` instead of `'spy'`
4. **Mock behavior**: Automocked methods can't be restored with `.mockRestore()`
5. **Test options**: No longer accepted as 3rd argument to `test()`/`describe()`

**Risk**: NightyTidy has 430 tests across 40 files with extensive use of `vi.doMock()`, `vi.resetModules()`, and custom mock factories. Mock behavior changes could affect many tests.

**Recommendation**: Plan a dedicated session for vitest upgrade. Run full suite after each incremental change. Budget for mock pattern updates. The esbuild vulnerability fix is the main incentive (though dev-only and low practical risk).

### Node-notifier Replacement

The package has had no releases since 2022 and appears effectively abandoned. However:
- NightyTidy uses it in a fire-and-forget pattern with full error swallowing
- Only imported in one file (`src/notifications.js`)
- No current security vulnerabilities
- Replacement candidate: `toasted-notifier` (maintained fork)

**Recommendation**: Low urgency. Consider replacing when a security issue surfaces or during a major refactor cycle.

---

## 6. Dependency Weight & Reduction

### Weight Analysis

| Package | Installed Size (Direct) | Transitive Count | Usage | Assessment |
|---------|------------------------|-------------------|-------|-----------|
| @inquirer/checkbox | ~15 packages | 11 | 1 file (cli.js) | Appropriate — full interactive checkbox UI |
| chalk | 1 package | 0 | 3 files | Lean — ESM, no deps |
| commander | 1 package | 0 | 1 file | Lean — no deps |
| node-notifier | ~5 packages | 4 | 1 file | Moderate — includes platform-specific notifiers |
| ora | ~12 packages | 11 | 1 file | Moderate — spinners need terminal control |
| simple-git | ~3 packages | 2 | 1 file (+ 11 test files) | Lean for what it does |
| vitest (dev) | ~130 packages | 120+ | 40 test files | Expected for a test framework |

### Duplicate Package Versions

| Package | Versions Installed | Reason |
|---------|-------------------|--------|
| string-width | 4.2.3, 5.1.2, 7.2.0 | Different consumers require different major versions |
| strip-ansi | 6.0.1, 7.2.0 | Same — legacy vs modern consumers |
| wrap-ansi | 7.0.0, 8.1.0 | @isaacs/cliui needs both legacy and modern |

These duplicates are normal npm semver resolution. No action possible without upstream changes.

### Unused Dependencies

**None found.** All 6 runtime dependencies are actively imported in source code. All 2 dev dependencies are used (vitest for testing, @vitest/coverage-v8 for coverage).

### Replacement Opportunities

| Dependency | Could Replace With | Usage | Effort | Worth It? |
|------------|-------------------|-------|--------|-----------|
| chalk | Node.js built-in `util.styleText()` (Node 21.7+) | 3 files | Low | **Not yet** — API is less ergonomic, project targets Node ≥20.12.0 which doesn't have it |
| ora | None — no lightweight alternative with equivalent features | 1 file | N/A | No |
| node-notifier | `toasted-notifier` (maintained fork) | 1 file | Low | Only when needed |

---

## 7. Abandoned/At-Risk Dependencies

| Package | Last Release | Maintainer Activity | Risk | Recommendation |
|---------|-------------|-------------------|------|----------------|
| node-notifier | 2022 | None — effectively abandoned | **Low** (error-swallowed, 1 file) | Monitor; replace when issue arises |
| chalk | Sep 2025 | Supply chain attack survived; stable/mature | **Very Low** | No action needed |

All other dependencies show active maintenance with releases within the past 3 months.

---

## 8. Lock File Status

| Check | Status |
|-------|--------|
| Lock file exists | ✓ `package-lock.json` (95 KB) |
| Committed to repo | ✓ |
| Consistent with manifest | ✓ (`npm install --dry-run` reports "up to date") |
| Duplicate packages | 3 pairs (string-width, strip-ansi, wrap-ansi) — normal semver resolution |

---

## 9. Recommendations

### Priority-Ordered Action Items

1. **Vitest 4.x upgrade** (Medium priority): Resolves the esbuild dev-server vulnerability. Significant effort due to 430 tests and mock behavior changes. Plan a dedicated session.

2. **node-notifier monitoring** (Low priority): No immediate action needed. Replace with `toasted-notifier` if a CVE surfaces or during next major refactor.

3. **Dependency policy**: Consider adding a `npm run check:deps` script that runs `npm audit` + `npm outdated` as part of CI. The existing `check:security` script covers audit but not staleness.

### Tooling Recommendations

- **Dependabot or Renovate**: Enable on the GitHub repo for automated PR creation on dependency updates. Renovate's `schedule: ["before 6am on Monday"]` would fit the overnight-improvement philosophy.
- **npm audit in CI**: Already present via `check:security` script — good.
- **License monitoring**: Consider `license-checker` as a one-off or CI check if dependencies grow significantly.

### Dependency Addition Policy (Suggested)

Before adding a new dependency, verify:
1. It's actively maintained (release within past 12 months)
2. It has a permissive license (MIT/ISC/BSD/Apache)
3. It doesn't duplicate existing functionality
4. The transitive dependency count is proportional to value added
5. It has adequate download numbers (>10K weekly for niche, >100K for infrastructure)
