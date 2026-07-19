// =============================================================================
// scripts/send-digest.ts — Production dispatch entry point.
// Runs in GitHub Actions. Reads dispatch/subscribers.json, regenerates the
// deterministic digest for each subscriber, and sends via SMTP secrets.
//
//   tsx scripts/send-digest.ts          (sends to all subscribers)
//   tsx scripts/send-digest.ts --to=x   (sends a one-off test to x)
// =============================================================================

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import nodemailer from "nodemailer";
import { loadData, generateDigest, DEFAULT_SECTIONS } from "../server/digest.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SUBSCRIBERS_FILE = resolve(ROOT, "dispatch/subscribers.json");

function hasSmtp() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

async function main() {
  const data = loadData();
  const argTo = process.argv
    .find((a) => a.startsWith("--to="))
    ?.slice(5);

  let subscribers: Array<{
    email: string;
    frequency?: string;
    time?: string;
    topN?: number;
    sections?: Partial<typeof DEFAULT_SECTIONS>;
  }>;

  if (argTo) {
    subscribers = [{ email: argTo, frequency: "weekly", time: "08:00", topN: 10 }];
  } else if (existsSync(SUBSCRIBERS_FILE)) {
    subscribers = JSON.parse(readFileSync(SUBSCRIBERS_FILE, "utf-8"));
  } else if (process.env.DIGEST_SUBSCRIBERS) {
    // Private recipients kept out of the public repo: paste the app's
    // "Copy subscribers for production" JSON into a DIGEST_SUBSCRIBERS secret.
    try {
      subscribers = JSON.parse(process.env.DIGEST_SUBSCRIBERS);
    } catch {
      console.error("DIGEST_SUBSCRIBERS is set but is not valid JSON.");
      process.exit(1);
    }
  } else {
    console.log(
      "No subscribers found (dispatch/subscribers.json or DIGEST_SUBSCRIBERS) — nothing to send.",
    );
    return;
  }

  if (subscribers.length === 0) {
    console.log("No subscribers — nothing to send.");
    return;
  }

  if (!hasSmtp()) {
    console.error(
      "SMTP secrets not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM.",
    );
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true" || Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  let sent = 0;
  let failed = 0;
  for (const sub of subscribers) {
    const digest = generateDigest(data, {
      email: sub.email,
      frequency: (sub.frequency as "daily" | "weekly") || "weekly",
      time: sub.time || "08:00",
      topN: sub.topN || 10,
      sections: sub.sections || DEFAULT_SECTIONS,
    });
    try {
      const info = await transporter.sendMail({
        from,
        to: sub.email,
        subject: digest.subject,
        text: digest.text,
        html: digest.html,
      });
      sent++;
      console.log(`✓ ${sub.email} — ${digest.subject} (${info.messageId})`);
    } catch (e) {
      failed++;
      console.error(`✕ ${sub.email} — ${(e as Error).message}`);
    }
  }

  console.log(`\nDone. Sent: ${sent}, Failed: ${failed}.`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
