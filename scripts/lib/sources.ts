// =============================================================================
// scripts/lib/sources.ts — live model discovery from free, no-key sources.
// =============================================================================
// The tracker stalled because discovery used HuggingFace `sort=downloads`,
// which returns all-time popular models (2022-era embedding models) and so
// never surfaced a new release. It also had NO source for closed frontier
// models (GPT / Claude / Gemini), which never appear on the HF Hub.
//
// Two trusted, free, unauthenticated sources now feed discovery:
//
//   1. OpenRouter  https://openrouter.ai/api/v1/models
//      Catalogue of served models — including CLOSED frontier releases — with
//      creation timestamps, context length, pricing and modality.
//
//   2. HuggingFace Hub  https://huggingface.co/api/models
//      Sorted by trendingScore + recently-created-with-traction, so genuinely
//      new open-weight releases appear. Quantisations and derivative community
//      fine-tunes are filtered out so the board isn't flooded with noise.
//
// Everything here is deterministic parsing of published metadata. No AI, no
// estimates: benchmarks are only ever filled by the extractor from real text.
// =============================================================================

import type { Model } from "../../src/types";

// --- provider mapping -------------------------------------------------------
// Maps source namespaces onto the tracker's canonical providerKey / provider.

const PROVIDERS: Record<string, { key: string; name: string }> = {
  openai: { key: "openai", name: "OpenAI" },
  "openai-community": { key: "openai", name: "OpenAI" },
  anthropic: { key: "anthropic", name: "Anthropic" },
  google: { key: "google", name: "Google" },
  "google-t5": { key: "google", name: "Google" },
  "google-deepmind": { key: "google", name: "Google" },
  meta: { key: "meta", name: "Meta" },
  "meta-llama": { key: "meta", name: "Meta" },
  facebook: { key: "meta", name: "Meta" },
  "x-ai": { key: "xai", name: "xAI" },
  xai: { key: "xai", name: "xAI" },
  deepseek: { key: "deepseek", name: "DeepSeek" },
  "deepseek-ai": { key: "deepseek", name: "DeepSeek" },
  "z-ai": { key: "zhipu", name: "Zhipu AI" },
  "zai-org": { key: "zhipu", name: "Zhipu AI" },
  thudm: { key: "zhipu", name: "Zhipu AI" },
  zhipu: { key: "zhipu", name: "Zhipu AI" },
  qwen: { key: "alibaba", name: "Alibaba / Qwen" },
  alibaba: { key: "alibaba", name: "Alibaba / Qwen" },
  moonshotai: { key: "moonshot", name: "Moonshot AI" },
  moonshot: { key: "moonshot", name: "Moonshot AI" },
  mistralai: { key: "mistral", name: "Mistral AI" },
  mistral: { key: "mistral", name: "Mistral AI" },
  minimax: { key: "minimax", name: "MiniMax" },
  minimaxai: { key: "minimax", name: "MiniMax" },
  microsoft: { key: "microsoft", name: "Microsoft" },
  amazon: { key: "amazon", name: "Amazon" },
  cohere: { key: "cohere", name: "Cohere" },
  coherelabs: { key: "cohere", name: "Cohere" },
  bytedance: { key: "bytedance", name: "ByteDance" },
  "bytedance-seed": { key: "bytedance", name: "ByteDance" },
  tencent: { key: "tencent", name: "Tencent" },
  "tencent-hunyuan": { key: "tencent", name: "Tencent" },
  meituan: { key: "meituan", name: "Meituan" },
  "meituan-longcat": { key: "meituan", name: "Meituan" },
  nousresearch: { key: "nous", name: "Nous Research" },
  nous: { key: "nous", name: "Nous Research" },
  nvidia: { key: "nvidia", name: "NVIDIA" },
  ai21: { key: "ai21", name: "AI21 Labs" },
  perplexity: { key: "perplexity", name: "Perplexity" },
  inclusionai: { key: "inclusionai", name: "InclusionAI" },
  baidu: { key: "baidu", name: "Baidu" },
  openrouter: { key: "openrouter", name: "OpenRouter" },
};

