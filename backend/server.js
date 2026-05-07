/**
 * PreviewPanel — Backend Server
 *
 * Stack: Node.js + Express
 * APIs: TwelveLabs (video understanding) + Anthropic (judge personas)
 *
 * Endpoints:
 *   POST /api/analyze       — upload file or URL, run all judges
 *   GET  /api/status/:jobId — poll job status during TwelveLabs processing
 *
 * Setup:
 *   npm install express cors multer @anthropic-ai/sdk twelvelabs dotenv
 *   node server.js
 */

import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import https from "https";
import Anthropic from "@anthropic-ai/sdk";
import { TwelveLabs } from "twelvelabs-js";
import pg from "pg";
import FormDataStream from "form-data";
import "dotenv/config";

const { Pool } = pg;

const execFileAsync = promisify(execFile);
const FFMPEG = fs.existsSync("/opt/homebrew/bin/ffmpeg")
  ? "/opt/homebrew/bin/ffmpeg"
  : fs.existsSync("/usr/local/bin/ffmpeg")
  ? "/usr/local/bin/ffmpeg"
  : "ffmpeg";

// ── Issue #3: 3-minute video limit ───────────────────────────
const MAX_VIDEO_DURATION_SECS = 300; // 5 minutes

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException] Unhandled exception — server will exit:", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection] Unhandled promise rejection:", reason);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Ensure uploads directory exists before multer tries to write to it
try {
  fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });
  console.log(`[startup] uploads dir ready: ${path.join(__dirname, "uploads")}`);
} catch (err) {
  console.error("[startup] Failed to create uploads dir:", err);
  process.exit(1);
}

const upload = multer({
  dest: path.join(__dirname, "uploads"),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB
  fileFilter: (_req, file, cb) => {
    console.log(`[multer] incoming file: ${file.originalname}, mimetype: ${file.mimetype}`);
    cb(null, true);
  },
});

app.use(cors());
app.use(express.json());

// ── Issue #1: Job Queue — process ONE job at a time to prevent OOM ──────────
let activeJob = null; // jobId of currently running pipeline
const jobQueue = []; // array of { jobId, fn } waiting to run

function enqueueJob(jobId, fn) {
  jobQueue.push({ jobId, fn });
  if (activeJob !== null) {
    console.log(`[queue] Job ${jobId} queued behind ${activeJob} — queue depth: ${jobQueue.length}`);
  }
  drainQueue();
}

const PIPELINE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes — covers ffmpeg + TwelveLabs upload only

async function drainQueue() {
  if (activeJob !== null) return; // already running something
  const next = jobQueue.shift();
  if (!next) return;
  activeJob = next.jobId;
  console.log(`[queue] Starting job ${next.jobId} — queue depth after: ${jobQueue.length}`);

  let timeoutHandle;
  const pipelineTimeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error("PIPELINE_TIMEOUT"));
    }, PIPELINE_TIMEOUT_MS);
  });

  try {
    await Promise.race([next.fn(), pipelineTimeout]);
  } catch (err) {
    const isTimeout = err.message === "PIPELINE_TIMEOUT";
    const timeoutMins = Math.round(PIPELINE_TIMEOUT_MS / 60000);
    console.error(`[queue] Job ${next.jobId} ${isTimeout ? `timed out after ${timeoutMins} minutes` : "threw: " + err.message}`);
    const tj = jobs[next.jobId];
    if (tj && !tj.finalized) {
      tj.status = "error";
      tj.error = isTimeout
        ? `Upload timed out after ${timeoutMins} minutes. Please try again with a smaller file or check your connection.`
        : err.message;
      tj.timings = tj.timings || {};
      tj.timings.totalMs = (Date.now() - (tj.createdAt || tj.startedAt || Date.now())) + (tj.timings.browserUploadMs || 0);
      // Fire-and-forget — sets finalized=true synchronously before first await,
      // so any concurrent runPipeline catch will see finalized and skip.
      recordSubmissionForJob(next.jobId, isTimeout ? "timeout" : "error");
    }
  } finally {
    clearTimeout(timeoutHandle);
    const releaseTime = new Date().toISOString();
    activeJob = null;
    console.log(`[queue] *** QUEUE SLOT FREED *** job=${next.jobId} at=${releaseTime} waiting=${jobQueue.length}`);
    drainQueue(); // pick up next job
  }
}

// ── Clients (lazy — initialized on first use so server starts without keys) ──
let _tl, _anthropic;
function tl() {
  if (!_tl) _tl = new TwelveLabs({ apiKey: process.env.TWELVELABS_API_KEY });
  return _tl;
}
function anthropic() {
  if (!_anthropic) _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// ── In-memory job store ───────────────────────────────────────
const jobs = {};

// ── Submission log — PostgreSQL if DATABASE_URL is set, else file ────────────
const SUBMISSIONS_PATH = path.join(__dirname, "submissions.ndjson");
let pgPool = null;

async function initDb() {
  console.log(`[db] DATABASE_URL present: ${!!process.env.DATABASE_URL}`);
  if (!process.env.DATABASE_URL) {
    console.log("[db] No DATABASE_URL — using file-based submission log");
    return;
  }
  console.log("[db] Connecting to PostgreSQL…");
  try {
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    console.log("[db] Pool created — testing connection…");
    await pgPool.query("SELECT 1");
    console.log("[db] Connection OK — creating table if needed…");
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS submissions (
        id            SERIAL PRIMARY KEY,
        job_id        TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        ip            TEXT,
        platform      TEXT,
        file_size_mb  NUMERIC,
        duration_secs NUMERIC,
        status        TEXT,
        total_ms      INTEGER,
        ffmpeg_ms     INTEGER,
        upload_ms     INTEGER,
        critic_ms     INTEGER,
        trendsetter_ms INTEGER,
        connector_ms  INTEGER,
        critic_score  NUMERIC,
        trendsetter_score NUMERIC,
        connector_score NUMERIC,
        avg_score     NUMERIC
      )
    `);
    await pgPool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS file_name TEXT`);
    await pgPool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS browser_upload_ms INTEGER`);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS analyze_tasks (
        id                  SERIAL PRIMARY KEY,
        job_id              TEXT NOT NULL,
        judge_id            TEXT NOT NULL,
        task_id             TEXT NOT NULL UNIQUE,
        status              TEXT DEFAULT 'pending',
        result              TEXT,
        error               TEXT,
        platform            TEXT,
        target_audience     TEXT,
        video_duration_secs NUMERIC,
        browser_upload_ms   INTEGER,
        file_name           TEXT,
        file_size_mb        NUMERIC,
        created_at          TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pgPool.query(`ALTER TABLE analyze_tasks ADD COLUMN IF NOT EXISTS browser_upload_ms INTEGER`);
    await pgPool.query(`ALTER TABLE analyze_tasks ADD COLUMN IF NOT EXISTS file_name TEXT`);
    await pgPool.query(`ALTER TABLE analyze_tasks ADD COLUMN IF NOT EXISTS file_size_mb NUMERIC`);
    await pgPool.query(`ALTER TABLE analyze_tasks ADD COLUMN IF NOT EXISTS ip TEXT`);
    await pgPool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS task_creation_ms INTEGER`);
    await pgPool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS queue_wait_ms INTEGER`);
    await pgPool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS tl_queue_ms INTEGER`);
    // Dimension score columns — universal (per judge, using display names)
    for (const judge of ["critic", "trendsetter", "connector"]) {
      for (const dim of ["hook_strength", "completion_likelihood", "share_save_worthiness"]) {
        await pgPool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ${judge}_${dim} NUMERIC`);
      }
    }
    // Rename dreamer_* columns to connector_* (judge rename: The Dreamer → The Connector)
    for (const col of ["ms", "score"]) {
      await pgPool.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='submissions' AND column_name='dreamer_${col}')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='submissions' AND column_name='connector_${col}') THEN
            ALTER TABLE submissions RENAME COLUMN dreamer_${col} TO connector_${col};
          END IF;
        EXCEPTION WHEN others THEN NULL;
        END $$
      `);
    }
    for (const dim of ["hook_strength", "completion_likelihood", "share_save_worthiness"]) {
      await pgPool.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='submissions' AND column_name='dreamer_${dim}')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='submissions' AND column_name='connector_${dim}') THEN
            ALTER TABLE submissions RENAME COLUMN dreamer_${dim} TO connector_${dim};
          END IF;
        EXCEPTION WHEN others THEN NULL;
        END $$
      `);
    }
    // Rename legacy cool_* columns to trendsetter_* if they exist and target doesn't
    for (const dim of ["hook_strength", "completion_likelihood", "share_save_worthiness"]) {
      await pgPool.query(`
        DO $$ BEGIN
          IF EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name='submissions' AND column_name='cool_${dim}')
          AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                          WHERE table_name='submissions' AND column_name='trendsetter_${dim}') THEN
            ALTER TABLE submissions RENAME COLUMN cool_${dim} TO trendsetter_${dim};
          END IF;
        EXCEPTION WHEN others THEN
          NULL;
        END $$
      `);
    }
    // Dimension score columns — platform-specific
    for (const col of [
      "tiktok_rewatch_potential", "tiktok_seo_strength",
      "instagram_dm_share_potential", "instagram_originality",
      "youtube_watch_time_potential", "youtube_thumbnail_hook",
    ]) {
      await pgPool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ${col} NUMERIC`);
    }
    // Remove legacy cool_* columns left over from before the cool→trendsetter rename
    for (const dim of ["hook_strength", "completion_likelihood", "share_save_worthiness"]) {
      await pgPool.query(`ALTER TABLE submissions DROP COLUMN IF EXISTS cool_${dim}`);
    }
    // Objective fit columns (9 new)
    for (const judge of ["critic", "trendsetter", "connector"]) {
      await pgPool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ${judge}_objective_fit_score INTEGER`);
      await pgPool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ${judge}_objective_fit_verdict TEXT`);
      await pgPool.query(`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS ${judge}_objective_fit_reasoning TEXT`);
    }
    // Ensure numeric columns aren't stranded as INTEGER from earlier deploys
    for (const col of [
      "avg_score",
      "critic_hook_strength", "critic_completion_likelihood", "critic_share_save_worthiness",
      "trendsetter_hook_strength", "trendsetter_completion_likelihood", "trendsetter_share_save_worthiness",
      "connector_hook_strength", "connector_completion_likelihood", "connector_share_save_worthiness",
      "tiktok_rewatch_potential", "tiktok_seo_strength",
      "instagram_dm_share_potential", "instagram_originality",
      "youtube_watch_time_potential", "youtube_thumbnail_hook",
    ]) {
      await pgPool.query(`
        DO $$ BEGIN
          ALTER TABLE submissions ALTER COLUMN ${col} TYPE NUMERIC USING ${col}::NUMERIC;
        EXCEPTION WHEN others THEN NULL;
        END $$
      `);
    }
    console.log("[db] PostgreSQL connected — submissions table ready");
  } catch (err) {
    console.error("[db] Failed to connect to PostgreSQL:", err.message);
    console.error("[db] Full error:", err);
    pgPool = null;
  }
}

async function loadSubmissionLog() {
  if (pgPool) {
    try {
      const { rows } = await pgPool.query(`
        SELECT job_id, created_at, ip, platform, file_size_mb, duration_secs, status,
               total_ms, ffmpeg_ms, upload_ms, browser_upload_ms,
               critic_ms, trendsetter_ms, connector_ms,
               critic_score, trendsetter_score, connector_score, avg_score,
               file_name, task_creation_ms, queue_wait_ms, tl_queue_ms
        FROM submissions ORDER BY created_at DESC LIMIT 500
      `);
      return rows.map(r => ({
        jobId: r.job_id,
        timestamp: r.created_at,
        ip: r.ip,
        platform: r.platform,
        fileName: r.file_name ?? null,
        fileSizeMB: r.file_size_mb != null ? parseFloat(r.file_size_mb) : null,
        videoDurationSecs: r.duration_secs != null ? parseFloat(r.duration_secs) : null,
        status: r.status,
        timings: {
          totalMs: r.total_ms,
          conversionMs: r.ffmpeg_ms,
          uploadMs: r.upload_ms,
          browserUploadMs: r.browser_upload_ms,
          taskCreationMs: r.task_creation_ms != null ? parseInt(r.task_creation_ms) : null,
          queueWaitMs: r.queue_wait_ms != null ? parseInt(r.queue_wait_ms) : null,
          tlQueueMs: r.tl_queue_ms != null ? parseInt(r.tl_queue_ms) : null,
          judges: {
            critic: r.critic_ms,
            cool: r.trendsetter_ms,
            connector: r.connector_ms,
          },
        },
        scores: {
          ...(r.critic_score != null ? { critic: parseFloat(r.critic_score) } : {}),
          ...(r.trendsetter_score != null ? { cool: parseFloat(r.trendsetter_score) } : {}),
          ...(r.connector_score != null ? { connector: parseFloat(r.connector_score) } : {}),
        },
        avgScore: r.avg_score != null ? parseFloat(r.avg_score) : null,
      }));
    } catch (err) {
      console.error("[db] Failed to load submissions:", err.message);
      return [];
    }
  }
  try {
    const lines = fs.readFileSync(SUBMISSIONS_PATH, "utf8").split("\n").filter(Boolean);
    return lines.map(l => JSON.parse(l)).reverse();
  } catch { return []; }
}

// Safe integer coercion — rounds floats, passes null through
function toInt(val) { return val == null ? null : Math.round(Number(val)); }

