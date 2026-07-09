// scoring/scoreDisplayTest.mjs — unit tests for scoreDisplay.js (Phase B3,
// Task 5). Run: node backend/scoring/scoreDisplayTest.mjs

import {
  getScoreDisplay, empiricalPercentile, nichePercentile, tierForObjective,
  PERSONAL_MIN_VIDEOS, OVERALL_APP_MIN_VIDEOS, loadReferenceDistributions, loadTiers,
} from "./scoreDisplay.js";

let failures = [];
function check(name, got, expected) {
  const pass = JSON.stringify(got) === JSON.stringify(expected);
  if (!pass) failures.push(`${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}
function checkTrue(name, cond) {
  if (!cond) failures.push(`${name}: expected truthy, got falsy`);
}

// ── 1. Percentile lookups against known grid values ────────────────────────
const reference = loadReferenceDistributions();
const someObjective = Object.keys(reference.active_reference_by_objective)[0];
const grid = reference.active_reference_by_objective[someObjective].quantiles;
check(`nichePercentile at exact p50 for ${someObjective}`, nichePercentile(someObjective, grid.p50, reference), 50);
check(`nichePercentile at exact p1 for ${someObjective}`, nichePercentile(someObjective, grid.p1, reference), 1);
check(`nichePercentile at exact p99 for ${someObjective}`, nichePercentile(someObjective, grid.p99, reference), 99);
check(`nichePercentile below p1 clamps to p1 for ${someObjective}`, nichePercentile(someObjective, grid.p1 - 100, reference), 1);
check(`nichePercentile above p99 clamps to p99 for ${someObjective}`, nichePercentile(someObjective, grid.p99 + 100, reference), 99);
check("nichePercentile for unknown objective returns null", nichePercentile("Not A Real Objective", 0, reference), null);

// empiricalPercentile: known small pool, exact fractions
check("empiricalPercentile mid value in [1,2,3,4,5]", empiricalPercentile(3, [1, 2, 3, 4, 5], 5), 60); // 3 of 5 <= 3
check("empiricalPercentile min value in [1,2,3,4,5]", empiricalPercentile(1, [1, 2, 3, 4, 5], 5), 20);
check("empiricalPercentile max value in [1,2,3,4,5]", empiricalPercentile(5, [1, 2, 3, 4, 5], 5), 100);

// ── 2. Tier gating ──────────────────────────────────────────────────────────
const tiers = loadTiers();
const predictObjective = tiers.tiers.PREDICT[0];
const abstainObjective = tiers.tiers.ABSTAIN[0];
check(`tierForObjective PREDICT sample (${predictObjective})`, tierForObjective(predictObjective, tiers), "PREDICT");
check(`tierForObjective ABSTAIN sample (${abstainObjective})`, tierForObjective(abstainObjective, tiers), "ABSTAIN");

const predictDisplay = await getScoreDisplay(predictObjective, grid.p50, null);
checkTrue("PREDICT tier shows percentile", predictDisplay.showPercentile === true);
checkTrue("PREDICT tier has a headline", typeof predictDisplay.headline === "string" && predictDisplay.headline.length > 0);

const abstainDisplay = await getScoreDisplay(abstainObjective, 0, null);
checkTrue("ABSTAIN tier suppresses percentile", abstainDisplay.showPercentile === false);
check("ABSTAIN tier nichePercentile is null", abstainDisplay.nichePercentile, null);
checkTrue("ABSTAIN tier includes the honest line", abstainDisplay.honestLine === "Reliable scoring for this niche is still in progress.");

// ── 3. <5-video users get no personal percentile ───────────────────────────
const under5 = await getScoreDisplay(predictObjective, grid.p50, "user-1", {
  fetchPersonalPredictions: async () => [grid.p10, grid.p25, grid.p50, grid.p50], // 4 total, below PERSONAL_MIN_VIDEOS
});
check("under-5-video user gets null personalPercentile", under5.personalPercentile, null);
check("under-5-video user gets null personalHeadline", under5.personalHeadline, null);

const exactly5 = await getScoreDisplay(predictObjective, grid.p50, "user-2", {
  fetchPersonalPredictions: async () => [grid.p10, grid.p25, grid.p50, grid.p75, grid.p50], // 5 total, this one included
});
checkTrue("exactly-5-video user gets a numeric personalPercentile", typeof exactly5.personalPercentile === "number");

// No userId at all -> no personal percentile, no crash
const noUser = await getScoreDisplay(predictObjective, grid.p50, null);
check("no userId gets null personalPercentile", noUser.personalPercentile, null);

// Overall-app volume gate (below OVERALL_APP_MIN_VIDEOS) -> null
const belowVolumeGate = await getScoreDisplay(predictObjective, grid.p50, null, {
  fetchOverallAppPredictions: async () => Array(OVERALL_APP_MIN_VIDEOS - 1).fill(grid.p50),
});
check("below overall-app volume gate gets null overallAppPercentile", belowVolumeGate.overallAppPercentile, null);

console.log(`PERSONAL_MIN_VIDEOS=${PERSONAL_MIN_VIDEOS}  OVERALL_APP_MIN_VIDEOS=${OVERALL_APP_MIN_VIDEOS}`);
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
