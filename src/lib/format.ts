import { BENCHMARKS, normalize } from "./scoring";
import type { Model, ScoreStatus } from "../types";

export function fmtScore(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return (Math.round(n * 10) / 10).toFixed(1);
}

export function dateLabel(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return iso;
  }
}

export function relativeDays(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const days = Math.round((Date.now() - d) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

export function statusChipClass(s: ScoreStatus): string {
  if (s === "measured") return "chip chip-green";
  if (s === "partial") return "chip chip-amber";
  return "chip chip-red";
}

export function tierLabel(tier?: string): string {
  switch (tier) {
    case "flagship":
      return "Flagship";
    case "frontier":
      return "Frontier";
    case "lightweight":
      return "Lightweight";
    default:
      return "General";
  }
}

// Deterministic colour from a string (provider/monogram background).
export function colorFromString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h} 70% 55%)`;
}

export function monogram(name: string, providerKey?: string): string {
  const base = providerKey || name || "?";
  const parts = base.replace(/[^a-zA-Z0-9 ]/g, " ").split(/[\s/-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Sorted verified benchmarks for display (hardest first).
export function verifiedBenchmarks(m: Model) {
  return BENCHMARKS.map((b) => ({
    meta: b,
    raw: m.benchmarks[b.key],
    norm: normalize(b.key, m.benchmarks[b.key]),
  })).filter((x) => typeof x.raw === "number");
}
