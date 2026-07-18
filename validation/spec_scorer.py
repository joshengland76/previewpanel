#!/usr/bin/env python3
"""
spec_scorer.py — Python port of backend/scoring/scorer.js + buildFeatures.js.

Enhancements, Task 1. Reads ONLY the app repo's canonical
scoring_spec_v2.json / golden_vectors_v2.json (backend/scoring/) -- no
research-repo import, matching this project's standing "local helper, no
cross-repo import" convention for validation/ scripts. Mirrors scorer.js's
scoreFeatures() and buildFeatures.js's buildScoringFeatures() line for
line; any future spec/logic change must be ported to all three
(scorer.js, capstone_phaseb1.py's json_only_score(), and this file).

Two functions, deliberately separate (same split as the JS side):
  - score_features(features, spec) -- PURE, unclamped. This is what the
    golden-vector acceptance test exercises; scoring_spec_v2.json's
    duration_clamp_bounds is informational only and must NEVER be applied
    inside this function (see scorer.js's own comment -- several golden
    vectors deliberately include out-of-range durations with expected_yhat
    computed unclamped; clamping here would silently diverge and fail the
    gate).
  - build_features_from_stored(...) -- assembles the flat feature dict
    from STORED research data (a submissions row, a research_pp_runs_claude
    row, research_videos.is_sponsored/sponsored_brand) instead of a live
    job's in-memory dimensions/scores/contentRisk/cdimsDims. Duration
    clamping happens HERE (an input-shaping policy, not the scorer's job),
    exactly where buildFeatures.js does it.

Usage (self-test / acceptance gate):
    ./_venv/bin/python3 spec_scorer.py
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
BACKEND_SCORING = HERE.parent / "backend" / "scoring"
SPEC_PATH = BACKEND_SCORING / "scoring_spec_v2.json"
GOLDEN_VECTORS_PATH = BACKEND_SCORING / "golden_vectors_v2.json"

DIMS9 = ["funny", "compelling", "authentic", "novel", "visually_engaging",
         "emotionally_resonant", "useful", "surprising", "relatable"]
JUDGE_PREFIXES = ["critic", "trendsetter", "connector"]
RISK_COLUMNS = ["risk_sexual_suggestive", "risk_violence_shock", "risk_hate_harassment",
                "risk_profanity", "risk_outrage_inflammatory", "risk_dangerous_acts"]

_spec = None


def load_spec():
    global _spec
    if _spec is None:
        _spec = json.loads(SPEC_PATH.read_text())
    return _spec


def _is_missing(v):
    if v is None:
        return True
    if isinstance(v, float) and v != v:  # NaN
        return True
    return False


def score_features(features, spec=None):
    """score_features(features, spec?) -> float (ŷ, log-ratio units).

    Direct port of scorer.js's scoreFeatures -- PURE, no DB/network, no
    clamping. `features` is a flat dict keyed by feature name (the SAME
    names golden_vectors_v2.json's `inputs` use, and buildFeatures.js's
    output uses): critic_score, jc_authentic, cl_big_compelling,
    duration_secs, caption_tone, emotion_combination, cta_present, ...
    Missing/unknown keys are treated as null (median-imputed for
    numerics, "NA" for categoricals, falsy for booleans) -- matching the
    JS reference exactly."""
    if spec is None:
        spec = load_spec()
    x = {}

    # --- numeric (median-impute + standardize; optional __miss indicator) ---
    for col, params in spec["numeric_standardization"].items():
        raw = features.get(col)
        if _is_missing(raw):
            x[col] = 0.0
            if params.get("has_missing_indicator"):
                x[f"{col}__miss"] = 1.0
        else:
            x[col] = (float(raw) - params["median"]) / params["sd"]
            if params.get("has_missing_indicator"):
                x[f"{col}__miss"] = 0.0

    # --- boolean passthrough (no standardization) ---
    for col in spec["boolean_passthrough_columns"]:
        x[col] = 1.0 if features.get(col) else 0.0

    # --- categorical one-hot (direct category -> column lookup) ---
    for col, enc_spec in spec["categorical_encoders"].items():
        raw_val = features.get(col)
        if _is_missing(raw_val):
            raw_val = "NA"
        if col == "emotion_combination":
            # ANY value (including the literal "NA" for missing) not in the
            # pre-remap top-8 becomes "other" -- no exception for "NA"
            # itself (the one edge case the research-side Task-2 parity
            # gate caught -- see PHASEB1_READOUT.md).
            if raw_val not in enc_spec["pre_remap_top8"]:
                raw_val = "other"
        for out_col in enc_spec["all_output_columns"]:
            x[out_col] = 0.0
        target_col = enc_spec["category_to_column"].get(str(raw_val))
        if target_col:
            x[target_col] = 1.0

    # --- dot product + intercept ---
    yhat = spec["intercept"]
    for col in spec["feature_order"]:
        yhat += spec["coefficients"].get(col, 0.0) * x.get(col, 0.0)
    return yhat


def _mean_std(values):
    v = [float(x) for x in values if x is not None]
    if not v:
        return None, None
    mean = sum(v) / len(v)
    if len(v) == 1:
        return mean, 0.0
    variance = sum((x - mean) ** 2 for x in v) / (len(v) - 1)
    return mean, variance ** 0.5


def clamp_duration_secs(duration_secs, spec=None):
    if duration_secs is None:
        return None
    if spec is None:
        spec = load_spec()
    bounds = spec["duration_clamp_bounds"]
    return min(max(float(duration_secs), bounds["p1"]), bounds["p99"])


def build_features_from_stored(*, submission, cdims, is_sponsored=None, sponsored_brand=None,
                                clamp_duration=True, spec=None):
    """Mirrors buildFeatures.js's buildScoringFeatures exactly, reading
    from STORED research data instead of a live job's in-memory
    dimensions/scores/contentRisk/cdimsDims.

    submission: dict-like row from the app's `submissions` table (judge
      scores/dimensions/risk/duration -- joined to a research_videos row
      via file_name, see submit_to_pp.py's own DISCOVERY_QUERY).
    cdims: dict-like row from `research_pp_runs_claude` (joined via
      video_id), or None if C_dims wasn't extracted for this video yet --
      when None, every C_dims-derived field is left OUT of the returned
      dict entirely, exactly like buildFeatures.js's `if (cdimsDims)`
      block, so score_features() treats them as missing/null/"NA", not a
      guess at a default.
    is_sponsored / sponsored_brand: research_videos' own columns -- the
      app's live C_dims flow derives is_sponsored_int/has_brand_mention_int
      from ITS OWN cdimsDims.is_sponsored/.sponsored_brand, which
      research_pp_runs_claude doesn't store; research_videos already
      carries the equivalent signal from the SAME Stage-D extraction, so
      this is the same information via a different table, not a
      substitute source.
    """
    if spec is None:
        spec = load_spec()
    f = {}

    f["critic_score"] = submission.get("critic_score")
    f["trendsetter_score"] = submission.get("trendsetter_score")
    f["connector_score"] = submission.get("connector_score")
    present_scores = [s for s in (f["critic_score"], f["trendsetter_score"], f["connector_score"]) if s is not None]
    f["avg_score"] = (sum(float(s) for s in present_scores) / len(present_scores)) if present_scores else None
    objfit = [submission.get(f"{p}_objective_fit_score") for p in JUDGE_PREFIXES]
    objfit = [v for v in objfit if v is not None]
    f["objfit_consensus"] = (sum(float(v) for v in objfit) / len(objfit)) if objfit else None

    for d in DIMS9:
        mean, std = _mean_std([submission.get(f"{p}_big_{d}") for p in JUDGE_PREFIXES])
        f[f"jc_{d}"] = mean
        f[f"jd_{d}"] = std
    mean, std = _mean_std([submission.get(f"{p}_big_emotion_intensity") for p in JUDGE_PREFIXES])
    f["jc_emotion_intensity"] = mean
    f["jd_emotion_intensity"] = std

    f["tiktok_rewatch_potential"] = submission.get("tiktok_rewatch_potential")
    f["tiktok_seo_strength"] = submission.get("tiktok_seo_strength")

    risk_vals = [submission.get(c) for c in RISK_COLUMNS]
    risk_vals = [v for v in risk_vals if v is not None]
    f["risk_any"] = (1 if any(float(v) >= 3 for v in risk_vals) else 0) if risk_vals else None

    if cdims is not None:
        for d in DIMS9:
            f[f"cl_big_{d}"] = cdims.get(f"big_{d}")
        f["cl_big_polished"] = cdims.get("big_polished")
        f["hook_strength_visual"] = cdims.get("hook_strength_visual")
        f["hook_strength_audio"] = cdims.get("hook_strength_audio")
        f["emotion_primary_intensity"] = cdims.get("emotion_primary_intensity")
        f["emotion_secondary_intensity"] = cdims.get("emotion_secondary_intensity")
        f["trending_topic_likelihood"] = cdims.get("trending_topic_likelihood")
        f["trending_alignment_signals"] = cdims.get("trending_alignment_signals")
        f["cover_text_promises_value"] = cdims.get("cover_text_promises_value")
        f["cta_present"] = bool(cdims.get("cta_present"))
        f["direct_address"] = bool(cdims.get("direct_address"))
        f["audio_likely_trending"] = bool(cdims.get("audio_likely_trending"))
        f["caption_tone"] = cdims.get("caption_tone")
        f["hook_style"] = cdims.get("hook_style")
        f["cta_type"] = cdims.get("cta_type")
        f["emotion_targeted"] = cdims.get("emotion_targeted")
        f["emotion_primary"] = cdims.get("emotion_primary")
        f["emotion_secondary"] = cdims.get("emotion_secondary")
        f["text_overlay_density"] = cdims.get("text_overlay_density")
        f["text_overlay_role"] = cdims.get("text_overlay_role")
        f["specificity"] = cdims.get("specificity")
        f["emotion_combination"] = cdims.get("emotion_combination")
        f["is_sponsored_int"] = 1 if is_sponsored else 0
        f["has_brand_mention_int"] = 1 if sponsored_brand else 0
    # cdims is None -> every C_dims/Ctrl-from-Claude field above is simply
    # absent from `f` -- score_features() treats missing keys as null/"NA".

    duration_secs = submission.get("duration_secs")
    f["duration_secs"] = clamp_duration_secs(duration_secs, spec) if clamp_duration else duration_secs

    return f


def _run_golden_vector_gate():
    """ACCEPTANCE: reproduce all 421 rows of golden_vectors_v2.json to
    <=1e-9 before this scorer is used for anything. Prints the max abs
    diff either way -- always, not just on failure."""
    spec = load_spec()
    data = json.loads(GOLDEN_VECTORS_PATH.read_text())
    rows = data["rows"]
    max_diff = 0.0
    max_diff_row = None
    failures = []
    for row in rows:
        got = score_features(row["inputs"], spec)
        expected = row["expected_yhat"]
        diff = abs(got - expected)
        if diff > max_diff:
            max_diff = diff
            max_diff_row = row.get("video_id", row.get("source"))
        if diff > 1e-9:
            failures.append((row.get("video_id", row.get("source")), expected, got, diff))

    print(f"[spec_scorer] golden-vector gate: {len(rows)} rows, max abs diff = {max_diff:.3e} "
          f"(row: {max_diff_row})")
    if failures:
        print(f"[spec_scorer] FAILED: {len(failures)} row(s) exceed 1e-9:", file=sys.stderr)
        for video_id, expected, got, diff in failures[:10]:
            print(f"  video_id={video_id} expected={expected} got={got} diff={diff:.3e}", file=sys.stderr)
        return False
    print(f"[spec_scorer] PASSED: all {len(rows)} rows within 1e-9.")
    return True


if __name__ == "__main__":
    ok = _run_golden_vector_gate()
    sys.exit(0 if ok else 1)
