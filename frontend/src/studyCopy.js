// studyCopy.js — every number and every sentence about the underlying study
// lives here, in one place, so it can be audited against
// analysis/PreviewPanel_Scoring_Study_Writeup_v2.md and tiers_v2_1.json
// (research repo) without hunting through UI code.
//
// HARD RULES (apply to every string in this file and in methodology.html):
//   1. No causal advice, duration especially. duration_secs is a feature the
//      model conditions on, never instructions to lengthen/shorten a video.
//   2. Baseline-relative framing everywhere -- performance is described
//      relative to a creator's own typical video / niche / cohort, never as
//      an absolute quality claim.
//   3. Never say "guarantee" or "predict virality" or anything that implies
//      certainty about a single future outcome. This is a ranking aid, not a
//      forecast of what will happen.
//
// Numbers below are exact figures from the study; do not round or restate
// them differently elsewhere without updating this file first.

export const STUDY_STATS = {
  nCreators: 259,
  nVideosCollected: 5109,
  nVideosScored: 4897,
  nVideosScoredRounded: "about 4,900",
  nNiches: 19,
  // Two-axis display gate (cohort_5 Phase 3d) + tier policy v2.2 (Educational
  // -> PROVISIONAL): percentile display is gated on P(WC>0)>=0.95 alone, not
  // the PREDICT label, so PROVISIONAL niches (Gaming, Educational/How-To)
  // show real percentiles too, paired with a caveat -- only Dancing (p_gt0
  // still below 0.95) stays fully suppressed. nNichesReliable (the old
  // PREDICT-only count) is retired in favor of these three, which describe
  // what the product actually shows:
  nNichesWithScores: 18, // PREDICT (16) + PROVISIONAL (2) -- percentile shown
  nNichesWithCaveat: 2, // of the 18, these additionally show the top-pick-precision caveat line
  nNichesSuppressed: 1, // Dancing -- honest line only, no percentile
  outcomeWindowDays: 30,
  precisionAtDecile: 0.6844,
  precisionAtDecileCasual: "68% of the time — more than 2 in 3 (coin flip = 1 in 2)",
  heldOutRankCorrelation: 0.25, // lockbox (generalization): sealed 30-creator holdout, opened once
  crossValidatedRankCorrelation: 0.28, // full-corpus CV (estimation): all 199 study creators
  lockboxCreators: 30,
  lockboxOpenedTimes: 1,
  preregAmendments: 36, // CAPSTONE_PREREG_v2.md's 35 numbered entries + COHORT5_PREREG.md (1 dated prereg, written before any cohort_5 number existed)
};

// Verbatim -- minor layout edits allowed, wording must not change. (Score
// display UI overhaul: dropped the "plus video length" callout -- duration
// is one of many inputs, not a distinguishing one worth naming on its own --
// in favor of stating the model's actual scale.)
export const METHODOLOGY_MODAL_TEXT =
  "PreviewPanel's scoring is a prediction of relative performance: how " +
  "this video is likely to do compared with your own typical video, based " +
  "on what's in the video itself. It comes from a study of about 4,900 " +
  "TikTok videos from 259 creators across 19 niches, tracking real 30-day " +
  "engagement (likes, shares, and saves per view). The model reads the same " +
  "signals our judges do — hook, emotion, pacing, clarity — across 56 " +
  "correlated variables in total, and turns them into a single prediction. In held-out " +
  "testing on creators the model had never seen, videos it ranked in its " +
  "top decile beat the creator's typical engagement 68% of the time — more " +
  "than 2 in 3 (coin flip = 1 in 2). " +
  "It's a ranking aid, not a crystal ball: it tells you which of your " +
  "videos looks strongest, not whether a video will go viral. See how we " +
  "validated it →";

export const METHODOLOGY_LINK_TEXT = "See how we validated it";
export const METHODOLOGY_URL = "/methodology";
