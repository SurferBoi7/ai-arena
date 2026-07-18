// =============================================================================
// AI Arena — Reality-Corrected Scoring Engine
// =============================================================================
// One canonical scoring module used by:
//   - scripts/score-models.ts  (regenerates ultimateScore in data/models.json)
//   - src/lib/* (UI reads precomputed scores; this module supplies the formula
//     metadata shown in the Arena view for transparency)
//
// DESIGN (the "Reality Correction"):
//
// 1. NO POSITIVE IMPUTATION. Missing benchmarks never inherit a lineage average
//    or "grace-period" baseline. A model with zero verified benchmarks scores
//    near zero and sinks to the bottom of the leaderboard.
//
// 2. VENDOR-VERIFIED BASELINES (not imputation). For named flagship models
//    whose own system-card text reports benchmark values that were not captured
//    in the structured scrape, we fill those gaps with `source: "vendor"`.
//    These are real, published numbers — not estimates. Fetched/measured
//    values always override vendor baselines.
//
// 3. WEIGHTED VERIFIED SCORE. norm = clamp(raw / ceiling * 100). The arena
//    score is the weight-renormalised mean of verified benchmarks, so a model
//    that sweeps the hardest benchmarks scores high even with partial coverage.
//
// 4. OMISSION PENALTY. Every missing benchmark subtracts a tier-scaled penalty,
//    with HYPER-DIFFICULT benchmarks (SWE-bench Verified, Humanity's Last Exam)
//    dominating. No separate "uncertainty" penalty — missing data is penalised
//    once, via omission.
//
// 5. INTELLIGENCE CEILING. Lightweight / utility models are hard-capped at the
//    top flagship score and cannot surpass a flagship unless they possess
//    verified, non-imputed data that SWEEPS the hardest benchmarks
//    (SWE-bench >= 70 AND HLE >= 40), in which case the cap is lifted.
// =============================================================================

import type { BenchmarkKey, Model } from "../types";

export interface BenchmarkMeta {
  key: BenchmarkKey;
  label: string;
  short: string;
  ceiling: number; // state-of-the-art ceiling for normalisation (raw %)
  weight: number; // relative weight (sums to 1.0)
  tier: "hyper" | "hard" | "medium";
  group: "knowledge" | "coding" | "math" | "reasoning" | "agentic";
  description: string;
}

export const BENCHMARKS: BenchmarkMeta[] = [
  {
    key: "swe_bench",
    label: "SWE-bench Verified",
    short: "SWE",
    ceiling: 95,
    weight: 0.18,
    tier: "hyper",
    group: "agentic",
    description:
      "Resolves real GitHub issues end-to-end. The hardest agentic coding benchmark.",
  },
  {
    key: "hle",
    label: "Humanity's Last Exam",
    short: "HLE",
    ceiling: 60,
    weight: 0.17,
    tier: "hyper",
    group: "reasoning",
    description:
      "Expert-authored questions across every domain. Near-zero baseline; hyper-difficult.",
  },
  {
    key: "gpqa_diamond",
    label: "GPQA Diamond",
    short: "GPQA",
    ceiling: 95,
    weight: 0.12,
    tier: "hard",
    group: "reasoning",
    description: "Google-proof graduate-level science questions.",
  },
  {
    key: "livecode_bench",
    label: "LiveCodeBench",
    short: "LCB",
    ceiling: 94,
    weight: 0.12,
    tier: "medium",
    group: "coding",
    description: "Contamination-checked competitive programming.",
  },
  {
    key: "aime",
    label: "AIME 2024",
    short: "AIME",
    ceiling: 100,
    weight: 0.11,
    tier: "hard",
    group: "math",
    description: "Olympiad-level mathematical reasoning.",
  },
  {
    key: "mmlu_pro",
    label: "MMLU-Pro",
    short: "MMLU",
    ceiling: 92,
    weight: 0.10,
    tier: "hard",
    group: "knowledge",
    description: "Broad multi-domain academic knowledge.",
  },
  {
    key: "humaneval",
    label: "HumanEval",
    short: "HE",
    ceiling: 97,
    weight: 0.10,
    tier: "medium",
    group: "coding",
    description: "Functional coding correctness on small functions.",
  },
  {
    key: "math500",
    label: "MATH-500",
    short: "MATH",
    ceiling: 97,
    weight: 0.10,
    tier: "medium",
    group: "math",
    description: "Competition mathematics, 500 problems.",
  },
];

