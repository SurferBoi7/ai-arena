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
import { BENCHMARK_MAP } from "../../src/lib/scoring";

// Exact source patterns for each TRACKED benchmark. Deliberately narrow.
const NAME_PATTERN: Record<BenchmarkKey, string> = {
  swe_bench: "SWE[-\\s]?bench\\s+Verified", // Verified only — not Pro/Multilingual
  hle: "(?:Humanity['’]?s\\s+Last\\s+Exam|HLE)",
  gpqa_diamond: "GPQA(?:\\s+Diamond)?",
  livecode_bench: "LiveCode[-\\s]?Bench",
  // `\d*(?![0-9])` forces the edition marker (AIME25 / AIME'24 / AIME 2026) to
  // be consumed whole. Without the lookahead the regex can give a digit back and
  // read the YEAR as the score ("AIME25" -> 5).
  // Consume the edition marker only when the trailing number really is an
  // edition — a 2–4 digit integer NOT followed by a decimal point. So "AIME 26:"
  // and "AIME25" swallow the year, while a genuine score ("AIME 92.6") does not
  // get eaten and is still read as the value.
  // Either consume the edition marker whole ("AIME25", "AIME 2026"), or match a
  // bare "AIME" ONLY when no edition follows. The guarded fallback stops regex
  // backtracking from re-reading the year as a score ("| AIME25 |" -> 25).
  aime: "AIME[\\s'’]*\\d{2,4}(?![\\d.])|AIME(?!\\s*\\d{2,4}(?![\\d.]))",
  mmlu_pro: "MMLU[-\\s]?Pro", // Pro only — not plain MMLU / MMLU-Lite
  humaneval: "HumanEval",
  math500: "MATH[-\\s]?500",
};

