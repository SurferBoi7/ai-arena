import { useState } from "react";
import type { ArenaData } from "../lib/data";
import { dateLabel } from "../lib/format";

export function ArchiveView({ data }: { data: ArenaData }) {
  const [q, setQ] = useState("");
  const companies = [...data.companies].sort((a, b) => b.modelCount - a.modelCount);
  const filtered = companies.filter(
    (c) =>
      !q ||
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      (c.latestModel ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <h1 className="view-title">Archive</h1>
      <p className="view-sub">Provider directory — model counts, latest releases, and lineages.</p>

      <input
        className="input mt-12"
        placeholder="Search providers or models…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="mt-12">
        {filtered.map((c) => (
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
                latest release: <strong style={{ color: "var(--text-2)" }}>{c.latestModel ?? "—"}</strong>
                {c.latestRelease ? ` · ${dateLabel(c.latestRelease)}` : ""}
              </div>
            </div>
          </div>
        ))}
        {filtered.length === 0 ? <div className="muted center" style={{ padding: 24 }}>No matches.</div> : null}
      </div>
    </>
  );
}
