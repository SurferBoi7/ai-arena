import type { Company, FeedItem, Meta, Model } from "../types";

const BASE = import.meta.env.BASE_URL || "/";

async function fetchJson<T>(file: string): Promise<T> {
  const res = await fetch(`${BASE}data/${file}`);
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);
  return (await res.json()) as T;
}

export interface ArenaData {
  models: Model[];
  feed: FeedItem[];
  companies: Company[];
  meta: Meta;
}

let cache: ArenaData | null = null;

export async function loadData(): Promise<ArenaData> {
  if (cache) return cache;
  const [models, feed, companies, meta] = await Promise.all([
    fetchJson<Model[]>("models.json"),
    fetchJson<FeedItem[]>("feed.json"),
    fetchJson<Company[]>("companies.json"),
    fetchJson<Meta>("meta.json"),
  ]);
  cache = { models, feed, companies, meta };
  return cache;
}

// Canonical client-side comparator (mirrors src/lib/scoring.compareModels).
export function compareModels(a: Model, b: Model): number {
  if (b.ultimateScore !== a.ultimateScore) return b.ultimateScore - a.ultimateScore;
  const order = ["flagship", "frontier", "general", "lightweight"];
  const ta = order.indexOf(a.tier ?? "general");
  const tb = order.indexOf(b.tier ?? "general");
  if (ta !== tb) return ta - tb;
  if (b.benchmarkCount !== a.benchmarkCount) return b.benchmarkCount - a.benchmarkCount;
  return (a.name || "").localeCompare(b.name || "");
}

export function rankedModels(models: Model[]): Model[] {
  return [...models].sort(compareModels);
}
