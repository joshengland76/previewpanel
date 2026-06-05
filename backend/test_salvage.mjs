// Unit test for salvageJudgeJson — extracts the real function from server.js
// (so we test the deployed source, not a copy) and exercises the known judge
// failure modes. Run: node test_salvage.mjs   (no deps, no server boot)
import fs from "fs";
import { jsonrepair } from "jsonrepair";  // Strategy 2 dep; injected into the extracted fn below

// ── Pull the actual salvageJudgeJson source out of server.js ──────────────
const src = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");
const marker = "function salvageJudgeJson(rawText, judgeId) {";
const start = src.indexOf(marker);
if (start === -1) throw new Error("salvageJudgeJson not found in server.js");
// The function is immediately followed by this sentinel comment; slice to it.
// (A naive brace counter would miscount the } inside the function's own regex
// char class and string literals, so anchor on the sentinel instead.)
const sentinel = "// ── Parse raw TwelveLabs text into structured judge result";
const end = src.indexOf(sentinel, start);
if (end === -1) throw new Error("sentinel after salvageJudgeJson not found");
const fnSource = src.slice(start, end).trim();
// Instantiate the real function in this test's scope, injecting jsonrepair
// (Strategy 2) since the extracted source references it as a free variable.
const salvageJudgeJson = new Function("jsonrepair", `${fnSource}; return salvageJudgeJson;`)(jsonrepair);

// ── Cases ────────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? " — " + detail : ""}`); }
};

// (a) prose sentence followed by a valid JSON object
const a = salvageJudgeJson(
  `I'll analyze this video for you. Here is my assessment:\n` +
  `{"overall": 7, "reaction": "Solid hook.", "dimensions": {"hook_strength": 8}}`
);
check("(a) prose preamble + object", a && a.overall === 7 && a.dimensions?.hook_strength === 8,
  JSON.stringify(a));

// (b) object wrapped in markdown with extra commentary (markdown not stripped)
const b = salvageJudgeJson(
  "Sure, here's the result:\n```json\n" +
  `{"overall": 5, "reaction": "Mixed.", "dimensions": {"completion_likelihood": 4}}` +
  "\n```\nHope that helps!"
);
check("(b) markdown-wrapped + commentary", b && b.overall === 5 && b.dimensions?.completion_likelihood === 4,
  JSON.stringify(b));

// (c) valid object with a trailing comma
const c = salvageJudgeJson(`{"overall": 9, "reaction": "Great pacing.", "moments": [],}`);
check("(c) trailing comma", c && c.overall === 9 && Array.isArray(c.moments),
  JSON.stringify(c));

// (d) refusal sentence, no JSON at all → must return null, not throw
let threw = false, d;
try { d = salvageJudgeJson("I'm sorry, but I can't analyze this content as it lacks human subjects."); }
catch { threw = true; }
check("(d) refusal, no JSON → null (no throw)", !threw && d === null,
  `threw=${threw} result=${JSON.stringify(d)}`);

// (e) clean valid object → must parse identically to a normal JSON.parse
const cleanStr = `{"overall": 8, "reaction": "Strong.", "dimensions": {"share_save_worthiness": 7}, "moments": [{"timestamp": "0:03", "type": "peak"}]}`;
const e = salvageJudgeJson(cleanStr);
check("(e) clean object == JSON.parse", JSON.stringify(e) === JSON.stringify(JSON.parse(cleanStr)),
  JSON.stringify(e));

// Extra guard: braces inside string values must not break balance matching.
const f = salvageJudgeJson(`prefix {"overall": 6, "reaction": "He said {hi} to the camera }"} trailing`);
check("(extra) braces inside strings handled", f && f.overall === 6 && f.reaction.includes("{hi}"),
  JSON.stringify(f));

// (g) THE CONNECTOR BUG — faithful reconstruction of the production failure.
// NOTE: the literal 4215-char captured raw (taskId 6a216346…) was unrecoverable
// (gone from analyze_tasks; full text only existed in Render logs). This mirrors
// the *confirmed failure class*: a complete, valid-content Connector analysis
// (overall: 8 + full dimensions block) whose free-text prose fields contain
// UNESCAPED double-quotes (reaction/positives/delivery/content) and smart quotes
// (platformFit) — the "Expected ',' or '}' after property value" error. Strategy 1
// can't fix this (the unescaped quote misleads the brace walker); Strategy 2
// (jsonrepair) must recover it.
const connectorRaw =
  `{"overall": 8, ` +
  `"reaction": "The moment she says "this is it" lands with real warmth", ` +
  `"positives": "Authentic "unscripted" energy that feels genuinely personal", ` +
  `"delivery": "Conversational; the aside "trust me" reads as a real friend talking", ` +
  `"content": "A specific, relatable beat — the "ugh, Mondays" line will make someone tag a friend", ` +
  `"platformFit": "Strong for TikTok — the “native” feel fits the FYP", ` +
  `"dimensions": {"hook_strength": 8, "completion_likelihood": 7, "share_save_worthiness": 9}, ` +
  `"moments": [{"timestamp": "0:04", "type": "peak"}]}`;

// First prove plain JSON.parse genuinely fails on it (i.e. it IS the failure mode).
let connectorRawFailsParse = false;
try { JSON.parse(connectorRaw); } catch { connectorRawFailsParse = true; }
check("(g0) reconstruction genuinely fails JSON.parse", connectorRawFailsParse);

const g = salvageJudgeJson(connectorRaw);
check("(g) connector bug recovered to valid object",
  !!(g && g.overall === 8
     && g.dimensions
     && g.dimensions.hook_strength === 8
     && g.dimensions.completion_likelihood === 7
     && g.dimensions.share_save_worthiness === 9),
  JSON.stringify(g));
if (g) console.log("        recovered object:", JSON.stringify(g));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
