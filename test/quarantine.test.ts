import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseJUnitXml } from "../src/parser/junit.js";
import { emptyStore, ingestReport, saveStore } from "../src/store/store.js";
import { quarantineCommand } from "../src/commands/quarantine.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("quarantineCommand", () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "flakeguard-quarantine-test-"));
    storePath = path.join(dir, "history.json");

    const store = emptyStore();
    for (let i = 1; i <= 5; i++) {
      const xml = await readFile(path.join(fixturesDir, `run-${i}.xml`), "utf-8");
      const parsed = parseJUnitXml(xml);
      ingestReport(store, parsed, { runId: `run-${i}` });
    }
    await saveStore(storePath, store);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("quarantines only the genuinely flaky test at threshold 0.1", async () => {
    const result = await quarantineCommand({
      threshold: 0.1,
      storePath,
      outDir: path.join(dir, "out"),
    });

    expect(result.quarantined.map((t) => t.name)).toEqual(["handles concurrent requests"]);
    // The always-passing, always-failing, and mostly-passing-with-a-skip tests must NOT appear.
    expect(result.quarantined.map((t) => t.name)).not.toContain("adds two numbers");
    expect(result.quarantined.map((t) => t.name)).not.toContain("connects to database");
    expect(result.quarantined.map((t) => t.name)).not.toContain("renders skeleton loader");
  });

  it("writes both a JSON and a plain-text quarantine list to disk", async () => {
    const result = await quarantineCommand({
      threshold: 0.1,
      storePath,
      outDir: path.join(dir, "out"),
    });

    const text = await readFile(result.textPath, "utf-8");
    expect(text.trim()).toBe("math.spec.ts > handles concurrent requests");

    const json = JSON.parse(await readFile(result.jsonPath, "utf-8"));
    expect(json.threshold).toBe(0.1);
    expect(json.tests).toHaveLength(1);
    expect(json.tests[0].name).toBe("handles concurrent requests");
    expect(json.tests[0].flakeRate).toBeCloseTo(0.4, 10);
  });

  it("quarantines nothing when the threshold is above every test's flake rate", async () => {
    const result = await quarantineCommand({
      threshold: 0.9,
      storePath,
      outDir: path.join(dir, "out2"),
    });
    expect(result.quarantined).toHaveLength(0);
  });

  it("rejects an out-of-range threshold", async () => {
    await expect(
      quarantineCommand({ threshold: 1.5, storePath, outDir: path.join(dir, "out3") })
    ).rejects.toThrow(/between 0 and 1/);
  });
});
