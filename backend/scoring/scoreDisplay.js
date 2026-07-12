// scoring/scoreDisplay.js — user-facing score-display logic. Built in Phase
// B3 behind DISPLAY_SCORE; Phase B3b (this revision) replaces the static
// active_reference_by_objective grid lookups with the live, windowed pool
// engine (percentilePools.js) for the niche and overall-app percentiles.
// reference_distributions_v2.json's active_reference_by_objective is no
// longer read from this file -- see percentilePools.js's header comment for
// why it stays wired into shadowScore.js's separate, internal
// calibrated_percentile field instead.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SCORE_DISPLAY_COPY } from "./scoreDisplayCopy.js";
import { getPools, midrankPercentile, personalDisplay, PERSONAL_MIN_VIDEOS, dedupePersonalGroups } from "./percentilePools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TIERS_PATH = path.join(__dirname, "tiers_v2_1.json");

let _tiers = null;
export function loadTiers() {
  if (!_tiers) _tiers = JSON.parse(fs.readFileSync(TIERS_PATH, "utf8"));
  return _tiers;
}

export function tierForObjective(objective, tiers = loadTiers()) {
  return tiers.per_objective?.[objective]?.tier ?? null;
}

export { PERSONAL_MIN_VIDEOS };

/**
 * getScoreDisplay(objective, prediction, userId, deps)
 *
 * deps.fetchShadowRows() -> Promise<Array<{id, prediction, objective,
 *   created_at}>>  every live shadow_scores row with a non-null prediction;
 *   percentilePools.js unions this with the frozen corpus seed, windows it,
 *   and caches the result (TTL or invalidated on write -- see shadowScore.js).
 * deps.selfKey -- the just-written row's pool key (e.g. `shadow:${id}`), so
 *   the niche/overall pools exclude the row being scored. Omit if the row
 *   isn't in the pool yet (e.g. computing a display before persisting).
 * deps.fetchPersonalPredictions(userId) -> Promise<Array<{id, prediction,
 *   fp_group_key, group_k, group_mean_prediction}>>  every raw row for this
 *   user's past shadow-scored videos, THIS ONE INCLUDED -- deliberately not
 *   pool_eligible-filtered (that flag is cross-user pool hygiene, unrelated
 *   to a user's own history). dedupePersonalGroups() (percentilePools.js)
 *   collapses repeat runs of the same video (fp_group_key) down to one entry
 *   per distinct video before the >=5 floor / ordinal-vs-percentile logic
 *   ever sees it, so "5 videos" means 5 DISTINCT videos, not 5 runs. Defaults
 *   to an empty-pool stub -- there is no user-identity system in the app yet
 *   (Phase C's handle-connect attribution is the eventual real source), so by
 *   default this always resolves to "not enough data," which is honest.
 *
 * Tier gate is deliberately BINARY (PREDICT vs everything else). ABSTAIN
 * suppresses ALL THREE percentiles, not just niche. tiers_v2_1.json
 * separately flags Gaming/Educational as having a positive, reasonably
 * confident RANK signal (within_creator_spearman positive, p_gt0 high)
 * despite failing the absolute-precision bar that puts them in ABSTAIN -- a
 * real nuance that could justify a third display state later ("directionally
 * confident, absolute score still calibrating") rather than full suppression.
 * Not shipped this pass; binary logic only, per spec.
 */
export async function getScoreDisplay(objective, prediction, userId, deps = {}) {
  const {
    fetchShadowRows = async () => [],
    selfKey = null,
    fetchPersonalPredictions = async () => [],
    tiers = loadTiers(),
    copy = SCORE_DISPLAY_COPY,
    platform = null, // Phase C, Task 0d -- non-tiktok proxy note in poolInfoTooltip
    groupK = 1, // pool hygiene Task 2 -- >=2 means `prediction` is already the group mean
  } = deps;

  const tier = tierForObjective(objective, tiers);
  const groupAverageNote = copy.groupAverageNote(groupK);

  if (tier !== "PREDICT") {
    return {
      objective,
      tier,
      showPercentile: false,
      nichePercentile: null,
      personal: null,
      overallAppPercentile: null,
      headline: copy.abstainHeadline,
      honestLine: copy.abstainHonestLine,
      trimNote: copy.trimNote,
      groupAverageNote,
    };
  }

  const pools = await getPools(fetchShadowRows);
  const objectivePool = pools.byObjective[objective] || [];
  const niche = midrankPercentile(prediction, objectivePool, { excludeKey: selfKey });
  const overallApp = midrankPercentile(prediction, pools.overall, { excludeKey: selfKey });
  // Pool sizes reported to the user are the window-capped count INCLUDING
  // self (the just-scored video genuinely is one of "the videos we've
  // scored," even though it's excluded from the percentile comparison
  // itself for accuracy) -- so this reads "100"/"1,000" at full capacity,
  // not "99"/"999". A genuinely thin niche (e.g. Myth Busting, ~24 rows —
  // see PHASEB3B_READOUT.md) still shows its true, smaller count; this
  // isn't padded to the window ceiling.
  const nichePoolSize = objectivePool.length;
  const overallPoolSize = pools.overall.length;

  const personalRows = userId ? await fetchPersonalPredictions(userId) : [];
  const personalPool = dedupePersonalGroups(personalRows);
  const personal = personalDisplay(prediction, personalPool);

  return {
    objective,
    tier,
    showPercentile: true,
    nichePercentile: niche,
    nichePoolSize,
    personal,
    overallAppPercentile: overallApp,
    overallPoolSize,
    headline: copy.predictHeadline(niche, objective),
    sub: copy.predictSub(objective, nichePoolSize),
    personalHeadline: copy.personalHeadline(personal),
    overallAppHeadline: copy.overallAppHeadline(overallApp, overallPoolSize),
    poolInfoTooltip: copy.poolInfoTooltip(platform),
    trimNote: copy.trimNote,
    groupAverageNote,
  };
}