async function saveSubmission(entry) {
  if (pgPool) {
    const d = entry.dimensions || {};
    const baseValues = [
      entry.jobId, entry.ip, entry.platform, entry.fileSizeMB, entry.videoDurationSecs, entry.status,
      toInt(entry.timings.totalMs), toInt(entry.timings.conversionMs), toInt(entry.timings.uploadMs), toInt(entry.timings.browserUploadMs),
      toInt(entry.timings.judges.critic), toInt(entry.timings.judges.cool), toInt(entry.timings.judges.connector),
      entry.scores.critic ?? null, entry.scores.cool ?? null, entry.scores.connector ?? null,
      entry.avgScore, entry.fileName ?? null,
      toInt(entry.timings.taskCreationMs), toInt(entry.timings.queueWaitMs), toInt(entry.timings.tlQueueMs),
    ];
    const fullValues = [
      ...baseValues,
      toInt(d.critic_hook_strength), toInt(d.critic_completion_likelihood), toInt(d.critic_share_save_worthiness),
      toInt(d.trendsetter_hook_strength), toInt(d.trendsetter_completion_likelihood), toInt(d.trendsetter_share_save_worthiness),
      toInt(d.connector_hook_strength), toInt(d.connector_completion_likelihood), toInt(d.connector_share_save_worthiness),
      toInt(d.tiktok_rewatch_potential), toInt(d.tiktok_seo_strength),
      toInt(d.instagram_dm_share_potential), toInt(d.instagram_originality),
      toInt(d.youtube_watch_time_potential), toInt(d.youtube_thumbnail_hook),
      toInt(d.critic_objective_fit_score), d.critic_objective_fit_verdict ?? null, d.critic_objective_fit_reasoning ?? null,
      toInt(d.trendsetter_objective_fit_score), d.trendsetter_objective_fit_verdict ?? null, d.trendsetter_objective_fit_reasoning ?? null,
      toInt(d.connector_objective_fit_score), d.connector_objective_fit_verdict ?? null, d.connector_objective_fit_reasoning ?? null,
    ];
    console.log(`[db] INSERT submissions — job=${entry.jobId} status=${entry.status} browser_upload_ms=${entry.timings.browserUploadMs} total_ms=${entry.timings.totalMs}`);
    console.log(`[db] Dimensions — critic_hook=${d.critic_hook_strength ?? "null"}, critic_completion=${d.critic_completion_likelihood ?? "null"}, trendsetter_hook=${d.trendsetter_hook_strength ?? "null"}, connector_hook=${d.connector_hook_strength ?? "null"}`);
    try {
      await pgPool.query(`
        INSERT INTO submissions
          (job_id, ip, platform, file_size_mb, duration_secs, status,
           total_ms, ffmpeg_ms, upload_ms, browser_upload_ms,
           critic_ms, trendsetter_ms, connector_ms,
           critic_score, trendsetter_score, connector_score, avg_score,
           file_name, task_creation_ms, queue_wait_ms, tl_queue_ms,
           critic_hook_strength, critic_completion_likelihood, critic_share_save_worthiness,
           trendsetter_hook_strength, trendsetter_completion_likelihood, trendsetter_share_save_worthiness,
           connector_hook_strength, connector_completion_likelihood, connector_share_save_worthiness,
           tiktok_rewatch_potential, tiktok_seo_strength,
           instagram_dm_share_potential, instagram_originality,
           youtube_watch_time_potential, youtube_thumbnail_hook,
           critic_objective_fit_score, critic_objective_fit_verdict, critic_objective_fit_reasoning,
           trendsetter_objective_fit_score, trendsetter_objective_fit_verdict, trendsetter_objective_fit_reasoning,
           connector_objective_fit_score, connector_objective_fit_verdict, connector_objective_fit_reasoning)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
                $22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,
                $37,$38,$39,$40,$41,$42,$43,$44,$45)
      `, fullValues);
      return;
    } catch (err) {
      console.error(`[db] Full INSERT failed — code=${err.code} message=${err.message}`);
      if (err.code === "42703") {
        console.warn(`[db] Dimension columns missing in schema — retrying with base 21-column INSERT`);
        try {
          await pgPool.query(`
            INSERT INTO submissions
              (job_id, ip, platform, file_size_mb, duration_secs, status,
               total_ms, ffmpeg_ms, upload_ms, browser_upload_ms,
               critic_ms, trendsetter_ms, connector_ms,
               critic_score, trendsetter_score, connector_score, avg_score,
               file_name, task_creation_ms, queue_wait_ms, tl_queue_ms)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
          `, baseValues);
          console.log(`[db] Base INSERT succeeded (no dimension columns) — job=${entry.jobId}`);
          return;
        } catch (fallbackErr) {
          console.error(`[db] Base INSERT also failed — code=${fallbackErr.code} message=${fallbackErr.message}`);
        }
      }
    }
  }
  try { fs.appendFileSync(SUBMISSIONS_PATH, JSON.stringify(entry) + "\n"); } catch (e) { console.warn("[log] Failed to write submission to disk:", e.message); }
}

async function saveAnalyzeTask(jobId, judgeId, taskId, platform, targetAudience, videoDurationSecs) {
  if (!pgPool) return;
  const job = jobs[jobId];

  // Full INSERT including optional columns added in schema migration
  const fullSql = `INSERT INTO analyze_tasks (job_id, judge_id, task_id, platform, target_audience, video_duration_secs, browser_upload_ms, file_name, file_size_mb, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`;
  const fullValues = [
    jobId, judgeId, taskId, platform, targetAudience, videoDurationSecs ?? null,
    job?.timings?.browserUploadMs ?? null, job?.fileName ?? null, job?.fileSizeMB ?? null,
    job?.ip ?? null,
  ];

  // Fallback INSERT using only original columns — works even if migration hasn't run
  const baseSql = `INSERT INTO analyze_tasks (job_id, judge_id, task_id, platform, target_audience, video_duration_secs) VALUES ($1,$2,$3,$4,$5,$6)`;
  const baseValues = [jobId, judgeId, taskId, platform, targetAudience, videoDurationSecs ?? null];

  try {
    await pgPool.query(fullSql, fullValues);
    console.log(`[db] Saved analyze task (full) — job=${jobId} judge=${judgeId} taskId=${taskId}`);
  } catch (err) {
    console.error(`[db] saveAnalyzeTask full INSERT failed — code=${err.code} message=${err.message} detail=${err.detail ?? ""}`);
    if (err.code === "42703") {
      // 42703 = undefined_column — schema migration hasn't run yet, fall back to base columns
      console.warn(`[db] Schema missing optional columns — retrying with base INSERT (run ALTER TABLE migration in Neon)`);
      try {
        await pgPool.query(baseSql, baseValues);
        console.log(`[db] Saved analyze task (base fallback) — job=${jobId} judge=${judgeId} taskId=${taskId}`);
      } catch (fallbackErr) {
        console.error(`[db] saveAnalyzeTask base INSERT also failed — code=${fallbackErr.code} message=${fallbackErr.message}`);
      }
    }
  }
}

async function loadInFlightTasks() {
  if (!pgPool) return [];
  try {
    const { rows } = await pgPool.query(`
      SELECT job_id, judge_id, task_id, platform, target_audience, video_duration_secs,
             browser_upload_ms, file_name, file_size_mb, ip, created_at
      FROM analyze_tasks WHERE status = 'pending'
    `);
    return rows;
  } catch (err) {
    console.error(`[db] Failed to load in-flight tasks: ${err.message}`);
    return [];
  }
}

const submissionLog = [];

// ── Shared guardrails injected into every judge prompt ────────
const GUARDRAILS = `
STRICT EXCLUSIONS — you must NEVER suggest changes related to physical appearance, attractiveness, body type, clothing that reveals skin, or any factor outside the creator's direct control over their content. Focus exclusively on: script structure, hook strength, pacing, editing choices, audio quality, lighting choices, on-screen text, thumbnails, titles, and delivery style.

CONTENT GUARDRAILS — you must NEVER provide suggestions that would encourage, normalize, or improve the effectiveness of offensive speech, hate speech, discriminatory language, violence, or the display or promotion of weapons including guns. If the video contains any of these elements, note it as a significant negative factor in the score and suggest removing or replacing that content rather than optimizing it.

SCORING — Your scores must reflect genuine quality differences. Use the FULL range of the scale. A video of someone walking across a street with nothing interesting happening: 1–2. A randomly filmed clip with no intent or craft: 2–3. Poor execution of a decent idea: 3–4. Mediocre but watchable: 5. Decent but needs work: 6. Good: 7. Strong: 8. Excellent: 8–9. Exceptional or viral-worthy: 9–10. Do NOT cluster around 7. If it is genuinely bad, say 1–4. If it is genuinely great, say 8–10. Be honest.`;

// ── Issue #10 & #12: Detect video type and calibrate review length ─────────
function buildVideoContext(videoDuration) {
  const secs = videoDuration?.secs || 0;

  // Estimate richness by duration as a proxy
  // Judges will also be told to calibrate based on what they actually see
  let videoType = "standard";
  let lengthGuidance = "";

  if (secs <= 15) {
    videoType = "very_short";
    lengthGuidance = `\nVIDEO LENGTH — Very short clip (under 15 seconds). Be brief and proportional. Reaction: 1 sentence. Positives: maximum 1–2 sentences — be selective, name only the single strongest craft or performance signal that genuinely helps this video, do not list everything that works. Delivery: 1 sentence. Content: 1 sentence. Platform fit: 1 sentence. Suggestions: 1–2 maximum, each one sentence. Do not pad. If there is almost nothing in it, say so briefly and score accordingly.`;
  } else if (secs <= 60) {
    videoType = "short";
    lengthGuidance = `\nVIDEO LENGTH — Short video (under 60 seconds). Keep all feedback tight. Reaction: 1–2 sentences. Positives: maximum 2 sentences — be selective, name only the strongest 1–2 craft or performance signals that genuinely help this video, do not list everything that works. Delivery: 1–2 sentences. Content: 1–2 sentences. Platform fit: 1 sentence. Suggestions: 2–3 maximum, each 1–2 sentences. Do not repeat yourself across fields.`;
  } else if (secs <= 180) {
    videoType = "medium";
    lengthGuidance = `\nVIDEO LENGTH — Medium video (1–3 minutes). Full feedback is appropriate. Reaction: 2–3 sentences. Positives: maximum 3 sentences — be selective, name only the strongest 1–2 craft or performance signals that genuinely help this video, do not list everything that works. Delivery: 1–2 sentences. Content: 1–2 sentences. Platform fit: 1–2 sentences. Suggestions: 3–4 maximum, each 1–2 sentences. Stay focused — do not repeat the same point across multiple fields.`;
  } else {
    videoType = "long";
    lengthGuidance = `\nVIDEO LENGTH — Longer video (3–5 minutes). There is more to analyze but be selective — comment only on what genuinely stands out. Reaction: 2–3 sentences. Positives: maximum 3–4 sentences — be selective, name only the strongest 1–2 craft or performance signals that genuinely help this video, do not list everything that works. Delivery: 2 sentences. Content: 2 sentences. Platform fit: 1–2 sentences. Suggestions: 4–5 maximum, each 1–2 sentences. Prioritize the most impactful observations over comprehensive coverage.`;
  }

  return { videoType, lengthGuidance };
}

// ── Issue #10: Content-type awareness ────────────────────────
const CONTENT_TYPE_GUIDANCE = `
IMPORTANT — VIDEO CONTENT TYPE: Before reviewing, identify what kind of video this actually is:
- TALKING/VLOG: Creator speaks directly to camera, narrates, explains, or interviews. Hook, delivery, and script quality matter most.
- AESTHETIC/VIBES: Minimal or no talking. Visual style, music choice, editing rhythm, and mood are the primary craft elements. Do NOT critique the absence of a spoken hook — that is not the format.
- TUTORIAL/HOWTO: Demonstrates a skill or process. Clarity, pacing, and information density matter most.
- ENTERTAINMENT/COMEDY: Relies on timing, reaction, or surprise. Evaluate on those terms, not vlog terms.
Adapt your entire review to the actual format you observe. Do not apply vlog criteria to a vibes video.`;

