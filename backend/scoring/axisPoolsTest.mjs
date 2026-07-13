// scoring/axisPoolsTest.mjs — unit tests for axisPools.js (radar rolling-
// decile normalization, radar/links prompt Part A).
// Run: node backend/scoring/axisPoolsTest.mjs

import { axisMidrankFraction, decileFor } from "./axisPools.js";

let failures = [];
function check(name, got, expected) {
  if (JSON.stringify(got) !== JSON.stringify(expected)) failures.push(`${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}

// ── 1. axisMidrankFraction: same midrank math as percentilePools.js's
// midrankPercentile, but as an unrounded 0-1 fraction, not a rounded 0-100. ─
const pool10 = Array.from({ length: 10 }, (_, i) => ({ key: `p${i + 1}`, value: i + 1 }));
check("midrank fraction of the max in a 10-pool", axisMidrankFraction(10, pool10), 0.95);
check("midrank fraction of the min in a 10-pool", axisMidrankFraction(1, pool10), 0.05);
check("midrank fraction of a mid-value with no ties", axisMidrankFraction(5.5, pool10), 0.5);

const tiedPool = [1, 2, 2, 2, 3].map((v, i) => ({ key: `t${i}`, value: v }));
check("midrank fraction with ties credits the midpoint", axisMidrankFraction(2, tiedPool), 0.5);

const poolWithSelf = [...pool10, { key: "self", value: 10 }];
check("excludeKey drops the self row before computing", axisMidrankFraction(10, poolWithSelf, { excludeKey: "self" }), 0.95);

check("empty pool returns null", axisMidrankFraction(5, []), null);

// ── 2. decileFor: clamp(ceil(pct*10), 1, 10) ────────────────────────────────
// pct=0.95 -> ceil(9.5)=10 -> clamp(10,1,10)=10
check("decile for the max in a 10-pool", decileFor(10, pool10), 10);
// pct=0.05 -> ceil(0.5)=1 -> clamp(1,1,10)=1
check("decile for the min in a 10-pool", decileFor(1, pool10), 1);
// pct=0.5 -> ceil(5)=5
check("decile for an exact-midpoint value", decileFor(5.5, pool10), 5);

// Floor/ceiling clamp: a fraction of exactly 0 must still floor to decile 1
// (never decile 0), and a fraction of 1 must cap at decile 10 (never 11).
const allTiedPool = Array.from({ length: 5 }, (_, i) => ({ key: `e${i}`, value: 5 }));
// value=5 tied with all 5 -> below=0, equal=5 -> pct=(0+2.5)/5=0.5 -> ceil(5)=5
check("value tied with the entire pool lands at the true midpoint decile", decileFor(5, allTiedPool), 5);

// A value strictly below every pool member: below=0, equal=0 -> pct=0 -> ceil(0)=0 -> clamp to 1
const allAbovePool = Array.from({ length: 5 }, (_, i) => ({ key: `a${i}`, value: 10 }));
check("a value below the entire pool floors at decile 1, never 0", decileFor(1, allAbovePool), 1);

check("null value returns null (graceful, no pool lookup attempted)", decileFor(null, pool10), null);
check("empty pool returns null decile (caller falls back to raw value)", decileFor(5, []), null);

console.log("axisPools.js checks complete.");
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
