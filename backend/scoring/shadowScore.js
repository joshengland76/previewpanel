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

export async function ensureShadowScoresTable(queryRW) {
  await queryRW(`
    CREATE TABLE IF NOT EXISTS shadow_scores (
      id                     BIGSERIAL PRIMARY KEY,
      submission_id          INTEGER,
      created_at             TIMESTAMPTZ DEFAULT now(),
      model_version          TEXT NOT NULL DEFAULT 'v2_capstone',
      prompt_version         TEXT,
      pegasus_model          TEXT,
      spec_hash              TEXT,
      input_features         JSONB,
      prediction             DOUBLE PRECISION,
      calibrated_percentile  DOUBLE PRECISION,
      tier_at_score_time     TEXT,
      extract_cdims_status   TEXT
    )
  `);
  await queryRW(`CREATE INDEX IF NOT EXISTS idx_shadow_scores_submission_id ON shadow_scores(submission_id)`);
  // objective: needed for scoreDisplay.js's overall-app percentile (scoped to
  // the same niche). user_id: nullable forward-compat column for the same
  // module's personal percentile -- there is no user-identity system in the
  // app yet (Phase C's handle-connect attribution is the eventual real
  // source), so this always writes NULL for now. Both added Phase B3 Task 5.
  await queryRW(`ALTER TABLE shadow_scores ADD COLUMN IF NOT EXISTS objective TEXT`);
  await queryRW(`ALTER TABLE shadow_scores ADD COLUMN IF NOT EXISTS user_id TEXT`);
  await queryRW(`CREATE INDEX IF NOT EXISTS idx_shadow_scores_objective ON shadow_scores(objective)`);
}

/**
 * recordShadowScore({ queryRW, submissionId, features, objective, pegasusModel,
 *   promptVersion, cdimsStatus }) -- fire-and-forget from the caller. Every
 * failure mode is caught internally and logged; nothing is ever re-thrown.
 */
export async function recordShadowScore({
  queryRW, submissionId, features, objective, pegasusModel, promptVersion, cdimsStatus,
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

    await queryRW(
      `INSERT INTO shadow_scores
        (submission_id, model_version, prompt_version, pegasus_model, spec_hash,
         input_features, prediction, calibrated_percentile, tier_at_score_time, extract_cdims_status,
         objective)
       VALUES ($1,'v2_capstone',$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        submissionId ?? null, promptVersion ?? null, pegasusModel ?? null, specHash(),
        JSON.stringify(features), prediction, calibratedPercentile, tierAtScoreTime,
        cdimsStatus ?? null, objective ?? null,
      ]
    );
    console.log(`[shadow_score] submission_id=${submissionId} pred=${prediction.toFixed(4)} `
      + `pctile=${calibratedPercentile != null ? calibratedPercentile.toFixed(1) : "n/a"} tier=${tierAtScoreTime}`);
    // Returned so a caller (e.g. the dark-launched score-display module, Task
    // 5) can build a display without recomputing scoreFeatures a second time.
    // Purely additive -- existing callers that ignore the return value are
    // unaffected.
    return { prediction, calibratedPercentile, tierAtScoreTime };
  } catch (e) {
    // Backpressure guard: never let a shadow-scoring failure surface to the
    // caller or affect the user-facing response in any way.
    console.error(`[shadow_score] FAILED (non-fatal, user path unaffected): ${e.message}`);
    return null;
  }
}
