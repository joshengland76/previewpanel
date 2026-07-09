// scoring/cdims.js — C_dims v1 Claude extraction, ported from the research
// repo's parser.py (stage_d_claude_extract / CLAUDE_EXTRACTION_PROMPT).
// LOCKED v1 prompt/schema -- NOT v2.1 (the hook-field extension tested and
// closed null in the capstone). Flagged off by default (EXTRACT_CDIMS env
// var); excluded entirely for research_api-sourced submissions (research
// already collects this via its own separate pipeline).
//
// Key-separation pattern (mirrors the existing synthesis feature): uses its
// OWN dedicated Anthropic key (CDIMS_ANTHROPIC_API_KEY), never the shared
// ANTHROPIC_API_KEY used by the main judge-fallback path -- a C_dims outage
// or quota issue can never touch judging.

import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const CDIMS_MODEL = process.env.CDIMS_MODEL || "claude-sonnet-4-6";
const FRAME_TIMESTAMPS_PCT = [0.10, 0.35, 0.60, 0.85]; // matches parser.py stage_c exactly

const OBJECTIVES = [
  "Funny Videos/Comedy", "Food & Drinks/Cooking", "Travel", "Fashion", "Makeup/Beauty",
  "Pets/Animals", "Fitness/Wellness", "Dancing", "Gaming", "Storytelling", "Life Hacks",
  "Fun Facts", "Shopping", "Cars/Automotive", "ASMR", "Myth Busting", "Educational/How-To",
  "Aesthetic/Vibes", "Business/Finance",
];

// Ported verbatim from parser.py's CLAUDE_EXTRACTION_PROMPT (locked v1 schema).
const CDIMS_PROMPT_TEMPLATE = `You are analyzing a short-form social media video to extract structured features for a correlation research study. You will be given the video's caption, basic metadata, and several sampled frames including the first/cover frame.

Return ONLY a single JSON object with the exact keys shown below. No prose, no markdown fences, no explanation — just the JSON.

Video metadata:
- Platform: {platform}
- Posted: {posted_at}
- Caption: {caption}
- Audio track: {audio_track}

Required JSON output (all fields required, use null only if explicitly noted):

{
    "objective": "<one of: {objectives}>",
    "objective_confidence": <float 0.0 to 1.0>,
    "is_sponsored": <true or false>,
    "sponsored_brand": "<brand name or null>",
    "sponsored_detection_method": "<one of: hashtag, mention, caption_keyword, manual, none>",

    "caption_tone": "<one of: educational, entertaining, inspirational, promotional, conversational>",
    "hook_style": "<one of: question, claim, pattern_interrupt, visual_promise, story, none>",
    "cta_present": <true or false>,
    "cta_type": "<one of: follow, save, comment, link, buy, none>",
    "specificity": "<one of: vague, specific>",
    "direct_address": <true or false>,

    "hook_strength_visual": <integer 1-5, how attention-grabbing is the first frame visually>,
    "hook_strength_audio": <integer 1-5, infer from caption/audio track context — bold sound choice / hook-line opening = higher>,

    "cover_text": "<text visible on the first/cover frame, or empty string if none>",
    "cover_text_length": <integer character count of cover_text>,
    "cover_text_promises_value": <0 or 1; 1 if cover text promises specific value like 'how to X', 'X tips for Y', 'I tried X for Z days', etc>,

    "text_overlay_density": "<one of: none, sparse, moderate, heavy>",
    "text_overlay_role": "<one of: narrative, captions, emphasis, jokes, multi, none>",

    "emotion_primary": "<one of: humor, joy, awe, curiosity, anger, fear, sadness, empathy, urgency, inspiration, nostalgia, frustration, neutral>",
    "emotion_primary_intensity": <integer 1-5>,
    "emotion_secondary": "<same options as primary, or null if no clear second emotion>",
    "emotion_secondary_intensity": <integer 1-5, or null if no secondary>,
    "emotion_combination": "<short snake_case label like 'inspiring_struggle', 'curiosity_delight', 'frustration_humor', or 'single' if no combination>",

    "big_funny": <integer 1-10>,
    "big_compelling": <integer 1-10>,
    "big_authentic": <integer 1-10>,
    "big_novel": <integer 1-10>,
    "big_visually_engaging": <integer 1-10>,
    "big_emotionally_resonant": <integer 1-10>,
    "big_useful": <integer 1-10>,
    "big_surprising": <integer 1-10>,
    "big_relatable": <integer 1-10>,
    "big_polished": <integer 1-10>,

    "trending_topic_likelihood": <integer 1-10>,
    "trending_alignment_signals": <integer 0-10, count of pattern signals you noticed>,
    "audio_likely_trending": <true or false>
}

Scoring guidance for the 1-10 dimensions: 1 means "not at all"; 5 means "moderately"; 10 means "exceptionally". Be honest — most videos should score in the 3-7 range. Reserve 9-10 for content that genuinely stands out.

Scoring guidance for the 1-5 intensity dimensions: 1 = minimal/absent, 3 = clearly present, 5 = dominant/peak.

Hook strength guidance: a 5/5 visual hook stops scrolling immediately (striking image, bold composition, unusual angle). A 1/5 hook is generic or static. Audio hooks: a 5/5 starts with a compelling line, urgent question, or attention-grabbing sound — inferred from audio track context plus caption opening if visible.

Cover text guidance: the cover frame is roughly the first 10% of frames (use the earliest frame provided). Extract text exactly as visible. "Promises value" means the text makes a specific claim or promise about content that follows.

Text overlay density: 'none' = no text overlays through video; 'sparse' = occasional labels; 'moderate' = regular overlays; 'heavy' = text-driven where overlays are primary content.

Emotion guidance: capture both dominant and second emotion when meaningful. For combination labels, use short descriptive snake_case like 'inspiring_struggle' (someone overcoming difficulty), 'curiosity_delight' (surprise reveal), 'frustration_humor' (relatable complaint comedy). If the video has one clear emotion only, set secondary fields to null and combination to 'single'.

Trending pattern signals to count: use of "POV:", current slang, trending audio mentions, references to viral events near the post date, hashtag stacking patterns, hook phrasing like "no one's talking about" or "everyone's doing this", explicit trend references.

For sponsorship detection: look for brand mentions (@brand), promo codes, gift/PR call-outs, hashtags like #ad #sponsored #partner, or product placement that appears commercially driven.
`;

