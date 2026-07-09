// scoring/scoreDisplayCopy.js — every user-facing score-display string lives
// in this one file so the two hard rules (Phase B3, Task 5) are easy to audit
// in one place rather than scattered across UI code:
//
//   1. BASELINE-RELATIVE FRAMING ONLY. Always phrase results relative to the
//      creator's own typical video / niche baseline ("predicted to outperform
//      your typical video..."). Never an absolute quality claim ("this is a
//      great video") -- the model predicts relative standing, not quality.
//
//   2. NO CAUSAL DURATION ADVICE, ANYWHERE. duration_secs is a feature the
//      model conditions on; it is not causal guidance. Never write or imply
//      "make it longer/shorter to score higher" in any string here.
//
// Anyone adding a new string to this file must satisfy both rules above.

export const SCORE_DISPLAY_COPY = {
  predictHeadline: (nichePercentile) =>
    nichePercentile == null
      ? "This video's predicted score is still being calibrated for your niche."
      : `Predicted to outperform ${Math.round(nichePercentile)}% of typical videos in your niche.`,

  personalHeadline: (personalPercentile) =>
    personalPercentile == null
      ? null
      : `Predicted to outperform ${Math.round(personalPercentile)}% of your own past videos.`,

  overallAppHeadline: (overallAppPercentile) =>
    overallAppPercentile == null
      ? null
      : `Predicted to outperform ${Math.round(overallAppPercentile)}% of videos analyzed on PreviewPanel.`,

  abstainHeadline: "We don't have enough reliable data yet to score this niche numerically.",

  abstainHonestLine: "Reliable scoring for this niche is still in progress.",

  // Neutral by design: describes what a re-cut changes (the analyzed footage)
  // without ever implying a specific trim direction improves the score.
  trimNote: "A shorter resubmitted cut may score differently than this one — the prediction reflects the specific cut you analyzed, not a general judgment on length.",
};
