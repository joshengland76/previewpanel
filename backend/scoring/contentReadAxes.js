// scoring/contentReadAxes.js — Sweep C: Curiosity/Inspiration "content read"
// spider-chart axes. These are NOT judge-scored (no per-judge ghost lines,
// no averaging across judges) -- they're a single deterministic scalar per
// video, derived entirely from the already-stored C_dims extraction fields
// (buildFeatures.js's emotion_primary/emotion_secondary/emotion_combination/
// emotion_primary_intensity/emotion_secondary_intensity). Computable for
// every past shadow row, since all of those fields are already part of the
// 116-feature JSON every submission has always written to
// shadow_scores.input_features -- no new extraction, no re-scoring.
//
// Model justification for choosing exactly these two (not some other
// emotion pair): scoring_spec_v2.json's nonzero coefficients include
// emotion_targeted_inspiration (+0.0535), emotion_primary_inspiration
// (+0.0535), emotion_combination_curiosity_delight (+0.0168), and
// emotion_combination_curiosity_inspiration (+0.1394, the single largest
// categorical coefficient in the model) -- curiosity and inspiration are the
// only two emotions with real, nonzero model support among everything C_dims
// captures. Every OTHER emotion_primary/emotion_targeted/emotion_combination
// level has a zero coefficient (regularized out).
//
// Bug fix (post-launch): buildFeatures.js mapped emotion_secondary_intensity
// from the Claude extraction but never mapped emotion_secondary itself (the
// emotion name) -- every submission silently lost that field, so a video
// whose real secondary emotion was e.g. "inspiration" read 0 here unless
// "inspir" also happened to appear in emotion_combination's text. Fixed in
// buildFeatures.js; this file now checks emotion_secondary directly instead
// of only reaching its intensity through a combination-text guess.

// 0-10 scale, matching every other radar axis. cdims.js's intensity fields
// are 1-5 (Claude's own extraction scale); this rescales to 0-10 by simple
// doubling, keeping "1-5 minimal->dominant" mapped onto "2-10 minimal->dominant".
function toTenScale(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(10, n * 2));
}

// Emotion detected via emotion_combination text alone -- neither
// emotion_primary nor emotion_secondary is literally this emotion, but the
// combination label mentions it (e.g. combo="curiosity_delight" while
// primary="joy" and secondary is something else or null). No specific 1-5
// intensity field maps to a combination-only mention, so rather than claim
// a precision the data doesn't support, or read 0 (which would misrepresent
// "detected, unmeasured" as "absent"), this fixed floor marks "present, but
// only backed by a categorical mention, not a direct intensity reading."
const CATEGORICAL_ONLY_FALLBACK = 4;

function emotionAxisValue(emotionName, matchSubstring, features) {
  if (!features) return 0;
  const primary = features.emotion_primary ?? null;
  const secondary = features.emotion_secondary ?? null;
  const combo = (features.emotion_combination ?? "").toLowerCase();

  if (primary === emotionName) {
    return toTenScale(features.emotion_primary_intensity) ?? CATEGORICAL_ONLY_FALLBACK;
  }
  if (secondary === emotionName) {
    return toTenScale(features.emotion_secondary_intensity) ?? CATEGORICAL_ONLY_FALLBACK;
  }
  if (combo.includes(matchSubstring)) {
    return CATEGORICAL_ONLY_FALLBACK;
  }
  return 0;
}

// features: the buildFeatures.js-shaped object (or the equivalent fields
// read back from shadow_scores.input_features for a past row). Returns
// {curiosity, inspiration}, each 0-10, always present (never null) so the
// chart always has a number to plot -- 0 genuinely means "no trace of this
// emotion in any of the three C_dims fields," which is a real, meaningful
// reading, not a missing-data placeholder.
export function computeContentReadAxes(features) {
  return {
    curiosity: emotionAxisValue("curiosity", "curiosity", features),
    inspiration: emotionAxisValue("inspiration", "inspir", features), // matches "inspiration" and "inspiring_*" combination labels
  };
}
