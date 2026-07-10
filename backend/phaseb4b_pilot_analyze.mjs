// Phase B4b, Task 3 -- analysis of the 3-arm pilot (N1=judges-v1.0,
// N2=judges-v1.0 retest, S=judges-v2.1). Fresh-vs-fresh only: N1/N2/S are
// all scored from THIS session's live judge calls, never against stored
// historical scores (that was B4's confound -- see CAPSTONE_PREREG_v2.md
// amendment 30). Stored scores are used only for (a) the anomaly-rule
// check already applied during scoring, and (b) the descriptive
// Spearman(N1, stored) rider computed here, split by Pegasus era.
//
// PRE-SET PILOT RULE (logged in CAPSTONE_PREREG_v2.md amendment 31 BEFORE
// this pilot ran):
//   GUARD: if Spearman(N1, N2) < 0.95, STOP -- report before evaluating
//     the pass rule at all.
//   PASS iff |mean(yhat_S - yhat_N1)| < 0.02 with its 95% CI excluding
//     +/-0.02 exceedance, AND Spearman(S, N1) >= Spearman(N1, N2) - 0.02.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scoreFeatures, loadSpec } from "./scoring/scorer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(process.env.HOME, "correlation-research", "analysis", "modeling", "data", "snapshots", "2026-07-07-capstone");
const RESULTS_PATH = process.env.PILOT_RESULTS || path.join(SNAPSHOT_DIR, "phaseb4b_pilot_results.json");
const OUT_PATH = process.env.PILOT_ANALYSIS_OUT || path.join(SNAPSHOT_DIR, "phaseb4b_pilot_analysis.json");

const spec = loadSpec();
const v1FeatureRows = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, "phaseb3b_corpus_seed_rows.json"), "utf8"));
const v1ByVideoId = new Map(v1FeatureRows.map((r) => [r.video_id, r]));

const pilotSample = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, "phaseb4b_pilot_sample.json"), "utf8"));
const sampleByVideoId = new Map(pilotSample.map((r) => [r.video_id, r]));

const results = JSON.parse(fs.readFileSync(RESULTS_PATH, "utf8"));
const successful = results.filter((r) => r.armResults);
console.log(`Pilot: ${results.length} attempted, ${successful.length} successful, ${results.length - successful.length} failed`);

const DIMS9 = ["funny", "compelling", "authentic", "novel", "visually_engaging", "emotionally_resonant", "useful", "surprising", "relatable"];

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function sampleStd(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}
function meanStd(values) {
  const v = values.filter((x) => x != null && !Number.isNaN(x));
  if (v.length === 0) return { mean: null, std: null };
  if (v.length === 1) return { mean: v[0], std: 0 };
  return { mean: mean(v), std: sampleStd(v) };
}
function spearman(xs, ys) {
  const n = xs.length;
  const rank = (arr) => {
    const idx = arr.map((v, i) => i).sort((a, b) => arr[a] - arr[b]);
    const r = new Array(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && arr[idx[j + 1]] === arr[idx[i]]) j++;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[idx[k]] = avgRank;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys);
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx2 += (rx[i] - mx) ** 2;
    dy2 += (ry[i] - my) ** 2;
  }
  return num / Math.sqrt(dx2 * dy2);
}

function buildJudgeFields(armJudges) {
  const out = {};
  const judges = ["critic", "cool", "connector"];
  const scoreKey = { critic: "critic_score", cool: "trendsetter_score", connector: "connector_score" };
  const scores = [];
  for (const j of judges) {
    const overall = armJudges[j]?.overall;
    out[scoreKey[j]] = overall ?? null;
    if (overall != null) scores.push(overall);
  }
  out.avg_score = scores.length ? mean(scores) : null;
  const objfitScores = judges.map((j) => armJudges[j]?.objective_fit?.score).filter((x) => x != null);
  out.objfit_consensus = objfitScores.length ? mean(objfitScores) : null;
  for (const d of DIMS9) {
    const vals = judges.map((j) => armJudges[j]?.dimensions?.big_picture?.[d]).map((x) => (x == null ? null : Number(x)));
    const { mean: m, std: s } = meanStd(vals);
    out[`jc_${d}`] = m;
    out[`jd_${d}`] = s;
  }
  const eiVals = judges.map((j) => armJudges[j]?.dimensions?.big_picture?.emotion_intensity).map((x) => (x == null ? null : Number(x)));
  const ei = meanStd(eiVals);
  out.jc_emotion_intensity = ei.mean;
  out.jd_emotion_intensity = ei.std;
  out.tiktok_rewatch_potential = meanStd(judges.map((j) => armJudges[j]?.dimensions?.rewatch_potential).map((x) => (x == null ? null : Number(x)))).mean;
  out.tiktok_seo_strength = meanStd(judges.map((j) => armJudges[j]?.dimensions?.seo_strength).map((x) => (x == null ? null : Number(x)))).mean;
  return out;
}

const paired = [];
for (const row of successful) {
  const v1Row = v1ByVideoId.get(row.video_id);
  if (!v1Row) continue;
  const yhats = {};
  for (const arm of ["N1", "N2", "S"]) {
    const armJudges = row.armResults[arm];
    if (!armJudges) continue;
    const overrideFields = buildJudgeFields(armJudges);
    const features = { ...v1Row.features, ...overrideFields };
    yhats[arm] = scoreFeatures(features, spec);
  }
  if (yhats.N1 == null || yhats.N2 == null || yhats.S == null) continue;
  paired.push({ video_id: row.video_id, objective: row.objective_long, pegasus_model: row.pegasus_model, ...yhats });
}
console.log(`Paired (all 3 arms present): ${paired.length}`);

