// Shared data types for AI Arena.

export type BenchmarkKey =
  | "mmlu_pro"
  | "humaneval"
  | "math500"
  | "gpqa_diamond"
  | "livecode_bench"
  | "aime"
  | "swe_bench"
  | "hle";

export type ScoreStatus = "measured" | "partial" | "imputed";

export type BenchmarkSource = "measured" | "vendor";

export interface Benchmarks {
  mmlu_pro?: number | null;
  humaneval?: number | null;
  math500?: number | null;
  gpqa_diamond?: number | null;
  swe_bench?: number | null;
  livecode_bench?: number | null;
  aime?: number | null;
  hle?: number | null;
}

export interface Model {
  id: string;
  name: string;
  provider: string;
  providerKey: string;
  family?: string | null;
  generation?: number | null;
  country?: string | null;
  type?: string | null;
  access?: string | null;
  released?: string | null;
  cutoff?: string | null;
  parameters?: string | null;
  contextWindow?: string | null;
  contextTokens?: number | null;
  pricing?: any;
  multimodal?: boolean;
  reasoning?: boolean;
  description?: string | null;
  sourceUrl?: string | null;
  benchmarks: Benchmarks;
  // Per-benchmark provenance: which key came from measured vs vendor data.
  benchmarkSources?: Partial<Record<BenchmarkKey, BenchmarkSource>>;
  normalized?: Partial<Record<BenchmarkKey, number | null>>;
  benchmarkCount: number;
  measuredScore?: number | null;
  ultimateScore: number;
  scoreStatus: ScoreStatus;
  imputationReason?: string | null;
  ceilingReason?: string | null;
  floorReason?: string | null;
  tier?: string;
  tags?: string[];
  source?: string | null;
  fetchedAt?: string | null;
  // HuggingFace mirror id ("org/repo"), when known, for a model not itself
  // sourced from the HF Hub (e.g. an OpenRouter-discovered open-weight model).
  // Lets the pipeline revisit its model card on a later run for benchmarks.
  hfRef?: string | null;
}

export interface FeedItem {
  id: string;
  modelId: string;
  title: string;
  provider: string;
  providerKey: string;
  released?: string | null;
  ultimateScore: number;
  scoreStatus: ScoreStatus;
  measuredScore?: number | null;
  imputationReason?: string | null;
  ceilingReason?: string | null;
  floorReason?: string | null;
  family?: string | null;
  tags?: string[];
  summary?: string;
  highlights?: string[];
  sourceUrl?: string | null;
  access?: string | null;
  type?: string | null;
  benchmarkCount?: number;
}

export interface Company {
  key: string;
  name: string;
  monogram: string;
  color: string;
  blurb: string;
  modelCount: number;
  latestRelease?: string | null;
  latestModel?: string | null;
}

export interface MetaSourceStatus {
  source: string;
  status: string;
  models?: number;
  note?: string;
}

export interface Meta {
  generatedAt: string;
  source?: string;
  modelCount: number;
  measuredCount: number;
  imputedCount: number;
  sourceStatuses?: MetaSourceStatus[];
  topModel?: { id: string; name: string; score: number };
  scoring?: string;
}
