import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseJUnitXml } from "../src/parser/junit.js";
import { emptyStore, ingestReport, testKey } from "../src/store/store.js";
import { computeFlakeStats } from "../src/stats/flake.js";
import type { HistoryStore } from "../src/types.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/**
 * Ingests 5 hand-written JUnit XML fixtures representing 5 simulated CI runs of the
 * same test suite, with no code changes between them. The suite intentionally contains:
 *   - "adds two numbers"           -> passes in every run (stable)
 *   - "connects to database"       -> fails in every run (consistently broken, NOT flaky)
 *   - "handles concurrent requests"-> alternates pass/fail across runs (genuinely flaky)
 *   - "renders skeleton loader"    -> passes except one run where it's skipped
 */
async function buildFixtureStore(): Promise<HistoryStore> {
  const store = emptyStore();
  for (let i = 1; i <= 5; i++) {
    const xml = await readFile(path.join(fixturesDir, `run-${i}.xml`), "utf-8");
    const parsed = parseJUnitXml(xml);
    ingestReport(store, parsed, { runId: `run-${i}`, timestamp: `2026-01-0${i}T00:00:00.000Z` });
  }
  return store;
}

describe("computeFlakeStats over 5 simulated CI runs", () => {
  it("gives a stable test a flake rate of exactly 0", async () => {
    const store = await buildFixtureStore();
    const record = store.tests[testKey("math.spec.ts", "adds two numbers")];
    const stats = computeFlakeStats(record, 20);

    expect(stats.totalRuns).toBe(5);
    expect(stats.windowRuns).toBe(5);
    expect(stats.passCount).toBe(5);
    expect(stats.failCount).toBe(0);
    expect(stats.dominantOutcome).toBe("pass");
    expect(stats.flakeRate).toBe(0);
    expect(stats.isFlaky).toBe(false);
  });

  it("gives a consistently-failing test a flake rate of exactly 0 (broken, not flaky)", async () => {
    const store = await buildFixtureStore();
    const record = store.tests[testKey("math.spec.ts", "connects to database")];
    const stats = computeFlakeStats(record, 20);

    expect(stats.totalRuns).toBe(5);
    expect(stats.passCount).toBe(0);
    expect(stats.failCount).toBe(5);
    expect(stats.dominantOutcome).toBe("fail");
    expect(stats.flakeRate).toBe(0);
    expect(stats.isFlaky).toBe(false);
  });

  it("gives a test that alternates pass/fail a flake rate of exactly 0.4 (2 of 5 runs differ)", async () => {
    const store = await buildFixtureStore();
    const record = store.tests[testKey("math.spec.ts", "handles concurrent requests")];
    const stats = computeFlakeStats(record, 20);

    // pass, fail, pass, fail, pass -> dominant = pass (3), 2 runs differ -> 2/5 = 0.4
    expect(stats.totalRuns).toBe(5);
    expect(stats.passCount).toBe(3);
    expect(stats.failCount).toBe(2);
    expect(stats.dominantOutcome).toBe("pass");
    expect(stats.flakeRate).toBeCloseTo(0.4, 10);
    expect(stats.isFlaky).toBe(true);
  });

  it("excludes skipped runs from the flake-rate window but still counts them in totalRuns", async () => {
    const store = await buildFixtureStore();
    const record = store.tests[testKey("math.spec.ts", "renders skeleton loader")];
    const stats = computeFlakeStats(record, 20);

    expect(stats.totalRuns).toBe(5);
    expect(stats.skippedCount).toBe(1);
    expect(stats.windowRuns).toBe(4); // 5 runs minus the 1 skipped
    expect(stats.passCount).toBe(4);
    expect(stats.failCount).toBe(0);
    expect(stats.flakeRate).toBe(0);
  });

  it("only considers the most recent N runs when window is smaller than history", async () => {
    const store = await buildFixtureStore();
    const record = store.tests[testKey("math.spec.ts", "handles concurrent requests")];

    // Last 2 runs of that test are: fail (run-4), pass (run-5) -> 1 differs from dominant -> 0.5
    const stats = computeFlakeStats(record, 2);
    expect(stats.windowRuns).toBe(2);
    expect(stats.flakeRate).toBeCloseTo(0.5, 10);
  });
});
