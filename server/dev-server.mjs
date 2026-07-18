// =============================================================================
// server/dev-server.mjs — Local dispatch server for the "Send Test Digest Now"
// button and local subscriber intake. Production dispatch is handled by the
// GitHub Actions workflow (see .github/workflows/update-data.yml).
//
// Email delivery:
//   - If SMTP_* env vars are set (e.g. a Gmail app password or any SMTP relay),
//     the digest is sent through real SMTP to the recipient's actual inbox.
//   - Otherwise it auto-creates a throwaway Ethereal Email test account and
//     delivers there, returning a preview URL you can open in a browser. This
//     makes "Send Test Digest Now" work out-of-the-box with zero setup.
//
// Run:  npm run dev   (starts Vite on :5173 + this server on :8787, proxied)
// =============================================================================

import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import nodemailer from "nodemailer";
import { loadData, generateDigest } from "./digest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SUBSCRIBERS_FILE = resolve(ROOT, "dispatch/subscribers.json");

// --- tiny .env loader (no dependency) ---
async function loadEnv() {
  const envPath = resolve(ROOT, ".env");
  if (!existsSync(envPath)) return;
  const txt = await readFile(envPath, "utf-8");
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  }
}
await loadEnv();

function hasSmtpConfig() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function buildTransport() {
  if (hasSmtpConfig()) {
    return {
      transporter: nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === "true" || Number(process.env.SMTP_PORT) === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      }),
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      mode: "smtp",
    };
  }
  // Ethereal zero-config fallback — creates a real, viewable test inbox.
  const testAccount = await nodemailer.createTestAccount();
  return {
    transporter: nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    }),
    from: `"AI Arena" <${testAccount.user}>`,
    mode: "ethereal",
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "post, options",
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((accept, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => accept(data));
    req.on("error", reject);
  });
}

function isValidEmail(e) {
  return typeof e === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
}

async function handleSendTest(req, res) {
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON body." });
  }
  const { email, frequency, time, topN, sections } = body || {};
  if (!isValidEmail(email)) {
    return sendJson(res, 400, { error: "A valid email address is required." });
  }

  const data = loadData();
  const digest = generateDigest(data, {
    email,
    frequency: frequency === "daily" ? "daily" : "weekly",
    time: time || "08:00",
    topN: Number(topN) || 10,
    sections,
  });

  const { transporter, from, mode } = await buildTransport();
  const info = await transporter.sendMail({
    from,
    to: email,
    subject: digest.subject,
    text: digest.text,
    html: digest.html,
  });

  const previewUrl = nodemailer.getTestMessageUrl
    ? nodemailer.getTestMessageUrl(info)
    : undefined;

  return sendJson(res, 200, {
    ok: true,
    messageId: info.messageId,
    mode,
    previewUrl: mode === "ethereal" ? previewUrl : undefined,
    message:
      mode === "ethereal"
        ? `Test digest delivered to an Ethereal test inbox (no SMTP creds configured).`
        : `Digest sent to ${email} via SMTP.`,
  });
}

async function handleSubscribe(req, res) {
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    return sendJson(res, 400, { error: "Invalid JSON body." });
  }
  const { email, frequency, time, topN, sections } = body || {};
  if (!isValidEmail(email)) {
    return sendJson(res, 400, { error: "A valid email address is required." });
  }
  await mkdir(dirname(SUBSCRIBERS_FILE), { recursive: true });
  let list = [];
  if (existsSync(SUBSCRIBERS_FILE)) {
    try {
      list = JSON.parse(await readFile(SUBSCRIBERS_FILE, "utf-8"));
    } catch {
      list = [];
    }
  }
  const entry = {
    email,
    frequency: frequency === "daily" ? "daily" : "weekly",
    time: time || "08:00",
    topN: Number(topN) || 10,
    sections: sections || null,
    addedAt: new Date().toISOString(),
  };
  const idx = list.findIndex((s) => s.email === email);
  if (idx >= 0) list[idx] = { ...list[idx], ...entry };
  else list.push(entry);
  await writeFile(SUBSCRIBERS_FILE, JSON.stringify(list, null, 2) + "\n", "utf-8");
  return sendJson(res, 200, { ok: true, count: list.length });
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type",
        "access-control-allow-methods": "post, options",
      });
      return res.end();
    }
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/send-test-digest" && req.method === "POST") {
      return await handleSendTest(req, res);
    }
    if (url.pathname === "/api/subscribe" && req.method === "POST") {
      return await handleSubscribe(req, res);
    }
    sendJson(res, 404, { error: "Not found." });
  } catch (e) {
    sendJson(res, 500, { error: String(e?.message || e) });
  }
});

const PORT = Number(process.env.DISPATCH_PORT || 8787);

// --- self-test (npm run test:dispatch) ---
if (process.argv.includes("--self-test")) {
  console.log("Running dispatch self-test…");
  try {
    const data = loadData();
    const digest = generateDigest(data, {
      email: "self-test@ai-arena.local",
      frequency: "weekly",
      time: "08:00",
      topN: 10,
    });
    if (!digest.subject || !digest.html || digest.html.length < 1000) {
      throw new Error("Digest output malformed.");
    }
    console.log("✓ Digest generated:", digest.subject);
    console.log("✓ HTML length:", digest.html.length, "| Text length:", digest.text.length);
    const { transporter, from, mode } = await buildTransport();
    const info = await transporter.sendMail({
      from,
      to: "self-test@ai-arena.local",
      subject: digest.subject,
      text: digest.text,
      html: digest.html,
    });
    const previewUrl = nodemailer.getTestMessageUrl
      ? nodemailer.getTestMessageUrl(info)
      : undefined;
    console.log(`✓ Email dispatched (mode=${mode}). messageId=${info.messageId}`);
    if (mode === "ethereal") console.log("  Ethereal preview:", previewUrl);
    console.log("\nSelf-test passed.");
    process.exit(0);
  } catch (e) {
    console.error("Self-test FAILED:", e?.message || e);
    process.exit(1);
  }
}

server.listen(PORT, () => {
  console.log(`Dispatch server on http://localhost:${PORT}  (mode: ${hasSmtpConfig() ? "smtp" : "ethereal"})`);
});
