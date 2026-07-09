// Phase B4, Task 3 -- analysis of the dual-run gate results. For each
// retained model field, computes the paired v2-v1 delta in training-SD units
// (using scoring_spec_v2.json's own frozen SDs -- the actual SD each feature
// was standardized against during training, not a re-estimated one). Then
// rebuilds the full 116-feature vector for both variants (only the
// judge-derived fields differ; every C_dims/duration/etc field is held
// identical, since only the judge prompt changed) and scores both through
// the untouched Node scorer, computing the paired prediction delta and
// Spearman(v1, v2). Applies the pre-set cutover rule logged in
// CAPSTONE_PREREG_v2.md before this dual-run gate started.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scoreFeatures, loadSpec } from "./scoring/scorer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(process.env.HOME, "correlation-research", "analysis", "modeling", "data", "snapshots", "2026-07-07-capstone");

const spec = loadSpec();
const v1FeatureRows = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, "phaseb3b_corpus_seed_rows.json"), "utf8"));
const v1ByVideoId = new Map(v1FeatureRows.map((r) => [r.video_id, r]));

const dualRun = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, "phaseb4_dualrun_v2_results.json"), "utf8"));
const successful = dualRun.filter((r) => r.v2);
console.log(`Dual-run: ${dualRun.length} attempted, ${successful.length} successful, ${dualRun.length - successful.length} failed`);

const DIMS9 = ["funny", "compelling", "novel", "visually_engaging", "emotionally_resonant", "useful", "surprising", "relatable"];
// "authentic" deliberately excluded -- dropped from v2 entirely.

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

// Build the v2-judge-derived override fields (jc_*/jd_*/critic_score/
// trendsetter_score/connector_score/avg_score/objfit_consensus), matching
// features.py's build_features() logic for these exact columns.
function buildV2JudgeFields(v2) {
  const out = {};
  const judges = ["critic", "cool", "connector"]; // "cool" internal id = trendsetter
  const scoreKey = { critic: "critic_score", cool: "trendsetter_score", connector: "connector_score" };
  const scores = [];
  for (const j of judges) {
    const overall = v2[j]?.overall;
    out[scoreKey[j]] = overall ?? null;
    if (overall != null) scores.push(overall);
  }
  out.avg_score = scores.length ? mean(scores) : null;

  const objfitScores = judges.map((j) => v2[j]?.objective_fit?.score).filter((x) => x != null);
  out.objfit_consensus = objfitScores.length ? mean(objfitScores) : null;

  for (const d of DIMS9) {
    const vals = judges.map((j) => v2[j]?.dimensions?.big_picture?.[d]).map((x) => (x == null ? null : Number(x)));
    const { mean: m, std: s } = meanStd(vals);
    out[`jc_${d}`] = m;
    out[`jd_${d}`] = s;
  }
  const eiVals = judges.map((j) => v2[j]?.dimensions?.big_picture?.emotion_intensity).map((x) => (x == null ? null : Number(x)));
  const ei = meanStd(eiVals);
  out.jc_emotion_intensity = ei.mean;
  out.jd_emotion_intensity = ei.std;

  // Platform dims (tiktok_rewatch_potential/seo_strength) -- dropped from v2
  // output entirely; leave as null so scoreFeatures treats them as missing,
  // matching how v1's own features vector already has near-zero effective
  // contribution (both are model-dead, per PHASEB2/Task 1).
  out.tiktok_rewatch_potential = null;
  out.tiktok_seo_strength = null;

  return out;
}

const JUDGE_FIELD_KEYS = [
  "critic_score", "trendsetter_score", "connector_score", "avg_score", "objfit_consensus",
  ...DIMS9.map((d) => `jc_${d}`), ...DIMS9.map((d) => `jd_${d}`),
  "jc_emotion_intensity", "jd_emotion_intensity",
];

const paired = [];
const missingV1 = [];
for (const row of successful) {
  const v1Row = v1ByVideoId.get(row.video_id);
  if (!v1Row) { missingV1.push(row.video_id); continue; }
  const featuresV1 = v1Row.features;
  const v2JudgeFields = buildV2JudgeFields(row.v2);
  const featuresV2 = { ...featuresV1, ...v2JudgeFields };
  const yhatV1 = scoreFeatures(featuresV1, spec);
  const yhatV2 = scoreFeatures(featuresV2, spec);
  paired.push({ video_id: row.video_id, objective: row.objective_long, yhatV1, yhatV2, featuresV1, v2JudgeFields });
}
console.log(`Paired (v1 features found): ${paired.length}${missingV1.length ? `, missing v1 features for: ${missingV1.join(",")}` : ""}`);

