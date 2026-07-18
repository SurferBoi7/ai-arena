// =============================================================================
// src/lib/digest.ts — Client-side deterministic "Smart Report" generator.
// =============================================================================
// A faithful TypeScript port of server/digest.mjs so the deployed static site
// (GitHub Pages, no backend) can build the exact same digest in the browser —
// deterministically from the parsed JSON data. NO AI, no external APIs.
//
// Used by the Settings "Send Test Digest Now" flow: in production it renders
// this HTML into an in-app preview and registers the email locally; in local
// dev the same options are also POSTed to the real dispatch server.
// =============================================================================

import type { ArenaData } from "./data";
import type { Company, FeedItem, Meta, Model } from "../types";

export interface DigestSections {
  leaderboard: boolean;
  movers: boolean;
  releases: boolean;
  flagships: boolean;
  industry: boolean;
}

export interface DigestOptions {
  email: string;
  frequency: "daily" | "weekly";
  time: string;
  topN: number;
  sections: DigestSections;
}

export const DEFAULT_SECTIONS: DigestSections = {
  leaderboard: true,
  movers: true,
  releases: true,
  flagships: true,
  industry: true,
};

// ---------------------------------------------------------------------------
// Pure helpers — deterministic, no randomness.
// ---------------------------------------------------------------------------

function fmtScore(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return (Math.round(n * 10) / 10).toFixed(1);
}

