// scoring/axisPoolsTest.mjs — unit tests for axisPools.js (radar rolling-
// decile normalization, radar/links prompt Part A; strict-dominance mapping,
// DECILE_FIX prompt).
// Run: node backend/scoring/axisPoolsTest.mjs

import { axisStrictBelowFraction, decileFor } from "./axisPools.js";

let failures = [];
function check(name, got, expected) {
  if (JSON.stringify(got) !== JSON.stringify(expected)) failures.push(`${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}

function pool(values) {
  return values.map((v, i) => ({ key: `p${i}`, value: v }));
}

// ── 1. axisStrictBelowFraction: ties earn NO credit, unlike the old midrank
// formula this replaced ((below + 0.5*equal)/n). ──────────────────────────
const pool10 = pool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
check("strict-below fraction of the max in a 10-pool", axisStrictBelowFraction(10, pool10), 0.9);
check("strict-below fraction of the min in a 10-pool", axisStrictBelowFraction(1, pool10), 0);
check("strict-below fraction of a mid-value with no ties", axisStrictBelowFraction(5.5, pool10), 0.5);

const tiedPool = pool([1, 2, 2, 2, 3]);
check("ties earn no credit -- only strictly-less rows count", axisStrictBelowFraction(2, tiedPool), 0.2);

const poolWithSelf = pool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).concat([{ key: "self", value: 10 }]);
check("excludeKey drops the self row before computing", axisStrictBelowFraction(10, poolWithSelf, { excludeKey: "self" }), 0.9);

check("empty pool returns null", axisStrictBelowFraction(5, []), null);

// ── 2. decileFor: clamp(1 + floor(frac * 10), 1, 10) ────────────────────────
// DECILE_FIX prompt's five required cases, built on a 100-row window so
// percentile bands land on clean, checkable boundaries.

// (a) a tie block spanning percentile 83-98 (83 rows below it, the block
// itself is 15 rows wide, 2 rows above) -> decile 9, not 10.
// frac = 83/100 = 0.83 -> 1 + floor(8.3) = 9.
const poolA = pool([
  ...Array(83).fill(1),   // below the tie block
  ...Array(15).fill(5),   // the tie block itself (pct 83-98)
  ...Array(2).fill(9),    // above it (pct 98-100)
]);
check("(a) tie block spanning pct 83-98 lands at decile 9, not 10", decileFor(5, poolA), 9);

// (b) a value with 98% strictly below it -> decile 10.
// frac = 98/100 = 0.98 -> 1 + floor(9.8) = 10.
const poolB = pool([...Array(98).fill(1), ...Array(2).fill(9)]);
check("(b) value with 98% strictly below lands at decile 10", decileFor(9, poolB), 10);

// (c) median tie blocks: one spanning pct 40-60, one spanning pct 50-70.
const poolC1 = pool([...Array(40).fill(1), ...Array(20).fill(5), ...Array(40).fill(9)]);
check("(c) median tie block spanning pct 40-60 lands at decile 5", decileFor(5, poolC1), 5);
const poolC2 = pool([...Array(50).fill(1), ...Array(20).fill(5), ...Array(30).fill(9)]);
check("(c) tie block spanning pct 50-70 lands at decile 6", decileFor(5, poolC2), 6);

// (d) thin-tie, near-continuous values match the old midrank formula within
// +/-1, never ABOVE it -- a small tie (2 rows out of 7) pulls the new
// strict-dominance decile down relative to the old formula's tie credit; it
// never pushes it up. (Old midrank, reconstructed here only for this one
// comparison -- it's no longer part of the module.)
function oldMidrankDecile(value, poolArr) {
  const n = poolArr.length;
  let below = 0, equal = 0;
  for (const p of poolArr) { if (p.value < value) below++; else if (p.value === value) equal++; }
  const pct = (below + 0.5 * equal) / n;
  return Math.max(1, Math.min(10, Math.ceil(pct * 10)));
}
const poolD = pool([1, 2, 3, 4, 4, 6, 7]); // n=7, a thin tie of 2 at value=4
const oldD = oldMidrankDecile(4, poolD); // (3 below + 1.0)/7 = 0.5714 -> ceil(5.714) = 6
const newD = decileFor(4, poolD);        // 3/7 = 0.4286 -> 1+floor(4.286) = 5
check("(d) old midrank decile for the thin-tie case (reference value)", oldD, 6);
check("(d) new strict-dominance decile is <= old, within 1", newD <= oldD && oldD - newD <= 1, true);
check("(d) new strict-dominance decile for the thin-tie case", newD, 5);
// A non-tied value in the same near-continuous pool matches old exactly
// (no tie credit was ever in play, so nothing to strip out).
const poolD2 = pool([1, 2, 3, 4, 5, 6, 7]); // n=7, fully distinct
check("(d) non-tied continuous value: new matches old exactly", decileFor(4.5, poolD2), oldMidrankDecile(4.5, poolD2));

// (e) all-identical-window degenerate case -> decile 1, no error.
const allTiedPool = pool([5, 5, 5, 5, 5]);
check("(e) all-identical window lands at decile 1 without error", decileFor(5, allTiedPool), 1);

// Floor/ceiling clamp retained: a fraction of 0 must still floor to decile 1
// (never decile 0), and beating the entire window caps at decile 10 (never 11).
const allAbovePool = pool([10, 10, 10, 10, 10]);
check("a value below the entire pool floors at decile 1, never 0", decileFor(1, allAbovePool), 1);
const allBelowPool = pool([1, 1, 1, 1, 1]);
check("a value above the entire pool caps at decile 10, never 11", decileFor(10, allBelowPool), 10);

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