export const BENCHMARK_MAP: Record<BenchmarkKey, BenchmarkMeta> = Object.fromEntries(
  BENCHMARKS.map((b) => [b.key, b]),
) as Record<BenchmarkKey, BenchmarkMeta>;

export const TOTAL_WEIGHT = BENCHMARKS.reduce((s, b) => s + b.weight, 0); // 1.0

// Omission penalty applied per missing benchmark, scaled by difficulty tier.
// Hyper-difficult omissions dominate so a model that hides its SWE-bench / HLE
// results cannot coast into the top tier.
export const OMISSION_PENALTY: Record<BenchmarkMeta["tier"], number> = {
  hyper: 6.0,
  hard: 2.2,
  medium: 1.3,
};

// Hard cap applied to lightweight/utility models unless they sweep the hardest
// benchmarks with verified, non-imputed data.
export const SWEEP_ESCAPE = {
  sweBenchRaw: 70,
  hleRaw: 40,
};

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

export function normalize(key: BenchmarkKey, raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined || Number.isNaN(raw)) return null;
  const meta = BENCHMARK_MAP[key];
  const n = (raw / meta.ceiling) * 100;
  return Math.max(0, Math.min(100, n));
}

// ---------------------------------------------------------------------------
// Tier classification
// ---------------------------------------------------------------------------

const FLAGSHIP_PATTERNS = [
  /\bfable\b/i,
  /\bmythos\b/i,
  /\bopus\b/i, // Claude Opus line
  /\bgpt-?5\b/i, // OpenAI flagship line
  /\bgrok\s*4\b/i,
  /gemini\s*3\.?\d*\s*pro/i,
  /deepseek\s*v4\s*pro/i,
  /qwen3\.?\d?-?\s*max/i,
];

const LIGHTWEIGHT_PATTERNS = [
  /\bmini\b/i,
  /\bsmall\b/i,
  /\blean\b/i,
  /\bhaiku\b/i,
  /\bnano\b/i,
  /\btiny\b/i,
  /\bmicro\b/i,
  /\blite\b/i,
  /\bedge\b/i,
  /\bflash-?lite\b/i,
];

function parseActiveParams(parameters?: string | null): number | null {
  if (!parameters) return null;
  // Prefer active params: "1600B (49B active)" -> 49e9
  const activeMatch = parameters.match(/\(([\d.]+)\s*([BM])\s*active\)/i);
  const rawMatch = parameters.match(/^([\d.]+)\s*([BM])/i);
  const m = activeMatch || rawMatch;
  if (!m) return null;
  const v = parseFloat(m[1]);
  return m[2].toUpperCase() === "B" ? v * 1e9 : v * 1e6;
}

export type Tier = "flagship" | "frontier" | "lightweight" | "general";

export function classifyTier(model: Pick<Model, "name" | "parameters" | "type" | "access" | "tags">): Tier {
  const name = model.name || "";

  // Small-variant markers take precedence: "GPT-5.4 Mini" / "Claude Opus Haiku"
  // are lightweight/utility SKUs even though they sit in a flagship family.
  if (LIGHTWEIGHT_PATTERNS.some((re) => re.test(name))) return "lightweight";

  if (FLAGSHIP_PATTERNS.some((re) => re.test(name))) return "flagship";

  const tags = model.tags || [];
  if (tags.includes("Frontier")) return "frontier";

  const params = parseActiveParams(model.parameters);
  if (params !== null && params < 35e9) return "lightweight";

  return "general";
}

export function isLightweight(model: Pick<Model, "name" | "parameters" | "type" | "access" | "tags">): boolean {
  return classifyTier(model) === "lightweight";
}

