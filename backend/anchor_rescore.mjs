// App hardening, Task C9 -- runs the permanent 30-video anchor set
// (anchor_manifest.json, App hardening / research repo's anchor_sample.py)
// through the FULL live path: live TL judge calls (whatever prompt_version
// is currently configured, via JUDGES_V21 -- so re-running this monthly
// automatically tracks prompt-version changes too, not just Pegasus drift),
// combined with each video's existing C_dims features (Claude-derived,
// already stored in phaseb3b_corpus_seed_rows.json -- these describe the
// video's static content, not something that drifts run-to-run, so they are
// NOT re-extracted here) via the same Node scorer.js used in production.
// Appends one row per video to anchor_history.jsonl and prints deltas vs the
// most recent PRIOR run in that file (median Δŷ, rank correlation) so drift
// is visible immediately without a separate analysis pass.
//
// Same hardened harness as the pilot/confirm scripts: retry-with-backoff on
// transient TL errors, one upload per video reused across all 3 judges.
//
// Cost: ~$2/run (30 videos x 3 judges = 90 TL judge calls). Manual, monthly
// trigger for now -- no cron/automation.
// Force judges-v2.1 regardless of local .env drift -- the prompt names this
// explicitly ("TL judges v2.1"), and production's JUDGES_V21=true lives only
// in Render's env config, not in this repo's local .env. Must be set BEFORE
// server.js is imported. NOTE: static `import` declarations are hoisted
// above ALL other top-level code in an ES module regardless of where they're
// written textually, so a plain `process.env.JUDGES_V21 = "true"` followed by
// `import ... from "./server.js"` does NOT work (server.js's module-load-time
// JUDGE_PROMPT_VERSION computation would already have run against the old
// env). server.js and scorer.js are therefore loaded via dynamic import()
// inside main(), which — unlike a static import — is a normal expression
// evaluated in program order, after the env var is set.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

let buildTLPrompt, JUDGES, uploadAssetDirect, waitForAssetReady, processAnalyzeResult, tl, PEGASUS_MODEL, JUDGE_PROMPT_VERSION;
let scoreFeatures, loadSpec;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(process.env.HOME, "correlation-research", "analysis", "modeling", "data", "snapshots", "2026-07-07-capstone");
const MANIFEST_PATH = process.env.ANCHOR_MANIFEST || path.join(SNAPSHOT_DIR, "anchor_manifest.json");
const HISTORY_PATH = process.env.ANCHOR_HISTORY || path.join(SNAPSHOT_DIR, "anchor_history.jsonl");
const FEATURES_PATH = path.join(SNAPSHOT_DIR, "phaseb3b_corpus_seed_rows.json");

const CONCURRENCY = 4;
const PLATFORM = "tiktok";
const DIMS9 = ["funny", "compelling", "authentic", "novel", "visually_engaging", "emotionally_resonant", "useful", "surprising", "relatable"];

