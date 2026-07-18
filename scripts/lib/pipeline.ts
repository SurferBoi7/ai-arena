// =============================================================================
// scripts/lib/pipeline.ts — shared scoring + persistence pipeline.
// Used by both `npm run score` (re-score committed data) and
// `npm run update-data` (scrape + re-score). Keeps the reality-correction
// logic in one place.
// =============================================================================

import type { BenchmarkKey, FeedItem, Meta, Model } from "../../src/types";
import {
  BENCHMARKS,
  compareModels,
  deriveStatus,
  normalizedMap,
  resolveVerified,
  scoreAll,
} from "../../src/lib/scoring";
import { VENDOR_BASELINES } from "../fixtures/vendor-baselines";

export interface PersistResult {
  models: Model[];
  feed: FeedItem[];
  meta: Meta;
}

export function applyVendorBaselines(models: Model[]): { filled: number; notes: string[] } {
  let filled = 0;
  const notes: string[] = [];
  for (const vb of VENDOR_BASELINES) {
    const model = models.find((m) => m.id === vb.modelId);
    if (!model) {
      notes.push(`[vendor] model ${vb.modelId} (${vb.name}) not found in data — skipped.`);
      continue;
    }
    model.benchmarkSources = model.benchmarkSources || {};
    for (const [key, value] of Object.entries(vb.values)) {
      const k = key as BenchmarkKey;
      const existing = model.benchmarks[k];
      if (typeof existing === "number") {
        model.benchmarkSources[k] = "measured";
        continue;
      }
      model.benchmarks[k] = value as number;
      model.benchmarkSources[k] = "vendor";
      filled++;
      notes.push(`[vendor] filled ${model.name} · ${k} = ${value} (${vb.reason})`);
    }
  }
  return { filled, notes };
}

export function finalize(models: Model[]): PersistResult {
  const scored = scoreAll(models);

  for (const m of scored) {
    const verified = resolveVerified(m);
    const hasHyper = verified.some(
      (v) => BENCHMARKS.find((b) => b.key === v.key)!.tier === "hyper",
    );
    m.normalized = normalizedMap(m);
    m.scoreStatus = deriveStatus(m.benchmarkCount, hasHyper);
    m.imputationReason =
      m.benchmarkCount === 0
        ? "No verified benchmark data — scored at floor (0). Missing-data models are no longer granted a grace-period baseline."
        : m.benchmarkCount < 4
          ? `Partial (${m.benchmarkCount} verified benchmark${m.benchmarkCount === 1 ? "" : "s"}). Omission penalty applied for missing benchmarks.`
          : null;
    if (!m.source) m.source = "demandsphere-mcp+huggingface";
  }

  const sorted = [...scored].sort(compareModels);
  const clean = sorted.map(({ _breakdown: _ignored, ...rest }) => rest) as Model[];

  const feed: FeedItem[] = sorted.map((m) => ({
    id: `feed-${m.id}`,
    modelId: m.id,
    title: `${m.name} ${m.scoreStatus === "imputed" ? "listed" : "ships"}`.trim(),
    provider: m.provider,
    providerKey: m.providerKey,
    released: m.released ?? null,
    ultimateScore: m.ultimateScore,
    scoreStatus: m.scoreStatus,
    measuredScore: m.measuredScore ?? null,
    imputationReason: m.imputationReason ?? null,
    ceilingReason: m.ceilingReason ?? null,
    floorReason: m.floorReason ?? null,
    family: m.family ?? null,
    tags: m.tags ?? [],
    summary: m.description ?? "",
    highlights: [],
    sourceUrl: m.sourceUrl ?? null,
    access: m.access ?? null,
    type: m.type ?? null,
    benchmarkCount: m.benchmarkCount,
  }));
  feed.sort((a, b) => (b.released ?? "").localeCompare(a.released ?? ""));

  const measuredCount = clean.filter((m) => m.scoreStatus !== "imputed").length;
  const imputedCount = clean.filter((m) => m.scoreStatus === "imputed").length;
  const top = sorted[0];
  const meta: Meta = {
    generatedAt: new Date().toISOString(),
    source: "demandsphere-mcp+huggingface+vendor-notes",
    modelCount: clean.length,
    measuredCount,
    imputedCount,
    sourceStatuses: [
      { source: "demandsphere-mcp", status: "ok", models: clean.length },
      { source: "huggingface-hub", status: "ok", note: "open-model discovery" },
      { source: "vendor-notes", status: "ok", note: "flagship system-card baselines" },
    ],
    topModel: top ? { id: top.id, name: top.name, score: top.ultimateScore } : undefined,
    scoring:
      "Reality-corrected: weighted verified mean (SWE-bench & HLE weighted highest) + hyper-dominant omission penalty + vendor-verified flagship baselines + intelligence ceiling on lightweight models. No grace-period imputation.",
  };

  return { models: clean, feed, meta };
}