// ── Judge definitions ─────────────────────────────────────────
const JUDGES = [
  {
    id: "critic",
    name: "The Editor",
    personality:
      "You are The Editor — sharp-eyed, direct, and focused on craft. You think like a seasoned video editor reviewing a cut before it goes live. You are not negative, but you are honest and precise. You notice what's working and what's not, and you express both with equal clarity. You do not sugarcoat, but you do not pile on either — your job is to make the video better, not to tear it down. You care deeply about editing craft: pacing, cuts, transitions, audio levels, on-screen text, captions, music choices, and the specific moments where editing elevates or undermines the content. When something is well-edited, you call it out specifically and explain why it works. When editing could improve the video, you give concrete actionable suggestions using the tools and functions available in common editing apps. Your positives are specific and craft-focused: you name the exact thing that works and why it matters for viewer retention or performance. " +
      "When acknowledging something that works, be precise and structural — name exactly what works and why it matters technically. Never use filler phrases like 'I'll give credit where it's due.' Just say what works, directly.",
    momentsInstruction:
      "MOMENTS — identify the timestamps that genuinely matter TO YOU as The Editor.\n" +
      "Look specifically for: editing cuts that land or jar, pacing shifts (positive or negative), moments where argumentation or structure impresses or collapses, delivery peaks or valleys, and missed opportunities where a better editor would have made a different cut.\n" +
      "Flag only moments that expose something real about craft or execution. If you find 5 problems, list 5. If only 2 stand out, list 2 — do not pad.\n" +
      "For each moment: use only timestamps you actually observed (no estimates, no evenly-spaced intervals).\n" +
      "Classify each from YOUR lens: \"peak\" = execution that works even by your high standards, \"drop\" = a craft or pacing failure you'd cut in the edit, \"note\" = a structural choice worth flagging but not catastrophic.",
  },
  {
    id: "cool",
    name: "The Trendsetter",
    personality:
      "You are The Trendsetter — platform-native, trend-aware, detached, and experienced. " +
      "You evaluate through the lens of what actually performs on social video platforms. " +
      "You have seen every format and trend. You care about virality signals, hook strength, " +
      "scroll-stopping moments, and whether the delivery style matches the platform. " +
      "You always frame feedback relative to what creators at this level typically produce — " +
      "your job is to help them outperform their own average, not chase unrealistic benchmarks. " +
      "When something is genuinely on-trend or culturally savvy, you call it out with enthusiasm — you're discerning, not easily impressed, but you recognise when a creator is tapping into what's actually working right now. " +
      "When something is genuinely on-trend, call it out specifically — name the trend, the platform behavior, or the audience signal it taps into. Never repeat stock phrases. Every positive observation should be specific to this video.",
    momentsInstruction:
      "MOMENTS — identify the timestamps that genuinely matter TO YOU as The Trendsetter.\n" +
      "Look specifically for: the opening hook (does it stop the scroll?), moments that are shareable or would drive a stitch/duet, audio sync points, places where the creator follows or breaks platform format conventions, and any moment that would make someone send this to a friend.\n" +
      "Flag only moments with real scroll-stopping or sharing potential — or moments that kill that potential. The count should reflect what's actually there, not a quota.\n" +
      "For each moment: use only timestamps you actually observed (no estimates, no evenly-spaced intervals).\n" +
      "Classify each from YOUR lens: \"peak\" = scroll-stopping or share-worthy, \"drop\" = scroll-away risk or format miss, \"note\" = a platform signal worth flagging either way.",
  },
  {
    id: "connector",
    name: "The Connector",
    personality:
      "You are The Connector — emotionally perceptive, human-first, and attuned to the moments in a video that create genuine personal resonance. Your core question is not whether this content will go viral, but whether it creates a moment of real human recognition — the feeling that makes someone think of a specific person in their life and need to share it with them. You watch video the way a real person watches it, not as a strategist tracking signals but as a human being noticing what lands and what doesn't. You are looking for: moments of authentic personality that make a viewer feel they know the creator; emotional beats specific enough to remind someone of their own life or relationships; vulnerability, humor, or surprise that breaks through the scroll and feels genuinely personal rather than performed; and the quiet details that create intimacy — a real laugh, an unscripted reaction, a moment of honest feeling. You understand that human resonance is what drives the deepest engagement signals — content gets passed between people not because it is trending but because it touched something true. When you find a moment of genuine connection, you describe it specifically and warmly — naming the exact detail that creates the feeling and why it matters for how real people will experience this video. Your positives celebrate authentic human moments. Your suggestions help the creator find or amplify the moments of genuine connection that are already there, or identify what is missing that would make a viewer feel seen.",
    momentsInstruction:
      "MOMENTS — identify the timestamps that genuinely matter TO YOU as The Connector.\n" +
      "Look specifically for: moments of authentic personality that make the viewer feel they know the creator, emotional beats specific enough to remind someone of their own life, a real laugh or unscripted reaction, a moment of vulnerability or honest feeling, a quiet detail that creates intimacy, or a moment that breaks the emotional spell and feels performed or distant.\n" +
      "Quality over quantity — 2 truly felt moments beat 5 surface observations. Only flag timestamps that created real human recognition or its absence.\n" +
      "For each moment: use only timestamps you actually observed (no estimates, no evenly-spaced intervals).\n" +
      "Classify each from YOUR lens: \"peak\" = genuine human connection, authentic personality, or a moment someone would DM to a specific person, \"drop\" = a moment that feels performed, distant, or breaks emotional intimacy, \"note\" = a choice that affects how personally the video lands.",
  },
];

// ── Platform focus areas and performance metrics ──────────────
const PLATFORM_FOCUS = {
  youtube: {
    signals: "hook strength at 0:00–0:30, mid-video retention, chapter structure, CTA placement, thumbnail and title alignment, pacing, on-camera energy, and eye contact",
    metrics: "watch time (average view duration and percentage), click-through rate on the thumbnail/title, and subscriber conversion from new viewers",
  },
  tiktok: {
    signals: "first 2–3 second hook, loop-ability, audio sync, trend alignment, on-screen text clarity, comment and share triggers, and pacing",
    metrics: "completion rate (watched to end), shares and stitches, and follows generated from this video",
  },
  instagram: {
    signals: "aesthetic cohesion, first-frame grab, audio selection, caption quality, cover frame appeal, and brand consistency",
    metrics: "saves (strongest signal of value), shares to Stories, and profile visits that lead to follows",
  },
};

// ── Per-judge bottom section: clip (Editor) / hashtags (Trendsetter) / captions (Connector) ──
function buildBottomSection(judge, platform) {
  if (judge.id === "critic") {
    return {
      instruction: `\nCLIPPING — If the video is over 45 seconds and contains strong standalone moments, suggest up to two clip candidates if two genuinely strong options exist. Only suggest a second clip if it is meaningfully different from the first — different moment, different emotional tone, or targets a different audience. If only one strong clip exists, suggest one. If none exist, omit entirely. Think like a film editor — each clip must have a clear in-point and out-point, work without context, have a visual hook in its first 2 seconds, and perform well as a standalone short. Describe each moment visually in 2-3 words so the creator can find it even if the timestamp is approximate. Return as an array: "clips": [{ "start": "M:SS", "end": "M:SS", "label": "2-3 word visual description", "reason": "1 sentence on why this moment works as a standalone short" }] with 1 or 2 items.`,
      format: `,\n  "clips": [{ "start": "<M:SS>", "end": "<M:SS>", "label": "<2-3 word visual description>", "reason": "<1 sentence>" }]`,
    };
  }
  if (judge.id === "cool") {
    if (platform === "tiktok" || platform === "instagram") {
      return {
        instruction: `\nHASHTAGS — Suggest exactly 5 hashtags ranging from obvious/high-volume to creative/niche. Strategy:\n- Start with the most searchable tags that match what this video is obviously about\n- If the video features a specific brand, product, sports team, athlete, city, neighborhood, landmark, or recognizable scene — include that as one hashtag\n- End with 2 more creative or unexpected tags that could help the video find a unique audience — the last 2 should not be the obvious choice but would attract exactly the right viewer\n- Choose hashtags people actually search, not generic ones like "video" or "content"\n- Base them entirely on what you actually observe in the video — do not invent content\nInclude them in the JSON as a "hashtags" array of exactly 5 strings (without the # symbol).`,
        format: `,\n  "hashtags": ["<hashtag1>", "<hashtag2>", "<hashtag3>", "<hashtag4>", "<hashtag5>"]`,
      };
    }
    return { instruction: "", format: "" };
  }
  // connector — caption suggestions
  return {
    instruction: `\nCAPTIONS — Suggest 2-3 post caption options that feel genuinely human and personally resonant — the kind of caption that makes a specific person feel seen. Each should be distinct in tone: Emotional (speaks directly to a feeling or human truth), Conversational (sounds like how the creator naturally talks to a friend), Curiosity (creates a personal hook that makes someone think "wait, that's me"). Each caption under 150 characters and feel native to the platform. These are post captions, not on-screen text. Include 1-2 emojis where they feel natural and warm — particularly in Emotional and Conversational tones. Emojis should feel organic — not forced or decorative. Never use emojis just to fill space — only include them when they genuinely strengthen the caption.`,
    format: `,\n  "captions": [{ "tone": "Emotional", "text": "<caption text>" }, { "tone": "Conversational", "text": "<caption text>" }, { "tone": "Curiosity", "text": "<caption text>" }]`,
  };
}