function titleCase(s: string): string {
  return s
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function resolveProvider(namespace: string): { key: string; name: string } {
  const ns = (namespace || "").toLowerCase().replace(/^~/, "");
  return PROVIDERS[ns] ?? { key: ns || "independent", name: titleCase(ns) || "Independent" };
}

// --- identity / dedupe ------------------------------------------------------

// Normalised model identity used to detect the same model arriving from two
// sources (or already present in the curated baseline).
export function normalizeName(raw: string): string {
  return (raw || "")
    .split(":")
    .pop()! // "Google: Gemini 3.7 Flash" -> " Gemini 3.7 Flash"
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\b(instruct|chat|preview|latest|free|beta|it|hf)\b/g, " ")
    .replace(/[^a-z0-9]/g, "");
}

// --- noise filters (open-weight hub) ----------------------------------------

// Quantisations / precision conversions — re-packagings of an existing model,
// matched per name-token so prefixed forms (NVFP4, MXFP8) are caught too.
const QUANT_TOKENS = new Set([
  "gguf", "awq", "gptq", "mlx", "exl2", "exl3", "bnb", "ggml", "imatrix",
  "onnx", "openvino", "trtllm", "tensorrt", "quantized", "quant",
  "int2", "int3", "int4", "int8", "fp4", "fp6", "fp8", "fp16", "bf16",
  "nvfp4", "nvfp8", "mxfp4", "mxfp8", "w4a16", "w8a8", "w4a8",
  "2bit", "3bit", "4bit", "6bit", "8bit", "16bit",
]);

// Derivative community edits — not first-party releases.
const DERIVATIVE_RE =
  /\b(abliterated|obliterat\w*|uncensored|heretic|jailbr\w*|merged?|slerp|lora|qlora|finetune|fine-tune|sft|dpo|roleplay|erp|nsfw|storywriter|waifu)\b/i;

export function isNoiseRepo(id: string): boolean {
  const name = id.split("/").pop() || id;
  const tokens = name.toLowerCase().split(/[-_.\s]+/);
  if (tokens.some((t) => QUANT_TOKENS.has(t))) return true;
  return DERIVATIVE_RE.test(name);
}

// The tracker's 8 benchmarks (SWE-bench, MMLU-Pro, HLE, ...) measure text
// reasoning and coding. A TTS, OCR, image-generation, or embedding model has
// no meaningful score on any of them — tracking one just adds a permanent
// zero to the board, which looks like missing data but is really a wrong
// category of model. These are filtered at the source rather than scored.
const NON_TEXT_RE =
  /\b(tts|text-to-speech|speech-to-text|asr|whisper|voxtral|vocoder|voice-?clone|ocr|image-to-image|text-to-image|image-edit|inpaint|upscal\w*|super-?resolution|embedding|reranker|rerank|feature-extract\w*|clip|diffusion|vae|controlnet|depth-estimation)\b/i;

export function isNonTextModel(nameOrId: string, tags: string[] = [], pipelineTag = ""): boolean {
  const NON_TEXT_TAGS = new Set([
    "text-to-speech", "automatic-speech-recognition", "text-to-image",
    "image-to-image", "feature-extraction", "sentence-similarity",
    "image-segmentation", "depth-estimation", "image-classification",
    "audio-classification", "audio-to-audio", "unconditional-image-generation",
    "text-to-video", "image-to-video", "image-to-text-classification",
  ]);
  if (pipelineTag && NON_TEXT_TAGS.has(pipelineTag)) return true;
  if (tags.some((t) => NON_TEXT_TAGS.has(t.toLowerCase()))) return true;
  const name = (nameOrId.split("/").pop() || nameOrId).toLowerCase();
  return NON_TEXT_RE.test(name);
}

// =============================================================================
// OpenRouter — closed + open frontier catalogue
// =============================================================================

interface ORModel {
  id: string;
  canonical_slug?: string;
  hugging_face_id?: string | null;
  name?: string;
  created?: number;
  description?: string;
  context_length?: number;
  architecture?: { modality?: string; input_modalities?: string[] };
  pricing?: Record<string, string>;
}

export interface DiscoveredModel {
  model: Model;
  hfId?: string | null;
}

