// scoring/durationClampTest.mjs — policy test for the Phase B3 Task 2 duration
// clamp (buildFeatures.js's clampDurationSecs / CLAMP_DURATION flag).
// Run: node backend/scoring/durationClampTest.mjs
//
// This tests the INPUT-SHAPING clamp only. It does not touch scorer.js /
// scoreFeatures(), which must stay unclamped forever (see buildFeatures.js
// header comment and PHASEB3_READOUT.md Task 2).

import { clampDurationSecs, buildScoringFeatures } from "./buildFeatures.js";
import { loadSpec } from "./scorer.js";

const spec = loadSpec();
const { p1, p99 } = spec.duration_clamp_bounds;

let failures = [];
function check(name, got, expected) {
  if (got !== expected) failures.push(`${name}: got ${got}, expected ${expected}`);
}

// 1. Above p99 (300s, p99≈273.22) clamps to the hi-bound exactly.
check("300s clamps to p99", clampDurationSecs(300), p99);

// 2. Below p1 (3s, p1=5) clamps to the lo-bound exactly.
check("3s clamps to p1", clampDurationSecs(3), p1);

// 3. In-range value passes through unchanged.
const midValue = (p1 + p99) / 2;
check("mid-range passes through", clampDurationSecs(midValue), midValue);

// 4. null/missing passes through as null (no fabricated duration).
check("null passes through", clampDurationSecs(null), null);

// 5. buildScoringFeatures wires the clamp into duration_secs when clampDuration=true (default),
//    and leaves it raw when clampDuration=false.
const clamped = buildScoringFeatures({ durationSecs: 300, clampDuration: true });
check("buildScoringFeatures clamps by default", clamped.duration_secs, p99);
const unclamped = buildScoringFeatures({ durationSecs: 300, clampDuration: false });
check("buildScoringFeatures respects clampDuration=false", unclamped.duration_secs, 300);

console.log(`duration_clamp_bounds: p1=${p1}, p99=${p99}`);
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