// ── Build per-judge prompt sent to TwelveLabs Pegasus ────────
function formatTimestamp(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function buildTLPrompt(judge, platform, objective, videoDuration) {
  const pf = PLATFORM_FOCUS[platform] || PLATFORM_FOCUS.youtube;
  const durationLine = videoDuration
    ? `\nVIDEO DURATION — This video is ${videoDuration.label} long. You MUST ONLY reference timestamps between 0:00 and ${videoDuration.label}. Do NOT reference any timestamp beyond this duration.\nTIMESTAMP NOTE — Timestamps are approximate (within 1-2 seconds due to encoding). Reference the general moment, not the exact frame.`
    : "";

  const { videoType, lengthGuidance } = buildVideoContext(videoDuration);
  const { instruction: bottomInstruction, format: bottomFormat } = buildBottomSection(judge, platform);

  // Platform-specific dimension definitions
  let platformDimensionDefs = "";
  let platformDimensionFormat = "";
  if (platform === "tiktok") {
    platformDimensionDefs = `\n- rewatch_potential (1-10): Does the video loop well or reward rewatching?\n- seo_strength (1-10): Are keywords present in captions, on-screen text, or spoken audio?`;
    platformDimensionFormat = `,\n    "rewatch_potential": <1-10>,\n    "seo_strength": <1-10>`;
  } else if (platform === "instagram") {
    platformDimensionDefs = `\n- dm_share_potential (1-10): Specifically, would someone DM this to a friend?\n- originality (1-10): Does this feel like fresh original content?`;
    platformDimensionFormat = `,\n    "dm_share_potential": <1-10>,\n    "originality": <1-10>`;
  } else {
    platformDimensionDefs = `\n- watch_time_potential (1-10): Would viewers watch this for significant absolute time?\n- thumbnail_hook (1-10): Does the first frame work as an effective thumbnail?`;
    platformDimensionFormat = `,\n    "watch_time_potential": <1-10>,\n    "thumbnail_hook": <1-10>`;
  }

  // Judge-specific dimension feedback instructions
  let dimensionFeedback = "";
  if (judge.id === "critic") {
    dimensionFeedback = `DIMENSION FEEDBACK REQUIREMENTS — Your feedback must explicitly address: (1) the hook — what works or doesn't in the first 3 seconds, and what specific edit would strengthen it; (2) pacing — identify specific moments where energy drops or value-per-second is low, and suggest concrete edits; (3) share-worthiness — is there a moment in this video someone would DM to a friend, and if not, what edit would create one. These three must appear in your suggestions with specific, actionable editing recommendations tied to the research above.`;
  } else if (judge.id === "cool") {
    dimensionFeedback = `DIMENSION FEEDBACK REQUIREMENTS — Your feedback must explicitly address: (1) the hook against platform norms — does it meet the bar for this platform's scroll speed? (2) completion signals — does the pacing match what performs on this platform (TikTok: tight 5-8s blocks; Instagram: strong story arc under 90s; YouTube: compelling value delivery over 2+ minutes)? (3) the share/save trigger — is there a clear moment that would make someone hit save or DM it? Name the specific moment if it exists, or suggest what would create one. Reference specific platform algorithm factors when relevant — e.g. TikTok SEO keywords, Instagram DM share signals, YouTube watch time.`;
  } else {
    dimensionFeedback = `DIMENSION FEEDBACK REQUIREMENTS — Your feedback must address: (1) Human hook — does the first 3 seconds create a moment of genuine personal recognition or emotional curiosity, beyond just information or trend? Name what works or what is missing. (2) The recognition moment — is there a specific moment in this video that would make a viewer think of someone they know and want to share it? Name that moment exactly if it exists, or suggest what edit would create it. This is different from virality — it is the moment of "oh my god, [name] needs to see this." (3) Authenticity read — does the creator's genuine personality come through, or does the video feel performed and distant? Be specific about the moments that feel real versus produced. (4) Emotional arc — does the video create a feeling that builds and pays off, or does it start and end at the same emotional register with no movement?`;
  }

  const objReasoningLength = { very_short: "1 sentence", short: "1 sentence", medium: "1–2 sentences", long: "2 sentences" }[videoType] || "1–2 sentences";

  const judgeLens = judge.id === "critic"
    ? `As The Editor, evaluate whether the craft serves the objective. Did the editing choices — pacing, cuts, structure, timing — actively support delivery of the objective? A comedy objective demands tight timing and precise cuts; a tutorial objective demands clear pacing and information density. Score how well the craft execution fulfills the creator's stated intent.`
    : judge.id === "cool"
    ? `As The Trendsetter, evaluate whether the objective lands in a platform-native way. Does it hit the format, timing, and conventions that make this type of content perform on this platform right now? Score whether the objective is executed in a way that would actually work here — not just attempted.`
    : `As The Connector, evaluate whether the objective creates genuine emotional resonance. Did it land at a human level — did it actually produce the feeling the objective intends (laughter, warmth, curiosity, awe)? Score whether a real person watching would feel what the video is trying to make them feel.`;

  const objectiveLens = objective ? `

OBJECTIVE FIT — REQUIRED EVALUATION
The creator has set this video's objective as: "${objective}". You must evaluate whether this video succeeds at this objective. This is a required top-level output field — not optional commentary.

YOUR EVALUATION LENS:
${judgeLens}

SCORING — use the full range honestly:
1–3: Clear miss — a viewer would not recognise this as a successful ${objective} video
4–6: Partial — some elements work but it falls short in critical ways
7–9: Hits — delivers on the objective with clear success
10: Nails it — exceptional; a textbook example of the objective done right

VERDICT: Set verdict to exactly one of: "hits" (score 7–10), "partial" (score 4–6), or "misses" (score 1–3).

REACTION REQUIREMENT: If verdict is "misses" or "partial", your reaction field must name the objective and state the failure directly — not in subtext, not buried in suggestions. Example: "As a comedy video, this doesn't land — the setup takes too long and the punchline is too soft." Do not soften this into generic feedback. For a "hits" verdict, integrate the objective naturally into your reaction — don't lead with a verdict declaration.

REASONING: Write ${objReasoningLength} for the objective_fit.reasoning field, explaining your score in your own voice and referencing specific moments from the video where possible.

CATEGORY PERFORMANCE CONTEXT — Apply this category-specific knowledge when scoring all dimensions (not just objective_fit), since the creator's objective changes what predicts performance:
If objective is 'ASMR': Audio quality and sensory immersion replace fast pacing as the primary completion signal. Hook is about immediate sensory reward, not pattern interrupt. Share-worthiness comes from creating a 'this is so relaxing' reaction. Harsh cuts, loud sounds, or abrupt transitions are significant negatives. Score audio quality heavily.
If objective is 'Funny Videos/Comedy': Hook score should heavily weight the speed of setup. Completion likelihood depends entirely on whether the punchline lands and lands fast. Share-worthiness is the primary signal — comedy is the most DM-shared content type. Timing precision matters more than any other category. A joke that takes 10 seconds to set up when it could take 3 is a critical pacing failure.
If objective is 'Food & Drinks/Cooking': Close-up shots and satisfying reveals are the visual hook. Save rate is extremely high in this category so save-worthiness should be weighted higher than average. Completion is driven by whether the recipe payoff is clearly promised and delivered. Appetite appeal in the visuals is a primary quality signal.
If objective is 'Dancing': The first movement IS the hook — score it accordingly. Audio sync is a primary quality signal; any drift between movement and beat is a significant negative. Loop-ability is especially valuable. Energy and precision in the movement are the completion drivers.
If objective is 'Fitness/Wellness': Transformation framing and energy in the hook predict performance. Before/after structure maximizes completion pull. Clear, achievable-looking results in the hook are the strongest signal. Motivation and relatability of the creator's energy matter heavily.
If objective is 'Educational/How-To': The hook must clearly promise the answer or solution — viewers click for information, not entertainment. Completion is almost entirely driven by whether that promise is kept. Saves are very high in this category — content that is reference-worthy scores higher. Clarity of explanation is a primary quality signal.
If objective is 'Travel': Visual wonder in the first frame is the hook — a stunning location shot outperforms a talking head opener in this category. Destination reveal moments are the peak share triggers. Pacing should build to visual payoffs. Audio and music choice matter more than average.
If objective is 'Fashion': Visual aesthetic consistency is a primary quality signal. Hook should establish the look immediately — outfit reveal moments are the strongest share triggers. Styling transitions and outfit changes are high-completion drivers. On-screen text naming brands or items significantly boosts saves.
If objective is 'Makeup/Beauty': Tutorial clarity and transformation reveal are the completion drivers. Hook should tease the final look. Saves are extremely high in this category. Product clarity (what products are used, shown clearly) is a save trigger. Before/after structure performs best.
If objective is 'Pets/Animals': The hook should feature the animal immediately — delayed animal appearances lose viewers fast. Surprise, cuteness, and unexpected behavior are the primary share triggers. Short clips (under 30 seconds) often outperform longer ones in this category. Emotional reaction (from creator or implied) amplifies shareability.
If objective is 'Gaming': Hook should feature the most impressive or surprising gameplay moment — not setup or menu screens. Commentary clarity and energy match to gameplay intensity are completion drivers. Clip-ability within the video is valuable — strong standalone moments for clipping.
If objective is 'Storytelling': Narrative tension in the first 3 seconds is the hook — open loops and cliffhangers are the primary completion driver. The payoff must feel earned. Emotional authenticity is the share trigger. Pacing should build — unlike other categories, a slow build can work if tension is maintained.
If objective is 'Life Hacks': Hook must immediately demonstrate the problem being solved — viewers must self-identify as having the problem within 3 seconds. Wow factor of the solution is the share trigger. Saves are extremely high — weight save-worthiness heavily. Clarity and speed of demonstration drive completion.
If objective is 'Fun Facts': Hook must deliver the fact immediately or tease it with a curiosity gap. Re-watch potential is high if the fact is surprising enough. Share-worthiness is the primary signal. On-screen text reinforcing the fact significantly improves retention and saves.
If objective is 'Shopping': Product reveal and visual appeal in the first frame are the hook. Try-on moments and reaction shots are the strongest share triggers. Saves indicate purchase intent — weight save-worthiness heavily. Clear product display and pricing signals drive completion.
If objective is 'Cars/Automotive': Visual drama of the vehicle in motion is the hook. Sound design and engine audio are quality signals specific to this category. Spec moments and performance reveals are the share triggers. Enthusiast authenticity matters — overly produced content can feel inauthentic to this audience.
If objective is 'Myth Busting': Hook must state the myth immediately and clearly — viewers must recognize the myth within 3 seconds. The reveal/result is the completion driver — tease it but don't give it away. Share-worthiness comes from the surprise of the result. Evidence clarity and credibility of the debunk are primary quality signals.
If objective is 'Aesthetic/Vibes': Visual cohesion and color palette are primary quality signals. Music choice is critical — it sets the emotional tone immediately. Hook is about creating an immediate mood, not information. Loop-ability is high-value in this category. Share-worthiness comes from aspirational or mood-matching reactions.
If objective is 'Business/Finance': Hook must immediately quantify the value — a dollar amount, percentage, or specific result in the first 3 seconds performs best. Saves are extremely high — weight save-worthiness heavily as this is reference content. Credibility signals (specific numbers, evidence, credentials) drive completion. Relatability of the financial situation described determines self-identification in the hook.
For any custom objective not listed above, apply equivalent category-specific logic based on what would make that type of content perform well — what is the hook signal, what drives completion, what triggers shares and saves.` : "";

  const editingCraftBlock = `
EDITING CRAFT — Pay attention to the editing of this video. Note specific editing choices that help or hurt the video's performance: cuts, pacing, transitions, caption style and placement, on-screen text, background music choice and volume, sound effects, zoom-ins, speed changes (fast-forward or slow-mo), overlays, stickers, animations, and effects. Where editing works well, name the specific moment and technique. Where editing could be improved, give a concrete actionable suggestion — for example: 'Cut the 8-second pause at 0:23', 'Add a zoom-in at 0:15 when the product is revealed', 'Lower the background music volume during the spoken section', 'Add captions in bold white text with a subtle drop shadow for accessibility and retention', 'Speed up the setup section to 1.5x', 'Add a sound effect at the transition at 0:10'. Suggest specific caption text where relevant. Focus on editing changes that would meaningfully improve watchability and audience retention, not editing for its own sake.${judge.id === "critic" ? "\nEditing craft is your primary lens. Use at least half your suggestions field for specific editing improvements. Lead with editing observations in your delivery field before covering other aspects of presentation." : ""}`;

  return `${judge.personality}
${GUARDRAILS}${durationLine}${lengthGuidance}

${CONTENT_TYPE_GUIDANCE}

EVIDENCE-BASED PERFORMANCE RESEARCH — Your scoring and feedback must be grounded in what research and platform data show actually predicts video performance. Key findings you must incorporate:

UNIVERSAL ACROSS PLATFORMS:
- The first 3 seconds are the single most critical factor. 65-71% of viewers decide here whether to continue. A strong hook uses one of: pattern interrupt (something unexpected), curiosity gap (tease without revealing), bold claim, direct question to viewer, or immediate visual movement/action. No slow builds, no intros, no logos — get to the point instantly.
- Pacing and value-per-second: edit with a 'value-per-second' mindset. Think in 5-8 second content blocks, each delivering new information, emotional payoff, or visual novelty. Dead air and slow sections are retention killers.
- Share/save worthiness: the strongest algorithmic signals are shares (especially DM shares on Instagram) and saves — not likes. Ask yourself: would someone DM this to a friend? Would someone save it to rewatch? Content that answers this yes gets distributed. Content that only gets passive likes does not.
- Completion rate: all platforms reward videos people watch to the end. TikTok's viral threshold is now ~70% completion. Anything that causes early drop-off — weak hook, slow middle, unclear payoff — is algorithmically penalized regardless of other quality.

TIKTOK-SPECIFIC:
- Completion rate and watch time account for 40-50% of TikTok's algorithm weight.
- Saves and shares now outweigh likes as engagement signals.
- Re-watch potential is highly valued — loop-ability (seamless end-to-start) is a meaningful advantage.
- TikTok SEO: keywords in captions, on-screen text, and spoken audio are all scanned. Captions with searchable keywords dramatically improve discovery.
- Optimal length: 42-60 seconds has the best combined engagement and views. 2-minute videos also perform well for the right content. Very short clips under 10 seconds underperform.
- Niche consistency matters more than ever in 2026 — videos are first tested with followers before reaching new audiences.

INSTAGRAM REELS-SPECIFIC:
- Top 3 ranking factors (confirmed by Adam Mosseri, Instagram head): watch time, likes per reach, and DM shares. DM shares are weighted 3-5x higher than likes.
- 94% of Instagram distribution comes from AI recommendations — content that gets skipped in the first 3 seconds gets buried regardless of follower count.
- Optimal length: 30-90 seconds for discovery. Under 30 seconds has highest completion. Over 3 minutes is ineligible for recommendations.
- Original content received 40-60% reach increases in late 2025. Watermarked or reposted content is suppressed.
- Your last 9-12 posts determine topic categorization — niche consistency is algorithmically penalized if broken.
- Saves signal 'content worth revisiting' and are a strong distribution trigger.

YOUTUBE-SPECIFIC:
- Watch time is the primary signal — both relative (percentage watched) and absolute (minutes watched).
- Best combined performance: 2-3 minute videos for Shorts. Viewers stick with longer content if the value is clear from the start.
- The hook determines click-through and initial retention. Thumbnails and first frame matter before a viewer even clicks.
- Re-watch and session depth (viewer watches multiple videos in a session) are strong signals.
${objectiveLens}

DIMENSION SCORING — Score the following dimensions (1-10 each), then compute your overall score as a weighted average:
UNIVERSAL DIMENSIONS:
- hook_strength (1-10): How well does the first 3 seconds grab attention and prevent scrolling?
- completion_likelihood (1-10): How likely is a viewer to watch to the end based on pacing, value-per-second, and structure?
- share_save_worthiness (1-10): How likely is someone to share via DM or save to rewatch?
PLATFORM-SPECIFIC DIMENSIONS for ${platform.toUpperCase()}:${platformDimensionDefs}
OVERALL WEIGHTING: hook_strength + completion_likelihood together ≈ 35%, share_save_worthiness ≈ 25%, platform-specific dimensions share the remaining ≈ 40%. When the CATEGORY PERFORMANCE CONTEXT above applies, adjust these weights per that guidance.

You are reviewing this video BEFORE it is published on ${platform.toUpperCase()}.
For ${platform.toUpperCase()}, pay special attention to: ${pf.signals}.

Your score and feedback must explicitly connect to the platform metrics that matter most here: ${pf.metrics}.

${dimensionFeedback}

Analyze BOTH:
1. DELIVERY — how the video is presented: energy, pacing, body language, eye contact,
   on-camera presence, editing rhythm, audio quality, visual style, and on-screen text
2. CONTENT — what is said or shown: script quality, hook strength, information value,
   narrative structure, and call to action
${editingCraftBlock}

${judge.momentsInstruction}
${bottomInstruction}

SUGGESTIONS — Give 3-5 specific actionable suggestions. Each suggestion must: (1) reference a specific timestamp or moment, (2) explain WHY it matters for performance based on the platform's algorithm signals (completion, shares, hook strength, etc.), and (3) give the specific edit — not just 'improve the hook' but 'cut the first 4 seconds and open instead with the moment at 0:08 when X happens, which immediately establishes Y.' At least one suggestion must address hook strength. At least one must address completion/pacing. At least one must address share or save potential. Editing suggestions should use CapCut-compatible techniques where relevant.

POSITIVES — When identifying positives, connect them to performance signals where possible — not just 'good energy' but 'the energy in the first 3 seconds creates a strong hook that should clear the 70% completion threshold on TikTok' or 'the payoff at 0:45 is exactly the kind of moment people DM to friends, which is Instagram's strongest algorithmic signal.' Be specific about WHY the positive matters for this video's actual performance.

You are one of three judges reviewing this video. Each judge must identify a DIFFERENT genuine strength — focus on an aspect the other judges are less likely to notice given your unique lens. Do not manufacture praise; only include positives that are genuinely present in the video.

Provide your analysis in this exact JSON format (no markdown, no backticks):
{
  "overall": <integer 1-10 — weighted average of your dimension scores>,
  "dimensions": {
    "hook_strength": <1-10>,
    "completion_likelihood": <1-10>,
    "share_save_worthiness": <1-10>${platformDimensionFormat}
  },
  "reaction": "<gut reaction in first person — 1 sentence for short/empty videos, 2-3 for longer ones>",
  "positives": "<genuine praise connected to performance signals — specific, content-focused, never about appearance. Omit this field entirely if there is nothing genuine to praise>",
  "delivery": "<how the video is delivered — scale length to video richness>",
  "content": "<what is said or shown — scale length to video richness>",
  "platformFit": "<fit for ${platform} specifically, referencing ${pf.metrics}>",
  "moments": [
    { "timestamp": "<exact timestamp you observed>", "type": "peak|drop|note", "note": "<your observation>" }
  ],
  "suggestions": [
    "<specific actionable improvement — timestamp, why it matters for algorithm signals, and the exact edit>"
  ]${bottomFormat}${objective ? `,\n  "objective_fit": {\n    "score": <integer 1–10>,\n    "verdict": "hits|partial|misses",\n    "reasoning": "<explanation in your voice>"\n  }` : ""}
}`;
}

// ── ffmpeg conversion ─────────────────────────────────────────────────────────
async function probeCodecs(filePath) {
  // Use `ffmpeg -i` (guaranteed available) rather than ffprobe (separate binary,
  // not always installed). ffmpeg -i exits with code 1 when no output is given,
  // but writes full stream info to stderr — we catch the error and parse stderr.
  async function runProbe() {
    try {
      await execFileAsync(FFMPEG, ["-i", filePath]);
      // ffmpeg exited 0 — no streams detected (treat as unknown)
      console.warn(`[ffprobe] ffmpeg -i exited 0 — no stream info in stderr`);
      return { video: null, audio: null };
    } catch (err) {
      const stderr = err.stderr || "";
      const videoMatch = stderr.match(/Stream #\S+: Video: (\w+)/);
      const audioMatch = stderr.match(/Stream #\S+: Audio: (\w+)/);
      const video = videoMatch?.[1] ?? null;
      const audio = audioMatch?.[1] ?? null;
      if (video === null && audio === null) {
        console.warn(`[ffprobe] No stream match in stderr — first 300 chars: ${stderr.slice(0, 300)}`);
      }
      return { video, audio };
    }
  }

  let result = await runProbe();
  if (result.video === null && result.audio === null) {
    console.warn(`[ffprobe] Both codecs null — retrying once after 200ms`);
    await new Promise(r => setTimeout(r, 200));
    result = await runProbe();
    if (result.video === null && result.audio === null) {
      console.warn(`[ffprobe] Retry also returned null — will default to full re-encode`);
    }
  }
  console.log(`[ffprobe] final result: video=${result.video ?? "null"} audio=${result.audio ?? "null"}`);
  return result;
}

async function convertToMp4(inputPath, { preProbed = null, forceReencode = false } = {}) {
  const outputPath = inputPath + ".mp4";
  const t0 = Date.now();

  const { video: vcodec, audio: acodec } = preProbed || await probeCodecs(inputPath);

  // Only stream-copy codecs confirmed compatible with MP4 — anything else gets re-encoded.
  // forceReencode overrides when a stream-copied HEVC file was rejected by TwelveLabs.
  const copyVideo = !forceReencode && (vcodec === "h264" || vcodec === "hevc" || vcodec === "h265");
  const copyAudio = acodec === "aac";

  const args = ["-i", inputPath];
  // -fflags +genpts regenerates presentation timestamps — only needed when re-encoding
  // (CFR normalization changes timing). Pure stream copy preserves original PTS and is
  // much faster without it (140-400ms vs 1000-3600ms).
  if (!copyVideo || !copyAudio) {
    args.push("-fflags", "+genpts");
  }
  if (copyVideo) {
    args.push("-c:v", "copy");
  } else {
    args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "32", "-vf", "scale=854:-2");
  }
  if (copyAudio) {
    args.push("-c:a", "copy");
  } else {
    args.push("-c:a", "aac", "-b:a", "96k");
  }
  args.push("-vsync", "cfr", "-movflags", "+faststart", "-threads", "1", "-y", outputPath);

  const mode = forceReencode ? "H264 re-encode (HEVC fallback)"
    : copyVideo && copyAudio ? "stream copy"
    : copyVideo ? "copy video, re-encode audio"
    : "full re-encode";
  const why = forceReencode ? "forced after HEVC rejection"
    : !copyVideo && !vcodec ? "video codec unknown"
    : !copyVideo ? `video codec '${vcodec}' not stream-copyable`
    : !copyAudio ? `audio codec '${acodec ?? "unknown"}' not AAC`
    : "both codecs copyable";
  console.log(`[ffmpeg] ${path.basename(inputPath)} — detected video=${vcodec ?? "null"} audio=${acodec ?? "null"} → ${mode} (${why})`);

  await execFileAsync(FFMPEG, args);
  const elapsed = Date.now() - t0;
  const timeStr = elapsed < 2000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`;
  const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
  const isStreamCopy = copyVideo && copyAudio && !forceReencode;
  console.log(`[ffmpeg] ${isStreamCopy ? "Stream copy" : "Re-encode"}: ${timeStr} — ${sizeMB} MB — mode: ${mode}`);
  return outputPath;
}

// ── Get video duration via ffmpeg -i stderr parsing ───────────────────────────
async function getVideoDuration(filePath) {
  try {
    await execFileAsync(FFMPEG, ["-i", filePath]);
  } catch (err) {
    const stderr = err.stderr || "";
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (match) {
      const secs = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
      if (secs > 0) {
        console.log(`[ffmpeg] Duration: ${secs.toFixed(1)}s`);
        return { secs, label: formatTimestamp(secs) };
      }
    }
  }
  console.warn(`[ffmpeg] Could not read duration`);
  return null;
}

// ── Step 1: Build a VideoContext for the TwelveLabs analyze call ─────────────
async function getVideoContext(videoUrl, filePath) {
  if (videoUrl) {
    console.log(`[TwelveLabs] Using supplied URL as video context`);
    return { type: "url", url: videoUrl };
  }
  if (filePath) {
    const assetId = await uploadAssetDirect(filePath);
    return { type: "asset_id", assetId };
  }
  throw new Error("No video source provided");
}

async function uploadAssetDirect(filePath) {
  const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
  console.log(`[TwelveLabs] Uploading asset: ${filePath} (${sizeMB} MB) — streaming to avoid memory spike…`);
  const t0 = Date.now();

  // Stream directly from disk — avoids loading the full file into memory
  const form = new FormDataStream();
  form.append("method", "direct");
  form.append("file", fs.createReadStream(filePath), path.basename(filePath));

  const responseBody = await new Promise((resolve, reject) => {
    const req = https.request({
      method: "POST",
      hostname: "api.twelvelabs.io",
      path: "/v1.3/assets",
      headers: { "x-api-key": process.env.TWELVELABS_API_KEY, ...form.getHeaders() },
      timeout: 600_000,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch (e) { reject(new Error(`TwelveLabs upload: failed to parse response — ${e.message}`)); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("TwelveLabs upload timed out")); });
    form.pipe(req);
  });

  if (responseBody.status >= 400) {
    throw new Error(`TwelveLabs asset upload failed: HTTP ${responseBody.status} — ${JSON.stringify(responseBody.body)}`);
  }

  const assetId = responseBody.body._id;
  if (!assetId) throw new Error(`TwelveLabs asset upload returned no _id: ${JSON.stringify(responseBody.body)}`);

  console.log(`[TwelveLabs] Asset uploaded in ${((Date.now() - t0) / 1000).toFixed(1)}s — assetId: ${assetId}`);
  return assetId;
}

// ── Parse raw TwelveLabs text into structured judge result ─────
async function processAnalyzeResult(rawText, judge, platform, objective, videoDuration) {
  // If the SDK already deserialized the result into an object, use it directly
  if (rawText !== null && typeof rawText === "object") {
    console.log(`[TwelveLabs][${judge.id}] result already deserialized — keys:`, Object.keys(rawText));
    validateObjectiveFit(rawText, judge.id, objective);
    return applyMomentFilters(rawText, judge, videoDuration);
  }

  const clean = String(rawText || "").replace(/```json|```/g, "").trim();
  console.log(`[TwelveLabs][${judge.id}] raw text type=${typeof rawText}, length=${clean.length}, first 500 chars:`, clean.slice(0, 500));

  try {
    const parsed = JSON.parse(clean);
    console.log(`[TwelveLabs][${judge.id}] JSON parsed OK — keys:`, Object.keys(parsed));
    if (parsed.dimensions) {
      console.log(`[TwelveLabs][${judge.id}] dimensions received:`, JSON.stringify(parsed.dimensions));
    } else {
      console.warn(`[TwelveLabs][${judge.id}] WARNING: no dimensions field in parsed result — top-level keys: ${Object.keys(parsed).join(", ")}`);
    }
    validateObjectiveFit(parsed, judge.id, objective);
    return applyMomentFilters(parsed, judge, videoDuration);
  } catch (parseErr) {
    console.error(`[TwelveLabs][${judge.id}] JSON parse FAILED: ${parseErr.message}`);
    console.error(`[TwelveLabs][${judge.id}] Full raw text (${clean.length} chars): ${clean.slice(0, 2000)}`);
    if (clean.length > 2000) console.error(`[TwelveLabs][${judge.id}] ...truncated (${clean.length - 2000} more chars)`);

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        console.log(`[TwelveLabs][${judge.id}] Attempting Claude fallback to structure raw text`);
        return await structureWithClaude(clean, judge, platform);
      } catch (claudeErr) {
        console.error(`[TwelveLabs][${judge.id}] Claude fallback also failed: ${claudeErr.message}`);
      }
    }

    return {
      overall: null,
      reaction: "This judge was unable to complete analysis. Please try again.",
      positives: "", delivery: "", content: "", platformFit: "", relativeInsight: "",
      moments: [], suggestions: [], objective_fit: null,
    };
  }
}

function validateObjectiveFit(parsed, judgeId, objective) {
  if (!objective) return;
  const of = parsed.objective_fit;
  if (!of) {
    console.warn(`[TwelveLabs][${judgeId}] OBJECTIVE_FIT MISSING — judge skipped required field despite objective "${objective}" being set`);
    return;
  }
  const scoreOk = typeof of.score === "number" && of.score >= 1 && of.score <= 10;
  const verdictOk = ["hits", "partial", "misses"].includes(of.verdict);
  const reasoningOk = typeof of.reasoning === "string" && of.reasoning.trim().length > 0;
  if (!scoreOk || !verdictOk || !reasoningOk) {
    console.warn(`[TwelveLabs][${judgeId}] OBJECTIVE_FIT MALFORMED — score=${of.score} verdict=${of.verdict} reasoning_present=${reasoningOk}`);
  } else {
    console.log(`[TwelveLabs][${judgeId}] objective_fit OK — score=${of.score} verdict=${of.verdict}`);
  }
}

function applyMomentFilters(parsed, judge, videoDuration) {
  if (parsed.moments?.length) {
    const tsToSecs = ts => { const p = String(ts).split(":").map(Number); return p.length === 2 ? p[0]*60+p[1] : p[0]; };
    if (videoDuration?.secs) {
      const before = parsed.moments.length;
      parsed.moments = parsed.moments.filter(m => tsToSecs(m.timestamp) <= videoDuration.secs + 2);
      if (parsed.moments.length < before) console.log(`[TwelveLabs][${judge.id}] Dropped ${before - parsed.moments.length} out-of-range moments`);
    }
    parsed.moments.sort((a, b) => tsToSecs(a.timestamp) - tsToSecs(b.timestamp));
  }
  const momentTypes = (parsed.moments || []).map(m => `${m.timestamp}:${m.type}`).join(", ");
  console.log(`[TwelveLabs][${judge.id}] moment types:`, momentTypes || "(none)");
  return parsed;
}

// ── Create an async TwelveLabs analysis task, return taskId ────
async function createAnalyzeTask(videoContext, judge, platform, objective, videoDuration) {
  const prompt = buildTLPrompt(judge, platform, objective, videoDuration);

  // Verify the SDK method chain exists before calling
  const tlClient = tl();
  console.log(`[TwelveLabs] SDK check — typeof analyzeAsync: ${typeof tlClient.analyzeAsync}, typeof analyzeAsync.tasks: ${typeof tlClient.analyzeAsync?.tasks}, typeof analyzeAsync.tasks.create: ${typeof tlClient.analyzeAsync?.tasks?.create}`);
  console.log(`[TwelveLabs] Creating async task — judge: ${judge.id}, videoContext: ${JSON.stringify(videoContext)}`);

  // HttpResponsePromise.then() unwraps to data directly — await resolves to the
  // CreateAnalyzeTaskResponse object itself, not { data, rawResponse }.
  let data;
  try {
    data = await tlClient.analyzeAsync.tasks.create(
      { video: videoContext, prompt, temperature: 0.3, maxTokens: 4096 },
      { timeoutInSeconds: 30 }
    );
  } catch (err) {
    console.error(`[TwelveLabs] analyzeAsync.tasks.create FAILED — judge: ${judge.id}`);
    console.error(`[TwelveLabs] Error name: ${err.name}, message: ${err.message}`);
    console.error(`[TwelveLabs] Error status: ${err.statusCode ?? err.status ?? "n/a"}`);
    console.error(`[TwelveLabs] Error body: ${JSON.stringify(err.body ?? err.error ?? {})}`);
    console.error(`[TwelveLabs] videoContext passed: ${JSON.stringify(videoContext)}`);
    console.error(`[TwelveLabs] Full error stack:`, err.stack ?? err);
    throw err;
  }

  console.log(`[TwelveLabs] Task created — judge: ${judge.id}, taskId: ${data.taskId}, status: ${data.status}, raw: ${JSON.stringify(data)}`);
  return data.taskId;
}

// ── Fallback: Claude structures raw TwelveLabs prose ─────────
async function structureWithClaude(rawAnalysis, judge, platform) {
  const msg = await anthropic().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: `You are ${judge.name}. ${judge.personality}`,
    messages: [
      {
        role: "user",
        content: `Here is a raw video analysis. Convert it into this exact JSON structure
(no markdown, no backticks). Infer reasonable timestamp estimates if not provided.

Raw analysis:
${rawAnalysis}

Required JSON format:
{
  "overall": <integer 1-10>,
  "reaction": "<2-3 sentence gut reaction in first person>",
  "delivery": "<2-3 sentences on delivery>",
  "content": "<2-3 sentences on content>",
  "platformFit": "<2 sentences on platform fit for ${platform}>",
  "moments": [{"timestamp": "0:00", "note": "..."}],
  "timelinePoints": [{"timestamp": "0:00", "position": 0, "type": "peak|drop|note", "note": "..."}],
  "suggestions": ["...", "...", "..."]
}`,
      },
    ],
  });

  const text = msg.content.map((b) => b.text || "").join("");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
}

// ── POST /api/analyze ─────────────────────────────────────────
app.post("/api/analyze", (req, res, next) => {
  const t_request = Date.now();
  console.log(`[upload] Request received — starting multer file parse`);
  upload.single("video")(req, res, (err) => {
    if (err) {
      console.error(`[upload] Multer error:`, err.message);
      return res.status(400).json({ error: err.message });
    }
    req.browserUploadMs = Date.now() - t_request;
    const fileSizeMB = req.file ? (req.file.size / 1024 / 1024) : null;
    if (req.file && fileSizeMB != null) {
      const secs = req.browserUploadMs / 1000;
      const mbps = secs > 0 ? (fileSizeMB / secs).toFixed(2) : "?";
      const slow = parseFloat(mbps) < 0.5 ? " — likely slow network" : "";
      console.log(`[upload] ${req.file.originalname} — ${fileSizeMB.toFixed(1)}MB in ${secs.toFixed(0)}s = ${mbps} MB/s${slow}`);
    } else {
      console.log(`[upload] Multer done — file: ${req.file?.originalname ?? "none"}, browser upload: ${req.browserUploadMs}ms`);
    }
    next();
  });
}, async (req, res) => {
  try {
    const {
      videoUrl,
      platform = "youtube",
      objective = "",
      judges: judgesParam,
    } = req.body;

    const filePath = req.file?.path;

    if (!videoUrl && !filePath) {
      return res.status(400).json({ error: "Provide a videoUrl or upload a file" });
    }

    const selectedJudgeIds = judgesParam
      ? JSON.parse(judgesParam)
      : ["critic", "cool", "connector"];
    const selectedJudges = JUDGES.filter((j) => selectedJudgeIds.includes(j.id));

    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Issue #1: Report queue position to client
    const queuePosition = jobQueue.length + (activeJob !== null ? 1 : 0);

    jobs[jobId] = {
      status: queuePosition > 0 ? "queued" : "uploading",
      queuePosition,
      platform,
      objective,
      results: {},
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      timings: { conversionMs: null, uploadMs: null, browserUploadMs: req.browserUploadMs ?? null, judges: {} },
      ip: (() => { const xff = req.headers["x-forwarded-for"] || ""; const fromXff = xff.split(",").map(s => s.trim()).find(Boolean); return fromXff || req.socket?.remoteAddress || "unknown"; })(),
      fileSizeMB: req.file ? parseFloat((req.file.size / 1024 / 1024).toFixed(2)) : null,
      fileName: req.file?.originalname ?? null,
      browserUploadMs: req.browserUploadMs ?? null,
    };

    console.log(`[${jobId}] Job created — queue position: ${queuePosition}, browser_upload_ms: ${req.browserUploadMs ?? "null"} — sending jobId to client`);
    res.json({ jobId, queuePosition });

    // ── Preprocess file outside the queue ─────────────────────────────────────
    // All ffmpeg work happens here, before enqueueJob, so the queue slot is held
    // only for the short TwelveLabs upload + task creation phase (~2-3s per job).
    if (filePath) {
      let preprocessedPath = null;
      try {
        // 1. Raw size check — instant stat, no ffmpeg
        const rawSizeMB = fs.statSync(filePath).size / 1024 / 1024;
        console.log(`[${jobId}] Raw file: ${jobs[jobId].fileName || "unknown"} — ${rawSizeMB.toFixed(1)} MB`);
        if (rawSizeMB > 1024) {
          jobs[jobId].status = "error";
          jobs[jobId].error = "File too large to process. Please use a video under 1GB.";
          console.log(`[${jobId}] Rejected — raw file too large: ${rawSizeMB.toFixed(1)}MB`);
          fs.unlink(filePath, () => {});
          await recordSubmissionForJob(jobId, "rejected_too_large");
          return;
        }

        // 2. Duration check on raw file — reads headers, no encode
        const rawDuration = await getVideoDuration(filePath);
        if (rawDuration && rawDuration.secs > MAX_VIDEO_DURATION_SECS) {
          jobs[jobId].status = "error";
          jobs[jobId].error = `Video is ${rawDuration.label} long. PreviewPanel currently supports videos up to 5:00. Please trim your video and try again.`;
          console.log(`[${jobId}] Rejected — video too long: ${rawDuration.label}`);
          fs.unlink(filePath, () => {});
          await recordSubmissionForJob(jobId, "rejected_too_long");
          return;
        }
        if (rawDuration && rawDuration.secs < 4) {
          jobs[jobId].status = "error";
          jobs[jobId].error = "Video is too short. Please use a video that is at least 4 seconds long.";
          console.log(`[${jobId}] Rejected — video too short: ${rawDuration.label}`);
          fs.unlink(filePath, () => {});
          await recordSubmissionForJob(jobId, "rejected_too_short");
          return;
        }

        // 3. Codec detect + first-pass convert
        const inputCodecs = await probeCodecs(filePath);
        const isHEVC = inputCodecs.video === "hevc" || inputCodecs.video === "h265";
        const t_conv = Date.now();
        preprocessedPath = await convertToMp4(filePath, { preProbed: inputCodecs });
        jobs[jobId].timings.conversionMs = Date.now() - t_conv;

        // 4. Second compression pass if over 150MB
        let convertedSizeMB = fs.statSync(preprocessedPath).size / 1024 / 1024;
        if (convertedSizeMB > 150) {
          const inputSizeMB = convertedSizeMB;
          const pass2Path = preprocessedPath + ".pass2.mp4";
          const t_conv2 = Date.now();
          await execFileAsync(FFMPEG, [
            "-i", preprocessedPath,
            "-c:v", "libx264", "-preset", "ultrafast", "-crf", "35", "-vf", "scale=640:-2",
            "-c:a", "aac", "-b:a", "96k",
            "-vsync", "cfr", "-movflags", "+faststart", "-threads", "2", "-y", pass2Path,
          ]);
          const pass2Ms = Date.now() - t_conv2;
          jobs[jobId].timings.conversionMs = (jobs[jobId].timings.conversionMs || 0) + pass2Ms;
          fs.unlink(preprocessedPath, () => {});
          preprocessedPath = pass2Path;
          convertedSizeMB = fs.statSync(preprocessedPath).size / 1024 / 1024;
          console.log(`[ffmpeg] Second pass: ${inputSizeMB.toFixed(1)}MB → ${convertedSizeMB.toFixed(1)}MB in ${(pass2Ms / 1000).toFixed(1)}s (ultrafast, 640p, crf35)`);
        }

        // 5. Hard reject if still too large after all passes
        if (convertedSizeMB > 190) {
          jobs[jobId].status = "error";
          jobs[jobId].error = "Your video is too large after processing. Please reduce the video quality or length before uploading.";
          console.log(`[${jobId}] Rejected — converted file too large: ${convertedSizeMB.toFixed(1)}MB`);
          fs.unlink(filePath, () => {});
          fs.unlink(preprocessedPath, () => {});
          await recordSubmissionForJob(jobId, "rejected_too_large");
          return;
        }

        // 6. Read converted duration — authoritative for TwelveLabs timestamps
        const convertedDuration = await getVideoDuration(preprocessedPath);
        if (convertedDuration) {
          const origSecs = rawDuration?.secs ?? null;
          console.log(`[ffmpeg] Duration — original: ${origSecs != null ? origSecs.toFixed(1) + "s" : "unknown"}, converted: ${convertedDuration.secs.toFixed(1)}s`);
          if (origSecs != null && Math.abs(convertedDuration.secs - origSecs) > 2) {
            console.warn(`[ffmpeg] Warning: duration mismatch of ${Math.abs(convertedDuration.secs - origSecs).toFixed(1)}s between original and converted file`);
          }
          jobs[jobId].videoDuration = convertedDuration;
        }

        // Store for runPipeline — original file kept until after TwelveLabs upload (HEVC fallback)
        jobs[jobId].preProcessedPath = preprocessedPath;
        jobs[jobId].inputCodecs = inputCodecs;
        jobs[jobId].isHEVC = isHEVC;
        jobs[jobId].originalFilePath = filePath;
        jobs[jobId].preprocessedAt = Date.now();
        console.log(`[${jobId}] Preprocessing complete — enqueuing for TwelveLabs upload`);
      } catch (err) {
        jobs[jobId].status = "error";
        jobs[jobId].error = err.message;
        console.error(`[${jobId}] Preprocessing error: ${err.message}`, err);
        fs.unlink(filePath, () => {});
        if (preprocessedPath) fs.unlink(preprocessedPath, () => {});
        await recordSubmissionForJob(jobId, "error");
        return;
      }
    }

    // Queue slot held only for TwelveLabs upload + task creation (~2-3s per job)
    enqueueJob(jobId, () =>
      runPipeline(jobId, videoUrl, platform, objective, selectedJudges)
    );
  } catch (err) {
    console.error(`[analyze] Unexpected error:`, err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── Upload phase pipeline (queue slot held only during this) ──────────────────
// Preprocessing (ffmpeg) already completed before this is called — this function
// only handles TwelveLabs upload + async task creation (~2-3s of queue time).
async function runPipeline(jobId, videoUrl, platform, objective, selectedJudges) {
  console.log(`[${jobId}] Pipeline starting — platform: ${platform}, judges: ${selectedJudges.map(j=>j.id).join(", ")}`);
  jobs[jobId].startedAt = Date.now();
  const queueWaitMs = jobs[jobId].preprocessedAt
    ? jobs[jobId].startedAt - jobs[jobId].preprocessedAt
    : jobs[jobId].startedAt - (jobs[jobId].createdAt || jobs[jobId].startedAt);
  jobs[jobId].timings.queueWaitMs = queueWaitMs;
  console.log(`[${jobId}] Queue wait (post-preprocessing): ${queueWaitMs}ms (${(queueWaitMs / 1000).toFixed(1)}s)`);

  // Read preprocessing results stored by the /api/analyze handler
  let activeConvertedPath = jobs[jobId].preProcessedPath || null;
  const inputCodecs = jobs[jobId].inputCodecs || null;
  const isHEVC = jobs[jobId].isHEVC || false;
  const filePath = jobs[jobId].originalFilePath || null;
  const videoDuration = jobs[jobId].videoDuration || null;

  try {
    jobs[jobId].status = "uploading";
    console.log(`[${jobId}] Step 1: uploading to TwelveLabs`);

    const t_upload = Date.now();
    let videoContext;
    try {
      videoContext = await getVideoContext(videoUrl, activeConvertedPath || filePath);
    } catch (uploadErr) {
      if (isHEVC && activeConvertedPath && filePath) {
        // HEVC stream copy rejected by TwelveLabs — re-encode to H264
        console.log(`[${jobId}] HEVC upload rejected (${uploadErr.message}) — re-encoding to H264`);
        fs.unlink(activeConvertedPath, () => {});
        const t_conv2 = Date.now();
        activeConvertedPath = await convertToMp4(filePath, { preProbed: inputCodecs, forceReencode: true });
        jobs[jobId].timings.conversionMs = (jobs[jobId].timings.conversionMs || 0) + (Date.now() - t_conv2);
        videoContext = await getVideoContext(videoUrl, activeConvertedPath);
      } else {
        throw uploadErr;
      }
    }
    jobs[jobId].timings.uploadMs = Date.now() - t_upload;

    // Local files no longer needed — TwelveLabs holds the asset
    if (filePath) fs.unlink(filePath, () => {});
    if (activeConvertedPath) fs.unlink(activeConvertedPath, () => {});

    if (jobs[jobId].finalized) {
      // Pipeline timeout fired during upload
      console.log(`[${jobId}] Cancelled by pipeline timeout — aborting before task creation`);
      return;
    }

    jobs[jobId].status = "analyzing";
    for (const judge of selectedJudges) {
      jobs[jobId].results[judge.id] = { status: "pending" };
    }

    // ── Fire-and-forget task creation ────────────────────────────────────────
    // Does NOT block runPipeline from returning — queue slot releases immediately.
    // The IIFE runs after the current call stack unwinds (next event loop tick).
    const _videoDuration = videoDuration;
    const _videoContext = videoContext;
    (async () => {
      const t_tasks_start = Date.now();
      console.log(`[${jobId}] Step 2: creating async TwelveLabs tasks${_videoDuration ? ` — duration: ${_videoDuration.label}` : ""}`);
      try {
        const taskCreations = await Promise.allSettled(
          selectedJudges.map(async judge => {
            const taskId = await createAnalyzeTask(_videoContext, judge, platform, objective, _videoDuration);
            await saveAnalyzeTask(jobId, judge.id, taskId, platform, objective, _videoDuration?.secs ?? null);
            return { judgeId: judge.id, taskId };
          })
        );

        if (jobs[jobId]?.finalized) {
          console.log(`[${jobId}] Job was finalized during task creation (timeout?) — discarding`);
          return;
        }

        const taskCreationMs = Date.now() - t_tasks_start;
        if (jobs[jobId]) {
          jobs[jobId].timings.taskCreationMs = taskCreationMs;
          jobs[jobId].tasksCreatedAt = Date.now();
        }
        console.log(`[${jobId}] task_creation_ms=${taskCreationMs} — tasks created and saved to Neon`);

        let tasksCreated = 0;
        for (let i = 0; i < taskCreations.length; i++) {
          const creation = taskCreations[i];
          const judge = selectedJudges[i];
          if (creation.status === "rejected") {
            const errMsg = creation.reason?.message || "Failed to create analysis task";
            console.error(`[${jobId}] Task creation failed for ${judge.id}: ${errMsg}`);
            if (jobs[jobId]) {
              jobs[jobId].results[judge.id] = {
                status: "error", error: errMsg,
                data: { overall: null, reaction: "This judge was unable to complete analysis. Please try again.", positives: "", delivery: "", content: "", platformFit: "", relativeInsight: "", moments: [], suggestions: [], objective_fit: null },
              };
            }
          } else {
            tasksCreated++;
          }
        }
        console.log(`[${jobId}] ${tasksCreated}/${selectedJudges.length} tasks created — poller will complete job`);
        if (tasksCreated === 0) {
          if (jobs[jobId]) {
            const j = jobs[jobId];
            j.timings.totalMs = (Date.now() - (j.createdAt || j.startedAt || Date.now())) + (j.timings.browserUploadMs || 0);
          }
          await recordSubmissionForJob(jobId, "error");
        } else {
          // Some judges may have failed task creation — settle them immediately
          await checkJobCompletion(jobId);
        }
      } catch (err) {
        console.error(`[${jobId}] Task creation error: ${err.message}`);
        if (jobs[jobId] && !jobs[jobId].finalized) {
          const j = jobs[jobId];
          j.timings.totalMs = (Date.now() - (j.createdAt || j.startedAt || Date.now())) + (j.timings.browserUploadMs || 0);
        }
        await recordSubmissionForJob(jobId, "error");
      }
    })();

    // runPipeline returns here — queue slot is released NOW, before tasks are created
    console.log(`[${jobId}] Upload phase done — returning to release queue slot, tasks creating in background`);

  } catch (err) {
    const j = jobs[jobId];
    j.timings.totalMs = (Date.now() - (j.createdAt || j.startedAt || Date.now())) + (j.timings.browserUploadMs || 0);
    jobs[jobId].status = "error";
    jobs[jobId].error = err.message;
    console.error(`[${jobId}] Pipeline error: ${err.message}`, err);
    if (filePath) fs.unlink(filePath, () => {});
    if (activeConvertedPath) fs.unlink(activeConvertedPath, () => {});
    await recordSubmissionForJob(jobId, "error");
  }
}

// ── Module-level submission recorder (used by pipeline + poller) ──────────────
async function recordSubmissionForJob(jobId, finalStatus) {
  const job = jobs[jobId] || {};
  if (job.finalized) return;
  job.finalized = true;
  const scores = {};
  let scoreSum = 0, scoreCount = 0;
  const dimensions = {};
  const platDimSums = {};
  const platDimCounts = {};
  const PLAT_DIM_PREFIX = {
    rewatch_potential: "tiktok", seo_strength: "tiktok",
    dm_share_potential: "instagram", originality: "instagram",
    watch_time_potential: "youtube", thumbnail_hook: "youtube",
  };
  for (const [id, r] of Object.entries(job.results || {})) {
    if (r.status === "done" && r.data?.overall) {
      scores[id] = r.data.overall;
      scoreSum += r.data.overall;
      scoreCount++;
    }
    if (r.status === "done") {
      if (r.data?.dimensions) {
        console.log(`[${jobId}] [db] Judge ${id} dimensions from result:`, JSON.stringify(r.data.dimensions));
      } else {
        console.warn(`[${jobId}] [db] Judge ${id} done but NO dimensions field — r.data keys: ${Object.keys(r.data || {}).join(", ")}`);
      }
    }
    if (r.status === "done" && r.data?.dimensions) {
      const d = r.data.dimensions;
      // Map internal judge id "cool" → display column name "trendsetter"
      const colPrefix = id === "cool" ? "trendsetter" : id;
      for (const key of ["hook_strength", "completion_likelihood", "share_save_worthiness"]) {
        if (d[key] != null) dimensions[`${colPrefix}_${key}`] = Number(d[key]);
      }
      for (const [key, prefix] of Object.entries(PLAT_DIM_PREFIX)) {
        if (d[key] != null) {
          platDimSums[key] = (platDimSums[key] || 0) + Number(d[key]);
          platDimCounts[key] = (platDimCounts[key] || 0) + 1;
        }
      }
    }
    if (r.status === "done" && r.data?.objective_fit) {
      const colPrefix = id === "cool" ? "trendsetter" : id;
      const of = r.data.objective_fit;
      if (of.score != null) dimensions[`${colPrefix}_objective_fit_score`] = toInt(of.score);
      if (of.verdict) dimensions[`${colPrefix}_objective_fit_verdict`] = of.verdict;
      if (of.reasoning) dimensions[`${colPrefix}_objective_fit_reasoning`] = of.reasoning;
    }
  }
  for (const [key, prefix] of Object.entries(PLAT_DIM_PREFIX)) {
    if (platDimCounts[key]) {
      dimensions[`${prefix}_${key}`] = parseFloat((platDimSums[key] / platDimCounts[key]).toFixed(1));
    }
  }
  console.log(`[${jobId}] [db] Platform dimensions — platform: ${job.platform ?? "unknown"}, tiktok_rewatch: ${dimensions.tiktok_rewatch_potential ?? "null"}, tiktok_seo: ${dimensions.tiktok_seo_strength ?? "null"}, instagram_dm_share: ${dimensions.instagram_dm_share_potential ?? "null"}, instagram_originality: ${dimensions.instagram_originality ?? "null"}, youtube_watch_time: ${dimensions.youtube_watch_time_potential ?? "null"}, youtube_thumbnail: ${dimensions.youtube_thumbnail_hook ?? "null"}`);
  if (Object.keys(dimensions).length > 0) {
    console.log(`[${jobId}] [db] Saving dimensions — critic_hook=${dimensions.critic_hook_strength ?? "—"}, critic_completion=${dimensions.critic_completion_likelihood ?? "—"}, critic_share=${dimensions.critic_share_save_worthiness ?? "—"}, trendsetter_hook=${dimensions.trendsetter_hook_strength ?? "—"}, trendsetter_completion=${dimensions.trendsetter_completion_likelihood ?? "—"}, connector_hook=${dimensions.connector_hook_strength ?? "—"}, connector_completion=${dimensions.connector_completion_likelihood ?? "—"}`);
  } else {
    console.log(`[${jobId}] [db] No dimensions found in judge results — dimensions object will be empty`);
  }
  const browserUploadMs = job.timings?.browserUploadMs ?? null;
  console.log(`[${jobId}] [log] browser_upload_ms=${browserUploadMs} timings.browserUploadMs=${job.timings?.browserUploadMs} job.browserUploadMs=${job.browserUploadMs}`);
  const entry = {
    jobId,
    timestamp: new Date(job.startedAt || job.createdAt || Date.now()).toISOString(),
    ip: job.ip || "unknown",
    platform: job.platform,
    fileName: job.fileName ?? null,
    fileSizeMB: job.fileSizeMB || null,
    videoDurationSecs: job.videoDuration?.secs || null,
    status: finalStatus,
    timings: { ...(job.timings || {}), browserUploadMs },
    scores,
    dimensions,
    avgScore: scoreCount > 0 ? parseFloat((scoreSum / scoreCount).toFixed(1)) : null,
  };
  submissionLog.unshift(entry);
  if (submissionLog.length > 500) submissionLog.length = 500;
  await saveSubmission(entry);
  console.log(`[${jobId}] [log] ${JSON.stringify(entry)}`);
}

// ── Check if all judges for a job are settled; finalize if so ─────────────────
async function checkJobCompletion(jobId) {
  const job = jobs[jobId];
  if (!job || job.finalized) return;
  const results = job.results || {};
  const judgeIds = Object.keys(results);
  if (judgeIds.length === 0) return;
  if (!judgeIds.every(id => ["done", "error", "timeout"].includes(results[id].status))) return;

  // Use createdAt (job entered queue) as baseline so total includes queue wait.
  // Add browserUploadMs so total covers the full user-facing journey.
  const pipelineMs = Date.now() - (job.createdAt || job.startedAt || Date.now());
  job.timings.totalMs = pipelineMs + (job.timings.browserUploadMs || 0);
  const succeeded = judgeIds.filter(id => results[id].status === "done").length;
  const timedOut = judgeIds.filter(id => results[id].status === "timeout").length;
  const total = judgeIds.length;
  let finalStatus;
  if (succeeded === total) {
    job.status = "done"; finalStatus = "done";
    console.log(`[${jobId}] All ${total} judges complete`);
  } else if (succeeded > 0) {
    job.status = "partial"; finalStatus = "partial";
    console.log(`[${jobId}] ${succeeded}/${total} judges complete`);
  } else if (timedOut > 0) {
    job.status = "timeout";
    job.error = "The panel took too long to reach a verdict — this can happen during busy periods. Your video has been submitted and you can try again for a fresh panel.";
    finalStatus = "timeout";
    console.log(`[${jobId}] All judges timed out — setting job status to 'timeout'`);
  } else {
    const errors = judgeIds.map(id => results[id].error).filter(Boolean);
    job.status = "error";
    job.error = errors[0] ?? "All judges failed";
    finalStatus = "error";
    console.log(`[${jobId}] All judges failed`);
  }

  await recordSubmissionForJob(jobId, finalStatus);

  if (pgPool) {
    pgPool.query(`DELETE FROM analyze_tasks WHERE job_id = $1`, [jobId]).catch(err =>
      console.error(`[poller] Failed to cleanup tasks for ${jobId}: ${err.message}`)
    );
  }
}

// ── Background poller: checks TwelveLabs every 15s for completed tasks ────────
const STALE_TASK_MS = 25 * 60 * 1000; // 25 minutes
let pollerRunning = false;
const taskStatusCache = {}; // taskId → last known TwelveLabs status, for transition logging

async function pollAnalyzeTasks() {
  if (pollerRunning) return;
  pollerRunning = true;
  try {
    if (!pgPool) return;
    const { rows } = await pgPool.query(
      `SELECT job_id, judge_id, task_id, platform, target_audience, video_duration_secs, created_at
       FROM analyze_tasks WHERE status = 'pending'`
    );
    console.log(`[poller] Pending tasks in Neon: ${rows.length}`);
    if (rows.length === 0) return;

    await Promise.allSettled(rows.map(async row => {
      // Skip if the job was already finalized (e.g. timeout fired while tasks were being created)
      if (jobs[row.job_id]?.finalized) {
        await pgPool.query(`UPDATE analyze_tasks SET status = 'cancelled' WHERE task_id = $1`, [row.task_id]).catch(() => {});
        return;
      }
      const ageMs = Date.now() - new Date(row.created_at).getTime();

      if (ageMs > STALE_TASK_MS) {
        console.warn(`[poller] Task ${row.task_id} (${row.judge_id}) stale after ${(ageMs/60000).toFixed(1)}min — marking as timeout`);
        await pgPool.query(`UPDATE analyze_tasks SET status = 'stale', error = $1 WHERE task_id = $2`, ['Analysis timed out after 25 minutes', row.task_id]);
        delete taskStatusCache[row.task_id];
        if (jobs[row.job_id]) {
          jobs[row.job_id].results[row.judge_id] = {
            status: "timeout", error: "Analysis timed out after 25 minutes",
            data: { overall: null, reaction: "This judge was unable to complete analysis. Please try again.", positives: "", delivery: "", content: "", platformFit: "", relativeInsight: "", moments: [], suggestions: [] },
          };
        }
        await checkJobCompletion(row.job_id);
        return;
      }

      try {
        const t_judge = Date.now();
        // HttpResponsePromise.then() unwraps to data directly — no { data } destructure needed
        const task = await tl().analyzeAsync.tasks.retrieve(row.task_id);

        // Log task status transitions — specifically queued → processing
        const prevStatus = taskStatusCache[row.task_id];
        if (prevStatus !== task.status) {
          // Capture tl_queue_ms on queued→processing, or on first-seen-as-processing (after restart)
          if (task.status === "processing" && (prevStatus === "queued" || prevStatus === undefined)) {
            const transition = prevStatus === undefined ? "first-seen→processing" : "queued→processing";
            console.log(`[poller] Task ${row.task_id} (${row.judge_id}, job ${row.job_id}): ${transition}`);
            const jobForQueue = jobs[row.job_id];
            if (jobForQueue && !jobForQueue.timings.tlQueueMs) {
              const baseline = jobForQueue.tasksCreatedAt || new Date(row.created_at).getTime();
              const tlQueueMs = Date.now() - baseline;
              jobForQueue.timings.tlQueueMs = tlQueueMs;
              console.log(`[poller] TwelveLabs queue time for job ${row.job_id}: ${tlQueueMs}ms (baseline: ${jobForQueue.tasksCreatedAt ? "tasksCreatedAt" : "task created_at"})`);
            }
          }
          taskStatusCache[row.task_id] = task.status;
        }
        console.log(`[poller] Task ${row.task_id} (${row.judge_id}): ${task.status}`);

        if (task.status === "ready") {
          // Log the raw result structure so we can diagnose format issues
          const resultType = typeof task.result;
          const dataType = typeof task.result?.data;
          console.log(`[poller] Task ${row.task_id} result structure: result=${resultType}, result.data=${dataType}`);
          if (resultType !== "undefined") {
            const preview = JSON.stringify(task.result).slice(0, 300);
            console.log(`[poller] Task ${row.task_id} result preview: ${preview}`);
          }

          // SDK may return result.data as an already-deserialized object or as a string
          const rawText = task.result?.data ?? task.result ?? "";
          const judge = JUDGES.find(j => j.id === row.judge_id);
          const videoDuration = row.video_duration_secs
            ? { secs: parseFloat(row.video_duration_secs), label: formatTimestamp(parseFloat(row.video_duration_secs)) }
            : null;
          let parsed;
          try {
            parsed = await processAnalyzeResult(rawText, judge, row.platform, row.target_audience, videoDuration);
          } catch (parseErr) {
            console.error(`[poller] Parse failed for ${row.task_id} (${row.judge_id}): ${parseErr.message}`);
            parsed = { overall: null, reaction: "This judge was unable to complete analysis. Please try again.", positives: "", delivery: "", content: "", platformFit: "", relativeInsight: "", moments: [], suggestions: [] };
          }
          await pgPool.query(`UPDATE analyze_tasks SET status = 'ready', result = $1 WHERE task_id = $2`, [JSON.stringify(parsed), row.task_id]);
          delete taskStatusCache[row.task_id];
          if (!jobs[row.job_id]) {
            console.warn(`[poller] Task ${row.task_id} result for ${row.judge_id} arrived but job ${row.job_id} not in memory — skipping state update`);
          } else {
            jobs[row.job_id].results[row.judge_id] = { status: "done", data: parsed };
            jobs[row.job_id].timings.judges[row.judge_id] = Date.now() - t_judge;
            // Log time from all-tasks-created to first judge result
            if (jobs[row.job_id].tasksCreatedAt && !jobs[row.job_id].firstResultAt) {
              jobs[row.job_id].firstResultAt = Date.now();
              const msFromTasksCreated = jobs[row.job_id].firstResultAt - jobs[row.job_id].tasksCreatedAt;
              console.log(`[${row.job_id}] First judge result received (${row.judge_id}) — ${msFromTasksCreated}ms from all tasks created (TwelveLabs queue + first analysis time)`);
            }
          }
          console.log(`[poller] Judge ${row.judge_id} complete for job ${row.job_id} in ${Date.now() - t_judge}ms`);
          await checkJobCompletion(row.job_id);

        } else if (task.status === "failed") {
          const errMsg = task.error?.message || "TwelveLabs analysis task failed";
          console.error(`[poller] Task ${row.task_id} failed: ${errMsg}`);
          await pgPool.query(`UPDATE analyze_tasks SET status = 'failed', error = $1 WHERE task_id = $2`, [errMsg, row.task_id]);
          delete taskStatusCache[row.task_id];
          const judge = JUDGES.find(j => j.id === row.judge_id);
          if (jobs[row.job_id]) {
            jobs[row.job_id].results[row.judge_id] = {
              status: "error", error: errMsg,
              data: { overall: null, reaction: "This judge was unable to complete analysis. Please try again.", positives: "", delivery: "", content: "", platformFit: "", relativeInsight: "", moments: [], suggestions: [] },
            };
          }
          await checkJobCompletion(row.job_id);
        }
        // queued/pending/processing — check again next poll
      } catch (err) {
        console.error(`[poller] Error checking task ${row.task_id}: ${err.message}`);
      }
    }));
  } finally {
    pollerRunning = false;
  }
}

// ── Restore in-flight jobs into memory after server restart ───────────────────
async function resumeInFlightTasks() {
  const rows = await loadInFlightTasks();
  if (rows.length === 0) return;
  const jobIds = new Set(rows.map(r => r.job_id));
  for (const row of rows) {
    if (!jobs[row.job_id]) {
      const browserUploadMs = row.browser_upload_ms != null ? parseInt(row.browser_upload_ms) : null;
      jobs[row.job_id] = {
        status: "analyzing", results: {}, error: null,
        platform: row.platform, objective: row.target_audience,
        createdAt: new Date(row.created_at).getTime(),
        startedAt: new Date(row.created_at).getTime(),
        timings: { conversionMs: null, uploadMs: null, browserUploadMs, judges: {} },
        ip: row.ip || "unknown",
        fileSizeMB: row.file_size_mb != null ? parseFloat(row.file_size_mb) : null,
        fileName: row.file_name ?? null,
        browserUploadMs,
      };
    }
    jobs[row.job_id].results[row.judge_id] = { status: "pending" };
  }
  console.log(`[startup] Resumed ${rows.length} in-flight task(s) across ${jobIds.size} job(s) from Neon — ffmpeg/upload timings unavailable for resumed jobs`);
}

// ── GET /api/status/:jobId ────────────────────────────────────
app.get("/api/status/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });

  // Report live queue position
  const queuePos = jobQueue.findIndex(q => q.jobId === req.params.jobId);
  const currentQueuePosition = queuePos >= 0 ? queuePos + 1 : (activeJob === req.params.jobId ? 0 : -1);

  res.json({
    status: job.status,
    results: job.results,
    error: job.error,
    duration: job.videoDuration?.secs || null,
    queuePosition: currentQueuePosition,
  });
});

// ── GET /admin/logs — submission dashboard ────────────────────
app.get("/admin/logs", (req, res) => {
  const secret = process.env.ADMIN_SECRET;
  if (secret && req.query.secret !== secret) {
    return res.status(401).send("Unauthorized — add ?secret=YOUR_ADMIN_SECRET to the URL");
  }

  const fmt = ms => ms != null ? `${(ms / 1000).toFixed(1)}s` : "—";
  const fmtDur = secs => secs != null
    ? `${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, "0")}`
    : "—";

  const totalSubmissions = submissionLog.length;
  const completed = submissionLog.filter(e => e.status === "done" || e.status === "partial").length;
  const avgTotal = submissionLog.filter(e => e.timings.totalMs).reduce((s, e, _, a) => s + e.timings.totalMs / a.length, 0);
  const allScores = submissionLog.flatMap(e => Object.values(e.scores));
  const overallAvg = allScores.length ? (allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(1) : "—";

  const platColor = p => p === "youtube" ? "#CC0000" : p === "tiktok" ? "#555" : "#C13584";
  const platBg = p => p === "youtube" ? "#CC000018" : p === "tiktok" ? "#55555518" : "#C1358418";
  const statusColor = s => s === "done" ? "#2E7D32" : s === "partial" ? "#E65100" : s === "timeout" ? "#E65100" : s.startsWith("rejected_") ? "#795548" : "#C62828";

  const rows = submissionLog.map(e => {
    const judgeCells = ["critic", "cool", "connector"].map(id => {
      const score = e.scores[id];
      const t = e.timings.judges[id];
      return `<td style="text-align:center;white-space:nowrap">${score != null ? `<strong>${score}</strong>` : "—"}${t != null ? `<br><span style="color:#bbb;font-size:10px">${fmt(t)}</span>` : ""}</td>`;
    }).join("");

    const scoreColor = e.avgScore >= 7 ? "#43A047" : e.avgScore >= 5 ? "#FB8C00" : "#E53935";
    const date = new Date(e.timestamp).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

    const safeFileName = e.fileName ? e.fileName.replace(/</g, "&lt;").replace(/>/g, "&gt;") : "—";
    return `<tr>
      <td style="color:#999;font-size:11px;white-space:nowrap">${date}</td>
      <td style="font-family:monospace;font-size:11px;color:#666">${e.ip}</td>
      <td><span style="background:${platBg(e.platform)};color:${platColor(e.platform)};padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;white-space:nowrap">${e.platform}</span></td>
      <td style="font-size:11px;color:#555;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${safeFileName}">${safeFileName}</td>
      <td style="text-align:right;white-space:nowrap">${e.fileSizeMB != null ? e.fileSizeMB + " MB" : "—"}</td>
      <td style="text-align:right;font-family:monospace">${fmtDur(e.videoDurationSecs)}</td>
      <td><strong style="color:${statusColor(e.status)}">${e.status}</strong></td>
      <td style="text-align:right;font-family:monospace;font-weight:700">${fmt(e.timings.totalMs)}</td>
      <td style="text-align:right;font-family:monospace;color:#888">${fmt(e.timings.browserUploadMs)}</td>
      <td style="text-align:right;font-family:monospace;color:#888">${fmt(e.timings.conversionMs)}</td>
      <td style="text-align:right;font-family:monospace;color:#888">${fmt(e.timings.uploadMs)}</td>
      ${judgeCells}
      <td style="text-align:center;font-size:18px;font-weight:800;color:${scoreColor}">${e.avgScore ?? "—"}</td>
    </tr>`;
  }).join("\n");

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PreviewPanel — Submission Log</title>
  <meta http-equiv="refresh" content="30">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #FAFAFA; color: #212121; margin: 0; padding: 24px; }
    h1 { font-size: 20px; margin: 0 0 4px; color: #4E342E; }
    .meta { font-size: 12px; color: #999; margin-bottom: 16px; }
    .stats { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
    .stat { background: #fff; border: 1px solid #E0D6D3; border-radius: 10px; padding: 12px 18px; min-width: 120px; }
    .stat-val { font-size: 22px; font-weight: 800; color: #4E342E; }
    .stat-label { font-size: 11px; color: #999; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.06em; }
    .table-wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 8px rgba(0,0,0,0.07); font-size: 13px; min-width: 900px; }
    th { background: #EFEBE9; padding: 10px 12px; text-align: left; font-size: 10px; font-weight: 700; color: #795548; text-transform: uppercase; letter-spacing: 0.06em; white-space: nowrap; }
    td { padding: 9px 12px; border-top: 1px solid #F5F0EE; vertical-align: middle; }
    tr:hover td { background: #FDFAF9; }
    .empty { text-align: center; padding: 48px; color: #bbb; font-size: 14px; }
  </style>
</head>
<body>
  <h1>🦉 PreviewPanel — Submission Log</h1>
  <div class="meta">${totalSubmissions} submission${totalSubmissions !== 1 ? "s" : ""} · auto-refreshes every 30s · resets on server restart</div>
  <div class="stats">
    <div class="stat"><div class="stat-val">${totalSubmissions}</div><div class="stat-label">Total</div></div>
    <div class="stat"><div class="stat-val">${completed}</div><div class="stat-label">Completed</div></div>
    <div class="stat"><div class="stat-val">${totalSubmissions ? Math.round((completed / totalSubmissions) * 100) + "%" : "—"}</div><div class="stat-label">Success Rate</div></div>
    <div class="stat"><div class="stat-val">${avgTotal ? fmt(avgTotal) : "—"}</div><div class="stat-label">Avg Total Time</div></div>
    <div class="stat"><div class="stat-val">${overallAvg}</div><div class="stat-label">Avg Score</div></div>
  </div>
  <div class="table-wrap">
  <table>
    <thead>
      <tr>
        <th>Time</th><th>IP</th><th>Platform</th><th>Filename</th><th>File</th><th>Duration</th>
        <th>Status</th><th>Total</th><th>Br Upload</th><th>ffmpeg</th><th>TL Upload</th>
        <th>Critic</th><th>Trend</th><th>Dream</th><th>Avg</th>
      </tr>
    </thead>
    <tbody>
      ${rows || `<tr><td colspan="15" class="empty">No submissions yet</td></tr>`}
    </tbody>
  </table>
  </div>
</body>
</html>`);
});

