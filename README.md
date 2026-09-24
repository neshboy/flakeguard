# FlakeGuard

**Stop letting flaky tests train your team to ignore CI.**

FlakeGuard tracks every test's real pass/fail history across CI runs, computes an
honest flake rate per test from that history, and generates a quarantine list so a
flaky test doesn't keep blocking every PR — while staying visible and tracked until
someone actually fixes it.

## Why

A test that fails 1 run in 5 for no code-related reason is a flaky test. Teams
routinely respond to flaky tests one of two ways, and both are bad:

- **Re-run until green.** Nobody gets alerted, the flake rate is never measured, and
  the test silently erodes trust in the whole test suite ("just re-run it, it's
  probably flaky" becomes the default reaction to *every* red CI run, including real
  bugs).
- **Skip it and forget it.** The test gets `.skip`'d in a moment of CI-rage and never
  revisited, so real coverage quietly disappears.

FlakeGuard gives you a third option: measure it. Ingest your JUnit XML report after
every CI run, and FlakeGuard builds a real historical record per test. Once a test's
flake rate crosses your threshold, `flakeguard quarantine` lists it explicitly (with
the number backing the decision) so you can wire your CI to soft-fail/skip *only*
that test — instead of guessing, or blocking merges on noise.

## What it does

- **Parses real JUnit XML reports** — the standard report format emitted by
  `vitest --reporter=junit`, `jest --reporters=jest-junit`, `pytest --junitxml`,
  `mocha --reporter mocha-junit-reporter`, and friends. Handles `<testsuites>` and
  bare `<testsuite>` roots, nested suites, and `<failure>`/`<error>`/`<skipped>`
  children.
- **Tracks history locally** in a small JSON file (`.flakeguard/history.json`) — one
  entry per test per ingested run, keyed by `(suite, name)`.
- **Computes a real flake rate**: for each test, over the most recent *N* runs
  (default window: 20, excluding skipped runs), find the dominant (most common)
  outcome, and divide the number of runs that *differ* from it by the window size.
- **Generates a quarantine list** (`flakeguard quarantine --threshold 0.1`) of every
  test whose flake rate exceeds the threshold, written as both JSON and plain text so
  you can consume it from a CI step.

## Install / Quick start

```bash
git clone <this-repo>
cd flakeguard
npm install
npm run build
npm link          # optional: makes the `flakeguard` command available globally
```

Or run it straight from source during development:

```bash
npm run dev -- report
```

### 1. Produce a JUnit XML report from your test runner

```bash
# vitest
vitest run --reporter=junit --outputFile=report.xml

# jest (with jest-junit installed)
jest --reporters=default --reporters=jest-junit

# pytest
pytest --junitxml=report.xml
```

### 2. Ingest it after every CI run

```bash
flakeguard ingest report.xml --run-id "$GITHUB_RUN_ID"
```

Commit `.flakeguard/history.json` back to the repo (or persist it as a CI cache/
artifact between runs) so history accumulates across builds.

### 3. Look at the report

```bash
flakeguard report
```

Example output, after ingesting 5 simulated CI runs of the same suite with no code
changes in between:

```
FlakeGuard report (window: last 20 non-skipped run(s) per test)
Runs ingested: 5  |  Tests tracked: 4

| SUITE        | TEST                        | RUNS | PASS | FAIL | SKIP | FLAKE RATE | STATUS |
|--------------|-----------------------------|------|------|------|------|------------|--------|
| math.spec.ts | handles concurrent requests |    5 |    3 |    2 |    0 |      40.0% | FLAKY  |
| math.spec.ts | adds two numbers            |    5 |    5 |    0 |    0 |       0.0% | stable |
| math.spec.ts | connects to database        |    5 |    0 |    5 |    0 |       0.0% | broken |
| math.spec.ts | renders skeleton loader     |    5 |    4 |    0 |    1 |       0.0% | stable |
```

Notice `connects to database` fails every single run — FlakeGuard correctly reports
it as **broken**, not flaky (its flake rate is 0%: it never disagrees with itself).
`handles concurrent requests` alternates pass/fail with no code change — that's the
one with a real 40% flake rate.

### 4. Generate the quarantine list

```bash
flakeguard quarantine --threshold 0.1
```

```
Quarantine threshold: flakeRate > 0.1 (window: last 20 non-skipped run(s) per test)
1 test(s) quarantined:
  - math.spec.ts > handles concurrent requests  (flake rate 40.0%)

Wrote .flakeguard/quarantine.txt
Wrote .flakeguard/quarantine.json
```

### 5. Wire it into a CI workflow

