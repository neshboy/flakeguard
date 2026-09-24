import { XMLParser } from "fast-xml-parser";
import type { ParsedReport, ParsedTestCase, TestOutcome } from "../types.js";

/**
 * Real JUnit XML parser.
 *
 * JUnit XML (the format emitted by vitest/jest/mocha's `--reporter=junit`,
 * pytest's `--junitxml`, etc.) has this general shape:
 *
 *   <testsuites>
 *     <testsuite name="..." tests="3" failures="1">
 *       <testcase classname="..." name="..." time="0.012">
 *         <failure message="...">stack trace...</failure>
 *       </testcase>
 *       <testcase classname="..." name="..." time="0.003" />
 *       <testcase classname="..." name="..." time="0.001">
 *         <skipped/>
 *       </testcase>
 *     </testsuite>
 *   </testsuites>
 *
 * The root <testsuites> wrapper is optional -- some reporters emit a single
 * top-level <testsuite> instead. <testsuite> elements may also nest inside
 * one another. This parser handles both shapes.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (tagName) =>
    tagName === "testsuite" ||
    tagName === "testcase" ||
    tagName === "failure" ||
    tagName === "error" ||
    tagName === "skipped",
});

/** Minimal shape of the parsed XML tree we rely on -- everything else is ignored. */
interface RawNode {
  [key: string]: unknown;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function attr(node: RawNode, name: string): string | undefined {
  const value = node[`@_${name}`];
  return typeof value === "string" ? value : undefined;
}

function textContent(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "object") {
    const asRecord = value as RawNode;
    // fast-xml-parser puts mixed text content under "#text".
    const text = asRecord["#text"];
    if (typeof text === "string") return text.trim() || undefined;
  }
  return undefined;
}

function parseDuration(raw: string | undefined): number {
  if (!raw) return 0;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

function extractTestCasesFromSuite(suite: RawNode, inheritedSuiteName: string): ParsedTestCase[] {
  const suiteName = attr(suite, "name") ?? inheritedSuiteName;
  const cases: ParsedTestCase[] = [];

  for (const testcase of asArray(suite["testcase"] as RawNode | RawNode[] | undefined)) {
    const name = attr(testcase, "name") ?? "(unnamed test)";
    const classname = attr(testcase, "classname") ?? suiteName;
    const durationSeconds = parseDuration(attr(testcase, "time"));

    const failures = asArray(testcase["failure"] as RawNode | RawNode[] | undefined);
    const errors = asArray(testcase["error"] as RawNode | RawNode[] | undefined);
    const skipped = asArray(testcase["skipped"] as RawNode | RawNode[] | undefined);

    let outcome: TestOutcome = "pass";
    let message: string | undefined;

    if (failures.length > 0) {
      outcome = "fail";
      message = attr(failures[0], "message") ?? textContent(failures[0]);
    } else if (errors.length > 0) {
      outcome = "fail";
      message = attr(errors[0], "message") ?? textContent(errors[0]);
    } else if (skipped.length > 0) {
      outcome = "skipped";
      message = attr(skipped[0], "message") ?? textContent(skipped[0]);
    }

    cases.push({
      name,
      suite: classname,
      durationSeconds,
      outcome,
      message,
    });
  }

  // Recurse into nested <testsuite> elements (some reporters nest by file/describe block).
  for (const nested of asArray(suite["testsuite"] as RawNode | RawNode[] | undefined)) {
    cases.push(...extractTestCasesFromSuite(nested, suiteName));
  }

  return cases;
}

/**
 * Parse a JUnit XML report (as a string) into a flat list of test cases.
 * Throws if the input is not well-formed XML or contains no recognizable
 * <testsuite>/<testcase> structure.
 */
export function parseJUnitXml(xml: string): ParsedReport {
  if (!xml || !xml.trim()) {
    throw new Error("JUnit XML report is empty");
  }

  let root: RawNode;
  try {
    root = parser.parse(xml) as RawNode;
  } catch (err) {
    throw new Error(`Failed to parse JUnit XML: ${(err as Error).message}`);
  }

  const testCases: ParsedTestCase[] = [];

  const topLevelSuites = asArray(root["testsuites"] as RawNode | RawNode[] | undefined);
  if (topLevelSuites.length > 0) {
    for (const suitesWrapper of topLevelSuites) {
      for (const suite of asArray(suitesWrapper["testsuite"] as RawNode | RawNode[] | undefined)) {
        testCases.push(...extractTestCasesFromSuite(suite, "unknown-suite"));
      }
    }
  } else {
    // No <testsuites> wrapper -- look for top-level <testsuite> directly.
    for (const suite of asArray(root["testsuite"] as RawNode | RawNode[] | undefined)) {
      testCases.push(...extractTestCasesFromSuite(suite, "unknown-suite"));
    }
  }

  if (testCases.length === 0) {
    throw new Error(
      "No <testcase> elements found. Expected a JUnit XML report with <testsuite>/<testcase> elements."
    );
  }

  return { testCases };
}
