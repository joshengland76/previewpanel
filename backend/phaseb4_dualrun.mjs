// Phase B4, Task 3 -- dual-run gate. Re-scores the ~150-video stratified
// sample under judges-v2.0 (real TwelveLabs cost, ~$10 budget per the
// prompt). Reuses the REAL, live buildTLPrompt/getVideoContext/
// processAnalyzeResult path (exported from server.js for exactly this
// purpose) rather than reimplementing any of it -- guarantees the dual-run
// exercises the identical code that would run in production if v2 cuts over.
// Run: node backend/phaseb4_dualrun.mjs
// One-off research script, not part of the app's runtime surface.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildTLPrompt, JUDGES, getVideoContext, processAnalyzeResult, tl, PEGASUS_MODEL,
} from "./server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_DIR = path.join(process.env.HOME, "correlation-research", "analysis", "modeling", "data", "snapshots", "2026-07-07-capstone");
const SAMPLE_PATH = process.env.DUALRUN_SAMPLE || path.join(SNAPSHOT_DIR, "phaseb4_dualrun_sample.json");
const OUT_PATH = process.env.DUALRUN_OUT || path.join(SNAPSHOT_DIR, "phaseb4_dualrun_v2_results.json");

const CONCURRENCY = 6;
const PLATFORM = "tiktok"; // corpus is 100% TikTok

function formatTimestamp(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function pollTask(taskId, { timeoutMs = 20 * 60 * 1000, intervalMs = 8000 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const task = await tl().analyzeAsync.tasks.retrieve(taskId);
    if (task.status === "ready" || task.status === "failed") return task;
    await sleep(intervalMs);
  }
  throw new Error(`task ${taskId} timed out after ${timeoutMs}ms`);
}

async function scoreVideoV2(row) {
  const videoDuration = row.duration_secs ? { secs: row.duration_secs, label: formatTimestamp(row.duration_secs) } : null;
  const videoContext = await getVideoContext(null, row.local_path);

  const taskIds = {};
  for (const judge of JUDGES) {
    const prompt = buildTLPrompt(judge, PLATFORM, row.objective_long, videoDuration, "judges-v2.0");
    const data = await tl().analyzeAsync.tasks.create(
      { video: videoContext, prompt, modelName: PEGASUS_MODEL, temperature: 0.3, maxTokens: 4096 },
      { timeoutInSeconds: 30 }
    );
    taskIds[judge.id] = data.taskId;
  }

  const results = {};
  for (const judge of JUDGES) {
    const task = await pollTask(taskIds[judge.id]);
    if (task.status === "failed") {
      results[judge.id] = { error: task.error?.message || "task failed" };
      continue;
    }
    const rawText = task.result?.data ?? task.result ?? "";
    try {
      results[judge.id] = await processAnalyzeResult(rawText, judge, PLATFORM, row.objective_long, videoDuration);
    } catch (e) {
      results[judge.id] = { error: `parse failed: ${e.message}` };
    }
  }
  return results;
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
        const v2 = await scoreVideoV2(row);
        done.push({ video_id: row.video_id, objective_long: row.objective_long, pegasus_model: row.pegasus_model, v2 });
        fs.writeFileSync(OUT_PATH, JSON.stringify(done));
        console.log(`[w${workerId}] video_id=${row.video_id} done in ${((Date.now() - t0) / 1000).toFixed(0)}s (${done.length}/${sample.length})`);
      } catch (e) {
        console.error(`[w${workerId}] video_id=${row.video_id} FAILED: ${e.message}`);
        done.push({ video_id: row.video_id, objective_long: row.objective_long, pegasus_model: row.pegasus_model, error: e.message });
        fs.writeFileSync(OUT_PATH, JSON.stringify(done));
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  console.log(`\nAll done. ${done.length} results -> ${OUT_PATH}`);
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
