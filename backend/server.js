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
import Anthropic from "@anthropic-ai/sdk";
import { TwelveLabs } from "twelvelabs-js";
import "dotenv/config";

const execFileAsync = promisify(execFile);
const FFMPEG = fs.existsSync("/opt/homebrew/bin/ffmpeg")
  ? "/opt/homebrew/bin/ffmpeg"
  : "/usr/local/bin/ffmpeg";
const FFPROBE = fs.existsSync("/opt/homebrew/bin/ffprobe")
  ? "/opt/homebrew/bin/ffprobe"
  : "/usr/local/bin/ffprobe";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Ensure uploads directory exists before multer tries to write to it
fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });

const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 4 * 1024 * 1024 * 1024 }, // 4 GB
});

const ALLOWED_ORIGINS = [
  "https://previewpanel.vercel.app",
  "http://localhost:5173",
  "http://localhost:3001",
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman, Railway health checks)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
}));
app.use(express.json());

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

// ── In-memory job store (use Redis in production) ─────────────
const jobs = {};

// ── Shared guardrails injected into every judge prompt ────────
const GUARDRAILS = `
STRICT EXCLUSIONS — you must NEVER suggest changes related to physical appearance, attractiveness, body type, clothing that reveals skin, or any factor outside the creator's direct control over their content. Focus exclusively on: script structure, hook strength, pacing, editing choices, audio quality, lighting choices, on-screen text, thumbnails, titles, and delivery style.

CONTENT GUARDRAILS — you must NEVER provide suggestions that would encourage, normalize, or improve the effectiveness of offensive speech, hate speech, discriminatory language, violence, or the display or promotion of weapons including guns. If the video contains any of these elements, note it as a significant negative factor in the score and suggest removing or replacing that content rather than optimizing it.`;

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

  return `${judge.personality}
${GUARDRAILS}${durationLine}

You are reviewing this video BEFORE it is published on ${platform.toUpperCase()}.
The creator's target audience is: ${audience}.
For ${platform.toUpperCase()}, pay special attention to: ${pf.signals}.

Your score and feedback must explicitly connect to the platform metrics that matter most here: ${pf.metrics}. For each piece of feedback, ask yourself: does this change directly improve one of those metrics? If not, it is not worth mentioning.

Analyze BOTH:
1. DELIVERY — how the video is presented: energy, pacing, body language, eye contact,
   on-camera presence, editing rhythm, audio quality, visual style, and on-screen text
2. CONTENT — what is said: script quality, hook strength, information value,
   narrative structure, and call to action

${judge.momentsInstruction}

You are one of three judges reviewing this video. Each judge must identify a DIFFERENT genuine strength — focus on an aspect the other judges are less likely to notice given your unique lens. Do not manufacture praise; only include positives that are genuinely present in the video.

Provide your analysis in this exact JSON format (no markdown, no backticks):
{
  "overall": <integer 1-10>,
  "reaction": "<2-3 sentence gut reaction in first person>",
  "positives": "<1-2 sentences of genuine praise in your authentic voice — specific, content-focused, never about appearance>",
  "delivery": "<2-3 sentences on HOW the video is delivered>",
  "content": "<2-3 sentences on WHAT is said>",
  "platformFit": "<2 sentences on fit for ${platform} specifically, referencing ${pf.metrics}>",
  "relativeInsight": "<1-2 sentences on what specifically would make this video outperform this creator's own average content — framed as a realistic, achievable improvement>",
  "moments": [
    { "timestamp": "<exact timestamp you observed>", "type": "peak|drop|note", "note": "<your observation>" }
  ],
  "suggestions": [
    "<specific actionable improvement tied to ${pf.metrics}, with timestamp reference>",
    "<specific actionable improvement tied to ${pf.metrics}, with timestamp reference>",
    "<specific actionable improvement tied to ${pf.metrics}, with timestamp reference>"
  ]
}`;
}

// ── ffmpeg conversion ─────────────────────────────────────────────────────────
async function convertToMp4(inputPath) {
  const outputPath = inputPath + ".mp4";
  console.log(`[ffmpeg] Converting ${inputPath} → ${outputPath}`);
  const t0 = Date.now();
  await execFileAsync(FFMPEG, [
    "-i", inputPath,
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac",
    "-movflags", "+faststart",
    "-y", outputPath,
  ]);
  const sizeMB = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
  console.log(`[ffmpeg] Done in ${((Date.now() - t0) / 1000).toFixed(1)}s — output: ${sizeMB} MB`);
  return outputPath;
}

// ── Get video duration via ffprobe ────────────────────────────────────────────
async function getVideoDuration(filePath) {
  try {
    const { stdout } = await execFileAsync(FFPROBE, [
      "-v", "quiet",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      filePath,
    ]);
    const secs = parseFloat(stdout.trim());
    if (isNaN(secs) || secs <= 0) return null;
    console.log(`[ffprobe] Duration: ${secs.toFixed(1)}s`);
    return { secs, label: formatTimestamp(secs) };
  } catch (e) {
    console.warn(`[ffprobe] Could not read duration: ${e.message}`);
    return null;
  }
}

