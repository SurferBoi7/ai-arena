// =============================================================================
// scripts/lib/extract-benchmarks.ts — deterministic benchmark extractor.
// =============================================================================
// Pulls the 8 TRACKED benchmark values that are already stated in a model's own
// source description (system-card / announcement text) into the structured
// `benchmarks` field, filling gaps only. This surfaces REAL published numbers
// that the structured scrape missed — it never invents data. Models whose
// sources publish no tracked-benchmark values keep their gaps (and sink to the
// floor, per the reality-corrected design).
//
// Conservative by construction:
//   • Only the exact tracked benchmark names match — "SWE-bench Verified" (NOT
//     "SWE-bench Pro"/"Multilingual"), "MMLU-Pro" (NOT "Global-MMLU-Lite").
//   • The number must be tightly adjacent to the benchmark name, so contextual
//     figures ("60% fewer tokens on SWE-Bench Verified") are never captured.
//   • Values must be a plausible 0–100 score; benchmark version years (AIME 2026)
//     are consumed by the name pattern, not read as a score.
//   • A measured/vendor value already present always wins — extraction fills
//     gaps only.
// =============================================================================

import type { BenchmarkKey, Model } from "../../src/types";

// Exact source patterns for each TRACKED benchmark. Deliberately narrow.
const NAME_PATTERN: Record<BenchmarkKey, string> = {
  swe_bench: "SWE[-\\s]?bench\\s+Verified", // Verified only — not Pro/Multilingual
  hle: "(?:Humanity['’]?s\\s+Last\\s+Exam|\\bHLE\\b)",
  gpqa_diamond: "GPQA(?:\\s+Diamond)?",
  livecode_bench: "LiveCode[-\\s]?Bench",
  aime: "AIME(?:\\s+20\\d\\d)?", // consume a benchmark year so it isn't read as the score
  mmlu_pro: "MMLU[-\\s]?Pro", // Pro only — not plain MMLU / MMLU-Lite
  humaneval: "HumanEval",
  math500: "MATH[-\\s]?500",
};

const VAL = "(\\d{1,3}(?:\\.\\d+)?)"; // 0–100(.d) — 4-digit years can't match

export interface ExtractedFill {
  modelId: string;
  name: string;
  key: BenchmarkKey;
  value: number;
  context: string;
}

function findValue(text: string, key: BenchmarkKey): { value: number; context: string } | null {
  const name = NAME_PATTERN[key];
  // "NN% Name" (value immediately before the name, e.g. "95.5% SWE-Bench Verified").
  const before = new RegExp(`[~≈]?${VAL}\\s*%\\s*(?:on\\s+)?(?:${name})`, "i");
  // "Name NN" / "Name: NN%" / "Name (NN%)" / "Name ~NN%" (value right after the name,
  // e.g. "GPQA Diamond 87.2", "SWE-bench Verified (87)", "HLE ~57%"). A "(" or "~" may
  // precede the number, but the char after the name must lead to a digit — so
  // "GPQA Diamond (Anthropic…)" and "AIME 2025 (vs 65…)" are still skipped.
  const after = new RegExp(
    `(?:${name})\\s*[:(]?\\s*[~≈]?\\s*(?:of\\s+|score\\s+|=\\s+)?${VAL}\\s*%?`,
    "i",
  );

  for (const re of [before, after]) {
    const m = text.match(re);
    if (m) {
      const v = parseFloat(m[1]);
      if (!Number.isNaN(v) && v >= 0 && v <= 100) {
        const idx = Math.max(0, (m.index ?? 0) - 8);
        return { value: v, context: text.slice(idx, idx + m[0].length + 16).replace(/\s+/g, " ").trim() };
      }
    }
  }
  return null;
}

export function extractBenchmarks(models: Model[]): { filled: number; fills: ExtractedFill[] } {
  const fills: ExtractedFill[] = [];
  for (const model of models) {
    const text = model.description || "";
    if (!text) continue;
    model.benchmarkSources = model.benchmarkSources || {};
    for (const key of Object.keys(NAME_PATTERN) as BenchmarkKey[]) {
      const existing = model.benchmarks?.[key];
      if (typeof existing === "number") continue; // never override measured/vendor data
      const hit = findValue(text, key);
      if (!hit) continue;
      model.benchmarks[key] = hit.value;
      model.benchmarkSources[key] = "vendor"; // real, stated in the model's own source text
      fills.push({ modelId: model.id, name: model.name, key, value: hit.value, context: hit.context });
    }
  }
  return { filled: fills.length, fills };
}
