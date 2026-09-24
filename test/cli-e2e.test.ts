import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const execFileAsync = promisify(execFile);

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "dist", "cli.js");
const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function runCli(args: string[], cwd: string) {
  return execFileAsync(process.execPath, [cliPath, ...args], { cwd });
}

describe("flakeguard CLI (end-to-end against the built dist/cli.js)", () => {
  let dir: string;

  beforeAll(async () => {
    if (!existsSync(cliPath)) {
      throw new Error(`${cliPath} does not exist. Run "npm run build" before running this test suite.`);
    }
    dir = await mkdtemp(path.join(tmpdir(), "flakeguard-cli-e2e-"));
    await cp(fixturesDir, path.join(dir, "fixtures"), { recursive: true });
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("ingests 5 runs, then reports and quarantines correctly through the real CLI", async () => {
    for (let i = 1; i <= 5; i++) {
      const { stdout } = await runCli(
        ["ingest", path.join("fixtures", `run-${i}.xml`), "--run-id", `run-${i}`],
        dir
      );
      expect(stdout).toContain(`Ingested run "run-${i}"`);
    }

    const { stdout: reportOut } = await runCli(["report"], dir);
    expect(reportOut).toContain("adds two numbers");
    expect(reportOut).toContain("handles concurrent requests");
    expect(reportOut).toContain("FLAKY");
    expect(reportOut).toContain("broken");
    expect(reportOut).toContain("stable");

    const { stdout: quarantineOut } = await runCli(["quarantine", "--threshold", "0.1"], dir);
    expect(quarantineOut).toContain("handles concurrent requests");
    expect(quarantineOut).not.toContain("adds two numbers");

    const quarantineTxt = path.join(dir, ".flakeguard", "quarantine.txt");
    expect(existsSync(quarantineTxt)).toBe(true);
  });

  it("refuses to double-ingest the same --run-id without --force", async () => {
    const freshDir = await mkdtemp(path.join(tmpdir(), "flakeguard-cli-e2e-dup-"));
    try {
      await cp(fixturesDir, path.join(freshDir, "fixtures"), { recursive: true });
      await runCli(["ingest", path.join("fixtures", "run-1.xml"), "--run-id", "dup"], freshDir);
      await expect(runCli(["ingest", path.join("fixtures", "run-1.xml"), "--run-id", "dup"], freshDir)).rejects.toThrow();
    } finally {
      await rm(freshDir, { recursive: true, force: true });
    }
  });
});