// ── Health check ──────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ ok: true }));

// ── TwelveLabs warm-up — keeps infrastructure warm, prevents cold-start delays ─
const WARMUP_PATH = path.join(__dirname, "uploads", "warmup.mp4");

async function createWarmupFile() {
  try {
    await execFileAsync(FFMPEG, [
      "-f", "lavfi", "-i", "color=c=black:size=640x360:duration=5",
      "-c:v", "libx264", "-preset", "ultrafast", "-t", "5",
      "-y", WARMUP_PATH,
    ]);
    const sizeBytes = fs.statSync(WARMUP_PATH).size;
    console.log(`[warmup] Warmup file created: 640x360, 5s, ${sizeBytes} bytes`);
  } catch (err) {
    console.error(`[warmup] Failed to create warmup file: ${err.message}\n${err.stack}`);
  }
}

async function runWarmup() {
  if (!process.env.TWELVELABS_API_KEY) return;
  if (!fs.existsSync(WARMUP_PATH)) {
    console.log("[warmup] Warmup file not found — skipping ping");
    return;
  }
  try {
    const assetId = await uploadAssetDirect(WARMUP_PATH);
    await tl().analyzeAsync.tasks.create(
      { video: { type: "asset_id", assetId }, prompt: "Describe this video in one word.", maxTokens: 10 },
      { timeoutInSeconds: 30 }
    );
    console.log("[warmup] TwelveLabs warm-up ping sent");
  } catch (err) {
    console.log(`[warmup] Warm-up ping failed: ${err.message}`);
  }
}