function dateLabel(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface Mover {
  rank: number;
  model: Model;
  prev: Model;
  gap: number;
}

function movers(models: Model[], n = 5): Mover[] {
  const ranked = [...models].sort(
    (a, b) => b.ultimateScore - a.ultimateScore || b.benchmarkCount - a.benchmarkCount,
  );
  const gaps: Mover[] = [];
  for (let i = 1; i < ranked.length; i++) {
    const gap = ranked[i - 1].ultimateScore - ranked[i].ultimateScore;
    gaps.push({ rank: i + 1, model: ranked[i], prev: ranked[i - 1], gap });
  }
  return gaps.sort((a, b) => b.gap - a.gap).slice(0, n);
}

// ---------------------------------------------------------------------------
// Subject line (deterministic).
// ---------------------------------------------------------------------------

export function buildSubject(meta: Meta, options: DigestOptions): string {
  const top = meta.topModel;
  const when = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const cadence = options.frequency === "daily" ? "Daily" : "Weekly";
  const lead = top ? `${top.name} leads (${fmtScore(top.score)})` : "Arena updated";
  return `AI Arena ${cadence} Smart Report — ${lead} · ${when}`;
}

// ---------------------------------------------------------------------------
// Plain-text body (deterministic).
// ---------------------------------------------------------------------------

export function buildText(data: ArenaData, options: DigestOptions): string {
  const { models, feed, companies, meta } = data;
  const topN = options.topN || 10;
  const sections = { ...DEFAULT_SECTIONS, ...(options.sections || {}) };
  const ranked = [...models].sort(
    (a, b) => b.ultimateScore - a.ultimateScore || b.benchmarkCount - a.benchmarkCount,
  );
  const L: string[] = [];
  const rule = "═══════════════════════════════════════════════════════════";

  L.push("AI ARENA — SMART REPORT");
  L.push(rule);
  L.push(`Generated: ${new Date().toISOString()}`);
  L.push(
    `Models tracked: ${meta.modelCount}  ·  Measured: ${meta.measuredCount}  ·  No-data (floor): ${meta.imputedCount}`,
  );
  L.push(`Cadence: ${options.frequency} at ${options.time}`);
  L.push("");

  if (sections.leaderboard) {
    L.push(`▶ ARENA LEADERBOARD — TOP ${topN}`);
    L.push(rule);
    ranked.slice(0, topN).forEach((m, i) => {
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`;
      L.push(
        `${medal}  ${fmtScore(m.ultimateScore).padStart(5)}  ${m.name}  ` +
          `(${m.provider} · ${m.benchmarkCount} benchmarks · ${m.scoreStatus})`,
      );
    });
    L.push("");
  }

  if (sections.movers) {
    L.push("▶ BIGGEST RANK SEPARATORS");
    L.push(rule);
    for (const g of movers(models, 5)) {
      L.push(
        `• ${g.prev.name} → ${g.model.name}: +${fmtScore(g.gap)} gap ` +
          `(${fmtScore(g.prev.ultimateScore)} vs ${fmtScore(g.model.ultimateScore)})`,
      );
    }
    L.push("");
  }

  if (sections.flagships) {
    L.push("▶ FLAGSHIP WATCH (Fable · Mythos · Opus)");
    L.push(rule);
    for (const m of ranked.filter((m) => /fable|mythos|opus/i.test(m.name))) {
      L.push(
        `• ${m.name.padEnd(26)} ${fmtScore(m.ultimateScore).padStart(5)}  ` +
          `SWE-bench ${m.benchmarks.swe_bench ?? "—"}% · HLE ${m.benchmarks.hle ?? "—"}%`,
      );
    }
    L.push("");
  }

  if (sections.releases) {
    L.push("▶ FRESH RELEASES");
    L.push(rule);
    feed.slice(0, 6).forEach((f: FeedItem) => {
      L.push(
        `• ${dateLabel(f.released)}  ${f.title}  — ${f.provider}  ` +
          `(Arena ${fmtScore(f.ultimateScore)}, ${f.scoreStatus})`,
      );
    });
    L.push("");
  }

  if (sections.industry) {
    L.push("▶ INDUSTRY PULSE");
    L.push(rule);
    for (const c of companies.slice(0, 8)) {
      L.push(
        `• ${c.name.padEnd(22)} ${String(c.modelCount).padStart(3)} models  ` +
          `latest: ${c.latestModel ?? "—"} (${dateLabel(c.latestRelease)})`,
      );
    }
    L.push("");
  }

  L.push(rule);
  L.push(
    "Scoring: weighted verified mean (SWE-bench & HLE weighted highest) + " +
      "hyper-dominant omission penalty + vendor-verified flagship baselines + " +
      "intelligence ceiling. No grace-period imputation.",
  );
  L.push("");
  L.push("You are receiving this deterministic Smart Report from AI Arena.");
  L.push("Manage your preferences in the app's Settings tab.");
  return L.join("\n");
}

// ---------------------------------------------------------------------------
// HTML body (deterministic, inline-styled for email clients).
// ---------------------------------------------------------------------------

const BRAND = "#7c5cff";
const CYAN = "#22d3ee";
const INK = "#0a0c12";
const MUTED = "#6b7280";

interface RowOpts {
  align?: (string | null)[];
  bold?: boolean[];
  color?: string;
}

export function buildHtml(data: ArenaData, options: DigestOptions): string {
  const { models, feed, companies, meta } = data;
  const topN = options.topN || 10;
  const sections = { ...DEFAULT_SECTIONS, ...(options.sections || {}) };
  const ranked = [...models].sort(
    (a, b) => b.ultimateScore - a.ultimateScore || b.benchmarkCount - a.benchmarkCount,
  );

  const medal = (i: number) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : String(i + 1));

  const row = (cells: string[], opts: RowOpts = {}) =>
    `<tr>${cells
      .map(
        (c, i) =>
          `<td style="padding:10px 12px;border-bottom:1px solid #eef0f4;` +
          `${opts.align?.[i] ? `text-align:${opts.align[i]};` : ""}${
            opts.bold?.[i] ? "font-weight:600;" : ""
          }${opts.color ? `color:${opts.color};` : ""}">${c}</td>`,
      )
      .join("")}</tr>`;

  let body = "";

  // Header
  body +=
    `<div style="background:linear-gradient(135deg,${BRAND},#5b3df0);padding:28px 24px;border-radius:14px 14px 0 0;">` +
    `<div style="font-size:12px;letter-spacing:2px;color:#ffffffcc;text-transform:uppercase;font-weight:700;">AI Arena</div>` +
    `<div style="font-size:26px;font-weight:800;color:#fff;margin-top:6px;">Smart Report</div>` +
    `<div style="font-size:13px;color:#ffffffcc;margin-top:8px;">${escapeHtml(
      new Date().toLocaleDateString("en-GB", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      }),
    )} · ${escapeHtml(options.frequency)} digest</div></div>`;

  body +=
    `<div style="background:#ffffff;padding:24px;color:#0a0c12;font-family:Inter,Arial,sans-serif;">` +
    `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px;">` +
    `<span style="background:#f3f0ff;color:${BRAND};padding:6px 12px;border-radius:999px;font-size:12px;font-weight:600;">${meta.modelCount} models</span>` +
    `<span style="background:#ecfeff;color:#0e7490;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:600;">${meta.measuredCount} measured</span>` +
    `<span style="background:#fff1f2;color:#be123c;padding:6px 12px;border-radius:999px;font-size:12px;font-weight:600;">${meta.imputedCount} no-data (floor)</span>` +
    `</div>`;

  const sectionHead = (title: string, accent = BRAND) =>
    `<h2 style="font-size:15px;font-weight:700;color:${INK};margin:24px 0 10px;border-left:4px solid ${accent};padding-left:10px;">${title}</h2>`;

  if (sections.leaderboard) {
    body += sectionHead(`Arena Leaderboard — Top ${topN}`);
    body += `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">`;
    body +=
      `<thead><tr style="background:#f8f9fb;">` +
      `<th style="padding:8px 12px;text-align:left;color:${MUTED};font-size:11px;text-transform:uppercase;">#</th>` +
      `<th style="padding:8px 12px;text-align:left;color:${MUTED};font-size:11px;text-transform:uppercase;">Model</th>` +
      `<th style="padding:8px 12px;text-align:right;color:${MUTED};font-size:11px;text-transform:uppercase;">Score</th>` +
      `<th style="padding:8px 12px;text-align:left;color:${MUTED};font-size:11px;text-transform:uppercase;">Benchmarks</th>` +
      `<th style="padding:8px 12px;text-align:left;color:${MUTED};font-size:11px;text-transform:uppercase;">Status</th></tr></thead><tbody>`;
    ranked.slice(0, topN).forEach((m, i) => {
      const statusColor =
        m.scoreStatus === "measured"
          ? "#059669"
          : m.scoreStatus === "partial"
            ? "#b45309"
            : "#be123c";
      body += row(
        [
          medal(i),
          `<strong>${escapeHtml(m.name)}</strong><br/><span style="color:${MUTED};font-size:11px;">${escapeHtml(m.provider)}</span>`,
          `<div style="font-family:'JetBrains Mono',monospace;font-weight:700;color:${BRAND};font-size:15px;">${fmtScore(m.ultimateScore)}</div>`,
          `${m.benchmarkCount}/8`,
          `<span style="color:${statusColor};font-weight:600;text-transform:capitalize;">${m.scoreStatus}</span>`,
        ],
        { align: [null, "left", "right", "left", "left"] },
      );
    });
    body += `</tbody></table>`;
  }

  if (sections.movers) {
    body += sectionHead("Biggest Rank Separators", CYAN);
    body += `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;"><tbody>`;
    for (const g of movers(models, 5)) {
      body += row(
        [
          `${escapeHtml(g.prev.name)} <span style="color:${MUTED};">→</span> ${escapeHtml(g.model.name)}`,
          `<span style="color:${BRAND};font-weight:700;">+${fmtScore(g.gap)}</span> gap`,
        ],
        { align: ["left", "right"] },
      );
    }
    body += `</tbody></table>`;
  }

  if (sections.flagships) {
    body += sectionHead("Flagship Watch — Fable · Mythos · Opus");
    body += `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;"><tbody>`;
    for (const m of ranked.filter((m) => /fable|mythos|opus/i.test(m.name))) {
      body += row(
        [
          `<strong>${escapeHtml(m.name)}</strong>`,
          `<span style="font-family:'JetBrains Mono',monospace;font-weight:700;color:${BRAND};">${fmtScore(m.ultimateScore)}</span>`,
          `SWE-bench <strong>${m.benchmarks.swe_bench ?? "—"}</strong> · HLE <strong>${m.benchmarks.hle ?? "—"}</strong>`,
        ],
        { align: ["left", "right", "left"] },
      );
    }
    body += `</tbody></table>`;
  }

  if (sections.releases) {
    body += sectionHead("Fresh Releases", "#34d399");
    body += `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;"><tbody>`;
    feed.slice(0, 6).forEach((f: FeedItem) => {
      body += row(
        [
          `${dateLabel(f.released)}`,
          `<strong>${escapeHtml(f.title)}</strong> <span style="color:${MUTED};">— ${escapeHtml(f.provider)}</span>`,
          `Arena <strong style="color:${BRAND};">${fmtScore(f.ultimateScore)}</strong>`,
        ],
        { align: ["left", "left", "right"] },
      );
    });
    body += `</tbody></table>`;
  }

  if (sections.industry) {
    body += sectionHead("Industry Pulse");
    body += `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;"><tbody>`;
    for (const c of companies.slice(0, 8) as Company[]) {
      body += row(
        [
          `<strong>${escapeHtml(c.name)}</strong>`,
          `${c.modelCount} models`,
          `latest: ${escapeHtml(c.latestModel ?? "—")} (${dateLabel(c.latestRelease)})`,
        ],
        { align: ["left", "right", "left"] },
      );
    }
    body += `</tbody></table>`;
  }

  // Footer
  body +=
    `<div style="margin-top:28px;padding:16px;background:#f8f9fb;border-radius:10px;font-size:11px;color:${MUTED};line-height:1.6;">` +
    `<strong style="color:${INK};">How scoring works.</strong> ` +
    `Weighted verified mean (SWE-bench Verified & Humanity's Last Exam weighted highest) ` +
    `+ hyper-dominant omission penalty for missing benchmarks + vendor-verified flagship ` +
    `baselines + an intelligence ceiling that hard-caps lightweight/utility models below ` +
    `flagships unless they sweep the hardest benchmarks with verified data. No grace-period imputation.` +
    `</div>` +
    `<div style="text-align:center;margin-top:16px;font-size:11px;color:${MUTED};">` +
    `Sent by AI Arena · manage preferences in the app's Settings tab</div>` +
    `</div>`;

  return (
    `<!doctype html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>` +
    `<title>AI Arena Smart Report</title></head>` +
    `<body style="margin:0;padding:24px;background:#eef0f4;font-family:Inter,Arial,sans-serif;">` +
    `<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(10,12,18,0.08);">` +
    body +
    `</div></body></html>`
  );
}

export interface Digest {
  subject: string;
  text: string;
  html: string;
}

export function generateDigest(data: ArenaData, options: DigestOptions): Digest {
  return {
    subject: buildSubject(data.meta, options),
    text: buildText(data, options),
    html: buildHtml(data, options),
  };
}
