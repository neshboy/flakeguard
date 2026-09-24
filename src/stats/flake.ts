import type { FlakeStats, TestObservation, TestOutcome, TestRecord } from "../types.js";

export const DEFAULT_WINDOW = 20;

/**
 * Compute real flake statistics for a single test from its recorded observations.
 *
 * Definition used (per FlakeGuard's spec): within the most recent `window` non-skipped
 * observations, find the dominant (most common) outcome. The flake rate is the fraction
 * of those observations whose outcome differs from the dominant one.
 *
 * This correctly distinguishes:
 *  - A test that always passes -> flakeRate 0 (stable).
 *  - A test that always fails -> flakeRate 0 (consistently broken, NOT flaky).
 *  - A test that sometimes passes and sometimes fails with no code change -> flakeRate > 0
 *    (genuinely flaky).
 */
export function computeFlakeStats(record: TestRecord, window: number = DEFAULT_WINDOW): FlakeStats {
  const totalRuns = record.observations.length;
  const skippedCount = record.observations.filter((o) => o.outcome === "skipped").length;

  const nonSkipped = record.observations.filter((o) => o.outcome !== "skipped");
  const windowObs: TestObservation[] = nonSkipped.slice(Math.max(0, nonSkipped.length - window));
  const windowRuns = windowObs.length;

  const passCount = windowObs.filter((o) => o.outcome === "pass").length;
  const failCount = windowObs.filter((o) => o.outcome === "fail").length;

  let dominantOutcome: TestOutcome | null = null;
  if (windowRuns > 0) {
    if (passCount > failCount) {
      dominantOutcome = "pass";
    } else if (failCount > passCount) {
      dominantOutcome = "fail";
    } else {
      // Exact tie: break using the most recent observation so a perfectly
      // alternating history doesn't produce an arbitrary/undefined dominant outcome.
      dominantOutcome = windowObs[windowObs.length - 1].outcome;
    }
  }

  const diffCount = dominantOutcome === null ? 0 : windowObs.filter((o) => o.outcome !== dominantOutcome).length;
  const flakeRate = windowRuns === 0 ? 0 : diffCount / windowRuns;

  return {
    suite: record.suite,
    name: record.name,
    totalRuns,
    windowRuns,
    passCount,
    failCount,
    skippedCount,
    dominantOutcome,
    flakeRate,
    isFlaky: diffCount > 0,
  };
}
