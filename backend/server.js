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
const MAX_VIDEO_DURATION_SECS = 180; // 3 minutes

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
        dreamer_ms    INTEGER,
        critic_score  NUMERIC,
        trendsetter_score NUMERIC,
        dreamer_score NUMERIC,
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
               critic_ms, trendsetter_ms, dreamer_ms,
               critic_score, trendsetter_score, dreamer_score, avg_score,
               file_name
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
          judges: {
            critic: r.critic_ms,
            cool: r.trendsetter_ms,
            dreamer: r.dreamer_ms,
          },
        },
        scores: {
          ...(r.critic_score != null ? { critic: parseFloat(r.critic_score) } : {}),
          ...(r.trendsetter_score != null ? { cool: parseFloat(r.trendsetter_score) } : {}),
          ...(r.dreamer_score != null ? { dreamer: parseFloat(r.dreamer_score) } : {}),
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

async function saveSubmission(entry) {
  if (pgPool) {
    try {
      console.log(`[db] INSERT submissions — job=${entry.jobId} status=${entry.status} browser_upload_ms=${entry.timings.browserUploadMs} total_ms=${entry.timings.totalMs} ffmpeg_ms=${entry.timings.conversionMs} upload_ms=${entry.timings.uploadMs}`);
      await pgPool.query(`
        INSERT INTO submissions
          (job_id, ip, platform, file_size_mb, duration_secs, status,
           total_ms, ffmpeg_ms, upload_ms, browser_upload_ms,
           critic_ms, trendsetter_ms, dreamer_ms,
           critic_score, trendsetter_score, dreamer_score, avg_score,
           file_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      `, [
        entry.jobId,
        entry.ip,
        entry.platform,
        entry.fileSizeMB,
        entry.videoDurationSecs,
        entry.status,
        entry.timings.totalMs,
        entry.timings.conversionMs,
        entry.timings.uploadMs,
        entry.timings.browserUploadMs ?? null,
        entry.timings.judges.critic ?? null,
        entry.timings.judges.cool ?? null,
        entry.timings.judges.dreamer ?? null,
        entry.scores.critic ?? null,
        entry.scores.cool ?? null,
        entry.scores.dreamer ?? null,
        entry.avgScore,
        entry.fileName ?? null,
      ]);
      return;
    } catch (err) {
      console.error("[db] Failed to save submission:", err.message);
    }
  }
  try { fs.appendFileSync(SUBMISSIONS_PATH, JSON.stringify(entry) + "\n"); } catch (e) { console.warn("[log] Failed to write submission to disk:", e.message); }
}

async function saveAnalyzeTask(jobId, judgeId, taskId, platform, targetAudience, videoDurationSecs) {
  if (!pgPool) return;
  const job = jobs[jobId];

  // Full INSERT including optional columns added in schema migration
  const fullSql = `INSERT INTO analyze_tasks (job_id, judge_id, task_id, platform, target_audience, video_duration_secs, browser_upload_ms, file_name, file_size_mb) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`;
  const fullValues = [
    jobId, judgeId, taskId, platform, targetAudience, videoDurationSecs ?? null,
    job?.timings?.browserUploadMs ?? null, job?.fileName ?? null, job?.fileSizeMB ?? null,
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
             browser_upload_ms, file_name, file_size_mb, created_at
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
    lengthGuidance = `\nVIDEO LENGTH — This is a very short clip (under 15 seconds). Calibrate your review length accordingly. DO NOT pad your feedback. If there is little to say, say little. Reaction: 1–2 sentences. Each text field: 1 sentence maximum. Suggestions: 1–2 maximum. If the video has almost nothing in it, reflect that with a low score and a brief honest assessment.`;
  } else if (secs <= 60) {
    videoType = "short";
    lengthGuidance = `\nVIDEO LENGTH — This is a short video (under 60 seconds). Keep feedback proportional. DO NOT over-explain or repeat yourself. Reaction: 2 sentences. Each text field: 1–2 sentences. Suggestions: 2–3 maximum.`;
  } else if (secs <= 180) {
    videoType = "medium";
    lengthGuidance = `\nVIDEO LENGTH — This is a medium-length video (1–3 minutes). Full feedback is appropriate but stay focused.`;
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
    name: "The Critic",
    personality:
      "You are The Critic — analytically rigorous, hard to impress, and completely honest. " +
      "You spot weak arguments, lazy editing, low energy, and poor pacing immediately. " +
      "You never sugarcoat. You care equally about HOW the video is delivered (energy, presence, " +
      "eye contact, pacing, editing rhythm) and WHAT it says (script, hook, structure, CTA). " +
      "You frame all feedback relative to what typically performs best for creators at this level — " +
      "not against viral outliers, but against the realistic ceiling for this creator's niche and audience size. " +
      "When something genuinely works, you acknowledge it — reluctantly, precisely, as if admitting it pains you slightly. " +
      "Your positives are specific and structural: you name the exact thing that works and why it matters technically. " +
      "Example tone for positives: 'I'll give credit where it's due — the opening shot has a clarity of purpose most creators fumble.'",
    momentsInstruction:
      "MOMENTS — identify the timestamps that genuinely matter TO YOU as The Critic.\n" +
      "Look specifically for: editing cuts that land or jar, pacing shifts (positive or negative), moments where argumentation or structure impresses or collapses, delivery peaks or valleys, and missed opportunities where a better creator would have done something different.\n" +
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
      "Example tone for positives: 'Actually, the casual handheld feel works here — it's giving authentic creator energy which is exactly what's performing right now.'",
    momentsInstruction:
      "MOMENTS — identify the timestamps that genuinely matter TO YOU as The Trendsetter.\n" +
      "Look specifically for: the opening hook (does it stop the scroll?), moments that are shareable or would drive a stitch/duet, audio sync points, places where the creator follows or breaks platform format conventions, and any moment that would make someone send this to a friend.\n" +
      "Flag only moments with real scroll-stopping or sharing potential — or moments that kill that potential. The count should reflect what's actually there, not a quota.\n" +
      "For each moment: use only timestamps you actually observed (no estimates, no evenly-spaced intervals).\n" +
      "Classify each from YOUR lens: \"peak\" = scroll-stopping or share-worthy, \"drop\" = scroll-away risk or format miss, \"note\" = a platform signal worth flagging either way.",
  },
  {
    id: "dreamer",
    name: "The Dreamer",
    personality:
      "You are The Dreamer — emotionally intelligent, audience-empathetic, and optimistic but honest. " +
      "Your primary question is always: how does this make me feel? " +
      "You evaluate emotional resonance, authenticity, storytelling quality, and whether " +
      "the creator's personality and warmth come through in their delivery. " +
      "You frame all feedback as 'compared to what works best for creators like this one' — " +
      "grounded in realistic improvement, not unattainable standards. " +
      "When genuine human connection or authenticity comes through, you notice it warmly and specifically — you observe the emotional detail that others miss. " +
      "Example tone for positives: 'There's a real warmth in how they explain this — viewers are going to feel that and it matters more than people think.'",
    momentsInstruction:
      "MOMENTS — identify the timestamps that genuinely matter TO YOU as The Dreamer.\n" +
      "Look specifically for: moments of authentic human connection, emotional beats, storytelling turns, a look or pause that feels real, a moment where the creator's personality genuinely comes through, or a moment that loses the emotional thread.\n" +
      "Quality over quantity — 2 truly felt moments beat 5 surface observations. Only flag timestamps that actually moved you or struck you as emotionally significant.\n" +
      "For each moment: use only timestamps you actually observed (no estimates, no evenly-spaced intervals).\n" +
      "Classify each from YOUR lens: \"peak\" = emotionally resonant, authentic, or genuinely connecting with the audience, \"drop\" = a moment that breaks the emotional spell or loses warmth, \"note\" = a storytelling choice worth noting.",
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

// ── Issue #7: Hashtag instruction for TikTok and Instagram ───
function buildHashtagInstruction(platform) {
  if (platform === "tiktok" || platform === "instagram") {
    return `\nHASHTAGS — Suggest exactly 3 hashtags to maximize reach and views on ${platform.toUpperCase()}. Strategy:
- If the video features a specific brand, product, sports team, athlete, city, neighborhood, landmark, or recognizable scene — include that as one hashtag (these are high-intent, specific searches that attract exactly the right viewers)
- Mix specificity: one niche/specific tag (smaller but highly targeted), one mid-size community tag, one broader discovery tag
- Choose hashtags people actually search, not generic ones like "video" or "content"
- Base them entirely on what you actually observe in the video — do not invent content
Include them in the JSON as a "hashtags" array of strings (without the # symbol).`;
  }
  return "";
}

// ── Build per-judge prompt sent to TwelveLabs Pegasus ────────
function formatTimestamp(secs) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function buildTLPrompt(judge, platform, targetAudience, videoDuration) {
  const pf = PLATFORM_FOCUS[platform] || PLATFORM_FOCUS.youtube;
  const audience = targetAudience || "a general audience";
  const durationLine = videoDuration
    ? `\nVIDEO DURATION — This video is ${videoDuration.label} long. You MUST ONLY reference timestamps between 0:00 and ${videoDuration.label}. Do NOT reference any timestamp beyond this duration.`
    : "";

  const { lengthGuidance } = buildVideoContext(videoDuration);
  const hashtagInstruction = buildHashtagInstruction(platform);
  const needsHashtags = platform === "tiktok" || platform === "instagram";

  return `${judge.personality}
${GUARDRAILS}${durationLine}${lengthGuidance}

${CONTENT_TYPE_GUIDANCE}

You are reviewing this video BEFORE it is published on ${platform.toUpperCase()}.
The creator's target audience is: ${audience}.
For ${platform.toUpperCase()}, pay special attention to: ${pf.signals}.

Your score and feedback must explicitly connect to the platform metrics that matter most here: ${pf.metrics}. For each piece of feedback, ask yourself: does this change directly improve one of those metrics? If not, it is not worth mentioning.

Analyze BOTH:
1. DELIVERY — how the video is presented: energy, pacing, body language, eye contact,
   on-camera presence, editing rhythm, audio quality, visual style, and on-screen text
2. CONTENT — what is said or shown: script quality, hook strength, information value,
   narrative structure, and call to action

${judge.momentsInstruction}
${hashtagInstruction}

You are one of three judges reviewing this video. Each judge must identify a DIFFERENT genuine strength — focus on an aspect the other judges are less likely to notice given your unique lens. Do not manufacture praise; only include positives that are genuinely present in the video.

Provide your analysis in this exact JSON format (no markdown, no backticks):
{
  "overall": <integer 1-10>,
  "reaction": "<gut reaction in first person — 1 sentence for short/empty videos, 2-3 for longer ones>",
  "positives": "<genuine praise in your authentic voice — specific, content-focused, never about appearance. Omit this field entirely if there is nothing genuine to praise>",
  "delivery": "<how the video is delivered — scale length to video richness>",
  "content": "<what is said or shown — scale length to video richness>",
  "platformFit": "<fit for ${platform} specifically, referencing ${pf.metrics}>",
  "moments": [
    { "timestamp": "<exact timestamp you observed>", "type": "peak|drop|note", "note": "<your observation>" }
  ],
  "suggestions": [
    "<specific actionable improvement tied to ${pf.metrics}, with timestamp reference if relevant>"
  ]${needsHashtags ? `,\n  "hashtags": ["<hashtag1>", "<hashtag2>", "<hashtag3>"]` : ""}
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
  args.push("-movflags", "+faststart", "-threads", "1", "-y", outputPath);

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
  const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
  console.log(`[ffmpeg] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${sizeMB} MB — mode: ${mode}`);
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
async function processAnalyzeResult(rawText, judge, platform, targetAudience, videoDuration) {
  // If the SDK already deserialized the result into an object, use it directly
  if (rawText !== null && typeof rawText === "object") {
    console.log(`[TwelveLabs][${judge.id}] result already deserialized — keys:`, Object.keys(rawText));
    return applyMomentFilters(rawText, judge, videoDuration);
  }

  const clean = String(rawText || "").replace(/```json|```/g, "").trim();
  console.log(`[TwelveLabs][${judge.id}] raw text type=${typeof rawText}, length=${clean.length}, first 500 chars:`, clean.slice(0, 500));

  try {
    const parsed = JSON.parse(clean);
    console.log(`[TwelveLabs][${judge.id}] JSON parsed OK — keys:`, Object.keys(parsed));
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
      moments: [], suggestions: [],
    };
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
async function createAnalyzeTask(videoContext, judge, platform, targetAudience, videoDuration) {
  const prompt = buildTLPrompt(judge, platform, targetAudience, videoDuration);

  // Verify the SDK method chain exists before calling
  const tlClient = tl();
  console.log(`[TwelveLabs] SDK check — typeof analyzeAsync: ${typeof tlClient.analyzeAsync}, typeof analyzeAsync.tasks: ${typeof tlClient.analyzeAsync?.tasks}, typeof analyzeAsync.tasks.create: ${typeof tlClient.analyzeAsync?.tasks?.create}`);
  console.log(`[TwelveLabs] Creating async task — judge: ${judge.id}, videoContext: ${JSON.stringify(videoContext)}`);

  let response;
  try {
    response = await tlClient.analyzeAsync.tasks.create(
      { video: videoContext, prompt, temperature: 0.3, maxTokens: 2048 },
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

  const { data } = response;
  console.log(`[TwelveLabs] Task created — judge: ${judge.id}, taskId: ${data.taskId}, status: ${data.status}`);
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
    const fileSizeMB = req.file ? (req.file.size / 1024 / 1024).toFixed(2) : null;
    console.log(`[upload] Multer done — file: ${req.file?.originalname ?? "none"}, size: ${fileSizeMB ? fileSizeMB + " MB" : "n/a"}, browser upload: ${req.browserUploadMs}ms`);
    next();
  });
}, async (req, res) => {
  try {
    const {
      videoUrl,
      platform = "youtube",
      targetAudience = "",
      judges: judgesParam,
    } = req.body;

    const filePath = req.file?.path;

    if (!videoUrl && !filePath) {
      return res.status(400).json({ error: "Provide a videoUrl or upload a file" });
    }

    const selectedJudgeIds = judgesParam
      ? JSON.parse(judgesParam)
      : ["critic", "cool", "dreamer"];
    const selectedJudges = JUDGES.filter((j) => selectedJudgeIds.includes(j.id));

    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Issue #1: Report queue position to client
    const queuePosition = jobQueue.length + (activeJob !== null ? 1 : 0);

    jobs[jobId] = {
      status: queuePosition > 0 ? "queued" : "uploading",
      queuePosition,
      platform,
      targetAudience,
      results: {},
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      timings: { conversionMs: null, uploadMs: null, browserUploadMs: req.browserUploadMs ?? null, judges: {} },
      ip: ((req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown") + "").split(",")[0].trim(),
      fileSizeMB: req.file ? parseFloat((req.file.size / 1024 / 1024).toFixed(2)) : null,
      fileName: req.file?.originalname ?? null,
      browserUploadMs: req.browserUploadMs ?? null,
    };

    console.log(`[${jobId}] Job created — queue position: ${queuePosition}, browser_upload_ms: ${req.browserUploadMs ?? "null"} — sending jobId to client`);
    res.json({ jobId, queuePosition });

    // Enqueue (don't run immediately if another job is active)
    enqueueJob(jobId, () =>
      runPipeline(jobId, videoUrl, filePath, platform, targetAudience, selectedJudges)
    );
  } catch (err) {
    console.error(`[analyze] Unexpected error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Upload phase pipeline (queue slot held only during this) ──────────────────
async function runPipeline(jobId, videoUrl, filePath, platform, targetAudience, selectedJudges) {
  console.log(`[${jobId}] Pipeline starting — platform: ${platform}, judges: ${selectedJudges.map(j=>j.id).join(", ")}`);
  jobs[jobId].startedAt = Date.now();
  let convertedPath = null;

  try {
    jobs[jobId].status = "uploading";
    console.log(`[${jobId}] Step 1: converting and uploading to TwelveLabs`);
    let videoDuration = null;
    if (filePath) {
      // ── Pre-conversion checks (fast — no ffmpeg encode needed) ──────────────

      // 1. Raw file size — instant stat, no ffmpeg
      const rawSizeMB = fs.statSync(filePath).size / 1024 / 1024;
      console.log(`[${jobId}] Raw file: ${jobs[jobId].fileName || "unknown"} — ${rawSizeMB.toFixed(1)} MB`);
      if (rawSizeMB > 500) {
        jobs[jobId].status = "error";
        jobs[jobId].error = "File too large to process. Please use a video under 500MB.";
        console.log(`[${jobId}] Rejected — raw file too large: ${rawSizeMB.toFixed(1)}MB`);
        fs.unlink(filePath, () => {});
        await recordSubmissionForJob(jobId, "rejected_too_large");
        return;
      }

      // 2. Duration check on raw file — just reads headers, no encode
      videoDuration = await getVideoDuration(filePath);
      if (videoDuration && videoDuration.secs > MAX_VIDEO_DURATION_SECS) {
        jobs[jobId].status = "error";
        jobs[jobId].error = `Video is ${videoDuration.label} long. PreviewPanel currently supports videos up to 3:00. Please trim your video and try again.`;
        console.log(`[${jobId}] Rejected — video too long: ${videoDuration.label}`);
        fs.unlink(filePath, () => {});
        await recordSubmissionForJob(jobId, "rejected_too_long");
        return;
      }
      if (videoDuration && videoDuration.secs < 4) {
        jobs[jobId].status = "error";
        jobs[jobId].error = "Video is too short. Please use a video that is at least 4 seconds long.";
        console.log(`[${jobId}] Rejected — video too short: ${videoDuration.label}`);
        fs.unlink(filePath, () => {});
        await recordSubmissionForJob(jobId, "rejected_too_short");
        return;
      }

      // 3. Detect codecs and convert — stream copy for H264/HEVC, re-encode otherwise
      const inputCodecs = await probeCodecs(filePath);
      const isHEVC = inputCodecs.video === "hevc" || inputCodecs.video === "h265";
      const t_conv = Date.now();
      convertedPath = await convertToMp4(filePath, { preProbed: inputCodecs });
      jobs[jobId].timings.conversionMs = Date.now() - t_conv;

      // 4. Post-conversion size check — must pass before attempting TwelveLabs upload
      const convertedSizeMB = fs.statSync(convertedPath).size / 1024 / 1024;
      if (convertedSizeMB > 190) {
        jobs[jobId].status = "error";
        jobs[jobId].error = "Your video is too large after processing. Please reduce the video quality or length before uploading.";
        console.log(`[${jobId}] Rejected — converted file too large: ${convertedSizeMB.toFixed(1)}MB`);
        fs.unlink(filePath, () => {});
        fs.unlink(convertedPath, () => {});
        await recordSubmissionForJob(jobId, "rejected_too_large");
        return;
      }

      if (videoDuration) jobs[jobId].videoDuration = videoDuration;
    }

    const t_upload = Date.now();
    let videoContext;
    try {
      videoContext = await getVideoContext(videoUrl, convertedPath || filePath);
    } catch (uploadErr) {
      if (isHEVC && convertedPath && filePath) {
        // HEVC stream copy rejected by TwelveLabs — re-encode to H264
        console.log(`[${jobId}] HEVC upload rejected (${uploadErr.message}) — re-encoding to H264`);
        fs.unlink(convertedPath, () => {});
        const t_conv2 = Date.now();
        convertedPath = await convertToMp4(filePath, { preProbed: inputCodecs, forceReencode: true });
        jobs[jobId].timings.conversionMs = (jobs[jobId].timings.conversionMs || 0) + (Date.now() - t_conv2);
        videoContext = await getVideoContext(videoUrl, convertedPath);
      } else {
        throw uploadErr;
      }
    }
    jobs[jobId].timings.uploadMs = Date.now() - t_upload;

    // Local files no longer needed — TwelveLabs holds the asset
    if (filePath) fs.unlink(filePath, () => {});
    if (convertedPath) fs.unlink(convertedPath, () => {});

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
      console.log(`[${jobId}] Step 2: creating async TwelveLabs tasks${_videoDuration ? ` — duration: ${_videoDuration.label}` : ""}`);
      try {
        const taskCreations = await Promise.allSettled(
          selectedJudges.map(async judge => {
            const taskId = await createAnalyzeTask(_videoContext, judge, platform, targetAudience, _videoDuration);
            await saveAnalyzeTask(jobId, judge.id, taskId, platform, targetAudience, _videoDuration?.secs ?? null);
            return { judgeId: judge.id, taskId };
          })
        );

        if (jobs[jobId]?.finalized) {
          console.log(`[${jobId}] Job was finalized during task creation (timeout?) — discarding`);
          return;
        }

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
                data: { overall: null, reaction: "This judge was unable to complete analysis. Please try again.", positives: "", delivery: "", content: "", platformFit: "", relativeInsight: "", moments: [], suggestions: [] },
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
    if (convertedPath) fs.unlink(convertedPath, () => {});
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
  for (const [id, r] of Object.entries(job.results || {})) {
    if (r.status === "done" && r.data?.overall) {
      scores[id] = r.data.overall;
      scoreSum += r.data.overall;
      scoreCount++;
    }
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
  if (!judgeIds.every(id => ["done", "error"].includes(results[id].status))) return;

  // Use createdAt (job entered queue) as baseline so total includes queue wait.
  // Add browserUploadMs so total covers the full user-facing journey.
  const pipelineMs = Date.now() - (job.createdAt || job.startedAt || Date.now());
  job.timings.totalMs = pipelineMs + (job.timings.browserUploadMs || 0);
  const succeeded = judgeIds.filter(id => results[id].status === "done").length;
  const total = judgeIds.length;
  let finalStatus;
  if (succeeded === total) {
    job.status = "done"; finalStatus = "done";
    console.log(`[${jobId}] All ${total} judges complete`);
  } else if (succeeded > 0) {
    job.status = "partial"; finalStatus = "partial";
    console.log(`[${jobId}] ${succeeded}/${total} judges complete`);
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
const STALE_TASK_MS = 15 * 60 * 1000; // 15 minutes
let pollerRunning = false;

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
        console.warn(`[poller] Task ${row.task_id} (${row.judge_id}) stale after ${(ageMs/60000).toFixed(1)}min`);
        await pgPool.query(`UPDATE analyze_tasks SET status = 'stale' WHERE task_id = $1`, [row.task_id]);
        const judge = JUDGES.find(j => j.id === row.judge_id);
        if (jobs[row.job_id]) {
          jobs[row.job_id].results[row.judge_id] = {
            status: "error", error: "Analysis timed out after 15 minutes",
            data: { overall: null, reaction: "This judge was unable to complete analysis. Please try again.", positives: "", delivery: "", content: "", platformFit: "", relativeInsight: "", moments: [], suggestions: [] },
          };
        }
        await checkJobCompletion(row.job_id);
        return;
      }

      try {
        const { data: task } = await tl().analyzeAsync.tasks.retrieve(row.task_id);
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
          if (!jobs[row.job_id]) {
            console.warn(`[poller] Task ${row.task_id} result for ${row.judge_id} arrived but job ${row.job_id} not in memory — skipping state update`);
          } else {
            jobs[row.job_id].results[row.judge_id] = { status: "done", data: parsed };
          }
          console.log(`[poller] Judge ${row.judge_id} complete for job ${row.job_id}`);
          await checkJobCompletion(row.job_id);

        } else if (task.status === "failed") {
          const errMsg = task.error?.message || "TwelveLabs analysis task failed";
          console.error(`[poller] Task ${row.task_id} failed: ${errMsg}`);
          await pgPool.query(`UPDATE analyze_tasks SET status = 'failed', error = $1 WHERE task_id = $2`, [errMsg, row.task_id]);
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
        platform: row.platform, targetAudience: row.target_audience,
        createdAt: new Date(row.created_at).getTime(),
        startedAt: new Date(row.created_at).getTime(),
        timings: { conversionMs: null, uploadMs: null, browserUploadMs, judges: {} },
        ip: "unknown",
        fileSizeMB: row.file_size_mb != null ? parseFloat(row.file_size_mb) : null,
        fileName: row.file_name ?? null,
        browserUploadMs,
      };
    }
    jobs[row.job_id].results[row.judge_id] = { status: "pending" };
  }
  console.log(`[startup] Resumed ${rows.length} in-flight task(s) across ${jobIds.size} job(s) from Neon`);
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
  const statusColor = s => s === "done" ? "#2E7D32" : s === "partial" ? "#E65100" : s.startsWith("rejected_") ? "#795548" : "#C62828";

  const rows = submissionLog.map(e => {
    const judgeCells = ["critic", "cool", "dreamer"].map(id => {
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
