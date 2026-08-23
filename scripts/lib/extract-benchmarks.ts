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
  // "bench" is optional: some cards label the row "SWE Verified (Resolved)"
  // rather than "SWE-bench Verified".
  ["swe_bench", /^swe[-\s]?(?:bench\s+)?verified\b/i],
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

// Substring containment is only meaningful once both sides carry real
// information — a 1–2 character header ("A", "v1") would otherwise
// false-match almost anything by sheer chance.
function identityMatches(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return (a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b));
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
      if (selfIds.some((s) => identityMatches(h, s))) {
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
      // Some cards group rows under a leading category column (e.g.
      // "| English | MMLU-Pro (EM) | 88.3 | ... |" or the category cell left
      // blank on continuation rows), so the benchmark name can sit in cells[0]
      // OR cells[1]. Try the plain layout first, then the grouped layout —
      // whichever cell actually names a tracked benchmark wins.
      let hit: (typeof ROW_PATTERNS)[number] | undefined;
      let label = "";
      for (const idx of [0, 1]) {
        if (idx >= col) break; // never treat a value column as the label
        const candidate = (cells[idx] || "").replace(/\*\*|\*|`/g, "").trim();
        const found_ = ROW_PATTERNS.find(([, re]) => re.test(candidate));
        if (found_) {
          hit = found_;
          label = candidate;
          break;
        }
      }
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

// ---------------------------------------------------------------------------
// Variant inheritance — vendor-stated equivalence, not imputation.
// ---------------------------------------------------------------------------
// Some catalogue entries are explicitly the SAME underlying model as a sibling
// already in the dataset, just served differently ("GPT-5.6 Luna Pro is the
// same underlying model as GPT-5.6 Luna, served with reasoning.mode set to
// pro"). Copying the sibling's real benchmarks here is not an estimate — it's
// using the vendor's own words. Deliberately excludes "successor"/"upgrade"
// language: a successor is a DIFFERENT model and must earn its own scores.
// ---------------------------------------------------------------------------

// Two idioms vendors actually use: the name right after the equivalence
// phrase ("same underlying model as X"), or the name at the tail of the
// sentence ("identical capabilities ... relative to regular X").
//
// The captured name is a bounded run of space-separated tokens rather than a
// non-greedy character class stopped by a punctuation lookahead — model names
// routinely contain periods ("GPT-5.6"), and a lookahead built on bare "."
// mistakes that decimal point for the end of the sentence, truncating "GPT-5.6
// Luna" down to just "GPT-5". Token counting can't make that mistake: a period
// only ends a token run when it's followed by whitespace/end-of-string, which
// is what actually distinguishes sentence punctuation from a version number.
// A token is an alnum run, plus any internal "-" or "." immediately followed
// by more alnum characters — that's what lets "GPT-5.6" collapse to one token
// while a real sentence-ending "." still closes the name off (nothing alnum
// follows it). No lookahead trickery needed: `[A-Za-z0-9]+` after the
// punctuation simply fails to match — and so the group doesn't consume it —
// when the punctuation isn't mid-token. Up to 4 tokens, so "GPT-5.6 Luna" (2)
// and "Claude Opus 4.8" (3) both capture in full.
const NAME_TOKEN = "[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*";
const FIRST_TOKEN = "[A-Z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*"; // must start uppercase
const EQUIVALENCE_RE = [
  new RegExp(
    `\\b(?:same (?:underlying )?model as|identical (?:capabilities|to)(?: as)?)\\s+` +
      `(${FIRST_TOKEN}(?:\\s+${NAME_TOKEN}){0,3})`,
  ),
  new RegExp(
    `\\bidentical capabilities\\b[\\s\\S]{0,120}?\\brelative to\\s+(?:the\\s+)?(?:regular|normal|standard)?\\s*` +
      `(${FIRST_TOKEN}(?:\\s+${NAME_TOKEN}){0,3})\\.?\\s*$`,
    "i",
  ),
];

// Counts real values directly rather than trusting the cached `benchmarkCount`
// field, which mid-pipeline may still reflect the state before this run's own
// extraction passes filled anything in.
export function realBenchmarkCount(m: Model): number {
  return Object.values(m.benchmarks || {}).filter((v) => typeof v === "number").length;
}

// Extracts the sibling name a description explicitly claims equivalence to,
// then resolves it against the given model list. Shared by inheritance (copy
// real numbers from a scored sibling) and by discovery (skip admitting a new
// row that's just a re-served SKU of an already-tracked, still-unscored
// model — see `isRedundantVariant` below).
export function resolveEquivalentSibling(
  description: string | null | undefined,
  models: Model[],
  selfId: string,
): Model | null {
  const text = description || "";
  let claimedName: string | null = null;
  for (const re of EQUIVALENCE_RE) {
    const m = text.match(re);
    if (m) {
      claimedName = m[1].trim().replace(/\s+/g, " ");
      break;
    }
  }
  if (!claimedName) return null;
  const siblingId = identityOf(claimedName);
  const byId = models.find((o) => o.id !== selfId && identityOf(o.name) === siblingId);
  if (byId) return byId;
  // Unambiguous containment fallback (handles a trailing suffix the regex's
  // token bound missed).
  const candidates = models.filter(
    (o) => o.id !== selfId && siblingId.length >= 4 && identityOf(o.name).includes(siblingId),
  );
  return candidates.length === 1 ? candidates[0] : null;
}

// True when a candidate is a vendor-confirmed re-serving of an ALREADY-TRACKED
// model that itself has no real benchmark data. Admitting it as a separate row
// would just be a second permanent zero for the same underlying weights — pure
// duplication, not a new data point — so discovery skips it. A sibling that
// DOES have real data is still admitted (inheritance below gives it that
// data, and the distinct serving mode is worth showing).
export function isRedundantVariant(model: Model, existing: Model[]): boolean {
  const sibling = resolveEquivalentSibling(model.description, existing, model.id);
  return sibling !== null && realBenchmarkCount(sibling) === 0;
}

export function inheritVariantBenchmarks(models: Model[]): { filled: number; fills: ExtractedFill[] } {
  const fills: ExtractedFill[] = [];

  for (const model of models) {
    if (realBenchmarkCount(model) > 0) continue; // only fill genuine gaps
    const sibling = resolveEquivalentSibling(model.description, models, model.id);
    if (!sibling || realBenchmarkCount(sibling) === 0) continue;

    model.benchmarks = model.benchmarks || {};
    model.benchmarkSources = model.benchmarkSources || {};
    let any = false;
    for (const [key, raw] of Object.entries(sibling.benchmarks || {})) {
      const k = key as BenchmarkKey;
      if (typeof raw !== "number") continue;
      if (typeof model.benchmarks[k] === "number") continue;
      model.benchmarks[k] = raw;
      model.benchmarkSources[k] = "vendor";
      any = true;
      fills.push({
        modelId: model.id,
        name: model.name,
        key: k,
        value: raw,
        context: `vendor-stated identical underlying model as "${sibling.name}"`,
      });
    }
    if (any) {
      model.imputationReason = `Inherited from ${sibling.name}: vendor-stated identical underlying model (same weights, different serving mode).`;
    }
  }
  return { filled: fills.length, fills };
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
