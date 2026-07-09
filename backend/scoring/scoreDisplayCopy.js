// scoring/scoreDisplayCopy.js — every user-facing score-display string lives
// in this one file so the two hard rules are easy to audit in one place
// rather than scattered across UI code:
//
//   1. BASELINE-RELATIVE FRAMING ONLY. Always phrase results relative to a
//      pool (this niche's recent videos, the app's recent videos, the
//      creator's own history) -- "Top 24% in Fitness," never an absolute
//      quality claim ("this is a great video"). The model predicts relative
//      standing, not quality.
//
//   2. NO CAUSAL DURATION ADVICE, ANYWHERE. duration_secs is a feature the
//      model conditions on; it is not causal guidance. Never write or imply
//      "make it longer/shorter to score higher" in any string here.
//
// Anyone adding a new string to this file must satisfy both rules above.
//
// Percentiles are ALWAYS rendered as integers (Math.round) -- never decimals,
// per Phase B3b Task 3. `poolSize` in the *Sub helpers below is the actual
// number of videos in the pool used, which may be well under the pool's
// window ceiling for a thin niche (e.g. Myth Busting, ~24 corpus rows —
// see PHASEB3B_READOUT.md Task 1) -- the sub-line must say what was actually
// used, not the theoretical window size.

function topPct(percentile) {
  if (percentile == null) return null;
  return Math.round(100 - percentile);
}

export const SCORE_DISPLAY_COPY = {
  // "Top 24% in Fitness"
  predictHeadline: (nichePercentile, objective) => {
    const t = topPct(nichePercentile);
    return t == null
      ? "This video's predicted score is still being calibrated for your niche."
      : `Top ${t}% in ${objective}`;
  },
  // "vs the last 100 Fitness videos we've scored"
  predictSub: (objective, poolSize) =>
    poolSize ? `vs the last ${poolSize} ${objective} videos we've scored` : null,

  // "Top 31% of the last 1,000 videos we've scored"
  overallAppHeadline: (overallAppPercentile, poolSize) => {
    const t = topPct(overallAppPercentile);
    return t == null ? null : `Top ${t}% of the last ${poolSize} videos we've scored`;
  },

  // personal is { type: "ordinal", rank, total } | { type: "percentile", value } | null
  personalHeadline: (personal) => {
    if (!personal) return null;
    if (personal.type === "ordinal") {
      return `You rank ${ordinal(personal.rank)} out of your last ${personal.total} videos`;
    }
    const t = topPct(personal.value);
    return t == null ? null : `Top ${t}% of your own videos`;
  },

  // Shown once, as an info-tooltip trigger next to the niche/overall rows
  // (NOT the personal row -- personal is the user's own history, no corpus
  // is involved there).
  poolInfoTooltip:
    "Includes PreviewPanel submissions and our 4,900-video research library; live submissions gradually replace the library.",

  abstainHeadline: "We don't have enough reliable data yet to score this niche numerically.",

  abstainHonestLine: "Reliable scoring for this niche is still in progress.",

  // Neutral by design: describes what a re-cut changes (the analyzed footage)
  // without ever implying a specific trim direction improves the score.
  trimNote: "A shorter resubmitted cut may score differently than this one — the prediction reflects the specific cut you analyzed, not a general judgment on length.",
};

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
