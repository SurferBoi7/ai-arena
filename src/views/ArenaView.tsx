import { useMemo, useState } from "react";
import type { ArenaData } from "../lib/data";
import type { Model } from "../types";
import { rankedModels } from "../lib/data";
import { ModelRow } from "../components/ModelRow";
import { ModelSheet } from "../components/ModelSheet";
import { TimelineGraph } from "../components/TimelineGraph";

export function ArenaView({ data }: { data: ArenaData }) {
  const [mode, setMode] = useState<"list" | "graph">("list");
  const [filter, setFilter] = useState<"all" | "flagship" | "measured">("all");
  const [active, setActive] = useState<Model | null>(null);

  const ranked = useMemo(() => rankedModels(data.models), [data.models]);

  const filtered = useMemo(() => {
    if (filter === "flagship") return ranked.filter((m) => m.tier === "flagship");
    if (filter === "measured") return ranked.filter((m) => m.scoreStatus !== "imputed");
    return ranked;
  }, [ranked, filter]);

  return (
    <>
      <h1 className="view-title">Arena Leaderboard</h1>
      <p className="view-sub">
        Reality-corrected compounded score. Flagships (Fable, Mythos, Opus) lead; missing-data
        models sink to the floor.
      </p>

      <div className="row between mt-12">
        <div className="toggle" role="tablist" aria-label="Arena view" data-testid="arena-toggle">
          <button
            className={`toggle-btn ${mode === "list" ? "active" : ""}`}
            onClick={() => setMode("list")}
            role="tab"
            aria-selected={mode === "list"}
          >
            List
          </button>
          <button
            className={`toggle-btn ${mode === "graph" ? "active" : ""}`}
            onClick={() => setMode("graph")}
            role="tab"
            aria-selected={mode === "graph"}
          >
            Timeline Graph
          </button>
        </div>
        <div className="toggle">
          {(["all", "flagship", "measured"] as const).map((f) => (
            <button
              key={f}
              className={`toggle-btn ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : f === "flagship" ? "Flagship" : "Measured"}
            </button>
          ))}
        </div>
      </div>

      {mode === "graph" ? (
        <div className="mt-12">
          <TimelineGraph models={filtered} onSelect={setActive} />
        </div>
      ) : (
        <div className="card mt-12" role="list" style={{ padding: "4px" }}>
          {filtered.map((m, i) => (
            <ModelRow key={m.id} model={m} rank={i + 1} onOpen={() => setActive(m)} />
          ))}
        </div>
      )}

      {active ? (
        <ModelSheet model={active} models={data.models} onClose={() => setActive(null)} />
      ) : null}

      <div className="alert alert-info mt-16">
        <strong>How scoring works.</strong> Weighted verified mean (SWE-bench Verified &amp;
        Humanity's Last Exam weighted highest) + hyper-dominant omission penalty for missing
        benchmarks + vendor-verified flagship baselines + an intelligence ceiling that hard-caps
        lightweight/utility models below flagships unless they sweep the hardest benchmarks. No
        grace-period imputation.
      </div>
    </>
  );
}
