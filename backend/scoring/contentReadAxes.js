// scoring/contentReadAxes.js — Sweep C: Curiosity/Inspiration "content read"
// spider-chart axes. These are NOT judge-scored (no per-judge ghost lines,
// no averaging across judges) -- they're a single deterministic scalar per
// video, derived entirely from the already-stored C_dims extraction fields
// (buildFeatures.js's emotion_primary/emotion_targeted/emotion_combination/
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
// live cdims.js's extraction schema has no separate "emotion_targeted" field
// -- buildFeatures.js's own comment confirms emotion_targeted is a back-compat
// mirror of emotion_primary (parser.py populates it the same way), so in
// practice "primary vs targeted" is one signal, not two, for a live
// submission's features object.

// 0-10 scale, matching every other radar axis. cdims.js's intensity fields
// are 1-5 (Claude's own extraction scale); this rescales to 0-10 by simple
// doubling, keeping "1-5 minimal->dominant" mapped onto "2-10 minimal->dominant"
// (0-2 is reserved for "detected in combination/targeted only, no direct
// intensity reading" -- see NO_INTENSITY_FALLBACK below).
function toTenScale(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(10, n * 2));
}

// Emotion detected via emotion_combination or emotion_targeted alone (no
// matching direct intensity field -- emotion_secondary's own NAME isn't
// stored, only emotion_secondary_intensity, so a combination-only match
// can't be definitively tied to primary vs. secondary intensity). Rather
// than claim a precision the data doesn't support, or read 0 (which would
// misrepresent "detected, unmeasured" as "absent"), this fixed floor marks
// "present, but only backed by a categorical mention, not the specific
// primary/secondary intensity scale."
const CATEGORICAL_ONLY_FALLBACK = 4;

function emotionAxisValue(emotionName, matchSubstring, features) {
  if (!features) return 0;
  const primary = features.emotion_primary ?? null;
  const targeted = features.emotion_targeted ?? null; // mirrors primary live, kept distinct for research-repo-shaped payloads
  const combo = (features.emotion_combination ?? "").toLowerCase();

  const inPrimary = primary === emotionName;
  const inTargeted = targeted === emotionName;
  const inCombo = combo.includes(matchSubstring);

  if (!inPrimary && !inTargeted && !inCombo) return 0;
  if (inPrimary) return toTenScale(features.emotion_primary_intensity) ?? CATEGORICAL_ONLY_FALLBACK;
  // Present via targeted (mirror of primary) or combination only, without a
  // direct primary-intensity match (e.g. it's the SECONDARY half of a
  // combination label) -- fall back to secondary intensity if the extraction
  // recorded one, else the fixed categorical-only floor.
  return toTenScale(features.emotion_secondary_intensity) ?? CATEGORICAL_ONLY_FALLBACK;
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
