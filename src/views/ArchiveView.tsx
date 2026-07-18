import { useMemo, useState } from "react";
import type { ArenaData } from "../lib/data";
import type { Company, Model } from "../types";
import { dateLabel, fmtScore, statusChipClass, tierLabel } from "../lib/format";
import { rankedModels } from "../lib/data";
import { CompanyLogo } from "../components/CompanyLogos";
import { ModelSheet } from "../components/ModelSheet";

// Some scraped providerKeys are sub-labels of a parent company; fold them in so
// a company's full model lineage shows up under one roof.
const PROVIDER_ALIASES: Record<string, string> = {
  qwen: "alibaba",
  "meta-llama": "meta",
  facebook: "meta",
  "openai-community": "openai",
  "google-t5": "google",
};
const aliasKey = (k: string) => PROVIDER_ALIASES[k] ?? k;

// Deterministic supersession: a model is "legacy" if the same company ships a
// newer model in the same family (higher generation, or later release date when
// generations tie/are absent).
function isSuperseded(m: Model, siblings: Model[]): boolean {
  if (!m.family) return false;
  return siblings.some((o) => {
    if (o.id === m.id || o.family !== m.family) return false;
    const go = o.generation;
    const gm = m.generation;
    if (typeof go === "number" && typeof gm === "number" && go !== gm) return go > gm;
    if (o.released && m.released) return new Date(o.released).getTime() > new Date(m.released).getTime();
    return false;
  });
}

export function ArchiveView({ data }: { data: ArenaData }) {
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Company | null>(null);
  const [active, setActive] = useState<Model | null>(null);

  const companies = useMemo(
    () => [...data.companies].sort((a, b) => b.modelCount - a.modelCount),
    [data.companies],
  );

  if (selected) {
    return (
      <>
        <CompanyDetail
          company={selected}
          data={data}
          onBack={() => setSelected(null)}
          onOpenModel={setActive}
        />
        {active ? (
          <ModelSheet model={active} models={data.models} onClose={() => setActive(null)} />
        ) : null}
      </>
    );
  }

  const filtered = companies.filter(
    (c) =>
      !q ||
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      (c.latestModel ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <h1 className="view-title">Archive</h1>
      <p className="view-sub">Provider directory — tap a company for its full model lineage.</p>

      <input
        className="input mt-12"
        placeholder="Search providers or models…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="mt-12">
        {filtered.map((c) => (
          <button
            className="company-card company-card-tap"
            key={c.key}
            onClick={() => setSelected(c)}
          >
            <CompanyLogo providerKey={c.key} name={c.name} color={c.color} />
            <div className="company-info">
              <div className="company-name">
                {c.name} <span className="muted tiny">· {c.modelCount} models</span>
              </div>
              <div className="company-blurb">{c.blurb}</div>
              <div className="tiny muted mt-8">
                latest: <strong style={{ color: "var(--text-2)" }}>{c.latestModel ?? "—"}</strong>
                {c.latestRelease ? ` · ${dateLabel(c.latestRelease)}` : ""}
              </div>
            </div>
            <span className="company-chevron" aria-hidden>
              ›
            </span>
          </button>
        ))}
        {filtered.length === 0 ? (
          <div className="muted center" style={{ padding: 24 }}>
            No matches.
          </div>
        ) : null}
      </div>
    </>
  );
}

function CompanyDetail({
  company,
  data,
  onBack,
  onOpenModel,
}: {
  company: Company;
  data: ArenaData;
  onBack: () => void;
  onOpenModel: (m: Model) => void;
}) {
  const models = useMemo(() => {
    const mine = data.models.filter((m) => aliasKey(m.providerKey) === company.key);
    return rankedModels(mine);
  }, [data.models, company.key]);

  const current = useMemo(
    () => models.filter((m) => !isSuperseded(m, models)),
    [models],
  );
  const legacy = useMemo(
    () =>
      models
        .filter((m) => isSuperseded(m, models))
        .sort((a, b) => new Date(b.released ?? 0).getTime() - new Date(a.released ?? 0).getTime()),
    [models],
  );

  const measured = models.filter((m) => m.scoreStatus !== "imputed").length;

  return (
    <>
      <button className="back-btn" onClick={onBack}>
        ‹ All companies
      </button>

      <div className="company-hero">
        <CompanyLogo providerKey={company.key} name={company.name} color={company.color} size={56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="view-title" style={{ margin: 0 }}>
            {company.name}
          </div>
          <div className="company-blurb" style={{ WebkitLineClamp: 3 }}>
            {company.blurb}
          </div>
        </div>
      </div>

      <div className="row gap-6 wrap mt-12">
        <span className="chip">{models.length} models tracked</span>
        <span className="chip chip-green">{measured} measured</span>
        {company.latestModel ? (
          <span className="chip chip-accent">latest · {company.latestModel}</span>
        ) : null}
      </div>

      <div className="section-head">Current Flagship</div>
      {current.length ? (
        <div className="card" style={{ padding: 4 }}>
          {current.map((m) => (
            <LineageRow key={m.id} model={m} onOpen={() => onOpenModel(m)} />
          ))}
        </div>
      ) : (
        <div className="muted small" style={{ padding: "4px 2px" }}>
          No current flagship on record.
        </div>
      )}

      <div className="section-head">Discontinued / Legacy</div>
      {legacy.length ? (
        <div className="card" style={{ padding: 4 }}>
          {legacy.map((m) => (
            <LineageRow key={m.id} model={m} legacy onOpen={() => onOpenModel(m)} />
          ))}
        </div>
      ) : (
        <div className="muted small" style={{ padding: "4px 2px" }}>
          No superseded models — every tracked model is current.
        </div>
      )}
    </>
  );
}

function LineageRow({
  model,
  legacy,
  onOpen,
}: {
  model: Model;
  legacy?: boolean;
  onOpen: () => void;
}) {
  return (
    <div
      className="model-row model-row-tap"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      style={legacy ? { opacity: 0.72 } : undefined}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="model-name">{model.name}</div>
        <div className="model-meta">
          <span>{tierLabel(model.tier)}</span>
          <span>·</span>
          <span>{model.benchmarkCount}/8 benchmarks</span>
          {model.released ? (
            <>
              <span>·</span>
              <span>{dateLabel(model.released)}</span>
            </>
          ) : null}
        </div>
      </div>
      <div className="model-right">
        <div className="score score-lg" style={{ fontSize: 20 }}>
          {fmtScore(model.ultimateScore)}
        </div>
        <div className="mt-8">
          <span className={statusChipClass(model.scoreStatus)}>{model.scoreStatus}</span>
        </div>
      </div>
    </div>
  );
}
