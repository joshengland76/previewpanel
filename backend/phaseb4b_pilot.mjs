// Phase B4b, Task 2 (hardened harness) + Task 3 (3-arm pilot).
// Arms, all fresh, same session: N1 = judges-v1.0; N2 = judges-v1.0 again
// (test-retest, the noise-floor baseline); S = judges-v2.1.
// Hardening vs. the B4 harness (phaseb4_dualrun.mjs):
//   - retry-with-backoff on transient TL errors (fetch failed, socket hang
//     up, ECONNRESET, ETIMEDOUT, EPIPE) -- these caused all 15 of B4's
//     unrecovered failures.
//   - asset uploaded ONCE per video (with the same waitForAssetReady
//     readiness guard the live app uses), then REUSED across all 3 arms x 3
//     judges = 9 analyze calls for that video, instead of re-uploading per
//     arm -- fewer uploads, fewer chances for an upload-specific transient
//     failure, and a fair apples-to-apples comparison (identical asset
//     analyzed by all 3 arms).
//   - anomaly rule: any objective_fit.score <= 2 where the video's STORED
//     production score (from modeling_table_capstone.parquet) was >= 8 gets
//     ONE automatic re-run of that specific judge call; both the original
//     and the re-run are logged (this is exactly the "Pizza Night for 10"
//     pattern found in B4 -- automating the check rather than requiring a
//     human to notice it after the fact).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildTLPrompt, JUDGES, uploadAssetDirect, waitForAssetReady, processAnalyzeResult, tl, PEGASUS_MODEL,
} from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(process.env.HOME, "correlation-research", "analysis", "modeling", "data", "snapshots", "2026-07-07-capstone");
const SAMPLE_PATH = process.env.PILOT_SAMPLE || path.join(SNAPSHOT_DIR, "phaseb4b_pilot_sample.json");
const OUT_PATH = process.env.PILOT_OUT || path.join(SNAPSHOT_DIR, "phaseb4b_pilot_results.json");

const CONCURRENCY = 4;
const PLATFORM = "tiktok";
const ARMS = [
  { id: "N1", version: "judges-v1.0" },
  { id: "N2", version: "judges-v1.0" },
  { id: "S", version: "judges-v2.1" },
];

function formatTimestamp(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

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

async function runOneJudgeCall(videoContext, judge, objective, videoDuration, promptVersion) {
  const prompt = buildTLPrompt(judge, PLATFORM, objective, videoDuration, promptVersion);
  const data = await withRetry(
    () => tl().analyzeAsync.tasks.create(
      { video: videoContext, prompt, modelName: PEGASUS_MODEL, temperature: 0.3, maxTokens: 4096 },
      { timeoutInSeconds: 30 }
    ),
    { label: `create task (${judge.id}, ${promptVersion})` }
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

async function scorePilotVideo(row) {
  const videoDuration = row.duration_secs ? { secs: row.duration_secs, label: formatTimestamp(row.duration_secs) } : null;

  // Upload ONCE, reuse across all 3 arms x 3 judges.
  const assetId = await withRetry(() => uploadAssetDirect(row.local_path), { label: `upload ${row.video_id}` });
  await withRetry(() => waitForAssetReady(assetId), { label: `wait ready ${row.video_id}` });
  const videoContext = { type: "asset_id", assetId };

  const armResults = {};
  const anomalies = [];
  for (const arm of ARMS) {
    armResults[arm.id] = {};
    for (const judge of JUDGES) {
      const result = await runOneJudgeCall(videoContext, judge, row.objective_long, videoDuration, arm.version);
      armResults[arm.id][judge.id] = result;

      // Anomaly rule: objective_fit.score <= 2 vs. stored production score >= 8 -> one auto-rerun.
      const objfitScore = result?.objective_fit?.score;
      const storedKey = judge.id === "critic" ? "critic_score" : judge.id === "cool" ? "trendsetter_score" : "connector_score";
      const storedScore = row[storedKey];
      if (objfitScore != null && objfitScore <= 2 && storedScore != null && storedScore >= 8) {
        console.warn(`[anomaly] video_id=${row.video_id} arm=${arm.id} judge=${judge.id}: objfit=${objfitScore} but stored ${storedKey}=${storedScore} — auto-rerunning once`);
        const rerun = await runOneJudgeCall(videoContext, judge, row.objective_long, videoDuration, arm.version);
        anomalies.push({ arm: arm.id, judge: judge.id, storedKey, storedScore, original: result, rerun });
        armResults[arm.id][judge.id] = { ...armResults[arm.id][judge.id], _anomalyRerun: rerun };
      }
    }
  }
  return { assetId, armResults, anomalies };
}

async function main() {
  const sample = JSON.parse(fs.readFileSync(SAMPLE_PATH, "utf8"));
  let done = [];
  if (fs.existsSync(OUT_PATH)) {
    done = JSON.parse(fs.readFileSync(OUT_PATH, "utf8"));
    console.log(`Resuming — ${done.length} videos already scored`);
  }
  const doneIds = new Set(done.map((d) => d.video_id));
  const remaining = sample.filter((r) => !doneIds.has(r.video_id));
  console.log(`${sample.length} total, ${done.length} done, ${remaining.length} remaining`);

  let idx = 0;
  async function worker(workerId) {
    while (idx < remaining.length) {
      const row = remaining[idx++];
      const t0 = Date.now();
      try {
        const { assetId, armResults, anomalies } = await scorePilotVideo(row);
        done.push({ video_id: row.video_id, objective_long: row.objective_long, pegasus_model: row.pegasus_model, assetId, armResults, anomalies });
        fs.writeFileSync(OUT_PATH, JSON.stringify(done));
        console.log(`[w${workerId}] video_id=${row.video_id} done in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${anomalies.length} anomalies (${done.length}/${sample.length})`);
      } catch (e) {
        console.error(`[w${workerId}] video_id=${row.video_id} FAILED after retries: ${e.message}`);
        done.push({ video_id: row.video_id, objective_long: row.objective_long, pegasus_model: row.pegasus_model, error: e.message });
        fs.writeFileSync(OUT_PATH, JSON.stringify(done));
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  console.log(`\nAll done. ${done.length} results -> ${OUT_PATH}`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