export async function fetchOpenRouter(): Promise<ORModel[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`OpenRouter API ${res.status}`);
  const json = (await res.json()) as { data?: ORModel[] };
  return json.data ?? [];
}

// Catalogue blurbs are markdown; flatten links/emphasis so the Feed and model
// sheet render clean prose instead of raw `[text](url)` syntax.
function cleanBlurb(s: string): string {
  return (s || "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[*_`]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function priceLabel(p?: Record<string, string>): string | null {
  if (!p?.prompt || !p?.completion) return null;
  const inM = Number(p.prompt) * 1_000_000;
  const outM = Number(p.completion) * 1_000_000;
  if (!Number.isFinite(inM) || !Number.isFinite(outM) || (inM === 0 && outM === 0)) return null;
  const fmt = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
  return `${fmt(inM)}/${fmt(outM)} per 1M tokens`;
}

export function openRouterToModel(m: ORModel, now: string): DiscoveredModel | null {
  if (!m.id) return null;
  const [ns, slug] = m.id.split("/");
  if (!slug) return null;
  // Router pseudo-entries ("openrouter/auto") aren't models.
  if (ns.toLowerCase() === "openrouter") return null;
  // ":free" / ":batch" / ":thinking" are routing variants of a model we already take.
  if (slug.includes(":")) return null;
  const provider = resolveProvider(ns);
  const displayName = (m.name || slug).split(": ").pop()!.trim();
  const released = m.created ? new Date(m.created * 1000).toISOString().slice(0, 10) : null;
  const modality = m.architecture?.modality || "";
  const multimodal = /image|audio|video/.test(modality);
  const ctx = m.context_length ?? null;

  // Output modality must include text (a TTS or image-gen endpoint can never
  // score on our text-reasoning benchmarks), and the name mustn't match a
  // known non-text category the modality field doesn't always flag.
  const outputModality = modality.includes("->") ? modality.split("->")[1] : modality;
  const outputsText = !modality || outputModality.includes("text");
  if (!outputsText || isNonTextModel(displayName)) return null;

  return {
    hfId: m.hugging_face_id ?? null,
    model: {
      id: `or:${m.id}`,
      name: displayName,
      provider: provider.name,
      providerKey: provider.key,
      family: displayName.toLowerCase().split(/[\s-]/)[0] || null,
      generation: null,
      country: null,
      type: /reason|think/i.test(displayName + " " + (m.description || "")) ? "Reasoning" : "General",
      access: m.hugging_face_id ? "Open" : "Closed",
      released,
      cutoff: null,
      parameters: null,
      contextWindow: ctx ? `${Math.round(ctx / 1000)}K tokens` : null,
      contextTokens: ctx,
      pricing: priceLabel(m.pricing),
      multimodal,
      reasoning: /reason|think/i.test(displayName),
      description: cleanBlurb(m.description || "") || null,
      sourceUrl: `https://openrouter.ai/${m.id}`,
      benchmarks: {},
      benchmarkSources: {},
      normalized: {},
      benchmarkCount: 0,
      measuredScore: null,
      ultimateScore: 0,
      scoreStatus: "imputed",
      imputationReason: null,
      ceilingReason: null,
      tags: [
        m.hugging_face_id ? "Open Weights" : "Proprietary",
        ...(multimodal ? ["Multimodal"] : []),
        ...(ctx && ctx >= 200000 ? ["Long Context"] : []),
      ],
      source: "openrouter",
      fetchedAt: now,
      hfRef: m.hugging_face_id ?? null,
    } as Model,
  };
}

// =============================================================================
// HuggingFace Hub — new open-weight releases
// =============================================================================

interface HFModel {
  id: string;
  downloads?: number;
  likes?: number;
  trendingScore?: number;
  pipeline_tag?: string;
  tags?: string[];
  createdAt?: string;
  lastModified?: string;
}

async function hfQuery(params: string): Promise<HFModel[]> {
  const res = await fetch(`https://huggingface.co/api/models?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HF API ${res.status}`);
  return (await res.json()) as HFModel[];
}

// Trending gives what the community is actually adopting right now; the recent
// sweep catches brand-new releases that have traction but haven't trended yet.
export async function fetchHuggingFace(): Promise<HFModel[]> {
  const [trending, recent] = await Promise.all([
    hfQuery("sort=trendingScore&direction=-1&limit=60&filter=text-generation&full=false"),
    hfQuery("sort=lastModified&direction=-1&limit=100&filter=text-generation&full=false"),
  ]);
  const seen = new Set<string>();
  const out: HFModel[] = [];
  for (const m of [...trending, ...recent]) {
    if (!m?.id || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

// A repo qualifies as a real release if it's first-party-looking and has real
// traction — this keeps the daily firehose of fine-tunes off the leaderboard.
export function hfQualifies(m: HFModel): boolean {
  if (!m.id || isNoiseRepo(m.id)) return false;
  if (isNonTextModel(m.id, m.tags || [], m.pipeline_tag || "")) return false;
  const ns = m.id.split("/")[0]?.toLowerCase() ?? "";
  const known = Boolean(PROVIDERS[ns]);
  const downloads = m.downloads ?? 0;
  const likes = m.likes ?? 0;
  if (known) return downloads >= 1000 || likes >= 20;
  return downloads >= 50000 && likes >= 100;
}

export function hfToModel(m: HFModel, now: string): DiscoveredModel | null {
  const [ns, slug] = m.id.split("/");
  if (!slug) return null;
  const provider = resolveProvider(ns);
  const tags = m.tags || [];
  return {
    hfId: m.id,
    model: {
      id: `hf:${m.id}`,
      name: slug.replace(/_/g, " "),
      provider: provider.name,
      providerKey: provider.key,
      family: slug.toLowerCase().split(/[-_.]/)[0] || null,
      generation: null,
      country: null,
      type: tags.includes("reasoning") ? "Reasoning" : "General",
      access: "Open",
      released: (m.createdAt || m.lastModified || "").slice(0, 10) || null,
      cutoff: null,
      parameters: null,
      contextWindow: null,
      contextTokens: null,
      pricing: null,
      multimodal: tags.some((t) => /image-text-to-text|multimodal|vision/i.test(t)),
      reasoning: tags.includes("reasoning"),
      description: null, // filled from the model card by the enrichment pass
      sourceUrl: `https://huggingface.co/${m.id}`,
      benchmarks: {},
      benchmarkSources: {},
      normalized: {},
      benchmarkCount: 0,
      measuredScore: null,
      ultimateScore: 0,
      scoreStatus: "imputed",
      imputationReason: null,
      ceilingReason: null,
      tags: ["Open Weights"],
      source: "huggingface-hub",
      fetchedAt: now,
    } as Model,
  };
}

// --- model card enrichment --------------------------------------------------
// The card README is where labs publish the benchmark tables. Fetching it gives
// the extractor real, citable numbers to work with.

export async function fetchModelCard(hfId: string): Promise<string | null> {
  try {
    const res = await fetch(`https://huggingface.co/${hfId}/raw/main/README.md`, {
      headers: { Accept: "text/plain" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.length > 400_000 ? text.slice(0, 400_000) : text;
  } catch {
    return null;
  }
}

// Condense a model card into a readable summary paragraph for the Feed/sheet:
// the first substantive prose lines, with markdown furniture stripped.
export function summarizeCard(md: string, fallback: string): string {
  const body = md.replace(/^---[\s\S]*?---/, ""); // drop YAML front-matter
  const lines = body.split("\n");
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^[#>|]/.test(line)) continue; // headings, quotes, tables
    if (/^[-*+]\s/.test(line)) continue; // bullets
    if (/^<|^\[!\[|^!\[|^\[/.test(line)) continue; // html / badges / links
    if (/^```/.test(line)) break; // stop at the first code block
    const clean = line
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[*_`]/g, "")
      .trim();
    if (clean.length < 40) continue;
    out.push(clean);
    if (out.join(" ").length > 500) break;
  }
  const text = out.join(" ").replace(/\s+/g, " ").trim();
  return text.length >= 60 ? text.slice(0, 900) : fallback;
}
