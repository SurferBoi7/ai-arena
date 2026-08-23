// =============================================================================
// scripts/update-data.ts — live discovery + re-score pipeline (Actions entry).
//
// 1. Load the committed baseline data (curated frontier set + vendor notes).
// 2. Discover NEW releases from two free, no-key sources:
//      • OpenRouter  — closed + open frontier catalogue (GPT / Claude / Gemini
//        never appear on the HF Hub, so this is the only way to see them)
//      • HuggingFace — trending + recently-updated open-weight releases
// 3. Enrich new models from their published model cards: a real description,
//    plus REAL benchmark values parsed out of the card's results table.
// 4. Apply vendor-verified baselines + text extraction + the reality-corrected
//    scoring engine, then rebuild the provider directory.
// 5. Write models.json / feed.json / companies.json / meta.json.
//
// This script NEVER fails the build on a scraping hiccup — if a source is
// unavailable it re-scores what it has and continues.
//   npm run update-data
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Company, Model } from "../src/types";
import { applyVendorBaselines, finalize } from "./lib/pipeline";
import {
  extractBenchmarks,
  extractFromCard,
  inheritVariantBenchmarks,
  isRedundantVariant,
  realBenchmarkCount as realCount,
} from "./lib/extract-benchmarks";
import {
  fetchHuggingFace,
  fetchModelCard,
  fetchOpenRouter,
  hfQualifies,
  hfToModel,
  isNonTextModel,
  normalizeName,
  openRouterToModel,
  resolveProvider,
  summarizeCard,
  type DiscoveredModel,
} from "./lib/sources";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../public/data");

// Only consider releases from roughly the last two years as "new arrivals" —
// older catalogue entries are historical and already covered by the baseline.
const MAX_AGE_DAYS = 730;
// Bound the per-run work so a scheduled run stays fast and predictable.
const MAX_NEW_PER_RUN = 40;
const MAX_CARD_FETCHES = 160;
const CARD_CONCURRENCY = 10;

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(DATA_DIR, file), "utf-8")) as T;
}
function serialize(data: unknown): string {
  return JSON.stringify(data, null, 1) + "\n";
}
function writeIfChanged(file: string, data: unknown): boolean {
  const next = serialize(data);
  const path = resolve(DATA_DIR, file);
  let prev = "";
  try {
    prev = readFileSync(path, "utf-8");
  } catch {
    /* new file */
  }
  if (prev === next) return false;
  writeFileSync(path, next, "utf-8");
  return true;
}

