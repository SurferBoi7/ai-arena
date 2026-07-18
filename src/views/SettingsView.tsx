import { useEffect, useState } from "react";
import type { ArenaData } from "../lib/data";

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

type SendState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "ok"; message: string }
  | { kind: "info"; message: string }
  | { kind: "err"; message: string };

export function SettingsView({ data }: { data: ArenaData }) {
  const [settings, setSettings] = useState<DigestSettings>(DEFAULT_SETTINGS);
  const [send, setSend] = useState<SendState>({ kind: "idle" });

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
    try {
      const res = await fetch("/api/send-test-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: settings.email,
          frequency: settings.frequency,
          time: settings.time,
          topN: settings.topN,
          sections: settings.sections,
        }),
      });
      if (res.status === 404) {
        setSend({
          kind: "info",
          message:
            "Live dispatch isn't available on the deployed static site. Run `npm run dev` locally to send a test digest, or push to GitHub — the scheduled workflow will email subscribers in dispatch/subscribers.json using your SMTP secrets.",
        });
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSend({ kind: "err", message: body.error || `Request failed (${res.status}).` });
        return;
      }
      const previewUrl = body.previewUrl ? `\n\nPreview: ${body.previewUrl}` : "";
      setSend({
        kind: "ok",
        message: (body.message || "Digest sent.") + previewUrl,
      });
    } catch (e) {
      setSend({
        kind: "err",
        message:
          "Couldn't reach the local dispatch server. Is `npm run dev` running? " + String(e),
      });
    }
  }

  const topModel = data.meta.topModel;

  return (
    <>
      <h1 className="view-title">Settings</h1>
      <p className="view-sub">
        Configure your deterministic Smart Report. The arena data you see here is what gets
        summarised — no AI, pure computed digest.
      </p>

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

      {/* Content toggles */}
      <div className="section-head">Content</div>
      <div className="card">
        {(
          [
            ["leaderboard", "Arena Leaderboard", "Top models by compounded score"],
            ["movers", "Rank Separators", "Biggest score gaps between ranks"],
            ["releases", "Fresh Releases", "Newest model drops & ships"],
            ["flagships", "Flagship Watch", "Fable · Mythos · Opus status"],
            ["industry", "Industry Pulse", "Provider activity & latest releases"],
          ] as const
        ).map(([key, label, desc]) => (
          <div className="toggle-row" key={key}>
            <div>
              <div className="toggle-row-label">{label}</div>
              <div className="toggle-row-desc">{desc}</div>
            </div>
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

      {send.kind === "ok" ? (
        <div className="alert alert-ok">✓ {send.message}</div>
      ) : null}
      {send.kind === "err" ? <div className="alert alert-err">✕ {send.message}</div> : null}
      {send.kind === "info" ? <div className="alert alert-info">ⓘ {send.message}</div> : null}

      {/* Production setup */}
      <div className="section-head">Production dispatch</div>
      <div className="card small" style={{ lineHeight: 1.6 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          When you push this repo to GitHub, a scheduled GitHub Actions workflow reads
          <code> dispatch/subscribers.json</code>, regenerates this deterministic digest, and emails
          every subscriber via SMTP secrets you set in the repo. Zero cost, no AI APIs.
        </p>
        <div className="kv">
          <span className="muted">Subscribers file</span>
          <code>dispatch/subscribers.json</code>
        </div>
        <div className="kv">
          <span className="muted">Required secrets</span>
          <code>SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM</code>
        </div>
        <div className="kv">
          <span className="muted">Trigger</span>
          <span>schedule (your frequency) + manual</span>
        </div>
        <p className="muted tiny" style={{ marginBottom: 0 }}>
          To add yourself in production, add an entry to{" "}
          <code>dispatch/subscribers.json</code> (see <code>dispatch/subscribers.example.json</code>)
          and push. The next run will email you.
        </p>
      </div>
    </>
  );
}
