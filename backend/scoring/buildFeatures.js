// scoring/buildFeatures.js — assembles the capstone-v2 feature dict from the
// app's already-computed judge results (dimensions/scores/contentRisk, the
// same objects recordSubmissionForJob builds), the optional C_dims
// extraction result, and duration_secs.
//
// Duration clamping (Phase B3, Task 2) happens HERE, as an input-shaping
// policy, not inside scorer.js. scorer.js's scoreFeatures() must stay
// unclamped forever -- golden_vectors_v2.json deliberately includes
// out-of-range durations with expected_yhat computed unclamped, so clamping
// there would fail the golden-vector gate. Clamping live input at this layer,
// before it ever reaches scoreFeatures(), achieves the same "bound extreme/
// erroneous durations" intent without touching the scoring formula.

import { loadSpec } from "./scorer.js";

const DIMS9 = ["funny", "compelling", "authentic", "novel", "visually_engaging",
  "emotionally_resonant", "useful", "surprising", "relatable"];
const JUDGE_PREFIXES = ["critic", "trendsetter", "connector"];

function meanStd(values) {
  const v = values.filter((x) => x != null && !Number.isNaN(x));
  if (v.length === 0) return { mean: null, std: null };
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  if (v.length === 1) return { mean, std: 0 };
  const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1);
  return { mean, std: Math.sqrt(variance) };
}

/**
 * buildScoringFeatures({ dimensions, scores, contentRisk, cdimsDims, durationSecs })
 * -> feature dict matching scoring_spec_v2.json's expected keys exactly.
 *
 * `dimensions` / `scores` / `contentRisk` are the SAME shape
 * recordSubmissionForJob() already builds (critic_/trendsetter_/connector_
 * prefixed keys; "cool" already remapped to "trendsetter" by the caller).
 * `cdimsDims` is extractCdims()'s parsed JSON (or null if not run/failed).
 */
/**
 * clampDuration: gates the duration_clamp_bounds policy (default true, mirrors
 * CLAMP_DURATION env flag which the caller reads and passes in -- this module
 * stays pure and takes no env reads itself). spec: injectable for tests.
 */
export function clampDurationSecs(durationSecs, spec = loadSpec()) {
  if (durationSecs == null || Number.isNaN(Number(durationSecs))) return durationSecs;
  const { p1, p99 } = spec.duration_clamp_bounds;
  return Math.min(Math.max(Number(durationSecs), p1), p99);
}

export function buildScoringFeatures({ dimensions = {}, scores = {}, contentRisk = null, cdimsDims = null, durationSecs = null, clampDuration = true, spec = loadSpec() }) {
  const f = {};

  // J_summary
  f.critic_score = scores.critic ?? null;
  f.trendsetter_score = scores.cool ?? scores.trendsetter ?? null;
  f.connector_score = scores.connector ?? null;
  const presentScores = [f.critic_score, f.trendsetter_score, f.connector_score].filter((s) => s != null);
  f.avg_score = presentScores.length ? presentScores.reduce((a, b) => a + b, 0) / presentScores.length : null;
  const objFitScores = JUDGE_PREFIXES.map((p) => dimensions[`${p}_objective_fit_score`]).filter((v) => v != null);
  f.objfit_consensus = objFitScores.length ? objFitScores.reduce((a, b) => a + b, 0) / objFitScores.length : null;

  // J_dims: jc_*/jd_* (mean/std across the 3 judges' big_* dims)
  for (const d of DIMS9) {
    const vals = JUDGE_PREFIXES.map((p) => dimensions[`${p}_big_${d}`]).map((v) => (v == null ? null : Number(v)));
    const { mean, std } = meanStd(vals);
    f[`jc_${d}`] = mean;
    f[`jd_${d}`] = std;
  }
  {
    const vals = JUDGE_PREFIXES.map((p) => dimensions[`${p}_big_emotion_intensity`]).map((v) => (v == null ? null : Number(v)));
    const { mean, std } = meanStd(vals);
    f.jc_emotion_intensity = mean;
    f.jd_emotion_intensity = std;
  }
  // tiktok_rewatch_potential / tiktok_seo_strength are platform-dimension
  // fields, not per-judge -- averaged across whichever judges reported them
  // (mirrors server.js's own platDimSums/platDimCounts averaging).
  f.tiktok_rewatch_potential = dimensions.tiktok_rewatch_potential ?? null;
  f.tiktok_seo_strength = dimensions.tiktok_seo_strength ?? null;

  // Ctrl
  f.is_sponsored_int = cdimsDims ? (cdimsDims.is_sponsored ? 1 : 0) : null;
  f.has_brand_mention_int = cdimsDims ? (cdimsDims.sponsored_brand ? 1 : 0) : null;
  if (contentRisk) {
    const riskVals = Object.values(contentRisk).filter((v) => v != null);
    f.risk_any = riskVals.length ? (riskVals.some((v) => Number(v) >= 3) ? 1 : 0) : null;
  } else {
    f.risk_any = null;
  }

  // C_dims (only populated if the C_dims extractor ran and succeeded)
  if (cdimsDims) {
    for (const d of DIMS9) f[`cl_big_${d}`] = cdimsDims[`big_${d}`] ?? null;
    f.cl_big_polished = cdimsDims.big_polished ?? null;
    f.hook_strength_visual = cdimsDims.hook_strength_visual ?? null;
    f.hook_strength_audio = cdimsDims.hook_strength_audio ?? null;
    f.emotion_primary_intensity = cdimsDims.emotion_primary_intensity ?? null;
    f.emotion_secondary_intensity = cdimsDims.emotion_secondary_intensity ?? null;
    f.trending_topic_likelihood = cdimsDims.trending_topic_likelihood ?? null;
    f.trending_alignment_signals = cdimsDims.trending_alignment_signals ?? null;
    f.cover_text_promises_value = cdimsDims.cover_text_promises_value ?? null;
    f.cta_present = !!cdimsDims.cta_present;
    f.direct_address = !!cdimsDims.direct_address;
    f.audio_likely_trending = !!cdimsDims.audio_likely_trending;
    f.caption_tone = cdimsDims.caption_tone ?? null;
    f.hook_style = cdimsDims.hook_style ?? null;
    f.cta_type = cdimsDims.cta_type ?? null;
    // research_pp_runs_claude.emotion_targeted is a back-compat column parser.py
    // populates directly from the extraction's emotion_primary value (confirmed
    // in parser.py: "Keep emotion_targeted for back-compat — populate from
    // emotion_primary") -- the extraction prompt itself has no separate
    // emotion_targeted field, so this mirrors that exactly, not a guess.
    f.emotion_targeted = cdimsDims.emotion_primary ?? null;
    f.emotion_primary = cdimsDims.emotion_primary ?? null;
    f.text_overlay_density = cdimsDims.text_overlay_density ?? null;
    f.text_overlay_role = cdimsDims.text_overlay_role ?? null;
    f.specificity = cdimsDims.specificity ?? null;
    f.emotion_combination = cdimsDims.emotion_combination ?? null;
  }
  // If cdimsDims is null, all C_dims/Ctrl-from-Claude fields above are simply
  // absent from `f` -- scoreFeatures() treats missing keys as null/"NA",
  // matching the research pipeline's own missing-C_dims-row handling exactly
  // (see PHASEB1_READOUT.md's Task-2 parity-gate bugfix, which specifically
  // exercised this all-categoricals-null path).

  f.duration_secs = clampDuration ? (clampDurationSecs(durationSecs, spec) ?? null) : (durationSecs ?? null);

  return f;
}
