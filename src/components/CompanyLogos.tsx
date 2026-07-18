// =============================================================================
// CompanyLogos — crisp, self-contained SVG brand marks for the Archive.
// =============================================================================
// Each mark is an original, geometric vector rendered in the provider's brand
// colour (stylised — not a trademark-exact reproduction). Any provider without
// a bespoke mark falls back to a clean monogram tile, so the Archive always has
// a high-quality vector logo for every company.
// =============================================================================

import { monogram } from "../lib/format";

type MarkFn = (color: string) => React.ReactNode;

// viewBox is 0 0 24 24 for every mark.
const MARKS: Record<string, MarkFn> = {
  openai: (c) => (
    <path
      d="M12 3.2a4.3 4.3 0 0 1 3.73 2.15 4.3 4.3 0 0 1 2.9 6.5 4.3 4.3 0 0 1-3.73 6.45A4.3 4.3 0 0 1 8.27 18 4.3 4.3 0 0 1 5.37 11.5 4.3 4.3 0 0 1 9.1 5.05 4.3 4.3 0 0 1 12 3.2Zm0 2.05-2.6 1.5v3l2.6 1.5 2.6-1.5v-3Z"
      fill="none"
      stroke={c}
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  ),
  anthropic: (c) => (
    <g fill={c}>
      <path d="M9 5 4.4 19h2.5l.95-3h4.3l.95 3h2.5L11 5Zm-.35 8.9L10 8.9l1.35 5Z" />
      <path d="M15.5 5 20 19h-2.5L13 5Z" opacity="0.55" />
    </g>
  ),
  google: (c) => (
    <path
      d="M20 12.2c0 4.5-3.1 7.7-7.8 7.7A8 8 0 1 1 17.6 6l-2.2 2.1A4.9 4.9 0 0 0 12.2 7 4.9 4.9 0 1 0 17 13H12.2v-2.9H20Z"
      fill={c}
    />
  ),
  meta: (c) => (
    <path
      d="M3 15.5c0-4.2 2-8 4.9-8 1.8 0 3 1.3 4.1 3.2 1.1-1.9 2.3-3.2 4.1-3.2 2.9 0 4.9 3.8 4.9 8 0 1.9-.9 3-2.4 3-1.6 0-2.6-1.3-3.8-3.6-.9-1.8-1.6-3-2.8-3s-1.9 1.2-2.8 3C10.2 17.2 9.2 18.5 7.6 18.5 6.1 18.5 3 17.4 3 15.5Zm2.4 0c0 .8.4 1.3 1 1.3.7 0 1.2-.6 2.1-2.4-.8-1.6-1.6-2.5-2.4-2.5-.6 0-1.4 1.4-1.4 3.6Zm11-3.6c-.8 0-1.6.9-2.4 2.5.9 1.8 1.4 2.4 2.1 2.4.6 0 1-.5 1-1.3 0-2.2-.8-3.6-1.4-3.6Z"
      fill={c}
    />
  ),
  xai: (c) => (
    <g stroke={c} strokeWidth="1.7" strokeLinecap="round">
      <path d="M5 5 19 19M19 5 5 19" />
    </g>
  ),
  deepseek: (c) => (
    <path
      d="M4 9c3.5 0 4.5 3.2 8 3.2 2 0 3-1.1 3-2.6 0-1-.6-1.7-1.5-1.7-.7 0-1.2.4-1.2 1 0 .5.3.8.8.8"
      fill="none"
      stroke={c}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  mistral: (c) => (
    <g fill={c}>
      <rect x="4" y="6" width="3.2" height="12" />
      <rect x="10.4" y="6" width="3.2" height="12" opacity="0.7" />
      <rect x="16.8" y="6" width="3.2" height="12" opacity="0.45" />
    </g>
  ),
  alibaba: (c) => (
    <path
      d="M7 8.5C5 8.5 4 10 4 12s1 3.5 3 3.5c1.4 0 2.2-.7 3-1.8l1-1.4c.8-1.1 1.6-1.8 3-1.8 2 0 3 1.5 3 3.5"
      fill="none"
      stroke={c}
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  ),
  qwen: (c) => (
    <path
      d="M7 8.5C5 8.5 4 10 4 12s1 3.5 3 3.5c1.4 0 2.2-.7 3-1.8l1-1.4c.8-1.1 1.6-1.8 3-1.8 2 0 3 1.5 3 3.5"
      fill="none"
      stroke={c}
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  ),
  zhipu: (c) => (
    <path d="M5 5h14l-9 14v-8H5Z" fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round" />
  ),
  moonshot: (c) => (
    <path d="M17 12a6 6 0 1 1-6-6 4.6 4.6 0 0 0 6 6Z" fill={c} />
  ),
  microsoft: (c) => (
    <g fill={c}>
      <rect x="4" y="4" width="7" height="7" />
      <rect x="13" y="4" width="7" height="7" opacity="0.8" />
      <rect x="4" y="13" width="7" height="7" opacity="0.8" />
      <rect x="13" y="13" width="7" height="7" opacity="0.6" />
    </g>
  ),
  minimax: (c) => (
    <g fill={c}>
      <rect x="4" y="7" width="2.6" height="10" />
      <rect x="8" y="4" width="2.6" height="16" opacity="0.7" />
      <rect x="13.4" y="7" width="2.6" height="10" opacity="0.7" />
      <rect x="17.4" y="4" width="2.6" height="16" />
    </g>
  ),
  bytedance: (c) => (
    <g fill={c}>
      <rect x="5" y="6" width="2.4" height="12" />
      <rect x="9.5" y="9" width="2.4" height="6" opacity="0.7" />
      <rect x="14" y="6" width="2.4" height="12" opacity="0.85" />
      <rect x="18" y="9" width="2" height="6" opacity="0.6" />
    </g>
  ),
  cohere: (c) => (
    <path
      d="M9 8.5a3.5 3.5 0 1 0 0 7h6.5a2 2 0 0 0 0-4H10"
      fill="none"
      stroke={c}
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  ),
  amazon: (c) => (
    <g fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round">
      <path d="M6 14c3.5 2.4 8.5 2.4 12 .2" />
      <path d="M16.5 16.4c.6-1.2.7-2.4.4-2.7-.3-.3-1.5-.2-2.4.2" strokeWidth="1.3" />
    </g>
  ),
  nous: (c) => (
    <circle cx="12" cy="12" r="6.5" fill="none" stroke={c} strokeWidth="1.6" strokeDasharray="3 2.4" />
  ),
  thinkingmachines: (c) => (
    <g fill="none" stroke={c} strokeWidth="1.5">
      <circle cx="12" cy="12" r="2.2" fill={c} />
      <path d="M12 4v3M12 17v3M4 12h3M17 12h3M6.3 6.3l2.1 2.1M15.6 15.6l2.1 2.1M17.7 6.3l-2.1 2.1M8.4 15.6l-2.1 2.1" strokeLinecap="round" />
    </g>
  ),
  tencent: (c) => (
    <path d="M12 4 5 18h14Z" fill="none" stroke={c} strokeWidth="1.6" strokeLinejoin="round" />
  ),
  meituan: (c) => (
    <path d="M6 16c0-4 2.7-8 6-8s6 4 6 8" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
  ),
};

export function CompanyLogo({
  providerKey,
  name,
  color,
  size = 44,
}: {
  providerKey: string;
  name: string;
  color: string;
  size?: number;
}) {
  const mark = MARKS[providerKey];
  return (
    <div className="brand-logo" style={{ width: size, height: size }} aria-hidden>
      {mark ? (
        <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62}>
          {mark(color)}
        </svg>
      ) : (
        <span style={{ color, fontWeight: 800, fontSize: size * 0.34 }}>
          {monogram(name, providerKey)}
        </span>
      )}
    </div>
  );
}