function ageInDays(iso?: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 86_400_000;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------------------------------------------------------------------------
// Provider directory — kept in sync so new providers appear in the Archive.
// Curated blurb / colour / monogram are preserved; counts are recomputed.
// ---------------------------------------------------------------------------

function hexFromKey(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  // Deterministic mid-bright hue, converted to hex for the committed JSON.
  const s = 0.62;
  const l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rebuildCompanies(models: Model[], existing: Company[]): Company[] {
  const byKey = new Map(existing.map((c) => [c.key, c]));
  const groups = new Map<string, Model[]>();
  for (const m of models) {
    const key = m.providerKey || "independent";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  const out: Company[] = [];
  for (const [key, list] of groups) {
    const dated = list
      .filter((m) => m.released)
      .sort((a, b) => (b.released || "").localeCompare(a.released || ""));
    const latest = dated[0];
    const prior = byKey.get(key);
    const name = prior?.name || list[0].provider || key;
    out.push({
      key,
      name,
      monogram: prior?.monogram || name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "?",
      color: prior?.color || hexFromKey(key),
      blurb: prior?.blurb || `Models tracked from ${name}.`,
      modelCount: list.length,
      latestRelease: latest?.released ?? null,
      latestModel: latest?.name ?? null,
    });
  }
  out.sort((a, b) => b.modelCount - a.modelCount || a.name.localeCompare(b.name));
  return out;
}

// ---------------------------------------------------------------------------

async function discover(existing: Model[], now: string) {
  const status: { source: string; status: string; models?: number; note?: string }[] = [];
  const knownIds = new Set(existing.map((m) => m.id));
  const knownNames = new Set(existing.map((m) => normalizeName(m.name)));
  const knownHf = new Set(
    existing.map((m) => (m.id.startsWith("hf:") ? m.id.slice(3).toLowerCase() : "")).filter(Boolean),
  );
  const candidates: DiscoveredModel[] = [];

  const accept = (d: DiscoveredModel | null): void => {
    if (!d) return;
    const { model, hfId } = d;
    if (knownIds.has(model.id)) return;
    const norm = normalizeName(model.name);
    if (!norm || knownNames.has(norm)) return;
    if (hfId && knownHf.has(hfId.toLowerCase())) return;
    if (ageInDays(model.released) > MAX_AGE_DAYS) return;
    // Skip a vendor-confirmed re-serving of an already-tracked model that
    // itself has no real benchmark data (e.g. "GPT-5.6 Luna Pro" when
    // "GPT-5.6 Luna" is unscored): admitting it would just be a second
    // permanent zero for the same underlying weights, not a new data point.
    // Checked against both committed models and this run's own candidates so
    // catalogue order can't let a duplicate slip through.
    if (isRedundantVariant(model, existing.concat(candidates.map((c) => c.model)))) return;
    knownIds.add(model.id);
    knownNames.add(norm);
    if (hfId) knownHf.add(hfId.toLowerCase());
    candidates.push(d);
  };

  // --- OpenRouter (frontier catalogue, incl. closed models) ---
  try {
    const raw = await fetchOpenRouter();
    const before = candidates.length;
    for (const m of [...raw].sort((a, b) => (b.created ?? 0) - (a.created ?? 0))) {
      accept(openRouterToModel(m, now));
    }
    const added = candidates.length - before;
    status.push({ source: "openrouter", status: "ok", models: raw.length, note: `${added} new` });
    console.log(`OpenRouter: ${raw.length} catalogue entries, ${added} new.`);
  } catch (e) {
    status.push({ source: "openrouter", status: "unavailable", note: (e as Error).message });
    console.warn(`OpenRouter skipped: ${(e as Error).message}`);
  }

  // --- HuggingFace Hub (new open-weight releases) ---
  try {
    const raw = await fetchHuggingFace();
    const before = candidates.length;
    for (const m of raw) {
      if (!hfQualifies(m)) continue;
      accept(hfToModel(m, now));
    }
    const added = candidates.length - before;
    status.push({ source: "huggingface-hub", status: "ok", models: raw.length, note: `${added} new` });
    console.log(`HuggingFace: ${raw.length} scanned, ${added} new.`);
  } catch (e) {
    status.push({ source: "huggingface-hub", status: "unavailable", note: (e as Error).message });
    console.warn(`HuggingFace skipped: ${(e as Error).message}`);
  }

  // Newest first, then cap the batch.
  candidates.sort((a, b) => (b.model.released || "").localeCompare(a.model.released || ""));
  const batch = candidates.slice(0, MAX_NEW_PER_RUN);
  return { batch, status };
}

// Pull real descriptions + benchmark tables from published model cards. Applies
// to new arrivals first, then to every tracked open-weight model still lacking
// a score — whether it was discovered via HuggingFace directly (`hf:` id) or
// via OpenRouter with a known HF mirror (`hfRef`) — so a model that publishes
// results later is picked up on a subsequent run rather than staying blind
// forever. Zero-benchmark models are prioritised over partial ones so the
// "no score at all" backlog clears first.
function hfIdOf(m: Model): string | null {
  if (m.id.startsWith("hf:")) return m.id.slice(3);
  return m.hfRef || null;
}

async function enrich(batch: DiscoveredModel[], existing: Model[], now: string) {
  const targets: { model: Model; hfId: string }[] = [];
  const seen = new Set<string>();
  for (const d of batch) {
    if (!d.hfId || seen.has(d.model.id)) continue;
    seen.add(d.model.id);
    targets.push({ model: d.model, hfId: d.hfId });
  }

  const backlog = existing.filter((m) => {
    if (seen.has(m.id)) return false;
    const hfId = hfIdOf(m);
    if (!hfId) return false;
    // A card that already yielded SOME data is on a cooldown — it's unlikely
    // to change again soon, so don't burn budget re-fetching it every run. A
    // model still sitting at zero gets no such grace: either the source
    // genuinely has nothing (worth confirming again as cards get updated), or
    // it was fetched before the extractor could read its table shape — in
    // which case retrying is exactly what recovers it, as happened here.
    if (realCount(m) > 0 && ageInDays(m.fetchedAt) < 6) return false;
    return true;
  });
  // Models with zero real benchmarks first; within each group, longest since
  // last fetch first, so the backlog converges instead of favouring whichever
  // model happens to sort first alphabetically every run.
  backlog.sort((a, b) => {
    const az = realCount(a) === 0 ? 0 : 1;
    const bz = realCount(b) === 0 ? 0 : 1;
    if (az !== bz) return az - bz;
    return ageInDays(b.fetchedAt) === ageInDays(a.fetchedAt) ? 0 : ageInDays(b.fetchedAt) - ageInDays(a.fetchedAt);
  });
  for (const m of backlog) {
    if (targets.length >= MAX_CARD_FETCHES) break;
    const hfId = hfIdOf(m)!;
    seen.add(m.id);
    targets.push({ model: m, hfId });
  }

  const slice = targets.slice(0, MAX_CARD_FETCHES);
  let cards = 0;
  const fills: string[] = [];
  await mapLimit(slice, CARD_CONCURRENCY, async ({ model, hfId }) => {
    const md = await fetchModelCard(hfId);
    if (!md) return;
    cards++;
    model.fetchedAt = now;
    if (!model.description || model.description.length < 60) {
      model.description = summarizeCard(
        md,
        model.description || `Open-weight release published on the HuggingFace Hub (${hfId}).`,
      );
    }
    for (const f of extractFromCard(model, md)) {
      fills.push(`[card] ${f.name} · ${f.key} = ${f.value}  ⟵  ${f.context}`);
    }
  });
  return { cards, fills };
}

async function main() {
  let models = readJson<Model[]>("models.json");
  const companies = readJson<Company[]>("companies.json");
  const now = new Date().toISOString();
  console.log(`Loaded ${models.length} baseline models.`);

  // Self-healing prune: a handful of non-text models (TTS/OCR/image-edit) sat
  // in the tracked set from before this scope was made explicit. They can
  // never score on reasoning/coding benchmarks, so tracking them just adds a
  // permanent, misleading zero. Filtered at discovery for new arrivals too —
  // this catches anything already committed.
  const before = models.length;
  models = models.filter((m) => !isNonTextModel(m.name, m.tags || []));
  const pruned = before - models.length;
  if (pruned) console.log(`Pruned ${pruned} non-text model(s) (TTS/OCR/image/embedding — out of scope).`);

  // Same self-healing idea for re-served SKU duplicates: a model whose own
  // description vendor-confirms it's identical weights to an already-tracked,
  // still-unscored sibling ("GPT-5.6 Luna Pro" = "GPT-5.6 Luna", just served
  // with reasoning.mode=pro) contributes nothing as its own leaderboard row —
  // it's the same permanent zero as its twin. The `isRedundantVariant` filter
  // now blocks these at discovery time, but this catches ones already
  // committed before that filter existed. If the sibling has real data,
  // inheritance (below) fills this model in instead of pruning it.
  const beforeVariants = models.length;
  models = models.filter((m) => realCount(m) > 0 || !isRedundantVariant(m, models));
  const prunedVariants = beforeVariants - models.length;
  if (prunedVariants) {
    console.log(`Pruned ${prunedVariants} redundant serving-variant(s) of an already-tracked, unscored model.`);
  }

  let sourceStatuses: { source: string; status: string; models?: number; note?: string }[] = [];

  try {
    const { batch, status } = await discover(models, now);
    sourceStatuses = status;

    const { cards, fills } = await enrich(batch, models, now);
    for (const line of fills) console.log(line);
    console.log(`Model cards read: ${cards}; ${fills.length} benchmark value(s) recovered.`);

    for (const d of batch) {
      if (!d.model.description) {
        d.model.description = `${d.model.name} — ${d.model.provider} release listed on ${
          d.model.source === "openrouter" ? "OpenRouter" : "the HuggingFace Hub"
        }. Awaiting published benchmark results.`;
      }
      models.push(d.model);
    }
    console.log(`Added ${batch.length} new model(s).`);
  } catch (e) {
    console.warn(`Discovery skipped entirely: ${(e as Error).message}`);
    sourceStatuses.push({ source: "discovery", status: "error", note: (e as Error).message });
  }

  const { filled, notes } = applyVendorBaselines(models);
  for (const n of notes) console.log(n);
  if (filled) console.log(`Vendor baselines filled ${filled} gap(s).`);

  const { filled: extracted, fills } = extractBenchmarks(models);
  for (const f of fills) console.log(`[extract] ${f.name} · ${f.key} = ${f.value}  ⟵  "${f.context}"`);
  if (extracted) console.log(`Extracted ${extracted} real benchmark value(s) from source text.`);

  // Vendor-stated equivalence ("same underlying model as X, served with...").
  // Not an estimate — using the vendor's own words to copy X's real scores.
  const { filled: inherited, fills: inheritedFills } = inheritVariantBenchmarks(models);
  for (const f of inheritedFills) console.log(`[inherit] ${f.name} · ${f.key} = ${f.value}  ⟵  ${f.context}`);
  if (inherited) console.log(`Inherited ${inherited} benchmark value(s) from vendor-stated equivalent models.`);

  // Fold scrape aliases onto their parent company (qwen→alibaba, meta-llama→meta,
  // openai-community→openai …) so the Archive shows one entry per lab. Only true
  // aliases are rewritten; curated providers keep their display names.
  let folded = 0;
  for (const m of models) {
    const canon = resolveProvider(m.providerKey || "");
    if (canon.key !== m.providerKey) {
      m.providerKey = canon.key;
      m.provider = canon.name;
      folded++;
    }
  }
  if (folded) console.log(`Folded ${folded} model(s) onto canonical providers.`);

  const { models: sorted, feed, meta } = finalize(models);
  const nextCompanies = rebuildCompanies(sorted, companies);
  meta.sourceStatuses = [
    ...sourceStatuses,
    { source: "vendor-notes", status: "ok", note: "flagship system-card baselines" },
  ];
  meta.source = "openrouter+huggingface+vendor-notes";

  // Keep the previous timestamp when nothing of substance changed, so a quiet
  // run doesn't produce an empty "refresh" commit.
  const modelsChanged = writeIfChanged("models.json", sorted);
  const feedChanged = writeIfChanged("feed.json", feed);
  const companiesChanged = writeIfChanged("companies.json", nextCompanies);
  if (!modelsChanged && !feedChanged && !companiesChanged) {
    try {
      const prev = readJson<{ generatedAt?: string }>("meta.json");
      if (prev.generatedAt) meta.generatedAt = prev.generatedAt;
    } catch {
      /* ignore */
    }
  }
  const metaChanged = writeIfChanged("meta.json", meta);

  console.log(
    `\nFinal: ${sorted.length} models (measured ${meta.measuredCount}, no-data ${meta.imputedCount}).`,
  );
  console.log(`Top: ${sorted[0]?.name} (${sorted[0]?.ultimateScore}).`);
  console.log(
    `Changed → models:${modelsChanged} feed:${feedChanged} companies:${companiesChanged} meta:${metaChanged}`,
  );
}

main();
