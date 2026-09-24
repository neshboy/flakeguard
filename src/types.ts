/** Outcome of a single test case in a single CI run. */
export type TestOutcome = "pass" | "fail" | "skipped";

/** A single `<testcase>` extracted from a JUnit XML report. */
export interface ParsedTestCase {
  /** Test case name, e.g. "adds two numbers". */
  name: string;
  /** Suite / classname the test case belongs to, e.g. "math.spec.ts > add()". */
  suite: string;
  /** Duration in seconds, as reported by the `time` attribute. */
  durationSeconds: number;
  /** Pass/fail/skipped outcome for this run. */
  outcome: TestOutcome;
  /** Failure/error message, if any (undefined when outcome is "pass" or "skipped"). */
  message?: string;
}

/** Result of parsing an entire JUnit XML report (which may contain multiple <testsuite> blocks). */
export interface ParsedReport {
  testCases: ParsedTestCase[];
}

/** A stable identity for a test, independent of the run it appeared in. */
export interface TestId {
  suite: string;
  name: string;
}

/** One recorded observation of a test's outcome during a specific CI run. */
export interface TestObservation {
  runId: string;
  /** ISO-8601 timestamp of when the observation was ingested. */
  timestamp: string;
  outcome: TestOutcome;
  durationSeconds: number;
}

/** Persisted history for a single test across all ingested runs. */
export interface TestRecord {
  suite: string;
  name: string;
  observations: TestObservation[];
}

/** Top-level shape of the on-disk history store. */
export interface HistoryStore {
  /** Schema version, for forward compatibility. */
  version: 1;
  /** Run IDs that have already been ingested (guards against double-ingest). */
  ingestedRunIds: string[];
  /** Map of "suite\u0000name" -> TestRecord. */
  tests: Record<string, TestRecord>;
}

/** Computed flake statistics for one test over a given window of runs. */
export interface FlakeStats {
  suite: string;
  name: string;
  totalRuns: number;
  /** Runs considered in the flake-rate window (most recent N, excluding skipped). */
  windowRuns: number;
  passCount: number;
  failCount: number;
  skippedCount: number;
  /** The most frequent non-skipped outcome within the window. */
  dominantOutcome: TestOutcome | null;
  /** (# runs in window whose outcome differs from dominantOutcome) / windowRuns. */
  flakeRate: number;
  /** True if the test has flipped outcome at least once in the window. */
  isFlaky: boolean;
}
