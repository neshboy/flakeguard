import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { HistoryStore, ParsedReport, TestRecord } from "../types.js";

export const DEFAULT_STORE_DIR = ".flakeguard";
export const DEFAULT_STORE_FILE = "history.json";

/**
 * Maximum number of observations retained per test. Stats only ever look at the most
 * recent `--window` (default 20) entries, so this cap is generously above any realistic
 * window while keeping the committed history file/diff size bounded for long-lived projects.
 */
export const MAX_OBSERVATIONS_PER_TEST = 500;

export function defaultStorePath(cwd: string = process.cwd()): string {
  return path.join(cwd, DEFAULT_STORE_DIR, DEFAULT_STORE_FILE);
}

export function testKey(suite: string, name: string): string {
  return `${suite}\u0000${name}`;
}

export function emptyStore(): HistoryStore {
  return { version: 1, ingestedRunIds: [], tests: {} };
}

export async function loadStore(storePath: string): Promise<HistoryStore> {
  if (!existsSync(storePath)) {
    return emptyStore();
  }
  const raw = await readFile(storePath, "utf-8");
  if (!raw.trim()) {
    return emptyStore();
  }
  const parsed = JSON.parse(raw) as HistoryStore;
  if (parsed.version !== 1) {
    throw new Error(`Unsupported FlakeGuard store version: ${String((parsed as { version?: unknown }).version)}`);
  }
  return parsed;
}

export async function saveStore(storePath: string, store: HistoryStore): Promise<void> {
  await mkdir(path.dirname(storePath), { recursive: true });
  const tmpPath = `${storePath}.tmp-${process.pid}`;
  await writeFile(tmpPath, JSON.stringify(store, null, 2) + "\n", "utf-8");
  await rename(tmpPath, storePath);
}

export interface IngestOptions {
  runId: string;
  timestamp?: string;
  force?: boolean;
}

export interface IngestResult {
  runId: string;
  testCasesIngested: number;
  newTestsSeen: number;
}

/**
 * Append one CI run's test results to the history store, mutating `store` in place.
 * Throws if `runId` has already been ingested, unless `force` is set (in which case
 * the previous observations for that runId are replaced).
 */
export function ingestReport(store: HistoryStore, parsed: ParsedReport, options: IngestOptions): IngestResult {
  const { runId, force } = options;
  const timestamp = options.timestamp ?? new Date().toISOString();

  const alreadyIngested = store.ingestedRunIds.includes(runId);
  if (alreadyIngested && !force) {
    throw new Error(
      `Run "${runId}" was already ingested. Use --force to re-ingest and overwrite its recorded observations.`
    );
  }

  if (alreadyIngested && force) {
    // Remove any prior observations tagged with this runId before re-adding.
    for (const record of Object.values(store.tests)) {
      record.observations = record.observations.filter((o) => o.runId !== runId);
    }
  } else {
    store.ingestedRunIds.push(runId);
  }

  let newTestsSeen = 0;

  for (const testCase of parsed.testCases) {
    const key = testKey(testCase.suite, testCase.name);
    let record: TestRecord | undefined = store.tests[key];
    if (!record) {
      record = { suite: testCase.suite, name: testCase.name, observations: [] };
      store.tests[key] = record;
      newTestsSeen++;
    }
    record.observations.push({
      runId,
      timestamp,
      outcome: testCase.outcome,
      durationSeconds: testCase.durationSeconds,
    });

    if (record.observations.length > MAX_OBSERVATIONS_PER_TEST) {
      record.observations = record.observations.slice(record.observations.length - MAX_OBSERVATIONS_PER_TEST);
    }
  }

  return {
    runId,
    testCasesIngested: parsed.testCases.length,
    newTestsSeen,
  };
}
