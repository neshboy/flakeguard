import { defaultStorePath, loadStore } from "../store/store.js";
import { DEFAULT_WINDOW, computeFlakeStats } from "../stats/flake.js";
import { renderReportTable } from "../report/table.js";

export interface ReportCommandOptions {
  window?: number;
  storePath?: string;
}

export async function reportCommand(options: ReportCommandOptions = {}): Promise<void> {
  const storePath = options.storePath ?? defaultStorePath();
  const window = options.window ?? DEFAULT_WINDOW;
  const store = await loadStore(storePath);

  const stats = Object.values(store.tests)
    .map((record) => computeFlakeStats(record, window))
    .sort((a, b) => b.flakeRate - a.flakeRate || a.suite.localeCompare(b.suite) || a.name.localeCompare(b.name));

  console.log(`FlakeGuard report (window: last ${window} non-skipped run(s) per test)`);
  console.log(`Runs ingested: ${store.ingestedRunIds.length}  |  Tests tracked: ${stats.length}`);
  console.log("");
  console.log(renderReportTable(stats));
}
