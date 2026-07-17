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
import { SCORE_DISPLAY_COPY, clampPercentile } from "./scoreDisplayCopy.js";
import { getPools, midrankPercentile, personalDisplay, PERSONAL_MIN_VIDEOS, dedupePersonalGroups } from "./percentilePools.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TIERS_PATH = path.join(__dirname, "tiers_v2_2.json");

let _tiers = null;
export function loadTiers() {
  if (!_tiers) _tiers = JSON.parse(fs.readFileSync(TIERS_PATH, "utf8"));
  return _tiers;
}

export function tierForObjective(objective, tiers = loadTiers()) {
  return tiers.per_objective?.[objective]?.tier ?? null;
}

// Cohort_5 Phase 3d -- the display gate is two-axis, not the tier label
// itself. showPercentile answers "is the RANKING claim (this percentile)
// statistically supported?" -- gated on P(WC>0) alone, independent of
// whether the objective also clears the separate PREDICT precision bar.
// tier_policy_v2_1's tier label still requires BOTH p_gt0>=0.95 AND
// precision>=0.55 to reach PREDICT, so an objective can clear the ranking
// bar (p_gt0>=0.95) while its tier stays PROVISIONAL/ABSTAIN on precision
// alone (e.g. Gaming, Educational/How-To post-cohort_5) -- those objectives
// now show real percentiles, paired with a separate precision caveat line
// rather than being fully suppressed. This intentionally surfaces the
// nuance flagged in this file's original header comment (see git history):
// a positive, confident RANK signal is a different claim from "our
// top-pick/decile hit rate is proven," and each should be gated on the
// statistic that actually backs it.
function showPercentileFor(objective, tiers) {
  const p = tiers.per_objective?.[objective]?.p_gt0;
  return typeof p === "number" && p >= 0.95;
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
 * Cohort_5 Phase 3d: the percentile gate is TWO-AXIS, not the tier label.
 * showPercentile (see showPercentileFor below) gates purely on P(WC>0)>=0.95
 * -- "is the ranking claim statistically supported" -- independent of
 * whether the objective also clears the separate precision>=0.55 bar that
 * tier_policy_v2_1 additionally requires for the PREDICT label. An objective
 * can therefore show real percentiles while its tier stays
 * PROVISIONAL/ABSTAIN on precision alone (Gaming, Educational/How-To as of
 * tiers_v2_2.json) -- those get a separate precisionCaveatLine instead of
 * full suppression. This is the "third display state" this file used to
 * flag as a future possibility (see git history); it's now the general rule
 * for every objective, not a one-off carve-out.
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
  const showPercentile = showPercentileFor(objective, tiers);

  if (!showPercentile) {
    return {
      objective,
      tier,
      showPercentile: false,
      nichePercentile: null,
      personal: null,
      overallAppPercentile: null,
      headline: copy.abstainHeadline,
      honestLine: copy.abstainHonestLine(objective, tier),
      groupAverageNote,
    };
  }

  const precisionAtDecile = tiers.per_objective?.[objective]?.precision_at_decile;
  const precisionCaveatLine = typeof precisionAtDecile === "number" && precisionAtDecile < 0.55
    ? copy.precisionCaveatLine
    : null;

  const pools = await getPools(fetchShadowRows);
  const objectivePool = pools.byObjective[objective] || [];
  // Polish v3, Task 6 -- clamped here, the single place niche/overallApp
  // (and personal.value, below) get computed, so every consumer (this
  // function's own copy.*Headline calls AND the raw nichePercentile/
  // overallAppPercentile/personal fields the frontend Gauge renders
  // directly) sees the same already-clamped number, never a raw 0 or 100.
  // midrankPercentile can legitimately return either at the pool's actual
  // lowest/highest value; both read as an absolute claim ("literally the
  // worst/best video in the pool") this app's baseline-relative-only
  // framing rule (scoreDisplayCopy.js's own header comment) doesn't
  // intend. clampPercentile lives in scoreDisplayCopy.js since it's a
  // display concern, imported here rather than duplicated.
  const niche = clampPercentile(midrankPercentile(prediction, objectivePool, { excludeKey: selfKey }));
  const overallApp = clampPercentile(midrankPercentile(prediction, pools.overall, { excludeKey: selfKey }));
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
  // Same display clamp as niche/overallApp above -- personal.value is the
  // one other raw midrank output that reaches a user (personalHeadline,
  // and personal itself is returned below for any direct frontend read).
  // Ordinal-type personal ({rank, total}) is untouched -- not a percentile.
  if (personal && personal.type === "percentile") {
    personal.value = clampPercentile(personal.value);
  }

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
    sub: copy.predictSub(nichePoolSize),
    personalHeadline: copy.personalHeadline(personal) ?? copy.personalPlaceholder,
    overallAppHeadline: copy.overallAppHeadline(overallApp, overallPoolSize),
    poolInfoTooltip: copy.poolInfoTooltip(platform),
    groupAverageNote,
    precisionCaveatLine,
  };
}
