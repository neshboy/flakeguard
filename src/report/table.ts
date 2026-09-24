import type { FlakeStats } from "../types.js";

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function padStart(value: string, width: number): string {
  return value.length >= width ? value : " ".repeat(width - value.length) + value;
}

function statusFor(stats: FlakeStats): string {
  if (stats.windowRuns === 0) return "no data";
  if (stats.flakeRate > 0) return "FLAKY";
  if (stats.dominantOutcome === "fail") return "broken";
  return "stable";
}

export interface RenderReportOptions {
  /** Flake rate strictly above this value is highlighted as quarantine-worthy. */
  threshold?: number;
}

/**
 * Render a compact terminal table of every tracked test's pass/fail/flake history.
 * Deterministic column widths, no external table-drawing dependency.
 */
export function renderReportTable(rows: FlakeStats[], options: RenderReportOptions = {}): string {
  if (rows.length === 0) {
    return "No tests tracked yet. Run `flakeguard ingest <report.xml> --run-id <id>` first.";
  }

  const headers = ["SUITE", "TEST", "RUNS", "PASS", "FAIL", "SKIP", "FLAKE RATE", "STATUS"];
  const dataRows = rows.map((r) => [
    r.suite,
    r.name,
    String(r.totalRuns),
    String(r.passCount),
    String(r.failCount),
    String(r.skippedCount),
    `${(r.flakeRate * 100).toFixed(1)}%`,
    statusFor(r),
  ]);

  const widths = headers.map((h, i) => Math.max(h.length, ...dataRows.map((row) => row[i].length)));

  const renderRow = (cells: string[]): string =>
    "| " +
    cells
      .map((cell, i) => (i === 2 || i === 3 || i === 4 || i === 5 || i === 6 ? padStart(cell, widths[i]) : pad(cell, widths[i])))
      .join(" | ") +
    " |";

  const separator = "|" + widths.map((w) => "-".repeat(w + 2)).join("|") + "|";

  const lines = [renderRow(headers), separator, ...dataRows.map((row) => renderRow(row))];
  return lines.join("\n");
}
