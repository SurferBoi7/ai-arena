// =============================================================================
// scripts/validate-ranks.ts
// Reality Check: asserts the leaderboard satisfies the correction guarantees.
//   1. Named flagships (Fable, Mythos, Opus) appear in the TOP tier.
//   2. Imputed / no-data models sink to the bottom (never above flagships).
//   3. No lightweight outranks an established flagship unless it sweeps the
//      hardest benchmarks (SWE-bench >= 70 AND HLE >= 40).
// Exit code 0 = pass, 1 = fail. Used in CI (GitHub Actions) before deploy.
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Model } from "../src/types";
import { compareModels } from "../src/lib/scoring";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../public/data");
const models: Model[] = JSON.parse(
  readFileSync(resolve(DATA_DIR, "models.json"), "utf-8"),
);

// models.json is stored sorted by the canonical comparator (flagships first).
const ranked = [...models].sort(compareModels);

const NAME = (m: Model) => m.name.toLowerCase();
const isNamedFlagship = (m: Model) => /fable|mythos|opus/.test(NAME(m));
const isImputed = (m: Model) => m.scoreStatus === "imputed" || m.benchmarkCount === 0;

const TOP_N = 12;
const failures: string[] = [];

// 1. Flagships in top tier. Fable/Mythos must be present; at least one Opus.
const hasFable = ranked.slice(0, TOP_N).some((m) => /fable/.test(NAME(m)));
const hasMythos = ranked.slice(0, TOP_N).some((m) => /mythos/.test(NAME(m)));
const hasOpus = ranked.slice(0, TOP_N).some((m) => /opus/.test(NAME(m)));
if (!hasFable) failures.push(`Fable not in top ${TOP_N}.`);
if (!hasMythos) failures.push(`Mythos not in top ${TOP_N}.`);
if (!hasOpus) failures.push(`Opus not in top ${TOP_N}.`);

// 2. No imputed/no-data model above the top flagship.
const topFlagshipScore = Math.max(
  ...ranked.filter(isNamedFlagship).map((m) => m.ultimateScore),
);
const imputedAboveFlagship = ranked.filter(
  (m) => isImputed(m) && m.ultimateScore > topFlagshipScore,
);
if (imputedAboveFlagship.length) {
  failures.push(
    `Imputed/no-data models above top flagship (${topFlagshipScore}): ${imputedAboveFlagship
      .map((m) => `${m.name}=${m.ultimateScore}`)
      .join(", ")}`,
  );
}

// 3. No lightweight outranks an established flagship unless it sweeps the
//    hardest benchmarks. Established = flagship tier with >= 2 verified
//    benchmarks (excludes no-data "flagship" SKUs scored at the floor).
const establishedFlagshipFloor = Math.min(
  ...ranked
    .filter((m) => m.tier === "flagship" && m.benchmarkCount >= 2)
    .map((m) => m.ultimateScore),
);
for (const m of ranked) {
  if (m.tier === "lightweight" && m.ultimateScore > establishedFlagshipFloor) {
    const swept =
      (m.benchmarks.swe_bench ?? 0) >= 70 && (m.benchmarks.hle ?? 0) >= 40;
    if (!swept) {
      failures.push(
        `Lightweight ${m.name} (${m.ultimateScore}) surpasses the established flagship floor (${establishedFlagshipFloor}) without sweeping the hardest benchmarks.`,
      );
    }
  }
}

console.log("=== Reality Check ===");
console.log(`Top ${TOP_N}:`);
ranked.slice(0, TOP_N).forEach((m, i) =>
  console.log(
    `  ${(i + 1).toString().padStart(2)}. ${m.ultimateScore.toFixed(1).padStart(5)}  ${m.name}`,
  ),
);
console.log(`\nTop flagship score: ${topFlagshipScore}`);
console.log(`Established flagship floor: ${establishedFlagshipFloor}`);

if (failures.length) {
  console.error("\nFAILED:");
  failures.forEach((f) => console.error("  - " + f));
  process.exit(1);
}
console.log("\nPASS: flagships at top, no missing-data reward, intelligence ceiling enforced.");
process.exit(0);
