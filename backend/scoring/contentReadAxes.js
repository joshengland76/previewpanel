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
//
// Spider v3: also home to computeTrendAxes() (trend_alignment/trending_topic,
// a direct field read, not emotion-name matching) -- the two axes that now
// occupy the radar's panel-only "content read" slots. See that function's
// own comment for why curiosity/inspiration were demoted to presence chips
// instead.

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
//
// Spider v3: no longer plotted as radar AXES (a near-certain 0 vertex on
// ~99% of videos looked broken even though it was an accurate reading --
// see SPIDER_V3_READOUT.md's zero-rate analysis). Still computed here and
// used to derive the "Detected signals" presence CHIPS instead -- the same
// underlying 0-10 read, just displayed as "detected: yes/no" (value > 0)
// rather than as a vertex that spends almost all its life at the origin.
export function computeContentReadAxes(features) {
  return {
    curiosity: emotionAxisValue("curiosity", "curiosity", features),
    inspiration: emotionAxisValue("inspiration", "inspir", features), // matches "inspiration" and "inspiring_*" combination labels
  };
}

// Spider v3 -- replaces the Curiosity/Inspiration vertices on the radar
// itself. Direct 0-10 reads of two C_dims fields (NOT emotion-name
// matching like computeContentReadAxes above): trending_alignment_signals
// (cdims.js: "count of pattern signals you noticed", already 0-10) and
// trending_topic_likelihood (cdims.js: 1-10). Both carry real but modest
// positive model coefficients (scoring_spec_v2.json: +0.0209 and +0.0138
// respectively -- an order of magnitude smaller than e.g. jc_novel's
// +0.0277 or emotion_combination_curiosity_inspiration's +0.1394), which is
// exactly why their tooltips must say "modest positive association," not
// imply a strong lever. Same "0 = no signal, including cdims never having
// run" convention as computeContentReadAxes -- see that function's comment.
function clampTo10(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
}

export function computeTrendAxes(features) {
  if (!features) return { trend_alignment: 0, trending_topic: 0 };
  return {
    trend_alignment: clampTo10(features.trending_alignment_signals),
    trending_topic: clampTo10(features.trending_topic_likelihood),
  };
}

// Spider v3.1 -- raw categorical/boolean inputs behind the "Detected
// signals" positive/negative chip row (DetectedSignals.jsx), bundled into
// one object so server.js has a single source of truth shared between the
// live path (this run's own `features`) and the /api/status DB-fallback
// recovery path (a past row's stored input_features) -- identical shape
// either way, same "current submission only" contract as the two functions
// above. Each field is a direct passthrough of an already-computed
// buildFeatures.js key; scoring_spec_v2.json coefficients (for reference):
// cta_type_follow +0.0368, caption_tone_educational +0.0293 (positive);
// is_sponsored_int -0.0746, caption_tone_promotional -0.0911,
// hook_style_question -0.0906, cta_type_buy -0.0572, cta_type_link -0.0362,
// text_overlay_density_heavy -0.0257 (negative). cta_type_save (+0.0541,
// positive) is read from the same ctaType field, checked separately in
// DetectedSignals.jsx.
export function buildSignalFields(features) {
  if (!features) {
    return { ctaType: null, captionTone: null, hookStyle: null, textOverlayDensity: null, isSponsored: null, inspirationStrict: false };
  }
  return {
    ctaType: features.cta_type ?? null,
    captionTone: features.caption_tone ?? null,
    hookStyle: features.hook_style ?? null,
    textOverlayDensity: features.text_overlay_density ?? null,
    isSponsored: features.is_sponsored_int === 1,
    // Chips v2, Task 4 -- the standalone Inspiration chip keys strictly to
    // emotion_primary_inspiration OR emotion_targeted_inspiration (the two
    // model-weighted categoricals, scoring_spec_v2.json coefficients
    // +0.0535 each), NOT the broader computeContentReadAxes() "inspiration"
    // read above (which also credits a secondary-emotion match or a bare
    // combination-label substring). emotion_targeted mirrors emotion_primary
    // 1:1 in this codebase (buildFeatures.js populates both from the same
    // extraction field), so checking both is redundant today but matches
    // the two real model features by name rather than assuming that never
    // changes.
    inspirationStrict: features.emotion_primary === "inspiration" || features.emotion_targeted === "inspiration",
  };
}
