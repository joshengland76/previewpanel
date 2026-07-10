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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REF_PATH = path.join(__dirname, "reference_distributions_v2.json");
const TIERS_PATH = path.join(__dirname, "tiers_v2_1.json");

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
 *   promptVersion, cdimsStatus }) -- fire-and-forget from the caller. Every
 * failure mode is caught internally and logged; nothing is ever re-thrown.
 */
export async function recordShadowScore({
  queryRW, submissionId, features, objective, pegasusModel, promptVersion, cdimsStatus, platform, userId,
  source, isPostedVideo, postedVideoId, // Phase C, Task 3
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

    const { rows } = await queryRW(
      `INSERT INTO shadow_scores
        (submission_id, model_version, prompt_version, pegasus_model, spec_hash,
         input_features, prediction, calibrated_percentile, tier_at_score_time, extract_cdims_status,
         objective, platform, user_id, source, is_posted_video, posted_video_id)
       VALUES ($1,'v2_capstone',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        submissionId ?? null, promptVersion ?? null, pegasusModel ?? null, specHash(),
        JSON.stringify(features), prediction, calibratedPercentile, tierAtScoreTime,
        cdimsStatus ?? null, objective ?? null, platform ?? null, userId ?? null,
        source ?? "app", isPostedVideo ?? false, postedVideoId ?? null,
      ]
    );
    const id = rows[0]?.id ?? null;
    console.log(`[shadow_score] id=${id} submission_id=${submissionId} pred=${prediction.toFixed(4)} `
      + `pctile=${calibratedPercentile != null ? calibratedPercentile.toFixed(1) : "n/a"} tier=${tierAtScoreTime}`);
    // Pool-based percentile engine (Phase B3b, Task 2) sources niche/overall
    // percentiles from a live, windowed pool over shadow_scores -- invalidate
    // so the very next read picks up this row rather than waiting out the TTL.
    invalidatePoolCache();
    // Returned so a caller (e.g. the score-display module) can build a
    // display without recomputing scoreFeatures a second time, and so it can
    // exclude this row's own id from the niche/overall pools it just joined.
    return { id, prediction, calibratedPercentile, tierAtScoreTime };
  } catch (e) {
    // Backpressure guard: never let a shadow-scoring failure surface to the
    // caller or affect the user-facing response in any way.
    console.error(`[shadow_score] FAILED (non-fatal, user path unaffected): ${e.message}`);
    return null;
  }
}
