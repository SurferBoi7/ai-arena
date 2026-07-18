# AI Arena — Frontier Model Tracker v2.0

A self-updating PWA tracking frontier AI models with a **reality-corrected** arena
leaderboard and a deterministic **Smart Report** email dispatch system.

- **Reality Correction:** Flagships (Fable, Mythos, Opus) lead the board. The math no
  longer rewards lightweight/utility models for missing data — missing hyper-difficult
  benchmarks incur an **omission penalty**, and an **intelligence ceiling** hard-caps
  lightweights below flagships unless they sweep the hardest benchmarks (SWE-bench & HLE)
  with verified, non-imputed data.
- **Personal Dispatch System:** A 4th tab (Settings) lets you enter an email and
  configure frequency / time / content. A **Send Test Digest Now** button dispatches a
  deterministic, AI-free Smart Report summarising the arena data.
- **Zero-cost infra:** GitHub Actions (free tier) runs the scrape→score→validate→build
  pipeline and deploys to a `gh-pages` branch on a schedule. A separate job emails
  subscribers via your SMTP secrets.
- **No AI APIs:** The digest is generated with strict deterministic logic + string
  formatting from the fetched JSON — no LLMs.

## Quick start (local)

```bash
npm install
npm run score          # apply reality-corrected scoring → public/data/*.json
npm run validate       # reality-check: flagships on top, no missing-data reward
npm run dev            # Vite (:5173) + dispatch server (:8787)
```

Open http://localhost:5173 → **Settings** → enter your email → **Send Test Digest Now**.

With no SMTP credentials configured, the digest is delivered to a real, viewable
[Ethereal Email](https://ethereal.email) test inbox (the response includes a preview URL).
To send to your actual inbox, copy `.env.example` → `.env` and fill in SMTP creds
(Gmail app password, Brevo, Mailtrap, Resend, AWS SES, etc.).

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite + local dispatch server (concurrently) |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm run score` | Re-score committed data → `public/data/{models,feed,meta}.json` |
| `npm run update-data` | Scrape (HuggingFace Hub, best-effort) + score + write |
| `npm run validate` | Reality-check assertions (flagships on top, ceiling enforced) |
| `npm run test:dispatch` | Dispatch self-test (Ethereal) |
| `npm run send-digest` | Production dispatch (reads `dispatch/subscribers.json`, SMTP secrets) |

## Scoring engine (`src/lib/scoring.ts`)

1. **Vendor-verified baselines** (`scripts/fixtures/vendor-baselines.ts`) fill real
   flagship data from system cards (e.g. Fable 5's GPQA & HLE) — not imputation.
2. **Weighted verified mean** — SWE-bench Verified (0.18) & HLE (0.17) weighted highest.
3. **Hyper-dominant omission penalty** — missing hyper/hard/medium benchmarks subtract
   6.0 / 2.2 / 1.3 points respectively. No grace-period imputation.
4. **Intelligence ceiling** — lightweight models (`params < 35B` or mini/small/haiku/etc.)
   are capped below the established-flagship floor unless they sweep the hardest
   benchmarks (SWE ≥ 70 & HLE ≥ 40) with verified data.

## Deploy to GitHub

This project is built for **manual deployment** — you push it to a new repo and GitHub
Actions takes over. `vite.config.ts` reads `VITE_BASE_PATH` (set automatically by the
workflow to `/<repo>/`), so the PWA works on a project Pages URL out of the box.

1. Create a new GitHub repo, push this folder to it (`git push origin main`).
2. **Settings → Pages → Source = Deploy from a branch = `gh-pages` / root.** The first
   workflow run creates the `gh-pages` branch.
3. (Optional) For production email dispatch, add repository secrets:
   `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, and
   add yourself to `dispatch/subscribers.json` (see `subscribers.example.json`).

The workflow (`.github/workflows/update-data.yml`) runs on push, daily at 08:00 UTC,
and manually — scraping, scoring, building, deploying, and (on schedule/manual) emailing
subscribers.

## Project structure

```
ai-arena-src/
├─ public/data/            # models.json, feed.json, companies.json, meta.json (generated)
├─ src/
│  ├─ lib/scoring.ts       # reality-corrected scoring engine
│  ├─ lib/{data,format}.ts # loaders + formatters
│  ├─ views/               # Feed, Arena, Archive, Settings
│  ├─ components/          # BottomNav, ModelRow, TimelineGraph
│  └─ index.css           # glassmorphic dark design system
├─ scripts/
│  ├─ lib/pipeline.ts     # shared score+finalize pipeline
│  ├─ score-models.ts     # npm run score
│  ├─ update-data.ts      # npm run update-data (scrape+score)
│  ├─ validate-ranks.ts   # npm run validate
│  ├─ send-digest.ts      # production dispatch
│  └─ fixtures/vendor-baselines.ts
├─ server/
│  ├─ dev-server.mjs      # local dispatch (nodemailer + Ethereal fallback)
│  └─ digest.mjs          # deterministic digest generator
├─ dispatch/              # subscribers.json (+ example)
└─ .github/workflows/update-data.yml
```
