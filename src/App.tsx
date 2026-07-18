import { useEffect, useState } from "react";
import type { ArenaData } from "./lib/data";
import { loadData } from "./lib/data";
import { BottomNav, type TabId } from "./components/BottomNav";
import { FeedView } from "./views/FeedView";
import { ArenaView } from "./views/ArenaView";
import { ArchiveView } from "./views/ArchiveView";
import { SettingsView } from "./views/SettingsView";

export default function App() {
  const [tab, setTab] = useState<TabId>("arena");
  const [data, setData] = useState<ArenaData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadData()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="topbar-row">
          <div className="brand">
            <div className="brand-mark">A</div>
            <div>
              <div className="brand-name">AI Arena</div>
              <div className="brand-sub">Frontier Model Tracker</div>
            </div>
          </div>
          <div className="meta-pill">
            {data
              ? `${data.meta.modelCount} models · ${data.meta.measuredCount} measured`
              : "loading…"}
          </div>
        </div>
      </header>

      <main className="app">
        {error ? (
          <div className="alert alert-err">
            Couldn't load arena data: {error}. Run <code>npm run score</code> then restart.
          </div>
        ) : !data ? (
          <SkeletonView />
        ) : tab === "feed" ? (
          <FeedView data={data} />
        ) : tab === "arena" ? (
          <ArenaView data={data} />
        ) : tab === "archive" ? (
          <ArchiveView data={data} />
        ) : (
          <SettingsView data={data} />
        )}
      </main>

      <BottomNav tab={tab} onChange={setTab} />
    </>
  );
}

function SkeletonView() {
  return (
    <>
      <h1 className="view-title">AI Arena</h1>
      <p className="view-sub">Loading the frontier…</p>
      <div className="card" style={{ height: 120, marginBottom: 10 }}>
        <div className="skel" style={{ height: 14, width: "60%", marginBottom: 10 }} />
        <div className="skel" style={{ height: 12, width: "40%" }} />
      </div>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="skel" style={{ height: 64, marginBottom: 8 }} />
      ))}
    </>
  );
}