A minimal GitHub Actions job that ingests results every run and fails the build only
if a *newly* flaky test shows up as a hard failure (the actual skip/soft-fail wiring
into your test runner is project-specific — the important part is that FlakeGuard
gives you the list to act on):

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci

      - name: Run tests (JUnit output)
        run: npx vitest run --reporter=junit --outputFile=report.xml
        continue-on-error: true # let FlakeGuard see failing runs too

      - name: Track flake history
        run: |
          npx flakeguard ingest report.xml --run-id "${{ github.run_id }}"
          npx flakeguard quarantine --threshold 0.1

      # Example: read .flakeguard/quarantine.txt in your test runner config to
      # skip/soft-fail exactly those tests on the *next* run, so a known-flaky
      # test doesn't block this PR while still being tracked.
      - uses: actions/upload-artifact@v4
        with:
          name: flakeguard-history
          path: .flakeguard/
```

In practice you'd persist `.flakeguard/` between runs (commit it, or restore it from
a cache/artifact at job start) so history actually accumulates instead of resetting
every build.

## CLI reference

```
flakeguard ingest <report.xml> --run-id <id> [--force] [--store <path>]
flakeguard report [--window <n>] [--store <path>]
flakeguard quarantine --threshold <0-1> [--window <n>] [--store <path>] [--out-dir <dir>]
```

- `--run-id` should be something stable and unique per CI run (commit SHA, build
  number, `$GITHUB_RUN_ID`, etc). Re-ingesting the same `--run-id` is rejected unless
  you pass `--force`, to prevent accidentally double-counting a run.
- `--window` controls how many of the most recent (non-skipped) runs are considered
  when computing a test's flake rate. Defaults to 20.
- History is stored at `.flakeguard/history.json` by default.

## How the flake rate is actually computed

For each test, independently:

1. Take its most recent `--window` observations, excluding `skipped` runs (a test
   that gets skipped isn't evidence of pass or fail either way).
2. Find whichever outcome (`pass` or `fail`) is more common within that window — the
   *dominant outcome*. Ties break toward the most recent observation.
3. `flakeRate = (number of runs whose outcome differs from the dominant outcome) / (window size)`.

This is deliberately symmetric: a test that fails every run has flake rate 0 (it
never disagrees with itself — it's just broken), and a test that passes every run
also has flake rate 0 (it's stable). Only a test whose result actually *changes*
across runs, with no corresponding code change, accumulates a nonzero flake rate.

## Limitations (read this before trusting the numbers)

- **Flake detection needs history.** With 1–2 runs ingested, every test's flake rate
  is 0 by definition — there's nothing to disagree with yet. FlakeGuard doesn't try
  to guess flakiness from a single run's stack trace or timing; it's a purely
  statistical, historical measure. Ingest at least a handful of runs (a dozen-plus is
  better) before trusting the quarantine list.
- **A test that always fails is not flaky — it's broken, and FlakeGuard says so.**
  Because flake rate is "disagreement with your own dominant outcome," a test that
  fails 20/20 times has a flake rate of exactly 0. It shows up in `flakeguard report`
  with status `broken`, never `FLAKY`, and it will never appear in the quarantine
  list no matter how low you set `--threshold` (short of `0`, which would also catch
  every 100%-stable test, so don't do that). This is intentional: quarantining a
  consistently-broken test would hide a real bug, not a flake.
- **Test identity is `(suite, name)`.** If you rename a test or move it between
  files, FlakeGuard sees a brand-new test with no history, not a continuation of the
  old one.
- **No code-change correlation.** FlakeGuard doesn't look at git history or diffs —
  it can't tell "flaky" apart from "someone intentionally fixed a real bug between
  run 3 and run 4," which would also look like a change in outcome distribution. In
  practice, a test that legitimately went from broken to fixed will show fewer and
  fewer disagreements as more post-fix runs are ingested and age the old failures out
  of the window (see `--window`).
- **Single local JSON file, no concurrency control.** Concurrent `ingest` calls
  against the same store can race. Fine for a single CI runner ingesting
  sequentially; not meant for concurrent writers.

## Development

```bash
npm install
npm run typecheck
npm test           # builds, then runs the vitest suite (see test/)
npm run build
```

Tests use hand-written JUnit XML fixtures under `test/fixtures/` that simulate 5 CI
runs of one suite with no code changes between them, covering: an always-passing
test, an always-failing test, a genuinely alternating (flaky) test, and a test that's
skipped in one run. The suite asserts the computed flake rate for each case matches
the expected value exactly, and that `quarantine --threshold 0.1` selects only the
genuinely flaky one.

## License

MIT © FlakeGuard contributors