// ---------------------------------------------------------------------------
// Verified-benchmark resolution (measured overrides vendor; never imputes)
// ---------------------------------------------------------------------------

export interface ResolvedBenchmark {
  key: BenchmarkKey;
  raw: number;
  norm: number;
  source: "measured" | "vendor";
}

export interface ScoreBreakdown {
  verified: ResolvedBenchmark[];
  presentWeight: number;
  coverage: number;
  baseScore: number;
  omissionPenalty: number;
  rawScore: number;
  tier: Tier;
  sweptHardest: boolean;
  capped: boolean;
  ceilingValue: number | null;
  finalScore: number;
}

export function resolveVerified(
  model: Pick<Model, "benchmarks" | "benchmarkSources">,
): ResolvedBenchmark[] {
  const out: ResolvedBenchmark[] = [];
  for (const meta of BENCHMARKS) {
    const raw = model.benchmarks?.[meta.key];
    if (typeof raw === "number" && !Number.isNaN(raw)) {
      const source: "measured" | "vendor" =
        model.benchmarkSources?.[meta.key] === "vendor" ? "vendor" : "measured";
      out.push({ key: meta.key, raw, norm: normalize(meta.key, raw) ?? 0, source });
    }
  }
  return out;
}

export function hasVerified(
  model: Pick<Model, "benchmarks" | "benchmarkSources">,
  key: BenchmarkKey,
): boolean {
  const v = model.benchmarks?.[key];
  return typeof v === "number" && !Number.isNaN(v);
}

// A model "sweeps the hardest benchmarks" if it has verified (non-imputed)
// SWE-bench AND HLE both above the escape thresholds.
export function sweepsHardest(
  model: Pick<Model, "benchmarks" | "benchmarkSources">,
): boolean {
  const swe = model.benchmarks?.swe_bench;
  const hle = model.benchmarks?.hle;
  return (
    typeof swe === "number" &&
    swe >= SWEEP_ESCAPE.sweBenchRaw &&
    typeof hle === "number" &&
    hle >= SWEEP_ESCAPE.hleRaw
  );
}

// ---------------------------------------------------------------------------
// Core scoring
// ---------------------------------------------------------------------------

export function scoreBreakdown(model: Model): ScoreBreakdown {
  const verified = resolveVerified(model);
  const tier = classifyTier(model);

  let baseScore = 0;
  let presentWeight = 0;
  if (verified.length > 0) {
    let weightedSum = 0;
    for (const v of verified) {
      weightedSum += BENCHMARK_MAP[v.key].weight * v.norm;
      presentWeight += BENCHMARK_MAP[v.key].weight;
    }
    baseScore = weightedSum / presentWeight; // renormalised to present set
  }

  const coverage = presentWeight / TOTAL_WEIGHT;

  // Omission penalty: sum of penalties for every missing benchmark.
  let omissionPenalty = 0;
  for (const meta of BENCHMARKS) {
    if (!verified.some((v) => v.key === meta.key)) {
      omissionPenalty += OMISSION_PENALTY[meta.tier];
    }
  }

  let rawScore = baseScore - omissionPenalty;
  if (verified.length === 0) rawScore = 0; // no data -> floor at 0, sinks to bottom
  rawScore = Math.max(0, Math.min(100, rawScore));

  const swept = sweepsHardest(model);
  const capped = tier === "lightweight" && !swept;

  return {
    verified,
    presentWeight,
    coverage,
    baseScore,
    omissionPenalty,
    rawScore,
    tier,
    sweptHardest: swept,
    capped,
    ceilingValue: null, // filled by scoreAll once flagship max is known
    finalScore: rawScore,
  };
}

// ---------------------------------------------------------------------------
// Full leaderboard scoring: computes per-model breakdown, then resolves the
// Intelligence Ceiling using the top flagship score.
// ---------------------------------------------------------------------------

export interface ScoredModel extends Model {
  _breakdown: ScoreBreakdown;
}