// ── Test-retest noise floor: Spearman(N1, N2) ───────────────────────────────
const rhoN1N2 = spearman(paired.map((p) => p.N1), paired.map((p) => p.N2));
console.log(`\n=== Noise floor: Spearman(N1, N2) [same prompt, fresh vs fresh] ===`);
console.log(`n = ${paired.length}, Spearman = ${rhoN1N2.toFixed(5)}`);

const GUARD_MIN = 0.95;
const guardOk = rhoN1N2 >= GUARD_MIN;
console.log(`GUARD: Spearman(N1,N2) >= ${GUARD_MIN}: ${guardOk ? "PASS" : "FAIL -- STOP, report before evaluating the pilot rule"}`);

// ── N1 vs N2 mean delta (informational -- pure noise, should be ~0) ────────
const n1n2Deltas = paired.map((p) => p.N2 - p.N1);
console.log(`mean(N2-N1) = ${mean(n1n2Deltas).toFixed(5)} (pure same-prompt noise; informational, not gated)`);

// ── S vs N1: the actual pilot comparison ────────────────────────────────────
const sN1Deltas = paired.map((p) => p.S - p.N1);
const meanSN1 = mean(sN1Deltas);
const sdSN1 = sampleStd(sN1Deltas);
const seSN1 = sdSN1 / Math.sqrt(sN1Deltas.length);
const ciSN1 = [meanSN1 - 1.96 * seSN1, meanSN1 + 1.96 * seSN1];
const rhoSN1 = spearman(paired.map((p) => p.S), paired.map((p) => p.N1));

console.log(`\n=== S vs N1 (the prompt-effect comparison) ===`);
console.log(`n = ${paired.length}`);
console.log(`mean(yhat_S - yhat_N1) = ${meanSN1.toFixed(5)}`);
console.log(`95% CI = [${ciSN1[0].toFixed(5)}, ${ciSN1[1].toFixed(5)}]`);
console.log(`Spearman(S, N1) = ${rhoSN1.toFixed(5)}`);

const meanOk = Math.abs(meanSN1) < 0.02 && Math.abs(ciSN1[0]) < 0.02 && Math.abs(ciSN1[1]) < 0.02;
const spearmanThreshold = rhoN1N2 - 0.02;
const spearmanOk = rhoSN1 >= spearmanThreshold;
const pilotPass = guardOk && meanOk && spearmanOk;

console.log(`\n=== Pre-set pilot rule (CAPSTONE_PREREG_v2.md amendment 31) ===`);
console.log(`GUARD Spearman(N1,N2) >= 0.95: ${rhoN1N2.toFixed(5)} -> ${guardOk ? "PASS" : "FAIL"}`);
if (guardOk) {
  console.log(`|mean delta| < 0.02 AND CI excludes +/-0.02: mean=${meanSN1.toFixed(5)}, CI=[${ciSN1[0].toFixed(5)},${ciSN1[1].toFixed(5)}] -> ${meanOk ? "PASS" : "FAIL"}`);
  console.log(`Spearman(S,N1) >= Spearman(N1,N2)-0.02 (${spearmanThreshold.toFixed(5)}): ${rhoSN1.toFixed(5)} -> ${spearmanOk ? "PASS" : "FAIL"}`);
}
console.log(`\nPILOT RESULT: ${!guardOk ? "GUARD FAILED -- STOP, report noise-floor finding" : pilotPass ? "PASS" : "FAIL"}`);

// ── Descriptive rider: Spearman(N1, stored originals), split by era ────────
const byEra = { "pegasus1.2": [], "pegasus1.5": [] };
for (const p of paired) {
  const v1Row = sampleByVideoId.get(p.video_id);
  const storedScores = ["critic_score", "trendsetter_score", "connector_score"].map((k) => v1Row?.[k]).filter((x) => x != null);
  if (!storedScores.length) continue;
  const storedMean = mean(storedScores);
  (byEra[p.pegasus_model] || (byEra[p.pegasus_model] = [])).push({ n1: p.N1, stored: storedMean });
}
console.log(`\n=== Descriptive rider: Spearman(N1 yhat, stored original mean judge score), by era ===`);
for (const [era, rows] of Object.entries(byEra)) {
  if (rows.length < 3) { console.log(`${era}: n=${rows.length} (too few to compute)`); continue; }
  const rho = spearman(rows.map((r) => r.n1), rows.map((r) => r.stored));
  console.log(`${era}: n=${rows.length}, Spearman(N1, stored) = ${rho.toFixed(5)}`);
}

fs.writeFileSync(OUT_PATH, JSON.stringify({
  nAttempted: results.length, nSuccessful: successful.length, nPaired: paired.length,
  rhoN1N2, guardOk, meanN2N1: mean(n1n2Deltas),
  meanSN1, ciSN1, rhoSN1, spearmanThreshold, meanOk, spearmanOk, pilotPass,
  perVideo: paired,
}, null, 2));
console.log(`\nWrote analysis -> ${OUT_PATH}`);
