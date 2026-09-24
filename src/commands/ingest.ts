import { readFile } from "node:fs/promises";
import { parseJUnitXml } from "../parser/junit.js";
import { defaultStorePath, ingestReport, loadStore, saveStore } from "../store/store.js";

export interface IngestCommandOptions {
  runId: string;
  force?: boolean;
  storePath?: string;
}

export async function ingestCommand(reportPath: string, options: IngestCommandOptions): Promise<void> {
  const xml = await readFile(reportPath, "utf-8");
  const parsed = parseJUnitXml(xml);

  const storePath = options.storePath ?? defaultStorePath();
  const store = await loadStore(storePath);

  const result = ingestReport(store, parsed, { runId: options.runId, force: options.force });

  await saveStore(storePath, store);

  console.log(
    `Ingested run "${result.runId}": ${result.testCasesIngested} test case(s)` +
      (result.newTestsSeen > 0 ? ` (${result.newTestsSeen} new test(s) tracked for the first time)` : "") +
      `.`
  );
  console.log(`History store: ${storePath}`);
}
