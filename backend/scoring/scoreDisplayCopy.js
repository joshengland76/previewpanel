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

  // "vs the last 100" -- poolSize is the fixed window ceiling (100/1,000),
  // not the self-excluded count used internally for the percentile math
  // itself; see scoreDisplay.js for why those two numbers are deliberately
  // different. Deliberately no objective/"videos we've scored" suffix here
  // (score display UI overhaul) -- the niche name is already in the stat's
  // own headline right above this line, so repeating it read as redundant.
  predictSub: (poolSize) =>
    poolSize ? `vs the last ${poolSize}` : null,

  // "Beats 68% of the last 1,000 videos we've scored"
  overallAppHeadline: (overallAppPercentile, poolSize) =>
    overallAppPercentile == null
      ? null
      : `Beats ${Math.round(overallAppPercentile)}% of the last ${poolSize} videos we've scored`,

  // personal is { type: "ordinal", rank, total } | { type: "percentile", value } | null
  personalHeadline: (personal) => {
    if (!personal) return null;
    if (personal.type === "ordinal") {
      return `Ranks ${ordinal(personal.rank)} out of your last ${personal.total} videos`;
    }
    return `Beats ${Math.round(personal.value)}% of your own videos`;
  },

  // Shown in the personal stat box in place of personalHeadline when there
  // isn't enough history yet (below PERSONAL_MIN_VIDEOS, currently 5 -- i.e.
  // this box always renders, unlike the niche/overall ones which are omitted
  // entirely when there's nothing to show). Keep in sync with
  // PERSONAL_MIN_VIDEOS in percentilePools.js if that threshold ever changes.
  personalPlaceholder: "Rank among your videos when >4",

  // Shown once, as an info-tooltip trigger next to the niche/overall rows
  // (NOT the personal row -- personal is the user's own history, no corpus
  // is involved there). Phase C, Task 0d: one modest added sentence for
  // non-tiktok submissions -- no disclaimer wall, just an honest proxy note.
  // The underlying model is genuinely the same for every platform right now
  // (see PROJECT_PLAN_v14.md §6); this doesn't change if/when the Task 0c
  // framing gate passes, since the gate is about whether platform-specific
  // percentile pools are warranted, not about the model itself.
  // Pool hygiene Task 3 -- one line, appended to the existing pool-info
  // tooltip (no new UI element): scores naturally vary a few points between
  // analyses of the same video; repeat runs are averaged (see
  // groupAverageNote below for the mechanism this refers to).
  poolInfoTooltip: (platform) => {
    const base = "Includes PreviewPanel submissions and our 4,900-video research library; live submissions gradually replace the library.";
    const varianceNote = " Scores naturally vary a few points between analyses of the same video; repeat runs of the same video are averaged.";
    if (platform && platform !== "tiktok") {
      return `${base} This score is based on our TikTok engagement study — treat it as a strong proxy for other short-form platforms.${varianceNote}`;
    }
    return `${base}${varianceNote}`;
  },

  // Pool hygiene Task 2 -- shown on the score card whenever this run matched
  // a Tier-1 fingerprint from the same user's own trailing-30d previews
  // (k>=2); null (renders nothing) for a first/only run.
  groupAverageNote: (k) => (k >= 2 ? `Average of ${k} analyses of this video.` : null),

  abstainHeadline: "We don't have enough reliable data yet to score this niche numerically.",

  // Three distinct cases, not one: a recognized objective that just isn't
  // clearing the ranking-confidence bar yet (data still accruing -- tier is
  // ABSTAIN/PROVISIONAL/THIN, any non-null tier, since showPercentileFor
  // already handles the one case where a recognized objective wouldn't reach
  // here: PREDICT implies p_gt0>=0.95 by construction, so a PREDICT tier
  // never lands in this branch) vs. a free-typed objective the UI accepts
  // but that isn't in tiers_v2_2.json at all (tier is null even though the
  // field isn't blank -- there's no model build for it yet, so it's logged
  // rather than scored) vs. no objective at all (nothing typed -- optional
  // field, left blank at submission). Conflating any two of these was
  // misleading: "still in progress" implies an existing model build is
  // catching up, which isn't true for an unknown objective, and "no
  // objective selected" is simply false when one was typed.
  abstainHonestLine: (objective, tier) => {
    if (tier != null) return "Reliable scoring for this objective is still in progress.";
    if (objective) return "This objective has been logged for a future scoring model build. No reliable score is currently available.";
    return "No objective selected, so no reliable scoring is available.";
  },

  // Cohort_5 Phase 3d -- shown as an additional line whenever showPercentile
  // is true but the objective's precision@decile is still below the 0.55
  // PREDICT bar (Gaming, Educational/How-To as of tiers_v2_2.json): the
  // ranking claim (this percentile) is statistically supported, but the
  // separate "our top pick for you is usually right" claim isn't yet.
  // Josh-editable constant, not a function -- one line, same for every
  // objective that trips this condition.
  precisionCaveatLine: "Percentiles here reflect validated ranking for this niche; our top-pick hit rate is still maturing.",
};

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
