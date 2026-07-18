import { useEffect, useState } from "react";
import type { ArenaData } from "../lib/data";
import { generateDigest, type DigestOptions } from "../lib/digest";
import { Sheet } from "../components/Sheet";

export interface DigestSettings {
  email: string;
  frequency: "daily" | "weekly";
  time: string;
  topN: number;
  sections: {
    leaderboard: boolean;
    movers: boolean;
    releases: boolean;
    flagships: boolean;
    industry: boolean;
  };
}

const STORAGE_KEY = "ai-arena-settings";
const SUBSCRIBERS_KEY = "ai-arena-subscribers";

const DEFAULT_SETTINGS: DigestSettings = {
  email: "",
  frequency: "weekly",
  time: "08:00",
  topN: 10,
  sections: {
    leaderboard: true,
    movers: true,
    releases: true,
    flagships: true,
    industry: true,
  },
};

function loadSettings(): DigestSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// Persist the subscriber locally (deterministic, free-tier — no backend needed
// on the static deploy). In production this is the system of record; the
// scheduled GitHub Actions dispatch reads dispatch/subscribers.json server-side.
function registerSubscriber(opts: DigestOptions) {
  try {
    const raw = localStorage.getItem(SUBSCRIBERS_KEY);
    const list: DigestOptions[] = raw ? JSON.parse(raw) : [];
    const idx = list.findIndex((s) => s.email === opts.email);
    const entry = { ...opts };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    localStorage.setItem(SUBSCRIBERS_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "ok"; message: string }
  | { kind: "err"; message: string };

export function SettingsView({ data }: { data: ArenaData }) {
  const [settings, setSettings] = useState<DigestSettings>(DEFAULT_SETTINGS);
  const [send, setSend] = useState<SendState>({ kind: "idle" });
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  function update<K extends keyof DigestSettings>(key: K, value: DigestSettings[K]) {
    setSettings((s) => {
      const next = { ...s, [key]: value };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function toggleSection(key: keyof DigestSettings["sections"]) {
    setSettings((s) => {
      const sections = { ...s.sections, [key]: !s.sections[key] };
      const next = { ...s, sections };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function sendTest() {
    if (!settings.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(settings.email)) {
      setSend({ kind: "err", message: "Enter a valid email address first." });
      return;
    }
    setSend({ kind: "sending" });

    const options: DigestOptions = {
      email: settings.email,
      frequency: settings.frequency,
      time: settings.time,
      topN: settings.topN,
      sections: settings.sections,
    };

    // Deterministic Smart Report, built entirely in-browser from the parsed JSON.
    const digest = generateDigest(data, options);
    registerSubscriber(options);

    // Local dev: the dispatch server is live behind the Vite proxy, so send a
    // real test email too. On the static deploy there is no backend — we never
    // touch the network (which is what previously caused the 405), and instead
    // render the exact report inline.
    if (import.meta.env.DEV) {
      try {
        const res = await fetch("/api/send-test-digest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options),
        });
        if (res.ok) {
          const body = await res.json().catch(() => ({}) as any);
          setPreview(digest.html);
          setSend({
            kind: "ok",
            message: `${body.message || "Digest sent."}${
              body.previewUrl ? ` · inbox preview: ${body.previewUrl}` : ""
            }`,
          });
          return;
        }
      } catch {
        /* fall through to the offline preview path */
      }
    }

    setPreview(digest.html);
    setSend({
      kind: "ok",
      message: `Smart Report generated for ${options.email} — preview opened. You're registered for the ${options.frequency} digest.`,
    });
  }

  const topModel = data.meta.topModel;

  return (
    <>
      <h1 className="view-title">Settings</h1>

      {topModel ? (
        <div className="card mt-12">
          <div className="tiny muted">Current arena leader</div>
          <div className="row between mt-8">
            <strong style={{ fontSize: 15 }}>{topModel.name}</strong>
            <span className="score" style={{ color: "var(--accent)", fontSize: 18 }}>
              {topModel.score.toFixed(1)}
            </span>
          </div>
        </div>
      ) : null}

      {/* Email */}
      <div className="section-head">Your email</div>
      <input
        className="input"
        type="email"
        inputMode="email"
        placeholder="you@example.com"
        value={settings.email}
        onChange={(e) => update("email", e.target.value)}
        data-testid="input-email"
      />

      {/* Frequency */}
      <div className="section-head">Frequency</div>
      <div className="row gap-6">
        {(["daily", "weekly"] as const).map((f) => (
          <button
            key={f}
            className={`chip ${settings.frequency === f ? "chip-accent" : ""}`}
            onClick={() => update("frequency", f)}
            style={{ padding: "9px 16px" }}
          >
            {f === "daily" ? "Daily" : "Weekly"}
          </button>
        ))}
      </div>

      {/* Time */}
      <div className="section-head">Delivery time</div>
      <input
        className="input"
        type="time"
        value={settings.time}
        onChange={(e) => update("time", e.target.value)}
        style={{ maxWidth: 160 }}
      />

      {/* Top N */}
      <div className="section-head">Leaderboard depth</div>
      <div className="row gap-6">
        {[5, 10, 15, 20].map((n) => (
          <button
            key={n}
            className={`chip ${settings.topN === n ? "chip-accent" : ""}`}
            onClick={() => update("topN", n)}
            style={{ padding: "8px 14px" }}
          >
            Top {n}
          </button>
        ))}
      </div>

      {/* Content toggles — labels only, no helper text */}
      <div className="section-head">Content</div>
      <div className="card">
        {(
          [
            ["leaderboard", "Arena Leaderboard"],
            ["movers", "Rank Separators"],
            ["releases", "Fresh Releases"],
            ["flagships", "Flagship Watch"],
            ["industry", "Industry Pulse"],
          ] as const
        ).map(([key, label]) => (
          <div className="toggle-row" key={key}>
            <div className="toggle-row-label">{label}</div>
            <button
              className={`switch ${settings.sections[key] ? "on" : ""}`}
              onClick={() => toggleSection(key)}
              role="switch"
              aria-checked={settings.sections[key]}
              aria-label={label}
            >
              <span className="switch-knob" />
            </button>
          </div>
        ))}
      </div>

      {/* Send test */}
      <div className="section-head">Test it</div>
      <button
        className="btn btn-primary"
        onClick={sendTest}
        disabled={send.kind === "sending"}
        data-testid="button-send-test"
      >
        {send.kind === "sending" ? "Sending…" : "Send Test Digest Now"}
      </button>

      {send.kind === "ok" ? <div className="alert alert-ok">✓ {send.message}</div> : null}
      {send.kind === "err" ? <div className="alert alert-err">✕ {send.message}</div> : null}

      {preview ? (
        <Sheet onClose={() => setPreview(null)} size="lg" labelledBy="digest-preview-title">
          <div id="digest-preview-title" className="sheet-title">
            Smart Report preview
          </div>
          <div className="tiny muted mt-8">
            Exactly what lands in your inbox — built deterministically from the tracker data.
          </div>
          <iframe className="digest-frame mt-12" srcDoc={preview} title="Smart Report preview" />
        </Sheet>
      ) : null}
    </>
  );
}
