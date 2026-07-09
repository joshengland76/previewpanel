// scoring/goldenVectorTest.mjs — acceptance gate for the Node scorer port.
// Run: node backend/scoring/goldenVectorTest.mjs
// PASS threshold: max |diff| <= 1e-9 across ALL rows in golden_vectors_v2.json.
// Any mismatch = fix the port, never the tolerance (per PHASEB2 Task 2).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scoreFeatures, loadSpec } from "./scorer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, "golden_vectors_v2.json"), "utf8"));
const spec = loadSpec();

let maxDiff = 0;
let nExceeding = 0;
const failures = [];

for (const row of golden.rows) {
  const got = scoreFeatures(row.inputs, spec);
  const diff = Math.abs(got - row.expected_yhat);
  if (diff > maxDiff) maxDiff = diff;
  if (diff > 1e-9) {
    nExceeding++;
    failures.push({ source: row.source, video_id: row.video_id, description: row.description, diff, got, expected: row.expected_yhat });
  }
}

console.log(`Golden vectors: ${golden.rows.length} rows`);
console.log(`Max |diff|: ${maxDiff.toExponential(3)}`);
console.log(`Rows exceeding 1e-9: ${nExceeding}`);

if (nExceeding > 0) {
  console.log("\nFirst failures:");
  for (const f of failures.slice(0, 10)) console.log(JSON.stringify(f));
  console.log("\nGATE: FAIL");
  process.exit(1);
} else {
  console.log("\nGATE: PASS");
  process.exit(0);
}
