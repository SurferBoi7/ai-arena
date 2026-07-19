// =============================================================================
// scripts/update-data.ts — Scrape + re-score pipeline (GitHub Actions entry).
//
// 1. Load the committed baseline data (curated frontier set + vendor notes).
// 2. Best-effort: refresh open-weight model discovery from the public
//    HuggingFace Hub API (no key, free). New popular open models are added
//    with null benchmarks — they score at the floor until real benchmark data
//    arrives, exactly per the "if real data comes in, score them properly" rule.
// 3. Apply vendor-verified flagship baselines + the reality-corrected scoring.
// 4. Write models.json / feed.json / meta.json.
//
// This script NEVER fails the build on a scraping hiccup — if the network or
// the API is unavailable, it re-scores the committed baseline and continues.
//   npm run update-data
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Model } from "../src/types";
import { applyVendorBaselines, finalize } from "./lib/pipeline";
import { extractBenchmarks } from "./lib/extract-benchmarks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../public/data");

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, file), "utf-8")) as T;
}
function writeJson(file: string, data: unknown) {
  writeFileSync(resolve(DATA_DIR, file), JSON.stringify(data, null, 1) + "\n", "utf-8");
}

// ---------------------------------------------------------------------------
// HuggingFace Hub discovery (best-effort, free, no key).
// ---------------------------------------------------------------------------

interface HFModel {
  id: string;
  downloads?: number;
  pipeline_tag?: string;
  tags?: string[];
  lastModified?: string;
}

async function fetchHuggingFaceTrending(): Promise<HFModel[]> {
  // Public, unauthenticated endpoint. Sort by downloads, take a small popular set.
  const url =
    "https://huggingface.co/api/models?sort=downloads&direction=-1&limit=40&full=false";
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HF API ${res.status}`);
  return (await res.json()) as HFModel[];
}

function mergeOpenModels(existing: Model[], hf: HFModel[]): { added: number; models: Model[] } {
  const now = new Date().toISOString();
  const byId = new Set(existing.map((m) => m.id));
  let added = 0;
  for (const h of hf) {
    const id = `hf:${h.id}`;
    if (byId.has(id)) continue;
    // Only include genuinely popular text models to avoid flooding the board
    // with unbenchmarked noise.
    if ((h.downloads ?? 0) < 250000) continue;
    const tags = h.tags || [];
    const isText =
      tags.includes("text-generation") ||
      tags.includes("text2text-generation") ||
      h.pipeline_tag === "text-generation";
    if (!isText) continue;
    const name = h.id.split("/").pop() || h.id;
    existing.push({
      id,
      name,
      provider: h.id.split("/")[0] || "Open Weights",
      providerKey: (h.id.split("/")[0] || "open").toLowerCase(),
      family: name.toLowerCase().split(/[-_]/)[0],
      generation: null,
      country: null,
      type: "General",
      access: "Open",
      released: h.lastModified?.slice(0, 10) ?? null,
      cutoff: null,
      parameters: null,
      contextWindow: null,
      contextTokens: null,
      pricing: null,
      multimodal: false,
      reasoning: false,
      description: `Open-weight model discovered on the HuggingFace Hub (${h.id}). Awaiting benchmark data.`,
      sourceUrl: `https://huggingface.co/${h.id}`,
      benchmarks: {},
      benchmarkSources: {},
      normalized: {},
      benchmarkCount: 0,
      measuredScore: null,
      ultimateScore: 0,
      scoreStatus: "imputed",
      imputationReason:
        "No verified benchmark data yet — scored at floor (0). Will score properly when verified data arrives.",
      ceilingReason: null,
      tags: ["Open Weights"],
      source: "huggingface-hub",
      fetchedAt: now,
    });
    byId.add(id);
    added++;
  }
  return { added, models: existing };
}

async function main() {
  const models = readJson<Model[]>("models.json");
  console.log(`Loaded ${models.length} baseline models from data/models.json`);

  // Best-effort scraping. Failures never abort the pipeline.
  try {
    const hf = await fetchHuggingFaceTrending();
    console.log(`HuggingFace Hub: fetched ${hf.length} trending models.`);
    const { added } = mergeOpenModels(models, hf);
    console.log(`HuggingFace Hub: added ${added} new popular open-weight model(s).`);
  } catch (e) {
    console.warn(`HuggingFace discovery skipped: ${(e as Error).message}`);
  }

  const { filled, notes } = applyVendorBaselines(models);
  for (const n of notes) console.log(n);
  if (filled) console.log(`Vendor baselines filled ${filled} gap(s).`);

  const { filled: extracted, fills } = extractBenchmarks(models);
  for (const f of fills) console.log(`[extract] ${f.name} · ${f.key} = ${f.value}  ⟵  "${f.context}"`);
  if (extracted) console.log(`Extracted ${extracted} real benchmark value(s) from source descriptions.`);

  const { models: sorted, feed, meta } = finalize(models);

  writeJson("models.json", sorted);
  writeJson("feed.json", feed);
  writeJson("meta.json", meta);

  console.log(`\nFinal model count: ${sorted.length} (measured ${meta.measuredCount}, no-data ${meta.imputedCount}).`);
  console.log(`Top: ${sorted[0]?.name} (${sorted[0]?.ultimateScore}).`);
  console.log(`Wrote models.json, feed.json, meta.json to ${DATA_DIR}`);
}

main();
