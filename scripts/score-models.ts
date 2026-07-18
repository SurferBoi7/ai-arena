// =============================================================================
// scripts/score-models.ts — Re-score the committed baseline data.
// Applies vendor-verified flagship baselines + the reality-corrected scoring
// engine, then writes models.json / feed.json / meta.json.
//   npm run score
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Model } from "../src/types";
import { applyVendorBaselines, finalize } from "./lib/pipeline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../public/data");

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, file), "utf-8")) as T;
}
function writeJson(file: string, data: unknown) {
  writeFileSync(resolve(DATA_DIR, file), JSON.stringify(data, null, 1) + "\n", "utf-8");
}

function main() {
  const models = readJson<Model[]>("models.json");
  console.log(`Loaded ${models.length} models from data/models.json`);

  const { filled, notes } = applyVendorBaselines(models);
  for (const n of notes) console.log(n);
  if (filled) console.log(`Vendor baselines filled ${filled} gap(s).`);

  const { models: sorted, feed, meta } = finalize(models);

  writeJson("models.json", sorted);
  writeJson("feed.json", feed);
  writeJson("meta.json", meta);

  console.log("\n=== Top 12 ===");
  sorted.slice(0, 12).forEach((m, i) =>
    console.log(
      `${(i + 1).toString().padStart(2)}. ${m.ultimateScore.toFixed(1).padStart(5)}  ${m.name.padEnd(34)} bc=${m.benchmarkCount} tier=${m.tier} status=${m.scoreStatus}`,
    ),
  );
  console.log("\n=== Bottom 3 (imputed / no-data) ===");
  sorted.slice(-3).forEach((m, i) =>
    console.log(
      `${(sorted.length - 2 + i).toString().padStart(2)}. ${m.ultimateScore.toFixed(1).padStart(5)}  ${m.name.padEnd(34)} status=${m.scoreStatus}`,
    ),
  );
  console.log(`\nWrote models.json, feed.json, meta.json to ${DATA_DIR}`);
}

main();
