import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { DEFAULT_STORE_DIR, defaultStorePath, loadStore } from "../store/store.js";
import { DEFAULT_WINDOW, computeFlakeStats } from "../stats/flake.js";
import type { FlakeStats } from "../types.js";

export interface QuarantineCommandOptions {
  threshold: number;
  window?: number;
  storePath?: string;
  outDir?: string;
}

export interface QuarantineResult {
  quarantined: FlakeStats[];
  jsonPath: string;
  textPath: string;
}

export async function quarantineCommand(options: QuarantineCommandOptions): Promise<QuarantineResult> {
  if (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 1) {
    throw new Error(`--threshold must be a number between 0 and 1 (got ${options.threshold})`);
  }

  const storePath = options.storePath ?? defaultStorePath();
  const window = options.window ?? DEFAULT_WINDOW;
  const store = await loadStore(storePath);

  const allStats = Object.values(store.tests).map((record) => computeFlakeStats(record, window));

  const quarantined = allStats
    .filter((s) => s.flakeRate > options.threshold)
    .sort((a, b) => b.flakeRate - a.flakeRate || a.name.localeCompare(b.name));

  const outDir = options.outDir ?? path.join(process.cwd(), DEFAULT_STORE_DIR);
  await mkdir(outDir, { recursive: true });

  const jsonPath = path.join(outDir, "quarantine.json");
  const textPath = path.join(outDir, "quarantine.txt");

  const jsonPayload = {
    threshold: options.threshold,
    window,
    generatedAt: new Date().toISOString(),
    tests: quarantined.map((s) => ({
      suite: s.suite,
      name: s.name,
      flakeRate: s.flakeRate,
      passCount: s.passCount,
      failCount: s.failCount,
      windowRuns: s.windowRuns,
    })),
  };

  await writeFile(jsonPath, JSON.stringify(jsonPayload, null, 2) + "\n", "utf-8");
  await writeFile(
    textPath,
    quarantined.map((s) => `${s.suite} > ${s.name}`).join("\n") + (quarantined.length > 0 ? "\n" : ""),
    "utf-8"
  );

  console.log(
    `Quarantine threshold: flakeRate > ${options.threshold} (window: last ${window} non-skipped run(s) per test)`
  );
  if (quarantined.length === 0) {
    console.log("No tests exceed the threshold. Nothing to quarantine.");
  } else {
    console.log(`${quarantined.length} test(s) quarantined:`);
    for (const s of quarantined) {
      console.log(`  - ${s.suite} > ${s.name}  (flake rate ${(s.flakeRate * 100).toFixed(1)}%)`);
    }
  }
  console.log("");
  console.log(`Wrote ${textPath}`);
  console.log(`Wrote ${jsonPath}`);

  return { quarantined, jsonPath, textPath };
}
