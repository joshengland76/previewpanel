// scoring/axisPools.js — Radar rolling-decile normalization (radar/links
// prompt, Part A). Same row universe, eligibility, ordering, and cache/TTL
// mechanics as percentilePools.js (see that file's own header comment for
// the corpus-seed-UNION-shadow_scores design this mirrors) -- this is a
// SEPARATE pair of windows because it ranks RAW per-axis judge dimension
// scores instead of the model's single calibrated prediction, which changes
// what's comparable across rows:
//
//   - Judge-axis window (compelling/novel/emotionally_resonant/
//     emotion_intensity/funny/objective_fit): restricted to
//     pegasus_model='pegasus1.5' rows only. Predictions can be version-
//     calibrated across pegasus1.2/1.5 (calibratedYhat() in scorer.js shifts
//     1.2 rows onto the 1.5 scale) because the FINAL scalar prediction has
//     one calibration curve; the 6 raw per-dimension judge scores that feed
//     into it don't -- there is no established per-dimension recalibration
//     formula, and reconstructing one from scratch for a display-only decile
//     ranking is out of scope here. Restricting the window beats guessing at
//     a conversion. As of corpus_axis_seed.json's export, 2,614 of 4,077
//     corpus rows are pegasus1.2 (64%) -- but every corpus row is frozen
//     forever while live 1.5 volume grows daily, so this window converges to
//     all-1.5 on its own with time; no migration step needed later.
//   - Trend-axis window (trend_alignment/trending_topic): no version
//     filter. These come from the locked C_dims extractor prompt, not
//     Pegasus -- version-stable by construction, no calibration concern.
//
// Both windows draw from the exact same row universe as percentilePools.js
// (corpus_axis_seed.json UNION shadow_scores) and the exact same eligibility
// the caller's fetch query applies (pool_eligible=true, is_posted_video
// excluded) -- pool_eligible is itself the fingerprint-dedupe mechanism (see
// that column's own migration comment in server.js), so no separate dedupe
// step is needed here either.
//
// One shared percentile grid per axis, built from the AVERAGED jc_*/
// objfit_consensus values -- NOT a separate grid per judge. Deliberate
// (Josh's call, radar/links prompt point A3): both the panel-average value
// AND each individual judge's own raw dimension score map through this SAME
// grid, so a stricter judge's raw score visibly lands on a lower decile than
// a lenient judge's on the identical axis -- persona strictness stays
// legible instead of being normalized away by giving each judge their own
// curve.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CORPUS_AXIS_PATH = path.join(__dirname, "corpus_axis_seed.json");

export const AXIS_WINDOW = 1000;
const TTL_MS = 10 * 60 * 1000;

export const JUDGE_AXES = [
  "jc_compelling", "jc_novel", "jc_emotionally_resonant", "jc_emotion_intensity", "jc_funny", "objfit_consensus",
];
export const TREND_AXES = ["trending_alignment_signals", "trending_topic_likelihood"];

let _corpusRows = null;
function loadCorpusRows() {
  if (!_corpusRows) {
    const raw = JSON.parse(fs.readFileSync(CORPUS_AXIS_PATH, "utf8"));
    _corpusRows = raw.map((r) => ({ key: `corpus:${r.video_id}`, date: r.posted_at, ...r }));
  }
  return _corpusRows;
}

let _cache = null; // { builtAt, judge: {[axis]: number[]}, trend: {[axis]: number[]}, judgeN, trendN, judgeVersionMix }

// Exposed for tests and for explicit invalidation right after a shadow write.
export function invalidateAxisPoolCache() {
  _cache = null;
}

function buildAxisPools(shadowRows) {
  const shadow = shadowRows.map((r) => ({ key: `shadow:${r.id}`, date: r.created_at, ...r }));
  const all = [...loadCorpusRows(), ...shadow]
    .filter((r) => r.date != null)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const judgeRows = all.filter((r) => r.pegasus_model === "pegasus1.5").slice(0, AXIS_WINDOW);
  const trendRows = all.slice(0, AXIS_WINDOW);

  const judge = {};
  for (const axis of JUDGE_AXES) {
    judge[axis] = judgeRows.map((r) => ({ key: r.key, value: r[axis] })).filter((p) => p.value != null);
  }
  const trend = {};
  for (const axis of TREND_AXES) {
    trend[axis] = trendRows.map((r) => ({ key: r.key, value: r[axis] })).filter((p) => p.value != null);
  }

  const judgeVersionMix = {};
  for (const r of all.slice(0, AXIS_WINDOW)) {
    judgeVersionMix[r.pegasus_model ?? "null"] = (judgeVersionMix[r.pegasus_model ?? "null"] ?? 0) + 1;
  }

  return { builtAt: Date.now(), judge, trend, judgeN: judgeRows.length, trendN: trendRows.length, judgeVersionMix };
}

/**
 * getAxisPools(fetchShadowAxisRows) -> { judge, trend, judgeN, trendN, judgeVersionMix }.
 * fetchShadowAxisRows() -> Promise<Array<{id, created_at, pegasus_model,
 *   jc_compelling, jc_novel, jc_emotionally_resonant, jc_emotion_intensity,
 *   jc_funny, objfit_consensus, trending_alignment_signals, trending_topic_likelihood}>>.
 * Cached in-memory; rebuilt on TTL expiry or after invalidateAxisPoolCache().
 */
export async function getAxisPools(fetchShadowAxisRows) {
  const stale = !_cache || Date.now() - _cache.builtAt > TTL_MS;
  if (stale) _cache = buildAxisPools(await fetchShadowAxisRows());
  return _cache;
}

/**
 * Midrank percentile of `value` within `pool` (array of {key, value}), as a
 * FRACTION in [0, 1] -- not the 0-100 rounded percentage
 * percentilePools.js's own midrankPercentile returns, since decileFor below
 * needs the unrounded fraction (radar/links prompt point A3: decile =
 * clamp(ceil(pct*10), 1, 10) -- pct*10 only makes sense as a 0-10 range if
 * pct is a 0-1 fraction). excludeKey mirrors percentilePools.js's own
 * parameter: drop the row being scored itself before computing, same
 * rationale as that file's niche/overall pools (a cross-population
 * comparison excludes self; personal history wouldn't, but there is no
 * "personal" axis pool here).
 */
export function axisMidrankFraction(value, pool, { excludeKey } = {}) {
  const filtered = excludeKey ? pool.filter((p) => p.key !== excludeKey) : pool;
  const n = filtered.length;
  if (n === 0) return null;
  let below = 0, equal = 0;
  for (const p of filtered) {
    if (p.value < value) below++;
    else if (p.value === value) equal++;
  }
  return (below + 0.5 * equal) / n;
}

/**
 * decile = clamp(ceil(pct * 10), 1, 10), pct = axisMidrankFraction above.
 * Returns null when the pool is empty (no data yet for this axis/window --
 * caller falls back to the raw 0-10 value, same graceful-degradation
 * contract as every other C_dims-derived field in this codebase).
 */
export function decileFor(value, pool, opts) {
  if (value == null) return null;
  const pct = axisMidrankFraction(value, pool, opts);
  if (pct == null) return null;
  return Math.max(1, Math.min(10, Math.ceil(pct * 10)));
}
