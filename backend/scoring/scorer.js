// scoring/scorer.js — capstone v2 scoring, JSON-spec-only (no ML library import).
//
// Consumes ONLY scoring_spec_v2.json (exported read-only from the research
// repo's capstone_model_artifact_v2.pkl — that pkl is never touched, and this
// file is a straight copy, not hand-edited). Pure function: features in,
// prediction out. No DB access, no side effects.
//
// IMPORTANT — duration_clamp_bounds in the spec is INFORMATIONAL ONLY. It is
// the training population's 1st/99th percentile of duration_secs, exported
// for out-of-range monitoring/flagging. It is NOT applied to the score: the
// research reference scorer that produced golden_vectors_v2.json's expected
// outputs does not clamp duration before standardizing, and several golden
// vectors deliberately include durations outside [p1, p99] specifically to
// pin this down. Clamping here would silently diverge from the shipped
// model and fail the golden-vector gate. See PHASEB2_READOUT.md.
//
// Mirrors analysis/modeling/scripts/capstone_phaseb1.py's json_only_score()
// line for line — any future spec/logic change must be ported to both.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = path.join(__dirname, "scoring_spec_v2.json");

let _spec = null;

export function loadSpec() {
  if (!_spec) {
    _spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  }
  return _spec;
}

// Returns { flagged: bool, p1, p99 } -- monitoring only, never alters scoring.
export function checkDurationRange(durationSecs, spec = loadSpec()) {
  const { p1, p99 } = spec.duration_clamp_bounds;
  const v = Number(durationSecs);
  return { flagged: !(v >= p1 && v <= p99), p1, p99, value: v };
}

function isMissing(v) {
  return v === null || v === undefined || (typeof v === "number" && Number.isNaN(v));
}

/**
 * scoreFeatures(features, spec?) -> number (ŷ, log-ratio units)
 *
 * `features` is a plain object keyed by feature name (the same names as
 * FinalModel consumes: critic_score, jc_authentic, cl_big_compelling,
 * duration_secs, caption_tone, emotion_combination, cta_present, ...).
 * Missing/unknown keys are treated as null (median-imputed for numerics,
 * "NA" for categoricals, falsy for booleans) — matching the Python reference
 * scorer exactly.
 */
export function scoreFeatures(features, spec = loadSpec()) {
  const x = {};

  // --- numeric (median-impute + standardize; optional __miss indicator) ---
  for (const [col, params] of Object.entries(spec.numeric_standardization)) {
    const raw = features[col];
    if (isMissing(raw)) {
      x[col] = 0.0;
      if (params.has_missing_indicator) x[`${col}__miss`] = 1.0;
    } else {
      x[col] = (Number(raw) - params.median) / params.sd;
      if (params.has_missing_indicator) x[`${col}__miss`] = 0.0;
    }
  }

  // --- boolean passthrough (no standardization) ---
  for (const col of spec.boolean_passthrough_columns) {
    x[col] = features[col] ? 1.0 : 0.0;
  }

  // --- categorical one-hot (direct category -> column lookup) ---
  for (const [col, encSpec] of Object.entries(spec.categorical_encoders)) {
    let rawVal = features[col];
    if (isMissing(rawVal)) rawVal = "NA";
    if (col === "emotion_combination") {
      // ANY value (including the literal "NA" for missing) not in the
      // pre-remap top-8 becomes "other" -- no exception for "NA" itself.
      // (This exact edge case was the one bug the research-side Task-2
      // parity gate caught -- see PHASEB1_READOUT.md.)
      if (!encSpec.pre_remap_top8.includes(rawVal)) rawVal = "other";
    }
    for (const outCol of encSpec.all_output_columns) x[outCol] = 0.0;
    const targetCol = encSpec.category_to_column[String(rawVal)];
    if (targetCol) x[targetCol] = 1.0;
  }

  // --- dot product + intercept ---
  let yhat = spec.intercept;
  for (const col of spec.feature_order) {
    yhat += (spec.coefficients[col] ?? 0.0) * (x[col] ?? 0.0);
  }
  return yhat;
}

/**
 * calibratedPercentile(yhat, objectiveLongName, pegasusModel, spec?) -> number|null
 *
 * Applies the Task-0 calibration policy: 1.2-scored predictions are shifted
 * onto the 1.5 scale before percentile lookup; 1.5-scored predictions are
 * used as-is. Looks up against reference_distributions_v2.json's precomputed
 * `active_reference_by_objective` grid (already resolved to empirical-1.5-only
 * or constructed-shifted per objective, per Validation B -- no decision logic
 * needed here, just interpolated lookup).
 */
export function calibratedYhat(yhat, pegasusModel, spec = loadSpec()) {
  const offset = spec.calibration.propagated_yhat_offset.mean;
  return pegasusModel === "pegasus1.5" ? yhat : yhat + offset;
}

export function percentileFromGrid(value, quantileGrid) {
  const entries = Object.entries(quantileGrid)
    .map(([k, v]) => [Number(k.slice(1)), v])
    .sort((a, b) => a[0] - b[0]);
  if (value <= entries[0][1]) return entries[0][0];
  if (value >= entries[entries.length - 1][1]) return entries[entries.length - 1][0];
  for (let i = 0; i < entries.length - 1; i++) {
    const [pLo, vLo] = entries[i];
    const [pHi, vHi] = entries[i + 1];
    if (value >= vLo && value <= vHi) {
      const frac = vHi === vLo ? 0 : (value - vLo) / (vHi - vLo);
      return pLo + frac * (pHi - pLo);
    }
  }
  return null;
}
