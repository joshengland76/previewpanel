// scoring/axisPoolsTest.mjs — unit tests for axisPools.js (radar rolling-
// decile normalization, radar/links prompt Part A; midrank with earned
// endpoints, DECILE_V2 prompt -- amends DECILE_FIX's pure strict-dominance
// mapping back to classic midrank in the middle, keeping strict-dominance
// only at the two endpoints).
// Run: node backend/scoring/axisPoolsTest.mjs

import { axisMidrankFraction, decileFor } from "./axisPools.js";

let failures = [];
function check(name, got, expected) {
  if (JSON.stringify(got) !== JSON.stringify(expected)) failures.push(`${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}
// Floating-point tolerance for direct pctMid comparisons (below/n arithmetic
// isn't always exactly representable, e.g. 0.9/... artifacts).
function checkClose(name, got, expected) {
  if (Math.abs(got - expected) > 1e-9) failures.push(`${name}: got ${got}, expected ~${expected}`);
}

function pool(values) {
  return values.map((v, i) => ({ key: `p${i}`, value: v }));
}

// ── 1. axisMidrankFraction: pctMid is algebraically identical to the classic
// midrank statistic (below + 0.5*equal)/n -- ties split their credit evenly
// between the two sides, unlike DECILE_FIX's strict-below-only fraction. ──
const pool10 = pool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
checkClose("midrank pctMid of the max in a 10-pool (sb=0.9, sa=0)", axisMidrankFraction(10, pool10).pctMid, 0.95);
checkClose("midrank pctMid of the min in a 10-pool (sb=0, sa=0.9)", axisMidrankFraction(1, pool10).pctMid, 0.05);
checkClose("midrank pctMid of a mid-value with no ties", axisMidrankFraction(5.5, pool10).pctMid, 0.5);

const tiedPool = pool([1, 2, 2, 2, 3]);
checkClose("ties split credit evenly (sb=0.2, sa=0.2 -> pctMid=0.5)", axisMidrankFraction(2, tiedPool).pctMid, 0.5);

const poolWithSelf = pool([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).concat([{ key: "self", value: 10 }]);
checkClose("excludeKey drops the self row before computing", axisMidrankFraction(10, poolWithSelf, { excludeKey: "self" }).pctMid, 0.95);

check("empty pool returns null", axisMidrankFraction(5, []), null);

// ── 2. decileFor: clamp(1+floor(pctMid*10),1,10), then earned-endpoint
// overrides (computed 10 needs sb>=0.90 or displays 9; computed 1 needs
// sa>=0.90 or displays 2). DECILE_V2 prompt's required cases, on 100-row
// windows so percentile bands land on clean, checkable boundaries. ────────

// (a) top tie blocks.
// 83-98 (83 below, 15-wide tie, 2 above): pctMid=(0.83+(1-0.02))/2=0.905 ->
// computed decile 10, but sb=0.83<0.90 -> override to 9.
const poolA1 = pool([...Array(83).fill(1), ...Array(15).fill(5), ...Array(2).fill(9)]);
check("(a) tie block spanning pct 83-98 lands at decile 9 (earned-endpoint override)", decileFor(5, poolA1), 9);
// 92-100 (92 below, 8-wide tie, 0 above): pctMid=(0.92+(1-0))/2=0.96 ->
// computed decile 10, sb=0.92>=0.90 -> stays 10.
const poolA2 = pool([...Array(92).fill(1), ...Array(8).fill(9)]);
check("(a) tie block spanning pct 92-100 lands at decile 10 (earned)", decileFor(9, poolA2), 10);

// (b) bottom tie blocks.
// 0-25 (0 below, 25-wide tie, 75 above): pctMid=(0+(1-0.75))/2=0.125 ->
// decile 1+floor(1.25)=2 (not an endpoint case at all).
const poolB1 = pool([...Array(25).fill(1), ...Array(75).fill(9)]);
check("(b) bottom block spanning pct 0-25 lands at decile 2", decileFor(1, poolB1), 2);
// 0-8 (0 below, 8-wide tie, 92 above): pctMid=(0+(1-0.92))/2=0.04 ->
// computed decile 1, sa=0.92>=0.90 -> stays 1.
const poolB2 = pool([...Array(8).fill(1), ...Array(92).fill(9)]);
check("(b) bottom block spanning pct 0-8 lands at decile 1 (earned)", decileFor(1, poolB2), 1);
// 0-15 (0 below, 15-wide tie, 85 above): pctMid=(0+(1-0.85))/2=0.075 ->
// computed decile 1, but sa=0.85<0.90 -> override to 2.
const poolB3 = pool([...Array(15).fill(1), ...Array(85).fill(9)]);
check("(b) bottom block spanning pct 0-15 lands at decile 2 (earned-endpoint override)", decileFor(1, poolB3), 2);

// (c) middle/median tie blocks -- classic midrank, no endpoint involved.
// 20-60 (20 below, 40-wide tie, 40 above): pctMid=(0.20+(1-0.60))/2=0.40 -> decile 5.
const poolC1 = pool([...Array(20).fill(1), ...Array(40).fill(5), ...Array(40).fill(9)]);
check("(c) middle tie block spanning pct 20-60 lands at decile 5", decileFor(5, poolC1), 5);
// 40-60 (40 below, 20-wide tie, 40 above): pctMid=(0.40+(1-0.60))/2=0.50 -> decile 6.
const poolC2 = pool([...Array(40).fill(1), ...Array(20).fill(5), ...Array(40).fill(9)]);
check("(c) median tie block spanning pct 40-60 lands at decile 5 or 6", [5, 6].includes(decileFor(5, poolC2)), true);

// (d) thin-tie, near-continuous values match classic midrank EXACTLY
// (pctMid is algebraically the same number as (below+0.5*equal)/n, so away
// from the two endpoints there's no approximation -- they're identical).
function classicMidrankDecile(value, poolArr) {
  const n = poolArr.length;
  let below = 0, equal = 0;
  for (const p of poolArr) { if (p.value < value) below++; else if (p.value === value) equal++; }
  const pct = (below + 0.5 * equal) / n;
  return Math.max(1, Math.min(10, 1 + Math.floor(pct * 10)));
}
const poolD = pool([1, 2, 3, 4, 4, 6, 7]); // n=7, a thin tie of 2 at value=4
check("(d) thin-tie value matches classic midrank exactly", decileFor(4, poolD), classicMidrankDecile(4, poolD));
const poolD2 = pool([1, 2, 3, 4, 5, 6, 7]); // n=7, fully distinct
check("(d) non-tied continuous value matches classic midrank exactly", decileFor(4.5, poolD2), classicMidrankDecile(4.5, poolD2));

// (e) all-identical-window degenerate case -> pctMid=0.5 -> decile 5 or 6
// (midrank is the truthful answer when everyone ties -- replaces DECILE_FIX's
// decile-1 expectation for this same case), no error.
const allTiedPool = pool([5, 5, 5, 5, 5]);
check("(e) all-identical window lands at decile 5 or 6, no error", [5, 6].includes(decileFor(5, allTiedPool)), true);

// Floor/ceiling clamp retained: a value below the entire pool still floors at
// decile 1 (sa=1>=0.90, earned), and a value above the entire pool still caps
// at decile 10 (sb=1>=0.90, earned) -- never 0 or 11.
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
