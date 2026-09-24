import { describe, expect, it } from "vitest";
import { renderReportTable } from "../src/report/table.js";
import type { FlakeStats } from "../src/types.js";

function stats(overrides: Partial<FlakeStats>): FlakeStats {
  return {
    suite: "s",
    name: "n",
    totalRuns: 5,
    windowRuns: 5,
    passCount: 5,
    failCount: 0,
    skippedCount: 0,
    dominantOutcome: "pass",
    flakeRate: 0,
    isFlaky: false,
    ...overrides,
  };
}

describe("renderReportTable", () => {
  it("prints a helpful message when there is no tracked data", () => {
    expect(renderReportTable([])).toMatch(/No tests tracked yet/);
  });

  it("labels a flaky test as FLAKY and shows its flake rate as a percentage", () => {
    const table = renderReportTable([
      stats({ name: "handles concurrent requests", passCount: 3, failCount: 2, flakeRate: 0.4, isFlaky: true }),
    ]);
    expect(table).toContain("handles concurrent requests");
    expect(table).toContain("40.0%");
    expect(table).toContain("FLAKY");
  });

  it("labels a consistently-failing test as broken, not flaky", () => {
    const table = renderReportTable([
      stats({ name: "connects to database", passCount: 0, failCount: 5, dominantOutcome: "fail", flakeRate: 0 }),
    ]);
    expect(table).toContain("broken");
    expect(table).not.toContain("FLAKY");
  });

  it("labels a consistently-passing test as stable", () => {
    const table = renderReportTable([stats({ name: "adds two numbers" })]);
    expect(table).toContain("stable");
  });
});
