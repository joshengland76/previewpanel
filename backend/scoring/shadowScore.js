// scoring/shadowScore.js — invisible shadow-scoring persistence (Phase B2,
// Task 4). Writes capstone-v2 predictions to a NEW table for every submission
// while EXTRACT_CDIMS + SHADOW_SCORING flags are on. Nothing here is ever
// shown to users. A scoring failure must NEVER block or delay the
// user-facing analysis path -- callers invoke recordShadowScore()
// fire-and-forget (no await on the request's critical path) and every
// internal step is wrapped so this module cannot throw out to the caller.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scoreFeatures, calibratedYhat, percentileFromGrid, loadSpec } from "./scorer.js";
import { invalidatePoolCache } from "./percentilePools.js";
import { invalidateAxisPoolCache } from "./axisPools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REF_PATH = path.join(__dirname, "reference_distributions_v2.json");
const TIERS_PATH = path.join(__dirname, "tiers_v2_2.json");

let _refDist = null;
function loadRefDist() {
  if (!_refDist) _refDist = JSON.parse(fs.readFileSync(REF_PATH, "utf8"));
  return _refDist;
}
let _tiers = null;
function loadTiers() {
  if (!_tiers) _tiers = JSON.parse(fs.readFileSync(TIERS_PATH, "utf8"));
  return _tiers;
}

let _specHash = null;
function specHash() {
  if (!_specHash) {
    const raw = fs.readFileSync(path.join(__dirname, "scoring_spec_v2.json"));
    _specHash = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 16);
  }
  return _specHash;
}

// Generic group-mean fold, shared by content-read axes (2 keys) and the
// spider chart's judge-scored big-picture axes (18 keys: 3 judges x 5 axes
// + objective fit) -- one row's own value object, folded against an array of
// the same-shaped objects from every other matched group member. Missing
// per-key values (e.g. a past row scored before a given axis existed) count
// as 0 rather than dropping the key or NaN-poisoning the mean, matching
// computeContentReadAxes()'s own "0 is a real, meaningful reading" contract.
function foldGroupMean(own, existingArray, groupK) {
  if (!own) return own;
  const result = {};
  for (const key of Object.keys(own)) {
    const existingSum = existingArray.reduce((a, e) => a + (e?.[key] ?? 0), 0);
    result[key] = (existingSum + (own[key] ?? 0)) / groupK;
  }
  return result;
}

// NOTE: the shadow_scores schema (including the objective/user_id columns
// added Phase B3 Task 5) is created inline in server.js's initDb() migration
// block, matching every other table's convention in this file -- there is no
// separate ensureShadowScoresTable() call site. An earlier version of this
// module exported one, but it was never actually wired into initDb() (dead
// code masking a real bug: the objective/user_id ALTER TABLEs it defined were
// never applied). Removed rather than left to rot as a second, diverging
// source of truth for this schema.

/**
 * recordShadowScore({ queryRW, submissionId, features, objective, pegasusModel,
 *   promptVersion, cdimsStatus, fpGroup }) -- fire-and-forget from the caller.
 * Every failure mode is caught internally and logged; nothing is ever re-thrown.
 *
 * fpGroup (pool hygiene Task 2): null, or { fpGroupKey, existingPredictions,
 * existingContentReadAxes, existingBigPicture, existingTrendAxes } from
 * server.js's resolveFingerprintGroup() -- a Tier-1 fingerprint match against
 * the same user's own trailing-30d previews. When present, this row joins
 * that group: group_k/group_mean_prediction fold this row's own (unchanged,
 * separately-stored) prediction into the group; group_mean_content_read_axes
 * does the same for the Curiosity/Inspiration content-read axes
 * (contentReadAxes param); group_mean_big_picture does the same for the
 * spider chart's other 6 axes -- each of the 3 judges' own big-picture
 * dimension scores plus objective fit (bigPicture param, this row's own
 * flattened {judge}_big_{dim}/{judge}_objective_fit_score values, same shape
 * as the `submissions` columns they're read from); group_mean_trend_axes does
 * the same for the radar's remaining 2 axes, Trend Alignment/Trending Topic
 * (trendAxes param). The row is inserted pool_eligible=false (only
 * a group's first member stays eligible).
 * When null, this row is a fresh singleton -- pool_eligible=true, and its
 * fp_group_key is a fresh UUID generated BEFORE the insert (bug fix: an
 * earlier version derived this from the row's own id via a two-step
 * INSERT-then-UPDATE, which raced against any concurrent submission's match
 * lookup reading this row's fp_group_key in the gap between the two queries
 * -- group_k/group_mean_prediction would compute correctly since those don't
 * depend on it, but the match would adopt a null key and self-assign its own
 * instead, so grouped rows never actually shared one key). Computing the key
 * up front and writing it in the single INSERT removes that gap entirely.
 */
