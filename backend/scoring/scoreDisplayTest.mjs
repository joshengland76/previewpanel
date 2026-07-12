// scoring/scoreDisplayTest.mjs — unit tests for scoreDisplay.js's
// orchestration (tier gating, pool wiring, personal ordinal/percentile
// branching). Percentile arithmetic itself is covered in
// percentilePoolsTest.mjs; this file focuses on getScoreDisplay's contract.
// Run: node backend/scoring/scoreDisplayTest.mjs

import { getScoreDisplay, tierForObjective, loadTiers } from "./scoreDisplay.js";
import { invalidatePoolCache } from "./percentilePools.js";

let failures = [];
function check(name, got, expected) {
  if (JSON.stringify(got) !== JSON.stringify(expected)) failures.push(`${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}
function checkTrue(name, cond) {
  if (!cond) failures.push(`${name}: expected truthy, got falsy`);
}

// Personal-percentile group dedup -- builds fetchPersonalPredictions-shaped
// rows from a list of "videos," each itself a list of raw predictions for
// repeat runs of that one video (in run order). A single-run video gets
// fp_group_key: null (the "no fingerprint/group" fallback path -- each such
// row is its own singleton group in dedupePersonalGroups); a multi-run video
// gets a real shared fp_group_key and per-row group_k/group_mean_prediction
// exactly as shadowScore.js would have written them (running mean, never
// retroactively updated on earlier rows in the group).
function personalRows(videos) {
  let id = 1000;
  const rows = [];
  videos.forEach((runs, videoIdx) => {
    const isGroup = runs.length > 1;
    let sum = 0;
    runs.forEach((pred, i) => {
      sum += pred;
      const k = i + 1;
      rows.push({
        id: id++,
        prediction: pred,
        fp_group_key: isGroup ? `fp:group${videoIdx}` : null,
        group_k: k,
        group_mean_prediction: sum / k,
      });
    });
  });
  return rows;
}

const tiers = loadTiers();
const predictObjective = tiers.tiers.PREDICT[0];
const abstainObjective = tiers.tiers.ABSTAIN[0];
check(`tierForObjective PREDICT sample (${predictObjective})`, tierForObjective(predictObjective, tiers), "PREDICT");
check(`tierForObjective ABSTAIN sample (${abstainObjective})`, tierForObjective(abstainObjective, tiers), "ABSTAIN");

// ── ABSTAIN suppresses ALL THREE percentiles, not just niche ───────────────
invalidatePoolCache();
const abstainDisplay = await getScoreDisplay(abstainObjective, 0, "user-1", {
  fetchShadowRows: async () => [{ id: 999, prediction: 0.5, objective: abstainObjective, created_at: new Date().toISOString() }],
  fetchPersonalPredictions: async () => personalRows([[0.1], [0.2], [0.3], [0.4], [0.5], [0.6], [0.7]]),
});
checkTrue("ABSTAIN tier suppresses percentile flag", abstainDisplay.showPercentile === false);
check("ABSTAIN tier nichePercentile is null", abstainDisplay.nichePercentile, null);
check("ABSTAIN tier overallAppPercentile is null", abstainDisplay.overallAppPercentile, null);
check("ABSTAIN tier personal is null", abstainDisplay.personal, null);
checkTrue("ABSTAIN tier (real objective) includes the objective-phrased honest line",
  abstainDisplay.honestLine === "Reliable scoring for this objective is still in progress.");

// No-objective case is distinct from a real-objective ABSTAIN -- "in
// progress" would be misleading when there's nothing selected to progress on.
invalidatePoolCache();
const noObjectiveDisplay = await getScoreDisplay("", 0, "user-1", {
  fetchShadowRows: async () => [],
});
checkTrue("no-objective submission also suppresses percentile flag", noObjectiveDisplay.showPercentile === false);
checkTrue("no-objective submission gets the distinct no-objective line",
  noObjectiveDisplay.honestLine === "No objective selected, so no reliable scoring is available.");

// Free-typed, unrecognized objective (the UI accepts arbitrary text) is a
// third distinct case -- not "still in progress" (no model build exists for
// it) and not "no objective selected" (one was typed).
invalidatePoolCache();
const unknownObjectiveDisplay = await getScoreDisplay("Underwater Basket Weaving", 0, "user-1", {
  fetchShadowRows: async () => [],
});
checkTrue("unrecognized typed-in objective also suppresses percentile flag", unknownObjectiveDisplay.showPercentile === false);
checkTrue("unrecognized typed-in objective gets the logged-for-future-build line",
  unknownObjectiveDisplay.honestLine === "This objective has been logged for a future scoring model build. No reliable score is currently available.");

// ── PREDICT tier: pool wiring, integer percentiles, selfKey exclusion ──────
invalidatePoolCache();
// Dates deliberately far in the future relative to the corpus seed (which is
// all 2026-04/05/06/etc posted_at) so these synthetic rows sort ahead of
// every real corpus row and are guaranteed to land inside the window --
// otherwise a populous real objective's 100-row window would be entirely
// filled by corpus rows and these synthetic rows (and selfKey) would have no
// effect on the result, which is exactly the bug this comment is here to
// prevent re-introducing.
const shadowRows = [
  { id: 1, prediction: -0.5, objective: predictObjective, created_at: "2099-01-01T00:00:00Z" },
  { id: 2, prediction: 0.0, objective: predictObjective, created_at: "2099-01-02T00:00:00Z" },
  { id: 3, prediction: 0.5, objective: predictObjective, created_at: "2099-01-03T00:00:00Z" },
];
const predictDisplay = await getScoreDisplay(predictObjective, 0.5, null, {
  fetchShadowRows: async () => shadowRows,
});
checkTrue("PREDICT tier shows percentile", predictDisplay.showPercentile === true);
checkTrue("PREDICT tier has an integer nichePercentile", Number.isInteger(predictDisplay.nichePercentile));
checkTrue("PREDICT tier has a headline", typeof predictDisplay.headline === "string" && predictDisplay.headline.length > 0);
checkTrue("headline uses direct percentile framing, no Top-N% inversion", predictDisplay.headline.startsWith("Beats "));
checkTrue("sub-line reports the pool size", predictDisplay.sub.includes(String(predictDisplay.nichePoolSize)));

// Pool size reported to the user INCLUDES self (it's genuinely one of "the
// videos we've scored") -- this must NOT shift depending on selfKey, even
// though the percentile MATH does exclude self for accuracy (that exclusion
// behavior itself is covered directly in percentilePoolsTest.mjs).
invalidatePoolCache();
const withSelfExcluded = await getScoreDisplay(predictObjective, 0.5, null, {
  fetchShadowRows: async () => shadowRows,
  selfKey: "shadow:3",
});
check("pool size reported to the user does not change based on selfKey", withSelfExcluded.nichePoolSize, predictDisplay.nichePoolSize);

// ── Personal: <5 videos -> null; 5-19 -> ordinal; >=20 -> percentile ───────
invalidatePoolCache();
const under5 = await getScoreDisplay(predictObjective, 0.5, "user-1", {
  fetchShadowRows: async () => [],
  fetchPersonalPredictions: async () => personalRows([[0.1], [0.2], [0.3], [0.4]]), // 4 videos, below PERSONAL_MIN_VIDEOS
});
check("under-5-video user gets null personal", under5.personal, null);
check("under-5-video user gets null personalHeadline", under5.personalHeadline, null);

invalidatePoolCache();
const ordinalCase = await getScoreDisplay(predictObjective, 0.5, "user-2", {
  fetchShadowRows: async () => [],
  fetchPersonalPredictions: async () => personalRows([[0.1], [0.2], [0.3], [0.4], [0.5]]), // 5 videos, this one included
});
check("5-19-video user gets an ordinal payload", ordinalCase.personal.type, "ordinal");
checkTrue("ordinal headline mentions rank", ordinalCase.personalHeadline.toLowerCase().includes("rank"));

invalidatePoolCache();
const percentileCase = await getScoreDisplay(predictObjective, 0.5, "user-3", {
  fetchShadowRows: async () => [],
  fetchPersonalPredictions: async () => personalRows(Array.from({ length: 20 }, (_, i) => [i / 40])), // 20 videos
});
check("20-video user gets a percentile payload", percentileCase.personal.type, "percentile");

// ── Personal-percentile group dedup (this prompt) ──────────────────────────
// (a) 5 runs of one video + 1 distinct video = 2 DISTINCT VIDEOS, well below
// the 5-video floor -- must NOT activate just because there are 6 raw rows.
invalidatePoolCache();
const repeatHeavyUser = await getScoreDisplay(predictObjective, 0.5, "user-4", {
  fetchShadowRows: async () => [],
  fetchPersonalPredictions: async () => personalRows([
    [0.1, 0.12, 0.09, 0.11, 0.10], // one video, run 5 times
    [0.4], // one distinct video
  ]),
});
check("5 runs of 1 video + 1 distinct video = 2 groups, still below floor", repeatHeavyUser.personal, null);

// (b) 5 distinct videos, one of them run 3 times = 5 DISTINCT VIDEOS ->
// activates: ordinal, total 5, and the multi-run video counts once at its
// (running) mean, not 3 times.
invalidatePoolCache();
const fiveDistinctOneRepeated = await getScoreDisplay(predictObjective, 0.5, "user-5", {
  fetchShadowRows: async () => [],
  fetchPersonalPredictions: async () => personalRows([
    [0.1, 0.3, 0.5], // repeated video: mean = 0.3
    [0.2],
    [0.4],
    [0.6],
    [0.8],
  ]),
});
check("5 distinct videos (one repeated 3x) activates with total=5", fiveDistinctOneRepeated.personal?.type, "ordinal");
check("total counts distinct videos, not raw runs", fiveDistinctOneRepeated.personal?.total, 5);
// value=0.5 vs the pool {0.3, 0.2, 0.4, 0.6, 0.8} -> 2 values strictly greater (0.6, 0.8) -> rank 3
check("rank is sane against distinct-video pool (repeated video counted once, at its mean)", fiveDistinctOneRepeated.personal?.rank, 3);

// (c) Fresh single-video user (1 run, no group) -- unchanged from pre-dedup
// behavior: still below the floor, still null.
invalidatePoolCache();
const freshSingleVideoUser = await getScoreDisplay(predictObjective, 0.5, "user-6", {
  fetchShadowRows: async () => [],
  fetchPersonalPredictions: async () => personalRows([[0.5]]),
});
check("fresh single-video user (no group) still gets null personal", freshSingleVideoUser.personal, null);

console.log("scoreDisplay.js checks complete.");
if (failures.length) {
  console.log("FAILURES:");
  for (const f of failures) console.log(`  - ${f}`);
  console.log("\nGATE: FAIL");
  process.exit(1);
} else {
  console.log("All checks passed.");
  console.log("\nGATE: PASS");
  process.exit(0);
}
