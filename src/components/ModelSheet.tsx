// =============================================================================
// ModelSheet — the "Model Pop-up Card" shown when a Feed/Arena model is tapped.
// =============================================================================
// Deterministic breakdown built entirely from the parsed JSON: exact calculated
// scores, per-benchmark normalised bars, the model's direct performance delta
// (vs the rank above / below), its closest mathematical rivals, and its full
// text description. No AI generation.
// =============================================================================

import { useMemo } from "react";
import type { Model } from "../types";
import { BENCHMARKS } from "../lib/scoring";
import { rankedModels } from "../lib/data";
import {
  colorFromString,
  dateLabel,
  fmtScore,
  monogram,
  statusChipClass,
  tierLabel,
} from "../lib/format";
import { Sheet } from "./Sheet";

export function ModelSheet({
  model,
  models,
  onClose,
}: {
  model: Model;
  models: Model[];
  onClose: () => void;
}) {
  const { rank, above, below, rivals } = useMemo(() => {
    const ranked = rankedModels(models);
    const idx = ranked.findIndex((m) => m.id === model.id);
    const above = idx > 0 ? ranked[idx - 1] : null;
    const below = idx >= 0 && idx < ranked.length - 1 ? ranked[idx + 1] : null;
    // Closest mathematical rivals: smallest absolute score distance.
    const rivals = ranked
      .filter((m) => m.id !== model.id)
      .map((m) => ({ m, diff: Math.abs(m.ultimateScore - model.ultimateScore) }))
      .sort((a, b) => a.diff - b.diff || b.m.ultimateScore - a.m.ultimateScore)
      .slice(0, 3);
    return { rank: idx + 1, above, below, rivals };
  }, [model, models]);

  const color = colorFromString(model.providerKey || model.provider || model.name);
  const deltaAbove = above ? model.ultimateScore - above.ultimateScore : null;
  const deltaBelow = below ? model.ultimateScore - below.ultimateScore : null;

  const benches = BENCHMARKS.map((b) => ({
    meta: b,
    raw: model.benchmarks[b.key],
    norm: model.normalized?.[b.key] ?? null,
  }));

  return (
    <Sheet onClose={onClose} labelledBy="model-sheet-name" size="lg">
      {/* Header */}
      <div className="row gap-6" style={{ alignItems: "flex-start" }}>
        <div className="monogram" style={{ background: color, width: 46, height: 46 }} aria-hidden>
          {monogram(model.name, model.providerKey)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div id="model-sheet-name" className="sheet-title">
            {model.name}
          </div>
          <div className="model-meta" style={{ marginTop: 4 }}>
            <span>{model.provider}</span>
            <span>·</span>
            <span>{tierLabel(model.tier)}</span>
            {model.released ? (
              <>
                <span>·</span>
                <span>{dateLabel(model.released)}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="model-right">
          <div className="score score-lg" style={{ color: "var(--accent)" }}>
            {fmtScore(model.ultimateScore)}
          </div>
          <div className="tiny muted" style={{ marginTop: 2 }}>
            rank #{rank || "—"}
          </div>
        </div>
      </div>

      {/* Status + tags */}
      <div className="row gap-6 wrap mt-12">
        <span className={statusChipClass(model.scoreStatus)}>{model.scoreStatus}</span>
        <span className="chip">{model.benchmarkCount}/8 benchmarks</span>
        {model.access ? <span className="chip">{model.access}</span> : null}
        {model.type ? <span className="chip">{model.type}</span> : null}
        {model.contextWindow ? <span className="chip">{model.contextWindow}</span> : null}
      </div>

      {/* Calculated scores */}
      <div className="section-head">Calculated scores</div>
      <div className="card">
        <div className="kv">
          <span className="muted">Arena (final)</span>
          <span className="score" style={{ color: "var(--accent)" }}>{fmtScore(model.ultimateScore)}</span>
        </div>
        <div className="kv">
          <span className="muted">Verified mean (pre-penalty)</span>
          <span className="score">{fmtScore(model.measuredScore)}</span>
        </div>
        <div className="kv">
          <span className="muted">Δ vs rank above{above ? ` (${above.name})` : ""}</span>
          <span className="score" style={{ color: deltaAbove === null ? "var(--muted)" : "var(--red)" }}>
            {deltaAbove === null ? "leader" : fmtScore(deltaAbove)}
          </span>
        </div>
        <div className="kv">
          <span className="muted">Lead over rank below{below ? ` (${below.name})` : ""}</span>
          <span className="score" style={{ color: deltaBelow === null ? "var(--muted)" : "var(--green-2)" }}>
            {deltaBelow === null ? "floor" : `+${fmtScore(deltaBelow)}`}
          </span>
        </div>
      </div>

      {/* Benchmark bars */}
      <div className="section-head">Benchmark breakdown</div>
      <div className="card">
        {benches.map(({ meta, raw, norm }) => {
          const has = typeof raw === "number";
          const pct = has ? Math.max(2, Math.min(100, norm ?? 0)) : 0;
          return (
            <div className="bench-row" key={meta.key}>
              <div className="bench-head">
                <span className="bench-name" title={meta.label}>
                  {meta.label}
                  {meta.tier === "hyper" ? <span className="bench-flag">hyper</span> : null}
                </span>
                <span className="bench-val score">
                  {has ? `${raw}` : <span className="muted">—</span>}
                </span>
              </div>
              <div className="score-bar">
                <div
                  className="score-bar-fill"
                  style={{ width: `${pct}%`, opacity: has ? 1 : 0.12 }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Closest rivals */}
      <div className="section-head">Closest rivals</div>
      <div className="card" style={{ padding: 4 }}>
        {rivals.map(({ m, diff }) => (
          <div className="model-row" key={m.id}>
            <div
              className="monogram"
              style={{ background: colorFromString(m.providerKey || m.provider || m.name), width: 32, height: 32, fontSize: 12 }}
              aria-hidden
            >
              {monogram(m.name, m.providerKey)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="model-name" style={{ fontSize: 13.5 }}>{m.name}</div>
              <div className="model-meta">{m.provider}</div>
            </div>
            <div className="model-right">
              <div className="score">{fmtScore(m.ultimateScore)}</div>
              <div className="tiny muted">
                {m.ultimateScore >= model.ultimateScore ? "+" : "−"}
                {fmtScore(diff)}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Description */}
      {model.description ? (
        <>
          <div className="section-head">About</div>
          <p className="sheet-desc">{model.description}</p>
        </>
      ) : null}

      {model.sourceUrl ? (
        <a
          className="btn btn-ghost mt-12"
          href={model.sourceUrl}
          target="_blank"
          rel="noreferrer"
        >
          View source ↗
        </a>
      ) : null}
    </Sheet>
  );
}
