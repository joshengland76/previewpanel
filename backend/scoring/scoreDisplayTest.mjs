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

const tiers = loadTiers();
const predictObjective = tiers.tiers.PREDICT[0];
const abstainObjective = tiers.tiers.ABSTAIN[0];
check(`tierForObjective PREDICT sample (${predictObjective})`, tierForObjective(predictObjective, tiers), "PREDICT");
check(`tierForObjective ABSTAIN sample (${abstainObjective})`, tierForObjective(abstainObjective, tiers), "ABSTAIN");

// ── ABSTAIN suppresses ALL THREE percentiles, not just niche ───────────────
invalidatePoolCache();
const abstainDisplay = await getScoreDisplay(abstainObjective, 0, "user-1", {
  fetchShadowRows: async () => [{ id: 999, prediction: 0.5, objective: abstainObjective, created_at: new Date().toISOString() }],
  fetchPersonalPredictions: async () => [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
});
checkTrue("ABSTAIN tier suppresses percentile flag", abstainDisplay.showPercentile === false);
check("ABSTAIN tier nichePercentile is null", abstainDisplay.nichePercentile, null);
check("ABSTAIN tier overallAppPercentile is null", abstainDisplay.overallAppPercentile, null);
check("ABSTAIN tier personal is null", abstainDisplay.personal, null);
checkTrue("ABSTAIN tier includes the honest line", abstainDisplay.honestLine === "Reliable scoring for this niche is still in progress.");

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
checkTrue("headline uses Top N% framing", predictDisplay.headline.startsWith("Top "));
checkTrue("sub-line reports actual pool size", predictDisplay.sub.includes(String(predictDisplay.nichePoolSize)));

// selfKey exclusion: scoring row id=3 (prediction 0.5) as itself should exclude it from its own pool
invalidatePoolCache();
const withSelfExcluded = await getScoreDisplay(predictObjective, 0.5, null, {
  fetchShadowRows: async () => shadowRows,
  selfKey: "shadow:3",
});
check("selfKey excludes the row from its own niche pool size", withSelfExcluded.nichePoolSize, predictDisplay.nichePoolSize - 1);

// ── Personal: <5 videos -> null; 5-19 -> ordinal; >=20 -> percentile ───────
invalidatePoolCache();
const under5 = await getScoreDisplay(predictObjective, 0.5, "user-1", {
  fetchShadowRows: async () => [],
  fetchPersonalPredictions: async () => [0.1, 0.2, 0.3, 0.4], // 4 total, below PERSONAL_MIN_VIDEOS
});
check("under-5-video user gets null personal", under5.personal, null);
check("under-5-video user gets null personalHeadline", under5.personalHeadline, null);

invalidatePoolCache();
const ordinalCase = await getScoreDisplay(predictObjective, 0.5, "user-2", {
  fetchShadowRows: async () => [],
  fetchPersonalPredictions: async () => [0.1, 0.2, 0.3, 0.4, 0.5], // 5 total, this one included
});
check("5-19-video user gets an ordinal payload", ordinalCase.personal.type, "ordinal");
checkTrue("ordinal headline mentions rank", ordinalCase.personalHeadline.includes("rank"));

invalidatePoolCache();
const percentileCase = await getScoreDisplay(predictObjective, 0.5, "user-3", {
  fetchShadowRows: async () => [],
  fetchPersonalPredictions: async () => Array.from({ length: 20 }, (_, i) => i / 40), // 20 total
});
check("20-video user gets a percentile payload", percentileCase.personal.type, "percentile");

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
