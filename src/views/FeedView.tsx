import { useState } from "react";
import type { ArenaData } from "../lib/data";
import type { FeedItem, Model } from "../types";
import { dateLabel, fmtScore, relativeDays, statusChipClass } from "../lib/format";
import { ModelSheet } from "../components/ModelSheet";

type Filter = "fresh" | "leaderboard" | "progress";

const FILTERS: { key: Filter; label: string; desc: string }[] = [
  { key: "fresh", label: "Fresh", desc: "Newest releases & drops" },
  { key: "leaderboard", label: "Leaderboard Shifts", desc: "Rank changes & movers" },
  { key: "progress", label: "Industry Progress", desc: "Provider activity" },
];

export function FeedView({ data }: { data: ArenaData }) {
  const [filter, setFilter] = useState<Filter>("fresh");
  const [active, setActive] = useState<Model | null>(null);

  const items: FeedItem[] = data.feed;

  function openModel(modelId: string) {
    const m = data.models.find((x) => x.id === modelId);
    if (m) setActive(m);
  }

  return (
    <>
      <h1 className="view-title">Feed</h1>
      <p className="view-sub">Live wire of frontier model releases, rank shifts, and industry moves.</p>

      <div className="row gap-6 wrap mt-12">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className={`chip ${filter === f.key ? "chip-accent" : ""}`}
            onClick={() => setFilter(f.key)}
            style={{ padding: "8px 12px" }}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-12">
        {filter === "leaderboard" ? (
          <LeaderboardShifts data={data} />
        ) : filter === "progress" ? (
          <IndustryProgress data={data} />
        ) : (
          items.slice(0, 30).map((f) => (
            <FeedCard key={f.id} item={f} onOpen={() => openModel(f.modelId)} />
          ))
        )}
      </div>

      {active ? (
        <ModelSheet model={active} models={data.models} onClose={() => setActive(null)} />
      ) : null}
    </>
  );
}

function FeedCard({ item, onOpen }: { item: FeedItem; onOpen: () => void }) {
  return (
    <article
      className="feed-item feed-item-tap"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="feed-head">
        <div className="row gap-6 wrap">
          <span className="feed-date">{dateLabel(item.released)}</span>
          <span className="chip">{item.provider}</span>
          <span className={statusChipClass(item.scoreStatus)}>{item.scoreStatus}</span>
        </div>
        <div className="score" style={{ color: "var(--accent)", fontSize: 15 }}>
          {fmtScore(item.ultimateScore)}
        </div>
      </div>
      <div className="feed-title">{item.title}</div>
      {item.summary ? <p className="feed-summary mt-8">{item.summary}</p> : null}
      <div className="tiny muted mt-8">
        {item.type ?? "model"} · {item.benchmarkCount ?? 0}/8 benchmarks · {relativeDays(item.released)}
        {item.sourceUrl ? (
          <>
            {" · "}
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--cyan)" }}
              onClick={(e) => e.stopPropagation()}
            >
              source
            </a>
          </>
        ) : null}
      </div>
    </article>
  );
}

function LeaderboardShifts({ data }: { data: ArenaData }) {
  const ranked = [...data.models].sort((a, b) => b.ultimateScore - a.ultimateScore);
  const gaps = [];
  for (let i = 1; i < Math.min(ranked.length, 20); i++) {
    const gap = ranked[i - 1].ultimateScore - ranked[i].ultimateScore;
    gaps.push({ a: ranked[i - 1], b: ranked[i], gap });
  }
  gaps.sort((x, y) => y.gap - x.gap);
  return (
    <div className="card" style={{ padding: "4px" }}>
      {gaps.slice(0, 10).map((g, i) => (
        <div className="model-row" key={i}>
          <div style={{ flex: 1 }}>
            <div className="model-name">
              {g.a.name} <span className="muted">→</span> {g.b.name}
            </div>
            <div className="model-meta">
              rank #{i + 1} separator · {fmtScore(g.a.ultimateScore)} vs {fmtScore(g.b.ultimateScore)}
            </div>
          </div>
          <div className="score" style={{ color: "var(--cyan)" }}>
            +{fmtScore(g.gap)}
          </div>
        </div>
      ))}
    </div>
  );
}

function IndustryProgress({ data }: { data: ArenaData }) {
  const top = [...data.companies].sort((a, b) => b.modelCount - a.modelCount).slice(0, 12);
  return (
    <>
      {top.map((c) => (
        <div className="company-card" key={c.key}>
          <div className="monogram" style={{ background: c.color }} aria-hidden>
            {c.monogram}
          </div>
          <div className="company-info">
            <div className="company-name">
              {c.name} <span className="muted tiny">· {c.modelCount} models</span>
            </div>
            <div className="company-blurb">{c.blurb}</div>
            <div className="tiny muted mt-8">
              latest: {c.latestModel ?? "—"} ({dateLabel(c.latestRelease)})
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
