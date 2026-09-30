#!/usr/bin/env node
import { Command } from "commander";
import { ingestCommand } from "./commands/ingest.js";
import { reportCommand } from "./commands/report.js";
import { quarantineCommand } from "./commands/quarantine.js";
import { DEFAULT_WINDOW } from "./stats/flake.js";

const program = new Command();

function parseWindowOption(value: string): number {
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--window must be an integer >= 1 (got "${value}")`);
  }
  return parsed;
}

program
  .name("flakeguard")
  .description(
    "Track per-test pass/fail history across CI runs, compute real flake rates, and quarantine statistically flaky tests."
  )
  .version("0.1.0");

program
  .command("ingest")
  .description("Ingest a JUnit XML test report from one CI run into the history store.")
  .argument("<report>", "path to a JUnit XML report file")
  .requiredOption("--run-id <id>", "unique identifier for this CI run (e.g. commit SHA or build number)")
  .option("--force", "re-ingest and overwrite observations for a run-id that was already ingested")
  .option("--store <path>", "path to the FlakeGuard history JSON file (default: .flakeguard/history.json)")
  .action(async (report: string, opts: { runId: string; force?: boolean; store?: string }) => {
    await ingestCommand(report, { runId: opts.runId, force: opts.force, storePath: opts.store });
  });

program
  .command("report")
  .description("Show every tracked test's pass/fail/flake history as a table.")
  .option("--window <n>", `number of most recent runs to consider per test (default: ${DEFAULT_WINDOW})`, parseWindowOption)
  .option("--store <path>", "path to the FlakeGuard history JSON file (default: .flakeguard/history.json)")
  .action(async (opts: { window?: number; store?: string }) => {
    await reportCommand({ window: opts.window, storePath: opts.store });
  });

program
  .command("quarantine")
  .description("Generate a quarantine list of tests whose flake rate exceeds a threshold.")
  .requiredOption("--threshold <rate>", "flake-rate threshold between 0 and 1, e.g. 0.1 for 10%", (v) =>
    parseFloat(v)
  )
  .option("--window <n>", `number of most recent runs to consider per test (default: ${DEFAULT_WINDOW})`, parseWindowOption)
  .option("--store <path>", "path to the FlakeGuard history JSON file (default: .flakeguard/history.json)")
  .option("--out-dir <dir>", "directory to write quarantine.json/quarantine.txt into (default: .flakeguard/)")
  .action(async (opts: { threshold: number; window?: number; store?: string; outDir?: string }) => {
    await quarantineCommand({
      threshold: opts.threshold,
      window: opts.window,
      storePath: opts.store,
      outDir: opts.outDir,
    });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`flakeguard: ${message}`);
  process.exitCode = 1;
});
