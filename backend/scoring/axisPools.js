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
 * Midrank fraction of `value` within `pool` (array of {key, value}) --
 * DECILE_V2: returns { pctMid, sb, sa }, where sb/sa are the fractions of the
 * window strictly BELOW / strictly ABOVE `value` and
 * pctMid = (sb + (1 - sa)) / 2. That's algebraically the exact same number as
 * the classic midrank statistic (below + 0.5*equal)/n -- ties split their
 * credit evenly between the two sides rather than earning none (the prior
 * DECILE_FIX pass) or full retroactive credit (the original pre-fix
 * formula). sb/sa are returned alongside pctMid because decileFor's
 * earned-endpoint rule below needs them directly, not just the midpoint.
 * excludeKey mirrors percentilePools.js's own parameter: drop the row being
 * scored itself before computing (relevant when re-scoring a row already
 * sitting in the historical window).
 */
export function axisMidrankFraction(value, pool, { excludeKey } = {}) {
  const filtered = excludeKey ? pool.filter((p) => p.key !== excludeKey) : pool;
  const n = filtered.length;
  if (n === 0) return null;
  let below = 0, above = 0;
  for (const p of filtered) {
    if (p.value < value) below++;
    else if (p.value > value) above++;
  }
  const sb = below / n, sa = above / n;
  return { pctMid: (sb + (1 - sa)) / 2, sb, sa };
}

/**
 * decile = clamp(1 + floor(pctMid * 10), 1, 10), THEN earned-endpoint
 * overrides: DECILE_V2 amends the pure strict-dominance mapping (DECILE_FIX)
 * back to classic midrank -- coarse/discrete axes were landing whole tie
 * blocks at decile 1 whenever nothing beat them outright, even though
 * midrank's "split the tie" logic is the textbook-correct way to rank a
 * value tied with a large chunk of the population. But midrank alone
 * reintroduces DECILE_FIX's original problem at the two endpoints: a tie
 * block occupying, say, percentile 83-98 has pctMid=0.905 -- squarely a
 * midrank "10" -- despite only 83% of the window actually sitting below it.
 * The earned-endpoint rule keeps midrank everywhere in the middle (deciles
 * 2-9), but requires a computed 10 to ALSO have beaten >=90% of the window
 * outright (sb>=0.90) or it displays 9 instead; symmetrically a computed 1
 * requires losing to >=90% outright (sa>=0.90) or it displays 2. The two
 * endpoints are the only deciles that assert "better/worse than nearly
 * everyone," so they're the only ones that need an outright-beat guarantee,
 * not just a midrank one. Returns null when the pool is empty (no data yet
 * for this axis/window -- caller falls back to the raw 0-10 value, same
 * graceful-degradation contract as every other C_dims-derived field here).
 */
export function decileFor(value, pool, opts) {
  if (value == null) return null;
  const m = axisMidrankFraction(value, pool, opts);
  if (m == null) return null;
  let decile = Math.max(1, Math.min(10, 1 + Math.floor(m.pctMid * 10)));
  if (decile === 10 && m.sb < 0.90) decile = 9;
  if (decile === 1 && m.sa < 0.90) decile = 2;
  return decile;
}