export async function recordShadowScore({
  queryRW, submissionId, features, objective, pegasusModel, promptVersion, cdimsStatus, platform, userId,
  source, isPostedVideo, postedVideoId, // Phase C, Task 3
  sourceUrl = null, // Hotfix v2, Task 2 -- link_fetch jobs' raw URL, for generate_preview.py's per-video reuse
  fpGroup = null, // pool hygiene Task 2
  contentReadAxes = null, // Sweep C -- this row's own {curiosity, inspiration}, for group-mean folding below
  bigPicture = null, // this row's own flattened {judge}_big_{dim}/{judge}_objective_fit_score values
  trendAxes = null, // this row's own {trend_alignment, trending_topic}, for group-mean folding below
  isInternal = false, // Track Record v2, Task 0 -- founder/team identity; forces pool_eligible=false below
}) {
  try {
    const spec = loadSpec();
    const prediction = scoreFeatures(features, spec);
    const shifted = calibratedYhat(prediction, pegasusModel, spec);

    const ref = loadRefDist();
    const active = ref.active_reference_by_objective?.[objective];
    let calibratedPercentile = null;
    if (active) {
      calibratedPercentile = percentileFromGrid(shifted, active.quantiles);
    }

    const tiers = loadTiers();
    const tierAtScoreTime = tiers.per_objective?.[objective]?.tier ?? null;

    const groupK = fpGroup ? fpGroup.existingPredictions.length + 1 : 1;
    const groupMeanPrediction = fpGroup
      ? (fpGroup.existingPredictions.reduce((a, b) => a + b, 0) + prediction) / groupK
      : prediction;
    // Same fold as groupMeanPrediction above, per content-read axis and per
    // judge-scored big-picture axis (18 keys: 3 judges x 5 axes + objective
    // fit) -- see foldGroupMean's own doc comment.
    const groupMeanContentReadAxes = fpGroup && contentReadAxes
      ? foldGroupMean(contentReadAxes, fpGroup.existingContentReadAxes, groupK)
      : contentReadAxes;
    const groupMeanBigPicture = fpGroup && bigPicture
      ? foldGroupMean(bigPicture, fpGroup.existingBigPicture, groupK)
      : bigPicture;
    const groupMeanTrendAxes = fpGroup && trendAxes
      ? foldGroupMean(trendAxes, fpGroup.existingTrendAxes, groupK)
      : trendAxes;
    // Track Record v2, Task 0 -- internal (founder/team) identities never
    // enter the comparison pools, regardless of fingerprint-group status --
    // the original pool-pollution class, closed structurally at write time.
    const poolEligible = !fpGroup && !isInternal; // only a group's first row stays eligible, and never for an internal user
    // Bug fix: generated up front (not derived from this row's own id after
    // insert) so there is no INSERT-then-UPDATE gap for a concurrent match
    // lookup to read as null -- see the fpGroup doc comment above.
    const fpGroupKey = fpGroup ? fpGroup.fpGroupKey : `fp:${crypto.randomUUID()}`;

    const { rows } = await queryRW(
      `INSERT INTO shadow_scores
        (submission_id, model_version, prompt_version, pegasus_model, spec_hash,
         input_features, prediction, calibrated_percentile, tier_at_score_time, extract_cdims_status,
         objective, platform, user_id, source, is_posted_video, posted_video_id, source_url,
         pool_eligible, fp_group_key, group_k, group_mean_prediction, group_mean_content_read_axes,
         group_mean_big_picture, group_mean_trend_axes)
       VALUES ($1,'v2_capstone',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING id`,
      [
        submissionId ?? null, promptVersion ?? null, pegasusModel ?? null, specHash(),
        JSON.stringify(features), prediction, calibratedPercentile, tierAtScoreTime,
        cdimsStatus ?? null, objective ?? null, platform ?? null, userId ?? null,
        source ?? "app", isPostedVideo ?? false, postedVideoId ?? null, sourceUrl ?? null,
        poolEligible, fpGroupKey, groupK, groupMeanPrediction,
        groupMeanContentReadAxes ? JSON.stringify(groupMeanContentReadAxes) : null,
        groupMeanBigPicture ? JSON.stringify(groupMeanBigPicture) : null,
        groupMeanTrendAxes ? JSON.stringify(groupMeanTrendAxes) : null,
      ]
    );
    const id = rows[0]?.id ?? null;
    console.log(`[shadow_score] id=${id} submission_id=${submissionId} pred=${prediction.toFixed(4)} `
      + `pctile=${calibratedPercentile != null ? calibratedPercentile.toFixed(1) : "n/a"} tier=${tierAtScoreTime} `
      + `group_key=${fpGroupKey} group_k=${groupK}`);
    // Pool-based percentile engine (Phase B3b, Task 2) sources niche/overall
    // percentiles from a live, windowed pool over shadow_scores -- invalidate
    // so the very next read picks up this row rather than waiting out the TTL.
    invalidatePoolCache();
    // Same invalidation for the radar rolling-decile axis pools (axisPools.js)
    // -- separate cache, same "next read picks up this row" contract.
    invalidateAxisPoolCache();
    // Returned so a caller (e.g. the score-display module) can build a
    // display without recomputing scoreFeatures a second time, and so it can
    // exclude this row's own id from the niche/overall pools it just joined.
    return { id, prediction, calibratedPercentile, tierAtScoreTime, groupK, groupMeanPrediction, groupMeanContentReadAxes, groupMeanBigPicture, groupMeanTrendAxes };
  } catch (e) {
    // Backpressure guard: never let a shadow-scoring failure surface to the
    // caller or affect the user-facing response in any way.
    console.error(`[shadow_score] FAILED (non-fatal, user path unaffected): ${e.message}`);
    return null;
  }
}