// Every name must start at a word edge, otherwise "SuperGPQA" matches GPQA and
// "OpenHumanEval" matches HumanEval.
const LEFT_EDGE = "(?<![A-Za-z0-9])";

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
  const before = new RegExp(`[~≈]?${VAL}\\s*%\\s*(?:on\\s+)?${LEFT_EDGE}(?:${name})`, "i");
  // "Name NN" / "Name: NN%" / "Name (NN%)" / "Name ~NN%" (value right after the name,
  // e.g. "GPQA Diamond 87.2", "SWE-bench Verified (87)", "HLE ~57%"). A "(" or "~" may
  // precede the number, but the char after the name must lead to a digit — so
  // "GPQA Diamond (Anthropic…)" and "AIME 2025 (vs 65…)" are still skipped.
  // The trailing lookahead rejects a value followed by more numbers: an HTML
  // results table flattened to text ("SWE-bench Verified 75.0 76.2 5") is a
  // multi-model row where the owning column is unknowable, so it is skipped
  // rather than guessed.
  const after = new RegExp(
    // `(?!\\s*:)` rejects a number that is itself a label ("AIME 26: We use…"),
    // which alternation backtracking would otherwise expose as a score.
    `${LEFT_EDGE}(?:${name})\\s*[:(]?\\s*[~≈]?\\s*(?:of\\s+|score\\s+|=\\s+)?${VAL}\\s*%?(?!\\s*:)(?!\\s*[\\d.]+[\\s|])`,
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

// ---------------------------------------------------------------------------
// Markdown benchmark tables (HuggingFace model cards).
// ---------------------------------------------------------------------------
// Labs publish results as a table whose columns are COMPETING models:
//
//   | Benchmark | DeepSeek-V4-Pro-0813 | GLM-5.2 | Opus-4.8 |
//   | HLE (wo / w tools) | 42.7 / 60.0 | 40.5 / 54.7 | 49.8 / 57.9 |
//
// Reading the wrong column would attribute a rival's score to this model, so a
// column is used ONLY when its header identifies this model. If no header
// matches, a table is used only when it has a single data column (unambiguous).

// Row labels → tracked benchmark key. Anchored so "SWE-bench Pro",
// "Global-MMLU-Lite" and similar near-misses never match.
const ROW_PATTERNS: [BenchmarkKey, RegExp][] = [
  ["swe_bench", /^swe[-\s]?bench\s+verified\b/i],
  ["hle", /^(?:humanity'?s\s+last\s+exam|hle)\b/i],
  ["gpqa_diamond", /^gpqa(?:[-\s]?diamond)?\b/i],
  ["livecode_bench", /^livecode[-\s]?bench\b/i],
  ["aime", /^aime\s*['’]?\d{0,4}\b/i],
  ["mmlu_pro", /^mmlu[-\s]?pro\b/i],
  ["humaneval", /^humaneval\b/i],
  ["math500", /^math[-\s]?500\b/i],
];

function identityOf(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Cards also carry throughput / speculative-decoding tables that reuse the same
// task names ("| Task | MTP | DSpark |" with acceptance lengths of 3–5). Those
// are not accuracy, so a table introduced by speed/efficiency language is
// ignored outright.
const UNITS_RE =
  /\b(acceptance|speedup|speed-?up|throughput|latency|tokens?\s*\/\s*s|tokens?\s+per\s+second|tok\/s|tps|ms\b|memory|vram|cost|price|params?)\b/i;

// Second net: these are percentage-accuracy benchmarks. A headline result below
// the floor is not a real published score for that benchmark, so it is almost
// certainly a different metric that happened to share a row label.
const PLAUSIBLE_FLOOR: Record<BenchmarkKey, number> = {
  mmlu_pro: 15,
  humaneval: 15,
  math500: 15,
  gpqa_diamond: 10,
  livecode_bench: 5,
  aime: 5,
  swe_bench: 5,
  hle: 1, // Humanity's Last Exam genuinely sits in low single digits for many models
};

// Upper guard: a value well above the benchmark's published state-of-the-art
// ceiling isn't a score for THAT benchmark — it's a neighbouring number that got
// picked up (e.g. "GPQA Diamond 89.5% HLE (text-only) …" lending 89.5 to HLE,
// where real HLE tops out near 60). A small margin allows a genuine new SOTA.
function upperBound(key: BenchmarkKey): number {
  return Math.min(100, BENCHMARK_MAP[key].ceiling + 5);
}

function isPlausible(key: BenchmarkKey, value: number): boolean {
  return value >= PLAUSIBLE_FLOOR[key] && value <= upperBound(key);
}

function parseCell(cell: string): number | null {
  const raw = (cell || "").replace(/\*\*|\*|`/g, "").trim();
  if (!raw || /^[-–—n\/a]+$/i.test(raw)) return null;
  // "42.7 / 60.0" = without tools / with tools — take the unaided score.
  const first = raw.split("/")[0].trim();
  const m = first.match(/^([\d]{1,3}(?:\.\d+)?)\s*%?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function extractFromMarkdown(
  model: Model,
  markdown: string,
): { key: BenchmarkKey; value: number; context: string }[] {
  const found: { key: BenchmarkKey; value: number; context: string }[] = [];
  const lines = markdown.split("\n");
  const selfIds = [identityOf(model.name), identityOf((model.id || "").split("/").pop() || "")];

  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const header = splitRow(lines[i]);
    if (header.length < 2) continue;
    // A markdown table header is followed by a |---|---| separator row.
    if (!/^\s*\|[\s:|-]+\|?\s*$/.test(lines[i + 1] || "")) continue;

    // Skip speed / efficiency tables: check the header row itself and the prose
    // introducing it.
    const preamble = lines.slice(Math.max(0, i - 6), i).join(" ");
    if (UNITS_RE.test(header.join(" ")) || UNITS_RE.test(preamble)) continue;

    // Which column is this model's own?
    let col = -1;
    for (let c = 1; c < header.length; c++) {
      const h = identityOf(header[c]);
      if (!h) continue;
      if (selfIds.some((s) => s && (h === s || h.includes(s) || s.includes(h)))) {
        col = c;
        break;
      }
    }
    if (col === -1) {
      if (header.length !== 2) continue; // ambiguous multi-model table — skip
      col = 1;
    }

    for (let r = i + 2; r < lines.length && /^\s*\|/.test(lines[r]); r++) {
      const cells = splitRow(lines[r]);
      if (cells.length <= col) continue;
      const label = cells[0].replace(/\*\*|\*|`/g, "").trim();
      const hit = ROW_PATTERNS.find(([, re]) => re.test(label));
      if (!hit) continue;
      const value = parseCell(cells[col]);
      if (value === null || !isPlausible(hit[0], value)) continue;
      found.push({
        key: hit[0],
        value,
        context: `${label} = ${cells[col].trim()} (column "${header[col]}")`,
      });
    }
  }
  return found;
}

// Fill gaps on one model from its published model card (table first, then the
// prose patterns). Measured/vendor values are never overwritten.
export function extractFromCard(model: Model, markdown: string): ExtractedFill[] {
  const fills: ExtractedFill[] = [];
  model.benchmarks = model.benchmarks || {};
  model.benchmarkSources = model.benchmarkSources || {};

  // Prose scan runs on de-HTML'd text so markup can't fuse a benchmark name to
  // an unrelated number (e.g. `AIME26</td>`).
  const prose = markdown.replace(/<[^>]+>/g, " ");

  const candidates = [
    ...extractFromMarkdown(model, markdown),
    ...(Object.keys(NAME_PATTERN) as BenchmarkKey[])
      .map((key) => {
        const hit = findValue(prose, key);
        return hit && isPlausible(key, hit.value)
          ? { key, value: hit.value, context: hit.context }
          : null;
      })
      .filter(Boolean as unknown as (v: unknown) => v is { key: BenchmarkKey; value: number; context: string }),
  ];

  for (const c of candidates) {
    if (typeof model.benchmarks[c.key] === "number") continue;
    model.benchmarks[c.key] = c.value;
    model.benchmarkSources[c.key] = "vendor";
    fills.push({ modelId: model.id, name: model.name, key: c.key, value: c.value, context: c.context });
  }
  return fills;
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