function formatTimestamp(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function meanStd(values) {
  const v = values.filter((x) => x != null && !Number.isNaN(x));
  if (v.length === 0) return { mean: null, std: null };
  if (v.length === 1) return { mean: v[0], std: 0 };
  const m = mean(v);
  return { mean: m, std: Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) };
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

const TRANSIENT_RE = /fetch failed|socket hang up|ECONNRESET|ETIMEDOUT|EPIPE|ECONNREFUSED|network|timeout/i;
async function withRetry(fn, { retries = 3, baseDelayMs = 3000, label = "" } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const transient = TRANSIENT_RE.test(e.message || "");
      if (!transient || attempt === retries) throw e;
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(`[retry] ${label} attempt ${attempt + 1}/${retries + 1} failed (${e.message}) — retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function pollTask(taskId, { timeoutMs = 20 * 60 * 1000, intervalMs = 8000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const task = await withRetry(() => tl().analyzeAsync.tasks.retrieve(taskId), { label: `poll ${taskId}` });
    if (task.status === "ready" || task.status === "failed") return task;
    await sleep(intervalMs);
  }
  throw new Error(`task ${taskId} timed out after ${timeoutMs}ms`);
}

async function runOneJudgeCall(videoContext, judge, objective, videoDuration) {
  const prompt = buildTLPrompt(judge, PLATFORM, objective, videoDuration); // defaults to the live JUDGE_PROMPT_VERSION
  const data = await withRetry(
    () => tl().analyzeAsync.tasks.create(
      { video: videoContext, prompt, modelName: PEGASUS_MODEL, temperature: 0.3, maxTokens: 4096 },
      { timeoutInSeconds: 30 }
    ),
    { label: `create task (${judge.id})` }
  );
  const task = await pollTask(data.taskId);
  if (task.status === "failed") return { error: task.error?.message || "task failed" };
  const rawText = task.result?.data ?? task.result ?? "";
  try {
    return await processAnalyzeResult(rawText, judge, PLATFORM, objective, videoDuration);
  } catch (e) {
    return { error: `parse failed: ${e.message}` };
  }
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

async function scoreAnchorVideo(row, v1Row, spec) {
  const videoDuration = row.duration_secs ? { secs: Number(row.duration_secs), label: formatTimestamp(Number(row.duration_secs)) } : null;
  const assetId = await withRetry(() => uploadAssetDirect(row.local_path), { label: `upload ${row.video_id}` });
  await withRetry(() => waitForAssetReady(assetId), { label: `wait ready ${row.video_id}` });
  const videoContext = { type: "asset_id", assetId };

  const judgeResults = {};
  for (const judge of JUDGES) {
    judgeResults[judge.id] = await runOneJudgeCall(videoContext, judge, row.objective_long, videoDuration);
  }

  const freshFields = buildJudgeFields(judgeResults);
  // C_dims (Claude-derived) come from the video's existing stored feature row
  // -- static content features, not re-extracted here (see header comment).
  const features = { ...(v1Row?.features ?? {}), ...freshFields };
  const yhat = scoreFeatures(features, spec);

  return { assetId, judgeResults, avgScore: freshFields.avg_score, yhat };
}

async function main() {
  process.env.JUDGES_V21 = "true";
  ({ buildTLPrompt, JUDGES, uploadAssetDirect, waitForAssetReady, processAnalyzeResult, tl, PEGASUS_MODEL, JUDGE_PROMPT_VERSION } = await import("./server.js"));
  ({ scoreFeatures, loadSpec } = await import("./scoring/scorer.js"));
  if (JUDGE_PROMPT_VERSION !== "judges-v2.1") throw new Error(`expected judges-v2.1, got ${JUDGE_PROMPT_VERSION} — refusing to run anchor rescore against the wrong prompt version`);

  const spec = loadSpec();
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const v1FeatureRows = fs.existsSync(FEATURES_PATH) ? JSON.parse(fs.readFileSync(FEATURES_PATH, "utf8")) : [];
  const v1ByVideoId = new Map(v1FeatureRows.map((r) => [r.video_id, r]));

  console.log(`Anchor set: ${manifest.length} videos, prompt_version=${JUDGE_PROMPT_VERSION}, pegasus_model=${PEGASUS_MODEL}`);

  const runDate = new Date().toISOString();
  const results = new Array(manifest.length);
  let idx = 0;
  async function worker(workerId) {
    while (idx < manifest.length) {
      const i = idx++;
      const row = manifest[i];
      const t0 = Date.now();
      try {
        const { assetId, avgScore, yhat } = await scoreAnchorVideo(row, v1ByVideoId.get(row.video_id), spec);
        results[i] = {
          date: runDate, video_id: row.video_id, objective_creator: row.objective_creator,
          yhat, avg_score: avgScore, prompt_version: JUDGE_PROMPT_VERSION, pegasus_model: PEGASUS_MODEL, assetId,
        };
        console.log(`[w${workerId}] video_id=${row.video_id} yhat=${yhat?.toFixed(4)} avg_score=${avgScore?.toFixed(2)} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      } catch (e) {
        console.error(`[w${workerId}] video_id=${row.video_id} FAILED after retries: ${e.message}`);
        results[i] = { date: runDate, video_id: row.video_id, objective_creator: row.objective_creator, error: e.message, prompt_version: JUDGE_PROMPT_VERSION, pegasus_model: PEGASUS_MODEL };
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

  // Load prior history (if any) BEFORE appending this run, so the delta is
  // against the true baseline/most-recent-prior-run, not against itself.
  const priorLines = fs.existsSync(HISTORY_PATH)
    ? fs.readFileSync(HISTORY_PATH, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];

  for (const r of results) fs.appendFileSync(HISTORY_PATH, JSON.stringify(r) + "\n");
  console.log(`\nAppended ${results.length} rows -> ${HISTORY_PATH}`);

  const succeeded = results.filter((r) => r.yhat != null);
  console.log(`\n${succeeded.length}/${results.length} videos scored successfully.`);

  if (priorLines.length === 0) {
    console.log("\nNo prior run found in anchor_history.jsonl — this run IS the baseline. Nothing to diff against.");
    console.log("Suggested alert thresholds for future runs: |median delta yhat| > 0.02 or rank corr < 0.95 -> investigate.");
    return;
  }

  // Most recent prior run = the run with the latest `date` strictly before this one, per video_id.
  const priorByVideo = new Map();
  for (const r of priorLines) {
    if (r.yhat == null) continue;
    const existing = priorByVideo.get(r.video_id);
    if (!existing || new Date(r.date) > new Date(existing.date)) priorByVideo.set(r.video_id, r);
  }

  const paired = succeeded
    .map((r) => ({ video_id: r.video_id, yhatNow: r.yhat, yhatPrior: priorByVideo.get(r.video_id)?.yhat }))
    .filter((p) => p.yhatPrior != null);

  if (paired.length < 4) {
    console.log(`\nOnly ${paired.length} video(s) have a comparable prior run — too few to report a delta.`);
    return;
  }

  const deltas = paired.map((p) => p.yhatNow - p.yhatPrior);
  const medianDelta = median(deltas);
  const rankCorr = spearman(paired.map((p) => p.yhatNow), paired.map((p) => p.yhatPrior));

  console.log(`\n=== Deltas vs. most recent prior run (n=${paired.length}) ===`);
  console.log(`median(Δyhat) = ${medianDelta.toFixed(5)}`);
  console.log(`rank correlation (yhat now vs. yhat prior) = ${rankCorr.toFixed(5)}`);
  const alert = Math.abs(medianDelta) > 0.02 || rankCorr < 0.95;
  console.log(`Alert thresholds: |median delta| > 0.02 or rank corr < 0.95 -> ${alert ? "ALERT -- investigate" : "within tolerance"}`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