// ── Per-field deltas in training-SD units ──────────────────────────────────
console.log("\n=== Per-retained-field delta (v2 - v1), training-SD units ===");
console.log("field | n | mean_delta_raw | mean_delta_sd_units | median_delta_sd_units");
for (const field of JUDGE_FIELD_KEYS) {
  const deltas = [];
  for (const p of paired) {
    const v1 = p.featuresV1[field];
    const v2 = p.v2JudgeFields[field];
    if (v1 == null || v2 == null) continue;
    deltas.push(v2 - v1);
  }
  if (deltas.length === 0) continue;
  const sd = spec.numeric_standardization[field]?.sd;
  const meanDelta = mean(deltas);
  const sorted = [...deltas].sort((a, b) => a - b);
  const medianDelta = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  const meanSdUnits = sd ? meanDelta / sd : null;
  const medianSdUnits = sd ? medianDelta / sd : null;
  console.log(`${field} | ${deltas.length} | ${meanDelta.toFixed(4)} | ${meanSdUnits != null ? meanSdUnits.toFixed(4) : "n/a"} | ${medianSdUnits != null ? medianSdUnits.toFixed(4) : "n/a"}`);
}

// ── Paired prediction delta + Spearman ──────────────────────────────────────
const yhatDeltas = paired.map((p) => p.yhatV2 - p.yhatV1);
const meanYhatDelta = mean(yhatDeltas);
const sdYhatDelta = sampleStd(yhatDeltas);
const seYhatDelta = sdYhatDelta / Math.sqrt(yhatDeltas.length);
const ci95 = [meanYhatDelta - 1.96 * seYhatDelta, meanYhatDelta + 1.96 * seYhatDelta];
const rho = spearman(paired.map((p) => p.yhatV1), paired.map((p) => p.yhatV2));

console.log("\n=== Paired prediction (yhat) delta ===");
console.log(`n = ${paired.length}`);
console.log(`mean(yhat_v2 - yhat_v1) = ${meanYhatDelta.toFixed(5)}`);
console.log(`95% CI = [${ci95[0].toFixed(5)}, ${ci95[1].toFixed(5)}]`);
console.log(`Spearman(yhat_v1, yhat_v2) = ${rho.toFixed(5)}`);

// ── Pre-set cutover rule (logged in CAPSTONE_PREREG_v2.md BEFORE this ran) ──
const RULE_MEAN_ABS_MAX = 0.02;
const RULE_SPEARMAN_MIN = 0.98;
const meanOk = Math.abs(meanYhatDelta) < RULE_MEAN_ABS_MAX;
const spearmanOk = rho > RULE_SPEARMAN_MIN;
const cutoverApproved = meanOk && spearmanOk;

console.log("\n=== Cutover rule (fixed before this run; see CAPSTONE_PREREG_v2.md amendment 28) ===");
console.log(`|mean delta| < ${RULE_MEAN_ABS_MAX}: ${Math.abs(meanYhatDelta).toFixed(5)} -> ${meanOk ? "PASS" : "FAIL"}`);
console.log(`Spearman > ${RULE_SPEARMAN_MIN}: ${rho.toFixed(5)} -> ${spearmanOk ? "PASS" : "FAIL"}`);
console.log(`\nCUTOVER: ${cutoverApproved ? "APPROVED" : "NOT APPROVED"}`);

fs.writeFileSync(
  path.join(SNAPSHOT_DIR, "phaseb4_dualrun_analysis.json"),
  JSON.stringify({
    nAttempted: dualRun.length, nSuccessful: successful.length, nPaired: paired.length,
    meanYhatDelta, ci95, sdYhatDelta, spearman: rho,
    ruleMeanAbsMax: RULE_MEAN_ABS_MAX, ruleSpearmanMin: RULE_SPEARMAN_MIN,
    meanOk, spearmanOk, cutoverApproved,
    perVideo: paired.map((p) => ({ video_id: p.video_id, objective: p.objective, yhatV1: p.yhatV1, yhatV2: p.yhatV2 })),
  }, null, 2)
);
console.log(`\nWrote analysis -> ${path.join(SNAPSHOT_DIR, "phaseb4_dualrun_analysis.json")}`);