// ── Step 1: Build a VideoContext for the TwelveLabs analyze call ─────────────
// For user-supplied URLs, use { type: "url" } directly — no upload needed.
// For uploaded files, POST the mp4 directly to TwelveLabs /assets using native
// fetch with a long timeout, bypassing the SDK's hardcoded 60s limit entirely.
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
  console.log(`[TwelveLabs] Uploading asset directly: ${filePath} (${sizeMB} MB)…`);
  const t0 = Date.now();

  const buffer = fs.readFileSync(filePath);
  const blob = new Blob([buffer], { type: "video/mp4" });
  const filename = path.basename(filePath);

  const form = new FormData();
  form.append("method", "direct");
  form.append("file", blob, filename);

  const response = await fetch("https://api.twelvelabs.io/v1.3/assets", {
    method: "POST",
    headers: { "x-api-key": process.env.TWELVELABS_API_KEY },
    body: form,
    signal: AbortSignal.timeout(600_000), // 10 min — SDK was hardcoded to 60s
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(`TwelveLabs asset upload failed: HTTP ${response.status} — ${JSON.stringify(body)}`);
  }

  const assetId = body._id;
  if (!assetId) throw new Error(`TwelveLabs asset upload returned no _id: ${JSON.stringify(body)}`);

  console.log(`[TwelveLabs] Asset uploaded in ${((Date.now() - t0) / 1000).toFixed(1)}s — assetId: ${assetId}`);
  return assetId;
}

// ── Step 2: Run TwelveLabs Pegasus analysis for one judge ─────
async function analyzeWithTwelveLabs(videoContext, judge, platform, targetAudience, videoDuration) {
  const prompt = buildTLPrompt(judge, platform, targetAudience, videoDuration);

  console.log(`[TwelveLabs] Starting analysis — judge: ${judge.id}, context: ${JSON.stringify(videoContext)}`);
  const t0 = Date.now();
  const result = await tl().analyze(
    { video: videoContext, prompt, temperature: 0.3, maxTokens: 2048 },
    { timeoutInSeconds: 600 }
  );
  console.log(`[TwelveLabs] Analysis done in ${((Date.now()-t0)/1000).toFixed(1)}s — judge: ${judge.id}`);
  console.log(`[TwelveLabs][${judge.id}] Raw result object keys:`, Object.keys(result ?? {}));
  console.log(`[TwelveLabs][${judge.id}] result.data type:`, typeof result?.data);
  console.log(`[TwelveLabs][${judge.id}] result.data value:`, JSON.stringify(result?.data)?.slice(0, 500));

  // Parse JSON from TwelveLabs response
  const text = result.data || result || "";
  const clean = String(text).replace(/```json|```/g, "").trim();
  console.log(`[TwelveLabs][${judge.id}] clean text (first 500 chars):`, clean.slice(0, 500));

  try {
    const parsed = JSON.parse(clean);
    console.log(`[TwelveLabs][${judge.id}] JSON parsed OK — keys:`, Object.keys(parsed));
    const momentTypes = (parsed.moments || []).map(m => `${m.timestamp}:${m.type}`).join(", ");
    console.log(`[TwelveLabs][${judge.id}] moment types:`, momentTypes || "(none)");
    return parsed;
  } catch (parseErr) {
    console.warn(`[TwelveLabs][${judge.id}] JSON parse failed: ${parseErr.message} — raw length: ${clean.length} chars`);
    if (!process.env.ANTHROPIC_API_KEY) {
      return { overall: 0, reaction: clean, positives: "", delivery: "", content: "", platformFit: "", relativeInsight: "", moments: [], suggestions: [] };
    }
    return await structureWithClaude(clean, judge, platform);
  }
}