let _cdimsAnthropic = null;
function cdimsAnthropic() {
  if (!_cdimsAnthropic) {
    if (!process.env.CDIMS_ANTHROPIC_API_KEY) return null;
    _cdimsAnthropic = new Anthropic({ apiKey: process.env.CDIMS_ANTHROPIC_API_KEY });
  }
  return _cdimsAnthropic;
}

export async function sampleFrames(filePath, durationSecs) {
  const frames = [];
  for (const pct of FRAME_TIMESTAMPS_PCT) {
    const ts = Math.max(0, durationSecs * pct);
    try {
      const { stdout } = await execFileAsync(FFMPEG, [
        "-ss", String(ts), "-i", filePath, "-frames:v", "1", "-q:v", "3",
        "-f", "image2pipe", "-vcodec", "mjpeg", "-",
      ], { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 });
      frames.push(stdout.toString("base64"));
    } catch (e) {
      console.warn(`[cdims] frame sample failed at ${ts.toFixed(1)}s: ${e.message}`);
    }
  }
  return frames;
}

// Mirrors server.js's salvageJudgeJson pattern (balanced-brace extract, then
// a coarse first{...last} slice as fallback) -- duplicated locally rather
// than imported since server.js does not currently export it.
function salvageJson(rawText) {
  const text = String(rawText || "");
  try {
    const start = text.indexOf("{");
    if (start !== -1) {
      let depth = 0, end = -1, inStr = false, esc = false;
      for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === "\\") esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') { inStr = true; continue; }
        if (ch === "{") depth++;
        else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end !== -1) {
        const candidate = text.slice(start, end + 1).replace(/,(\s*[}\]])/g, "$1");
        return JSON.parse(candidate);
      }
    }
  } catch {
    // fall through
  }
  try {
    const start = text.indexOf("{"), end = text.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1));
  } catch {
    // unrecoverable
  }
  return null;
}

/**
 * extractCdims({ filePath, durationSecs, platform, postedAt, caption, audioTrack, source })
 * -> { dims, costUsd, ok } | { dims: null, ok: false, reason }
 *
 * Caller is responsible for checking process.env.EXTRACT_CDIMS === "true"
 * before calling -- this function itself also re-checks the flag and the
 * research_api exclusion as a defense-in-depth guard, not the sole gate.
 */
export async function extractCdims({ filePath, durationSecs, platform, postedAt, caption, audioTrack, source }) {
  if (process.env.EXTRACT_CDIMS !== "true") {
    return { dims: null, ok: false, reason: "EXTRACT_CDIMS flag off" };
  }
  if (source === "research_api") {
    return { dims: null, ok: false, reason: "research_api source excluded (research collects C_dims via its own pipeline)" };
  }
  const client = cdimsAnthropic();
  if (!client) {
    return { dims: null, ok: false, reason: "CDIMS_ANTHROPIC_API_KEY not set" };
  }

  const frames = await sampleFrames(filePath, durationSecs);
  if (frames.length === 0) {
    return { dims: null, ok: false, reason: "no frames sampled" };
  }

  const prompt = CDIMS_PROMPT_TEMPLATE
    .replace("{platform}", platform)
    .replace("{posted_at}", postedAt || "unknown")
    .replace("{caption}", (caption || "(empty)").slice(0, 2000))
    .replace("{audio_track}", audioTrack || "unknown")
    .replace("{objectives}", OBJECTIVES.join(", "));

  const content = frames.map((f) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: f } }));
  content.push({ type: "text", text: prompt });

  const t0 = Date.now();
  let response;
  try {
    response = await client.messages.create({
      model: CDIMS_MODEL, max_tokens: 2048, messages: [{ role: "user", content }],
    });
  } catch (e) {
    console.error(`[cdims] Anthropic call failed: ${e.message}`);
    return { dims: null, ok: false, reason: `anthropic_error: ${e.message}` };
  }
  const elapsedMs = Date.now() - t0;

  const rawText = response.content?.[0]?.text || "";
  const dims = salvageJson(rawText);

  // Cost log — sonnet-4-6 pricing per the research pipeline's own measured
  // rate ($3/M in, $15/M out; observed ~$0.026-0.036/call in that pipeline).
  const usage = response.usage || {};
  const costUsd = ((usage.input_tokens || 0) * 3 + (usage.output_tokens || 0) * 15) / 1_000_000;
  console.log(`[cdims] call complete: ${elapsedMs}ms, in=${usage.input_tokens} out=${usage.output_tokens} `
    + `cost=$${costUsd.toFixed(4)} parsed=${dims ? "ok" : "FAILED"}`);

  if (!dims) {
    console.warn(`[cdims] JSON salvage failed, raw text head: ${rawText.slice(0, 200)}`);
    return { dims: null, ok: false, reason: "json_parse_failed", costUsd, elapsedMs };
  }

  return { dims, ok: true, costUsd, elapsedMs };
}
