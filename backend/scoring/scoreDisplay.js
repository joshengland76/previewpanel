// scoring/scoreDisplay.js — user-facing score-display logic (Phase B3, Task
// 5). Built and unit-tested behind DISPLAY_SCORE (default false) -- dark
// launched. Nothing in server.js currently calls this in anger; it exists so
// B3's user-facing review can evaluate the real logic before any UI ships.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { percentileFromGrid } from "./scorer.js";
import { SCORE_DISPLAY_COPY } from "./scoreDisplayCopy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REF_PATH = path.join(__dirname, "reference_distributions_v2.json");
const TIERS_PATH = path.join(__dirname, "tiers_v2_1.json");

let _reference = null;
export function loadReferenceDistributions() {
  if (!_reference) _reference = JSON.parse(fs.readFileSync(REF_PATH, "utf8"));
  return _reference;
}
let _tiers = null;
export function loadTiers() {
  if (!_tiers) _tiers = JSON.parse(fs.readFileSync(TIERS_PATH, "utf8"));
  return _tiers;
}

export function tierForObjective(objective, tiers = loadTiers()) {
  return tiers.per_objective?.[objective]?.tier ?? null;
}

export function nichePercentile(objective, prediction, reference = loadReferenceDistributions()) {
  const grid = reference.active_reference_by_objective?.[objective]?.quantiles;
  if (!grid) return null;
  return percentileFromGrid(prediction, grid);
}

// Minimum pool size (this video included) before a percentile is shown at
// all -- below this, a percentile computed from too few points is noise, not
// signal.
export const PERSONAL_MIN_VIDEOS = 5;
// Provisional -- no real production volume exists yet (Phase B3). Revisit
// once shadow rows accrue in prod (see PROD_ENABLE_CHECKLIST.md).
export const OVERALL_APP_MIN_VIDEOS = 30;

// Empirical percentile of `value` within `pool` (`value` must already be
// included in `pool` by the caller -- "their raw predictions, this one
// included", per Task 5). Returns null below minCount.
export function empiricalPercentile(value, pool, minCount) {
  if (!pool || pool.length < minCount) return null;
  const sorted = [...pool].sort((a, b) => a - b);
  const nLessEq = sorted.filter((v) => v <= value).length;
  return (nLessEq / sorted.length) * 100;
}

/**
 * getScoreDisplay(objective, prediction, userId, deps)
 *
 * deps.fetchPersonalPredictions(userId) -> Promise<number[]>  raw predictions
 *   for this user's past shadow-scored videos, THIS ONE INCLUDED. Defaults to
 *   an empty-pool stub -- there is no user-identity system in the app yet
 *   (Phase C's handle-connect attribution is the eventual real source), so by
 *   default this always resolves to "not enough data," which is honest.
 * deps.fetchOverallAppPredictions(objective) -> Promise<number[]>  same
 *   convention, scoped to the same niche/objective, drawn ONLY from the app's
 *   own accumulated shadow_scores rows -- the static research corpus never
 *   feeds this number, by design (it's meant to eventually supersede the
 *   corpus-derived niche percentile as real usage accrues, not blend with it).
 *
 * Tier gate is deliberately BINARY (PREDICT vs everything else), per Task 5.
 * tiers_v2_1.json separately flags Gaming/Educational as having a positive,
 * reasonably confident RANK signal (within_creator_spearman positive, p_gt0
 * high) despite failing the absolute-precision bar that puts them in ABSTAIN
 * -- a real nuance that could justify a third display state later ("directionally
 * confident, absolute score still calibrating") rather than full suppression.
 * Not shipped this pass; binary logic only, per spec.
 */
export async function getScoreDisplay(objective, prediction, userId, deps = {}) {
  const {
    fetchPersonalPredictions = async () => [],
    fetchOverallAppPredictions = async () => [],
    reference = loadReferenceDistributions(),
    tiers = loadTiers(),
    copy = SCORE_DISPLAY_COPY,
  } = deps;

  const tier = tierForObjective(objective, tiers);

  if (tier !== "PREDICT") {
    return {
      objective,
      tier,
      showPercentile: false,
      nichePercentile: null,
      personalPercentile: null,
      overallAppPercentile: null,
      headline: copy.abstainHeadline,
      honestLine: copy.abstainHonestLine,
      trimNote: copy.trimNote,
    };
  }

  const niche = nichePercentile(objective, prediction, reference);
  const personalPool = userId ? await fetchPersonalPredictions(userId) : [];
  const personal = empiricalPercentile(prediction, personalPool, PERSONAL_MIN_VIDEOS);
  const overallPool = await fetchOverallAppPredictions(objective);
  const overallApp = empiricalPercentile(prediction, overallPool, OVERALL_APP_MIN_VIDEOS);

  return {
    objective,
    tier,
    showPercentile: true,
    nichePercentile: niche,
    personalPercentile: personal,
    overallAppPercentile: overallApp,
    headline: copy.predictHeadline(niche),
    personalHeadline: copy.personalHeadline(personal),
    overallAppHeadline: copy.overallAppHeadline(overallApp),
    trimNote: copy.trimNote,
  };
}
