// =============================================================================
// Vendor-Verified Baselines
// =============================================================================
// Real, published benchmark values for named flagship models that were not
// captured in the structured scrape but are stated in the model's own
// system card / announcement text. These are NOT imputations or estimates —
// they are verified vendor figures used only to FILL GAPS. A fetched/measured
// value always takes precedence (see scripts/score-models.ts).
//
// Source for Fable 5: "Per Fable 5/Mythos 5 System Card" — Fable 5 is the same
// underlying model as Claude Mythos 5, so the System Card's GPQA Diamond (94.1)
// and Humanity's Last Exam (59.0) figures apply to Fable 5 as well. Fable 5's
// measured SWE-bench Verified (95) is already in the structured data.
// =============================================================================

import type { BenchmarkKey } from "../../src/types";

export interface VendorBaseline {
  modelId: string;
  name: string;
  values: Partial<Record<BenchmarkKey, number>>;
  reason: string;
}

export const VENDOR_BASELINES: VendorBaseline[] = [
  {
    modelId: "cf5",
    name: "Claude Fable 5",
    values: {
      // Same underlying model as Mythos 5 per the Fable 5/Mythos 5 System Card.
      // Fable's measured SWE-bench (95) is kept; these fill the GPQA/HLE gaps.
      gpqa_diamond: 94.1,
      hle: 59.0,
    },
    reason:
      "Fable 5/Mythos 5 System Card: same underlying model as Claude Mythos 5 — GPQA Diamond 94.1%, Humanity's Last Exam 59.0%.",
  },
];
