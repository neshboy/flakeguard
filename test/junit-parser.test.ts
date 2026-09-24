import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseJUnitXml } from "../src/parser/junit.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function readFixture(name: string): Promise<string> {
  return readFile(path.join(fixturesDir, name), "utf-8");
}

describe("parseJUnitXml", () => {
  it("extracts name, suite, duration and pass status from a passing <testcase>", async () => {
    const xml = await readFixture("run-1.xml");
    const { testCases } = parseJUnitXml(xml);

    const addsTwoNumbers = testCases.find((t) => t.name === "adds two numbers");
    expect(addsTwoNumbers).toBeDefined();
    expect(addsTwoNumbers?.suite).toBe("math.spec.ts");
    expect(addsTwoNumbers?.durationSeconds).toBeCloseTo(0.004, 5);
    expect(addsTwoNumbers?.outcome).toBe("pass");
    expect(addsTwoNumbers?.message).toBeUndefined();
  });

  it("extracts <failure> children as a fail outcome with the message preserved", async () => {
    const xml = await readFixture("run-1.xml");
    const { testCases } = parseJUnitXml(xml);

    const db = testCases.find((t) => t.name === "connects to database");
    expect(db?.outcome).toBe("fail");
    expect(db?.message).toBe("Error: connection refused");
  });

  it("extracts <skipped/> children as a skipped outcome", async () => {
    const xml = await readFixture("run-3.xml");
    const { testCases } = parseJUnitXml(xml);

    const skeleton = testCases.find((t) => t.name === "renders skeleton loader");
    expect(skeleton?.outcome).toBe("skipped");
  });

  it("treats <error> the same as <failure> (both are non-passing)", () => {
    const xml = `<?xml version="1.0"?>
      <testsuite name="suite-a">
        <testcase classname="suite-a" name="throws unexpectedly" time="0.02">
          <error message="TypeError: boom">stack trace</error>
        </testcase>
      </testsuite>`;
    const { testCases } = parseJUnitXml(xml);
    expect(testCases).toHaveLength(1);
    expect(testCases[0].outcome).toBe("fail");
    expect(testCases[0].message).toBe("TypeError: boom");
  });

  it("handles a bare top-level <testsuite> with no <testsuites> wrapper", () => {
    const xml = `<?xml version="1.0"?>
      <testsuite name="bare-suite">
        <testcase classname="bare-suite" name="works standalone" time="0.01"/>
      </testsuite>`;
    const { testCases } = parseJUnitXml(xml);
    expect(testCases).toEqual([
      { name: "works standalone", suite: "bare-suite", durationSeconds: 0.01, outcome: "pass", message: undefined },
    ]);
  });

  it("handles nested <testsuite> elements", () => {
    const xml = `<?xml version="1.0"?>
      <testsuites>
        <testsuite name="outer">
          <testsuite name="inner">
            <testcase classname="inner" name="nested test" time="0.005"/>
          </testsuite>
        </testsuite>
      </testsuites>`;
    const { testCases } = parseJUnitXml(xml);
    expect(testCases).toHaveLength(1);
    expect(testCases[0].name).toBe("nested test");
    expect(testCases[0].suite).toBe("inner");
  });

  it("throws on empty input", () => {
    expect(() => parseJUnitXml("")).toThrow(/empty/i);
  });

  it("throws when there are no <testcase> elements", () => {
    expect(() => parseJUnitXml("<testsuites><testsuite name=\"x\"></testsuite></testsuites>")).toThrow(
      /No <testcase>/
    );
  });

  it("throws on malformed XML", () => {
    expect(() => parseJUnitXml("<testsuite><testcase name=\"unterminated\"")).toThrow();
  });
});
