// App hardening, Task C8 -- clean drift recompute from ALREADY-STORED Phase
// B4b pilot/confirmation data. NO NEW API CALLS. This corrects a mixed-
// quantity problem in phaseb4b_pilot_analyze.mjs's "descriptive rider"
// (PHASEB4B_READOUT.md, Task 3): that rider computed Spearman(fresh N1 yhat,
// stored MEAN JUDGE SCORE) -- a model prediction compared against a raw,
// unscored quantity. That's not a clean drift measurement; a low correlation
// there could reflect the yhat-vs-avg_score unit mismatch as easily as real
// drift. This script instead computes two apples-to-apples pairs:
//   (a) Spearman(fresh N1 avg_score, stored avg_score) -- both are the same
//       quantity (mean of 3 judges' overall score), one fresh, one stored.
//   (b) Spearman(yhat from fresh N1 features, yhat from stored features) --
//       both are full model outputs (scoreFeatures()), one built by
//       overriding v1Row.features with fresh N1 judge output, one from
//       v1Row.features completely unmodified (v1Row.features already IS the
//       video's stored feature row, confirmed via direct inspection --
//       critic_score/avg_score/jc_*/jd_* etc. are already embedded in it).
// Both split by Pegasus era, with n and a Fisher-z-approximation 95% CI.
//
// Also recomputes the confirmation run's anomaly-rerun rate against its TRUE
// denominator (total judge calls that were ELIGIBLE to trigger the anomaly
// rule, not an assumed round number), and classifies each rerun as having
// CONFIRMED the original low read (rerun also low -- evidence of genuine
// drift/disagreement) or REVERTED it (rerun came back higher -- evidence of
// transient noise, one-off judge miss).
import fs from "fs";
import path from "path";
import { scoreFeatures, loadSpec } from "./scoring/scorer.js";

const SNAPSHOT_DIR = path.join(process.env.HOME, "correlation-research", "analysis", "modeling", "data", "snapshots", "2026-07-07-capstone");

const spec = loadSpec();
const v1FeatureRows = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, "phaseb3b_corpus_seed_rows.json"), "utf8"));
const v1ByVideoId = new Map(v1FeatureRows.map((r) => [r.video_id, r]));

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
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
// Fisher z-transformation approximate 95% CI for a Spearman rho (n >= 4).
function spearmanCI(rho, n) {
  if (n < 4) return [null, null];
  const z = Math.atanh(rho);
  const se = 1 / Math.sqrt(n - 3);
  const lo = Math.tanh(z - 1.96 * se);
  const hi = Math.tanh(z + 1.96 * se);
  return [lo, hi];
}

const DIMS9 = ["funny", "compelling", "authentic", "novel", "visually_engaging", "emotionally_resonant", "useful", "surprising", "relatable"];
function meanStd(values) {
  const v = values.filter((x) => x != null && !Number.isNaN(x));
  if (v.length === 0) return { mean: null, std: null };
  if (v.length === 1) return { mean: v[0], std: 0 };
  const m = mean(v);
  const s = v.length < 2 ? 0 : Math.sqrt(v.reduce((s2, x) => s2 + (x - m) ** 2, 0) / (v.length - 1));
  return { mean: m, std: s };
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

// ─────────────────────────────────────────────────────────────────────────
// Part (a)/(b): clean drift pairs from the pilot run (N1 arm has both a
// fresh judge run AND a stored v1Row.features baseline for the same video).
// ─────────────────────────────────────────────────────────────────────────
const pilotResults = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, "phaseb4b_pilot_results.json"), "utf8"));
const pilotSuccessful = pilotResults.filter((r) => r.armResults);

const byEra = {};
for (const row of pilotSuccessful) {
  const v1Row = v1ByVideoId.get(row.video_id);
  const n1Judges = row.armResults.N1;
  if (!v1Row || !n1Judges) continue;

  const freshFields = buildJudgeFields(n1Judges);
  if (freshFields.avg_score == null || v1Row.features.avg_score == null) continue;

  const freshFeatures = { ...v1Row.features, ...freshFields };
  const yhatFresh = scoreFeatures(freshFeatures, spec);
  const yhatStored = scoreFeatures(v1Row.features, spec); // v1Row.features IS the stored row, unmodified

  const era = row.pegasus_model || v1Row.pegasus_model || "unknown";
  (byEra[era] || (byEra[era] = [])).push({
    video_id: row.video_id,
    freshAvgScore: freshFields.avg_score,
    storedAvgScore: v1Row.features.avg_score,
    yhatFresh,
    yhatStored,
  });
}