// ── Start ─────────────────────────────────────────────────────
let server;
try {
  await initDb();
  const saved = await loadSubmissionLog();
  submissionLog.push(...saved);
  console.log(`[startup] Submission log loaded — ${submissionLog.length} entries`);
  await resumeInFlightTasks();
  setInterval(pollAnalyzeTasks, 15_000);
  console.log(`[startup] Background poller started — checking TwelveLabs every 15s`);

  // Warm-up: generate file once at startup, ping immediately, then every 14 minutes
  console.log("[warmup] Warmup initialized on startup");
  try {
    await createWarmupFile();
  } catch (err) {
    console.error(`[warmup] createWarmupFile threw unexpectedly: ${err.message}`);
  }
  if (process.env.TWELVELABS_API_KEY) {
    try {
      await runWarmup(); // awaited so all three log lines appear sequentially
    } catch (err) {
      console.error(`[warmup] Initial warmup failed: ${err.message}\n${err.stack}`);
    }
    setInterval(() => {
      runWarmup().catch(err => console.error(`[warmup] Scheduled warmup failed: ${err.message}`));
    }, 14 * 60 * 1000);
    console.log("[warmup] TwelveLabs warm-up scheduled every 14 minutes");
  } else {
    console.warn("[warmup] TWELVELABS_API_KEY not set — warmup ping skipped");
  }

  const PORT = process.env.PORT || 3001;
  server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`PreviewPanel backend running on http://localhost:${PORT}`);
    console.log(`TwelveLabs key: ${process.env.TWELVELABS_API_KEY ? "✓" : "✗ MISSING"}`);
    console.log(`Anthropic key:  ${process.env.ANTHROPIC_API_KEY ? "✓" : "– not set (Claude fallback disabled)"}`);
  });

  server.on("error", (err) => {
    console.error("[server] Listen error:", err);
    process.exit(1);
  });

  server.timeout = 0;
  server.headersTimeout = 600_000;
  server.requestTimeout = 0;
  server.keepAliveTimeout = 30000;

  if (process.env.RENDER_EXTERNAL_URL) {
    const pingUrl = process.env.RENDER_EXTERNAL_URL + "/health";
    setInterval(() => {
      fetch(pingUrl)
        .then(() => console.log("[keep-warm] ping ok"))
        .catch((err) => console.warn("[keep-warm] ping failed:", err.message));
    }, 14 * 60 * 1000);
    console.log(`[keep-warm] self-ping enabled → ${pingUrl} every 14 min`);
  }
} catch (err) {
  console.error("[startup] Fatal error during server initialization:", err);
  process.exit(1);
}