// ── Fallback: Claude structures raw TwelveLabs prose ─────────
async function structureWithClaude(rawAnalysis, judge, platform) {
  const msg = await anthropic().messages.create({
    model: "claude-sonnet-4-6-20251031",
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
// Accepts: multipart form (file upload) or JSON (videoUrl)
// Returns: { jobId } immediately, then poll /api/status/:jobId
app.post("/api/analyze", (req, res, next) => {
  console.log(`[upload] Request received — starting multer file parse`);
  upload.single("video")(req, res, (err) => {
    if (err) {
      console.error(`[upload] Multer error:`, err.message);
      return res.status(400).json({ error: err.message });
    }
    const fileSizeMB = req.file ? (req.file.size / 1024 / 1024).toFixed(2) : null;
    console.log(`[upload] Multer done — file: ${req.file?.originalname ?? "none"}, size: ${fileSizeMB ? fileSizeMB + " MB" : "n/a"}, path: ${req.file?.path ?? "n/a"}`);
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

    // Determine which judges to run
    const selectedJudgeIds = judgesParam
      ? JSON.parse(judgesParam)
      : ["critic", "cool", "dreamer"];
    const selectedJudges = JUDGES.filter((j) => selectedJudgeIds.includes(j.id));

    // Create a job ID and start async processing
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    jobs[jobId] = {
      status: "uploading",
      platform,
      targetAudience,
      results: {},
      error: null,
      createdAt: Date.now(),
    };

    console.log(`[${jobId}] Job created — sending jobId to client`);
    res.json({ jobId });

    // Run the pipeline asynchronously (don't await in request handler)
    runPipeline(jobId, videoUrl, filePath, platform, targetAudience, selectedJudges);
  } catch (err) {
    console.error(`[analyze] Unexpected error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Background pipeline ───────────────────────────────────────
async function runPipeline(jobId, videoUrl, filePath, platform, targetAudience, selectedJudges) {
  console.log(`[${jobId}] Pipeline starting — platform: ${platform}, judges: ${selectedJudges.map(j=>j.id).join(", ")}`);
  let convertedPath = null;
  try {
    // 1. Convert uploaded file to mp4, then resolve a public URL
    jobs[jobId].status = "uploading";
    console.log(`[${jobId}] Step 1: converting and uploading to TwelveLabs`);
    let videoDuration = null;
    if (filePath) {
      convertedPath = await convertToMp4(filePath);
      videoDuration = await getVideoDuration(convertedPath);
      if (videoDuration) jobs[jobId].videoDuration = videoDuration;
    }
    const videoContext = await getVideoContext(videoUrl, convertedPath || filePath);
    jobs[jobId].status = "analyzing";
    console.log(`[${jobId}] Step 2: running judges sequentially${videoDuration ? ` — duration: ${videoDuration.label}` : ""}`);

    // 2. Run judges sequentially with retries
    for (const judge of selectedJudges) {
      let lastErr;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (attempt > 1) {
            console.log(`[${jobId}] Judge ${judge.id} retry ${attempt}/3 — waiting 5s…`);
            await new Promise(r => setTimeout(r, 5000));
          }
          const result = await analyzeWithTwelveLabs(videoContext, judge, platform, targetAudience, videoDuration);
          jobs[jobId].results[judge.id] = { status: "done", data: result };
          console.log(`[${jobId}] Judge ${judge.id} complete — stored:`, JSON.stringify(jobs[jobId].results[judge.id]).slice(0, 300));
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          // Extract the most useful error info from TwelveLabs responses
          let detail = err.message;
          try { detail = JSON.parse(err.message.match(/\{[\s\S]*\}/)?.[0] ?? "{}").message || detail; } catch {}
          console.error(`[${jobId}] Judge ${judge.id} attempt ${attempt} failed: ${detail}`);
        }
      }
      if (lastErr) {
        let detail = lastErr.message;
        try { detail = JSON.parse(lastErr.message.match(/\{[\s\S]*\}/)?.[0] ?? "{}").message || detail; } catch {}
        jobs[jobId].results[judge.id] = {
          status: "error",
          error: detail,
          data: {
            overall: 0,
            reaction: `${judge.name} couldn't analyse this video: ${detail}`,
            positives: "", delivery: "", content: "", platformFit: "", relativeInsight: "",
            moments: [], suggestions: [],
          },
        };
      }
    }

    const succeeded = selectedJudges.filter(j => jobs[jobId].results[j.id]?.status === "done").length;
    const total = selectedJudges.length;
    if (succeeded === total) {
      jobs[jobId].status = "done";
      console.log(`[${jobId}] Pipeline complete — all ${total} judges succeeded`);
    } else if (succeeded > 0) {
      jobs[jobId].status = "partial";
      console.log(`[${jobId}] Pipeline complete — ${succeeded}/${total} judges succeeded`);
    } else {
      const errors = selectedJudges.map(j => jobs[jobId].results[j.id]?.error).filter(Boolean);
      jobs[jobId].status = "error";
      jobs[jobId].error = errors[0] ?? "All judges failed — check TwelveLabs API status";
      console.log(`[${jobId}] Pipeline failed — 0/${total} judges succeeded`);
    }

    // 3. Clean up both the original upload and the converted mp4
    if (filePath) fs.unlink(filePath, () => {});
    if (convertedPath) fs.unlink(convertedPath, () => {});
  } catch (err) {
    jobs[jobId].status = "error";
    jobs[jobId].error = err.message;
    console.error(`[${jobId}] Pipeline error: ${err.message}`, err);
    if (filePath) fs.unlink(filePath, () => {});
    if (convertedPath) fs.unlink(convertedPath, () => {});
  }
}

// ── GET /api/status/:jobId ────────────────────────────────────
app.get("/api/status/:jobId", (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json({
    status: job.status,
    results: job.results,
    error: job.error,
    duration: job.videoDuration?.secs || null,
  });
});

// ── Health check ──────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ ok: true }));

// ── Start ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`PreviewPanel backend running on http://localhost:${PORT}`);
  console.log(`TwelveLabs key: ${process.env.TWELVELABS_API_KEY ? "✓" : "✗ MISSING"}`);
  console.log(`Anthropic key:  ${process.env.ANTHROPIC_API_KEY ? "✓" : "– not set (Claude fallback disabled)"}`);
});

// Disable all HTTP-level timeouts — uploads can be large and slow,
// and the /api/analyze route returns a jobId immediately anyway.
server.timeout = 0;
server.headersTimeout = 0;
server.requestTimeout = 0;
server.keepAliveTimeout = 30000;
