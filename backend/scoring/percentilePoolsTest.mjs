// scoring/percentilePoolsTest.mjs — unit tests for percentilePools.js
// (Phase B3b, Task 2). Run: node backend/scoring/percentilePoolsTest.mjs

import { midrankPercentile, personalDisplay, PERSONAL_MIN_VIDEOS, PERSONAL_ORDINAL_CEILING, dedupePersonalGroups } from "./percentilePools.js";

let failures = [];
function check(name, got, expected) {
  if (JSON.stringify(got) !== JSON.stringify(expected)) failures.push(`${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}

// ── 1. Seeded-pool percentile against hand-computed midrank values ─────────
// Pool of 10 distinct predictions 1..10 (as {key, prediction}).
const pool10 = Array.from({ length: 10 }, (_, i) => ({ key: `p${i + 1}`, prediction: i + 1 }));
// value=10 (max): below=9, equal=1 -> (9 + 0.5)/10*100 = 95
check("midrank of the max in a 10-pool", midrankPercentile(10, pool10), 95);
// value=1 (min): below=0, equal=1 -> (0 + 0.5)/10*100 = 5
check("midrank of the min in a 10-pool", midrankPercentile(1, pool10), 5);
// value=5.5 (between 5 and 6, no ties): below=5, equal=0 -> 50
check("midrank of a mid-value with no ties", midrankPercentile(5.5, pool10), 50);

// Ties: pool of [1,2,2,2,3] (5 items), value=2: below=1, equal=3 -> (1+1.5)/5*100 = 50
const tiedPool = [1, 2, 2, 2, 3].map((v, i) => ({ key: `t${i}`, prediction: v }));
check("midrank with ties credits the midpoint", midrankPercentile(2, tiedPool), 50);

// excludeKey removes exactly one entry before computing
const poolWithSelf = [...pool10, { key: "self", prediction: 10 }];
check("excludeKey drops the self row before computing", midrankPercentile(10, poolWithSelf, { excludeKey: "self" }), 95);

// Empty pool -> null
check("empty pool returns null", midrankPercentile(5, []), null);

// ── 2. Displacement: a windowed pool (simulated) evicts the oldest row ─────
// percentilePools.js's buildPools() itself is exercised via the corpus file +
// live DB in integration; here we verify the WINDOWING LOGIC in isolation by
// replicating its slice-after-sort behavior on a small synthetic series.
function windowedByDate(rows, windowSize) {
  return [...rows].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, windowSize);
}
const series = [
  { key: "day1", prediction: 1, date: "2026-01-01" },
  { key: "day2", prediction: 2, date: "2026-01-02" },
  { key: "day3", prediction: 3, date: "2026-01-03" },
];
const windowed2 = windowedByDate(series, 2);
check("window of 2 keeps the 2 newest rows", windowed2.map((r) => r.key), ["day3", "day2"]);
check("window of 2 evicts the oldest row", windowed2.some((r) => r.key === "day1"), false);
// Adding a newer row should displace the previously-newest boundary row.
const seriesPlusNewer = [...series, { key: "day4", prediction: 4, date: "2026-01-04" }];
const windowed2b = windowedByDate(seriesPlusNewer, 2);
check("adding a newer row evicts what used to be in-window", windowed2b.map((r) => r.key), ["day4", "day3"]);

// ── 3. Personal display: min-videos gate, ordinal path, percentile path ───
check("below PERSONAL_MIN_VIDEOS returns null", personalDisplay(5, [1, 2, 3, 4].map((v) => ({ prediction: v }))), null);

// Exactly PERSONAL_MIN_VIDEOS (5), below PERSONAL_ORDINAL_CEILING (20) -> ordinal
const sevenPool = [1, 3, 5, 5, 8, 9, 10].map((v) => ({ prediction: v })); // 7 videos total
// current value = 8: values strictly greater = {9, 10} = 2 -> rank 3 of 7
check("ordinal path: rank computed correctly", personalDisplay(8, sevenPool), { type: "ordinal", rank: 3, total: 7 });
check("PERSONAL_MIN_VIDEOS constant", PERSONAL_MIN_VIDEOS, 5);
check("PERSONAL_ORDINAL_CEILING constant", PERSONAL_ORDINAL_CEILING, 20);

// >= PERSONAL_ORDINAL_CEILING -> real percentile path
const twentyPool = Array.from({ length: 20 }, (_, i) => ({ prediction: i + 1 })); // 1..20
const result20 = personalDisplay(20, twentyPool);
check("percentile path returns type percentile", result20.type, "percentile");
check("percentile path value for the max of 20", result20.value, 98); // below=19,equal=1 -> 19.5/20*100=97.5->round 98

// ── 4. Personal-percentile group dedup ─────────────────────────────────────
// Rows with no fp_group_key (null) are each their own singleton group.
const allSingletons = [
  { id: 1, prediction: 0.1, fp_group_key: null, group_k: 1, group_mean_prediction: 0.1 },
  { id: 2, prediction: 0.2, fp_group_key: null, group_k: 1, group_mean_prediction: 0.2 },
];
check("no-group rows each stay their own singleton", dedupePersonalGroups(allSingletons).length, 2);

// A 3-run group collapses to ONE entry, valued at the LATEST row's
// group_mean_prediction (the running mean, up to date as of the last insert).
const groupedRows = [
  { id: 10, prediction: 0.1, fp_group_key: "fp:10", group_k: 1, group_mean_prediction: 0.1 },
  { id: 11, prediction: 0.3, fp_group_key: "fp:10", group_k: 2, group_mean_prediction: 0.2 },
  { id: 12, prediction: 0.5, fp_group_key: "fp:10", group_k: 3, group_mean_prediction: 0.3 },
];
const dedupedGroup = dedupePersonalGroups(groupedRows);
check("a 3-run group collapses to exactly 1 entry", dedupedGroup.length, 1);
check("the collapsed entry uses the group's up-to-date mean, not any single run", dedupedGroup[0].prediction, 0.3);

// Mixed: 1 group of 3 + 2 singletons = 3 distinct videos, not 5 raw rows.
const mixedRows = [...groupedRows, ...allSingletons];
check("mixed rows dedupe to distinct-video count, not raw row count", dedupePersonalGroups(mixedRows).length, 3);

console.log("percentilePools.js checks complete.");
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
