// scoring/scoreDisplayCopy.js — every user-facing score-display string lives
// in this one file so the two hard rules are easy to audit in one place
// rather than scattered across UI code:
//
//   1. BASELINE-RELATIVE FRAMING ONLY. Always phrase results relative to a
//      pool (this niche's recent videos, the app's recent videos, the
//      creator's own history) -- "Beats 71% of Fitness videos," never an
//      absolute quality claim ("this is a great video"). The model predicts
//      relative standing, not quality.
//
//   2. NO CAUSAL DURATION ADVICE, ANYWHERE. duration_secs is a feature the
//      model conditions on; it is not causal guidance. Never write or imply
//      "make it longer/shorter to score higher" in any string here.
//
// Anyone adding a new string to this file must satisfy both rules above.
//
// Percentiles are ALWAYS rendered as integers (Math.round, done upstream in
// percentilePools.js) -- never decimals.
//
// FRAMING NOTE (fixed after a real bug report): this file used to render
// "Top N%" (N = 100 - percentile). That inverts at the low end of the
// distribution -- a video that is literally the WORST in its pool has
// percentile=0, so N=100, producing "Top 100%," which reads as an
// impressive result to anyone unfamiliar with the arithmetic (bigger number
// looks like "more top-tier"), when it actually means the opposite. Direct
// percentile framing ("Beats N% of...") has no such inversion: 0 always
// reads as bad, 100 always reads as good, at every point in the range.

export const SCORE_DISPLAY_COPY = {
  // "Beats 71% of Fitness videos"
  predictHeadline: (nichePercentile, objective) =>
    nichePercentile == null
      ? "This video's predicted score is still being calibrated for your niche."
      : `Beats ${Math.round(nichePercentile)}% of ${objective} videos`,

  // "vs the last 100 Fitness videos we've scored" -- poolSize is the fixed
  // window ceiling (100/1,000), not the self-excluded count used internally
  // for the percentile math itself; see scoreDisplay.js for why those two
  // numbers are deliberately different.
  predictSub: (objective, poolSize) =>
    poolSize ? `vs the last ${poolSize} ${objective} videos we've scored` : null,

  // "Beats 68% of the last 1,000 videos we've scored"
  overallAppHeadline: (overallAppPercentile, poolSize) =>
    overallAppPercentile == null
      ? null
      : `Beats ${Math.round(overallAppPercentile)}% of the last ${poolSize} videos we've scored`,

  // personal is { type: "ordinal", rank, total } | { type: "percentile", value } | null
  personalHeadline: (personal) => {
    if (!personal) return null;
    if (personal.type === "ordinal") {
      return `You rank ${ordinal(personal.rank)} out of your last ${personal.total} videos`;
    }
    return `Beats ${Math.round(personal.value)}% of your own videos`;
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
