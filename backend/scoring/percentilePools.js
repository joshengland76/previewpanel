// scoring/percentilePools.js — Phase B3b, Task 2. Replaces the static
// active_reference_by_objective grid lookups at runtime with a live,
// windowed pool: corpus_reference_pool.json (frozen, 3,840-row small+mid
// floor-5 population, see PHASEB3B_READOUT.md Task 1) UNION shadow_scores
// rows, ordered newest-first, windowed per pool. As real submissions
// accrue, they gradually crowd out the oldest corpus rows within each
// window -- exactly the "live submissions gradually replace the library"
// behavior described to users (see studyCopy.js).
//
// reference_distributions_v2.json's active_reference_by_objective is NOT
// read here -- it retires from the runtime scoring-display path as of this
// module. It stays wired into shadowScore.js's own `calibrated_percentile`
// column (an internal/analytical field, not shown to users) as a frozen
// baseline for drift monitoring; that is a deliberate, narrower use, not an
// oversight.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_PATH = path.join(__dirname, "corpus_reference_pool.json");

export const OVERALL_WINDOW = 1000;
export const OBJECTIVE_WINDOW = 100;
const TTL_MS = 10 * 60 * 1000;

let _corpusRows = null;
function loadCorpusRows() {
  if (!_corpusRows) {
    const raw = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8"));
    _corpusRows = raw.map((r) => ({
      key: `corpus:${r.video_id}`,
      prediction: r.prediction_cal,
      objective: r.objective,
      date: r.posted_at,
    }));
  }
  return _corpusRows;
}

let _cache = null; // { builtAt, overall: [...], byObjective: { [objective]: [...] } }

// Exposed for tests and for explicit invalidation right after a shadow write.
export function invalidatePoolCache() {
  _cache = null;
}

function buildPools(shadowRows) {
  const shadow = shadowRows.map((r) => ({
    key: `shadow:${r.id}`,
    prediction: r.prediction,
    objective: r.objective,
    date: r.created_at,
  }));
  const all = [...loadCorpusRows(), ...shadow]
    .filter((r) => r.prediction != null && r.date != null)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const overall = all.slice(0, OVERALL_WINDOW);
  const byObjective = {};
  for (const row of all) {
    if (!row.objective) continue;
    if (!byObjective[row.objective]) byObjective[row.objective] = [];
    if (byObjective[row.objective].length < OBJECTIVE_WINDOW) byObjective[row.objective].push(row);
  }
  return { builtAt: Date.now(), overall, byObjective };
}

/**
 * getPools(fetchShadowRows) -> { overall, byObjective } (windowed, date-desc).
 * fetchShadowRows() -> Promise<Array<{id, prediction, objective, created_at}>>.
 * Cached in-memory; rebuilt on TTL expiry or after invalidatePoolCache().
 */
export async function getPools(fetchShadowRows) {
  const stale = !_cache || Date.now() - _cache.builtAt > TTL_MS;
  if (stale) _cache = buildPools(await fetchShadowRows());
  return _cache;
}

/**
 * Integer midrank percentile of `value` within `pool` (array of {key,
 * prediction}). Midrank credits ties at their midpoint rather than fully
 * above or below, e.g. a value tied with 3 others in a pool of 10 gets
 * credit for "beating" the average of the tied group, not the max.
 * excludeKey: drop one pool entry (the row being scored itself) before
 * computing -- required for the two cross pools (niche, overall); personal
 * percentile does NOT exclude self (per Phase B3, Task 5's "this one included").
 */
export function midrankPercentile(value, pool, { excludeKey } = {}) {
  const filtered = excludeKey ? pool.filter((p) => p.key !== excludeKey) : pool;
  const n = filtered.length;
  if (n === 0) return null;
  let below = 0, equal = 0;
  for (const p of filtered) {
    if (p.prediction < value) below++;
    else if (p.prediction === value) equal++;
  }
  return Math.round(((below + 0.5 * equal) / n) * 100);
}

export const PERSONAL_MIN_VIDEOS = 5;
export const PERSONAL_ORDINAL_CEILING = 20; // n < this -> ordinal payload instead of a percentile

/**
 * Personal display: below PERSONAL_MIN_VIDEOS -> null (not enough data).
 * [PERSONAL_MIN_VIDEOS, PERSONAL_ORDINAL_CEILING) -> ordinal {rank, total}
 * ("you rank 2nd of 7") -- a percentile computed from under 20 points reads
 * as false precision at this scale. >= PERSONAL_ORDINAL_CEILING -> a real
 * midrank percentile, self included (this is the user's own history, there
 * is no "self" to exclude the way there is in the niche/overall pools).
 */
export function personalDisplay(value, pool) {
  const n = pool.length;
  if (n < PERSONAL_MIN_VIDEOS) return null;
  if (n < PERSONAL_ORDINAL_CEILING) {
    const rank = pool.filter((p) => p.prediction > value).length + 1;
    return { type: "ordinal", rank, total: n };
  }
  return { type: "percentile", value: midrankPercentile(value, pool) };
}