console.log(`\n=== Task C8(a)/(b): clean drift recompute (pilot N1 arm, n=${pilotSuccessful.length} videos attempted) ===`);
const driftByEra = {};
for (const [era, rows] of Object.entries(byEra)) {
  const n = rows.length;
  if (n < 4) {
    console.log(`\n-- Era: ${era} (n=${n}, too few for a CI) --`);
    driftByEra[era] = { n, note: "too few for CI" };
    continue;
  }
  const rhoAvgScore = spearman(rows.map((r) => r.freshAvgScore), rows.map((r) => r.storedAvgScore));
  const ciAvgScore = spearmanCI(rhoAvgScore, n);
  const rhoYhat = spearman(rows.map((r) => r.yhatFresh), rows.map((r) => r.yhatStored));
  const ciYhat = spearmanCI(rhoYhat, n);

  console.log(`\n-- Era: ${era} (n=${n}) --`);
  console.log(`(a) Spearman(fresh N1 avg_score, stored avg_score) = ${rhoAvgScore.toFixed(4)}, 95% CI [${ciAvgScore[0].toFixed(4)}, ${ciAvgScore[1].toFixed(4)}]`);
  console.log(`(b) Spearman(yhat from fresh N1 features, yhat from stored features) = ${rhoYhat.toFixed(4)}, 95% CI [${ciYhat[0].toFixed(4)}, ${ciYhat[1].toFixed(4)}]`);

  driftByEra[era] = { n, rhoAvgScore, ciAvgScore, rhoYhat, ciYhat };
}

// ─────────────────────────────────────────────────────────────────────────
// Confirmation run: anomaly-rerun rate against its TRUE denominator, and
// CONFIRMED-vs-REVERTED classification.
// ─────────────────────────────────────────────────────────────────────────
const confirmResults = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, "phaseb4b_confirm_results.json"), "utf8"));
const confirmSuccessful = confirmResults.filter((r) => r.armResults);
const ARMS_PER_VIDEO = 2; // N1, S
const JUDGES_PER_ARM = 3; // critic, cool, connector
const totalJudgeCalls = confirmSuccessful.length * ARMS_PER_VIDEO * JUDGES_PER_ARM;
const totalAnomalies = confirmSuccessful.reduce((s, r) => s + (r.anomalies ? r.anomalies.length : 0), 0);
const anomalyRate = totalAnomalies / totalJudgeCalls;

let confirmedCount = 0, revertedCount = 0, ambiguousCount = 0;
const ANOMALY_THRESHOLD = 2; // matches the live anomaly rule's objective_fit.score <= 2
for (const row of confirmSuccessful) {
  for (const a of row.anomalies || []) {
    const origScore = a.original?.objective_fit?.score;
    const rerunScore = a.rerun?.objective_fit?.score;
    if (origScore == null || rerunScore == null) { ambiguousCount++; continue; }
    if (rerunScore <= ANOMALY_THRESHOLD) confirmedCount++;
    else revertedCount++;
  }
}

console.log(`\n=== Confirmation run: anomaly-rerun rate, true denominator ===`);
console.log(`Successful videos: ${confirmSuccessful.length} (${ARMS_PER_VIDEO} arms x ${JUDGES_PER_ARM} judges each = ${totalJudgeCalls} total judge calls)`);
console.log(`Anomaly auto-reruns triggered: ${totalAnomalies}`);
console.log(`True anomaly rate: ${totalAnomalies}/${totalJudgeCalls} = ${(anomalyRate * 100).toFixed(2)}%`);
console.log(`Rerun outcome: CONFIRMED (rerun objective_fit.score still <= ${ANOMALY_THRESHOLD}) = ${confirmedCount}, REVERTED (rerun > ${ANOMALY_THRESHOLD}) = ${revertedCount}, ambiguous = ${ambiguousCount}`);
console.log(`-> ${confirmedCount >= revertedCount ? "Majority CONFIRMED: the low reads were reproducible, not one-off noise (weak evidence toward genuine disagreement/drift on those specific videos, not transient)." : "Majority REVERTED: the low reads were largely transient, consistent with ordinary judge noise rather than drift."}`);

const OUT_PATH = path.join(SNAPSHOT_DIR, "phaseb4b_drift_recompute.json");
fs.writeFileSync(OUT_PATH, JSON.stringify({
  driftByEra,
  confirmation: {
    nSuccessful: confirmSuccessful.length,
    armsPerVideo: ARMS_PER_VIDEO,
    judgesPerArm: JUDGES_PER_ARM,
    totalJudgeCalls,
    totalAnomalies,
    anomalyRate,
    confirmedCount,
    revertedCount,
    ambiguousCount,
  },
}, null, 2));
console.log(`\nWrote -> ${OUT_PATH}`);
