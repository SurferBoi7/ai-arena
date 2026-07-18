// Type declarations for the deterministic digest generator (server/digest.mjs),
// so TypeScript scripts (scripts/send-digest.ts) get full typing while the
// plain-Node dev server imports the real .mjs implementation.

export interface DigestOptions {
  email?: string;
  frequency?: "daily" | "weekly";
  time?: string;
  topN?: number;
  sections?: {
    leaderboard?: boolean;
    movers?: boolean;
    releases?: boolean;
    flagships?: boolean;
    industry?: boolean;
  };
}

export interface Digest {
  subject: string;
  text: string;
  html: string;
}

export interface ArenaData {
  models: any[];
  feed: any[];
  companies: any[];
  meta: any;
}

export const DEFAULT_SECTIONS: {
  leaderboard: boolean;
  movers: boolean;
  releases: boolean;
  flagships: boolean;
  industry: boolean;
};

export function loadData(dataDir?: string): ArenaData;
export function generateDigest(data: ArenaData, options?: DigestOptions): Digest;
export function buildSubject(meta: any, options: DigestOptions): string;
export function buildText(data: ArenaData, options: DigestOptions): string;
export function buildHtml(data: ArenaData, options: DigestOptions): string;
