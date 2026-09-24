import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { emptyStore, ingestReport, loadStore, saveStore, testKey } from "../src/store/store.js";
import type { ParsedReport } from "../src/types.js";

const passingReport: ParsedReport = {
  testCases: [{ name: "t1", suite: "s", durationSeconds: 0.01, outcome: "pass" }],
};

const failingReport: ParsedReport = {
  testCases: [{ name: "t1", suite: "s", durationSeconds: 0.01, outcome: "fail", message: "boom" }],
};

describe("ingestReport", () => {
  it("appends a new observation per test case and tracks the run id", () => {
    const store = emptyStore();
    const result = ingestReport(store, passingReport, { runId: "run-1", timestamp: "2026-01-01T00:00:00.000Z" });

    expect(result.testCasesIngested).toBe(1);
    expect(result.newTestsSeen).toBe(1);
    expect(store.ingestedRunIds).toEqual(["run-1"]);

    const record = store.tests[testKey("s", "t1")];
    expect(record.observations).toHaveLength(1);
    expect(record.observations[0]).toEqual({
      runId: "run-1",
      timestamp: "2026-01-01T00:00:00.000Z",
      outcome: "pass",
      durationSeconds: 0.01,
    });
  });

  it("accumulates observations across multiple ingests for the same test", () => {
    const store = emptyStore();
    ingestReport(store, passingReport, { runId: "run-1", timestamp: "t1" });
    ingestReport(store, failingReport, { runId: "run-2", timestamp: "t2" });

    const record = store.tests[testKey("s", "t1")];
    expect(record.observations.map((o) => o.outcome)).toEqual(["pass", "fail"]);
  });

  it("refuses to re-ingest a run id that was already ingested", () => {
    const store = emptyStore();
    ingestReport(store, passingReport, { runId: "run-1" });
    expect(() => ingestReport(store, passingReport, { runId: "run-1" })).toThrow(/already ingested/);
  });

  it("allows overwriting a previously ingested run id with --force", () => {
    const store = emptyStore();
    ingestReport(store, passingReport, { runId: "run-1" });
    ingestReport(store, failingReport, { runId: "run-1", force: true });

    const record = store.tests[testKey("s", "t1")];
    // Force re-ingest should replace, not duplicate, the run-1 observation.
    expect(record.observations).toHaveLength(1);
    expect(record.observations[0].outcome).toBe("fail");
    expect(store.ingestedRunIds).toEqual(["run-1"]);
  });
});

describe("loadStore / saveStore", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "flakeguard-store-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an empty store when the file does not exist yet", async () => {
    const store = await loadStore(path.join(dir, "nope", "history.json"));
    expect(store).toEqual(emptyStore());
  });

  it("round-trips a store through save then load", async () => {
    const store = emptyStore();
    ingestReport(store, passingReport, { runId: "run-1", timestamp: "t1" });

    const storePath = path.join(dir, ".flakeguard", "history.json");
    await saveStore(storePath, store);

    const loaded = await loadStore(storePath);
    expect(loaded).toEqual(store);
  });
});
