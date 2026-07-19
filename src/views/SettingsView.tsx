import { useEffect, useState } from "react";
import type { ArenaData } from "../lib/data";
import { generateDigest, type DigestOptions, type DigestSections } from "../lib/digest";
import { Sheet } from "../components/Sheet";

export interface DigestSettings {
  emails: string[];
  frequency: "daily" | "weekly";
  time: string;
  topN: number;
  sections: DigestSections;
}

const STORAGE_KEY = "ai-arena-settings";

const DEFAULT_SETTINGS: DigestSettings = {
  emails: [],
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

const isValidEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());

function loadSettings(): DigestSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    // Migrate the old single-email shape → emails[].
    const emails: string[] = Array.isArray(parsed.emails)
      ? parsed.emails
      : parsed.email
        ? [parsed.email]
        : [];
    return { ...DEFAULT_SETTINGS, ...parsed, emails };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// Build the production subscribers.json payload from the current settings —
// this is exactly what the scheduled GitHub Actions dispatch consumes.
function subscribersPayload(s: DigestSettings) {
  const now = new Date().toISOString();
  return s.emails.map((email) => ({
    email,
    frequency: s.frequency,
    time: s.time,
    topN: s.topN,
    sections: s.sections,
    addedAt: now,
  }));
}

type SendState =
  | { kind: "idle" }
  | { kind: "ok"; message: string }
  | { kind: "err"; message: string };

export function SettingsView({ data }: { data: ArenaData }) {
  const [settings, setSettings] = useState<DigestSettings>(DEFAULT_SETTINGS);
  const [draft, setDraft] = useState("");
  const [send, setSend] = useState<SendState>({ kind: "idle" });
  const [preview, setPreview] = useState<string | null>(null);
  const [exportJson, setExportJson] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  function persist(next: DigestSettings) {
    setSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function update<K extends keyof DigestSettings>(key: K, value: DigestSettings[K]) {
    persist({ ...settings, [key]: value });
  }

  function toggleSection(key: keyof DigestSections) {
    persist({ ...settings, sections: { ...settings.sections, [key]: !settings.sections[key] } });
  }

  // Lock an email into the list (via the + button or Enter).
  function addEmail() {
    const email = draft.trim().toLowerCase();
    if (!isValidEmail(email)) {
      setSend({ kind: "err", message: "Enter a valid email address." });
      return;
    }
    if (settings.emails.includes(email)) {
      setDraft("");
      return;
    }
    persist({ ...settings, emails: [...settings.emails, email] });
    setDraft("");
    setSend({ kind: "idle" });
  }

  function removeEmail(email: string) {
    persist({ ...settings, emails: settings.emails.filter((e) => e !== email) });
  }

  function previewDigest() {
    if (settings.emails.length === 0) {
      setSend({ kind: "err", message: "Add at least one email first." });
      return;
    }
    const options: DigestOptions = {
      email: settings.emails[0],
      frequency: settings.frequency,
      time: settings.time,
      topN: settings.topN,
      sections: settings.sections,
    };
    setPreview(generateDigest(data, options).html);
    setSend({
      kind: "ok",
      message: `Preview generated for ${settings.emails.length} recipient${
        settings.emails.length === 1 ? "" : "s"
      }. Real digests dispatch on your ${settings.frequency} schedule once SMTP is configured.`,
    });
  }

  function openExport() {
    setCopied(false);
    setExportJson(JSON.stringify(subscribersPayload(settings), null, 2));
  }

  async function copyExport() {
    if (!exportJson) return;
    try {
      await navigator.clipboard.writeText(exportJson);
    } catch {
      /* clipboard may be blocked — the textarea below is the fallback */
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
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

      {/* Emails — lock in one or more recipients */}
      <div className="section-head">Your emails</div>
      <div className="row gap-6">
        <input
          className="input"
          type="email"
          inputMode="email"
          placeholder="you@example.com"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addEmail();
            }
          }}
          data-testid="input-email"
        />
        <button className="icon-btn" onClick={addEmail} aria-label="Add email" title="Add email">
          +
        </button>
      </div>

      {settings.emails.length > 0 ? (
        <div className="card mt-12" style={{ padding: 4 }}>
          {settings.emails.map((email) => (
            <div className="email-row" key={email}>
              <span className="email-addr">{email}</span>
              <button
                className="icon-btn icon-btn-ghost"
                onClick={() => removeEmail(email)}
                aria-label={`Remove ${email}`}
                title="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="muted small" style={{ padding: "8px 2px" }}>
          No recipients yet — add one above.
        </div>
      )}

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

      {/* Content toggles — labels only */}
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

      {/* Preview */}
      <div className="section-head">Preview</div>
      <button className="btn btn-primary" onClick={previewDigest} data-testid="button-send-test">
        Preview Smart Report
      </button>

      {send.kind === "ok" ? <div className="alert alert-ok">✓ {send.message}</div> : null}
      {send.kind === "err" ? <div className="alert alert-err">✕ {send.message}</div> : null}

      {/* Production export */}
      <div className="section-head">Scheduled delivery</div>
      <button className="btn btn-ghost" onClick={openExport} disabled={settings.emails.length === 0}>
        Export subscribers for production
      </button>

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

      {exportJson ? (
        <Sheet onClose={() => setExportJson(null)} size="md" labelledBy="export-title">
          <div id="export-title" className="sheet-title">
            Subscribers for production
          </div>
          <div className="tiny muted mt-8">
            Paste this into a repo secret named <code>DIGEST_SUBSCRIBERS</code> (Settings → Secrets →
            Actions). The scheduled workflow emails everyone here via your SMTP secrets.
          </div>
          <textarea className="export-json mt-12" readOnly value={exportJson} rows={10} />
          <button className="btn btn-primary mt-12" onClick={copyExport}>
            {copied ? "✓ Copied" : "Copy JSON"}
          </button>
        </Sheet>
      ) : null}
    </>
  );
}