export function scoreAll(models: Model[]): ScoredModel[] {
  const scored = models.map((m) => {
    const breakdown = scoreBreakdown(m);
    return { ...m, _breakdown: breakdown } as ScoredModel;
  });

  // Intelligence Ceiling: a lightweight/utility model is hard-capped from
  // surpassing ANY established flagship (flagship-tier models with real verified
  // data, i.e. >= 2 benchmarks) unless it sweeps the hardest benchmarks with
  // verified, non-imputed data. The cap is the minimum established-flagship
  // score; on ties the tier-priority sort ranks flagships above lightweights.
  const establishedFlagships = scored.filter(
    (m) => m._breakdown.tier === "flagship" && m._breakdown.verified.length >= 2,
  );
  const establishedScores = establishedFlagships.map((m) => m._breakdown.rawScore);
  const ceilingCap = establishedScores.length ? Math.min(...establishedScores) : 100;
  const topFlagship = scored
    .filter((m) => m._breakdown.tier === "flagship")
    .reduce((mx, m) => Math.max(mx, m._breakdown.rawScore), 0);

  for (const m of scored) {
    const b = m._breakdown;
    let finalScore = b.rawScore;
    let ceilingValue: number | null = null;
    let ceilingReason: string | null = null;

    if (b.tier === "lightweight") {
      if (b.sweptHardest) {
        // Escape hatch: verified non-imputed sweep of the hardest benchmarks.
        ceilingReason =
          "Ceiling lifted: verified non-imputed SWE-bench \u2265 70 AND HLE \u2265 40.";
      } else {
        ceilingValue = ceilingCap;
        finalScore = Math.min(finalScore, ceilingCap);
        ceilingReason = `Intelligence Ceiling: lightweight/utility model hard-capped at the lowest established flagship score (${ceilingCap.toFixed(
          1,
        )}). Lifted only with verified non-imputed SWE-bench \u2265 70 AND HLE \u2265 40.`;
      }
    }
    b.ceilingValue = ceilingValue;
    b.finalScore = finalScore;
    m.ultimateScore = Math.round(finalScore * 10) / 10;
    m.measuredScore = b.verified.length ? Math.round(b.baseScore * 10) / 10 : null;
    m.benchmarkCount = b.verified.length;
    m.ceilingReason = ceilingReason;
    m.tier = b.tier;
  }

  // Reference the top flagship value (kept for downstream reporting).
  void topFlagship;

  return scored;
}

// Normalised benchmark map for storage / display.
export function normalizedMap(model: Model): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const meta of BENCHMARKS) {
    const raw = model.benchmarks?.[meta.key];
    out[meta.key] = typeof raw === "number" ? normalize(meta.key, raw) : null;
  }
  return out;
}

// Determine scoreStatus for display.
export const TIER_PRIORITY: Record<Tier, number> = {
  flagship: 0,
  frontier: 1,
  general: 2,
  lightweight: 3,
};

// Canonical leaderboard comparator: score desc, then tier priority (flagships
// above lightweights on ties), then verified-benchmark coverage, then SWE-bench
// raw, then name.
export function compareModels(a: Model, b: Model): number {
  if (b.ultimateScore !== a.ultimateScore) return b.ultimateScore - a.ultimateScore;
  const ta = TIER_PRIORITY[(a.tier as Tier) ?? "general"];
  const tb = TIER_PRIORITY[(b.tier as Tier) ?? "general"];
  if (ta !== tb) return ta - tb;
  if (b.benchmarkCount !== a.benchmarkCount) return b.benchmarkCount - a.benchmarkCount;
  const sa = typeof a.benchmarks.swe_bench === "number" ? a.benchmarks.swe_bench : 0;
  const sb = typeof b.benchmarks.swe_bench === "number" ? b.benchmarks.swe_bench : 0;
  if (sb !== sa) return sb - sa;
  return (a.name || "").localeCompare(b.name || "");
}

export function deriveStatus(benchmarkCount: number, hasHyper: boolean): "measured" | "partial" | "imputed" {
  if (benchmarkCount === 0) return "imputed";
  if (benchmarkCount >= 4 && hasHyper) return "measured";
  if (benchmarkCount >= 4) return "measured";
  return "partial";
}
