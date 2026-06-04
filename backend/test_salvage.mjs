// Unit test for salvageJudgeJson — extracts the real function from server.js
// (so we test the deployed source, not a copy) and exercises the known judge
// failure modes. Run: node test_salvage.mjs   (no deps, no server boot)
import fs from "fs";

// ── Pull the actual salvageJudgeJson source out of server.js ──────────────
const src = fs.readFileSync(new URL("./server.js", import.meta.url), "utf8");
const marker = "function salvageJudgeJson(rawText) {";
const start = src.indexOf(marker);
if (start === -1) throw new Error("salvageJudgeJson not found in server.js");
// The function is immediately followed by this sentinel comment; slice to it.
// (A naive brace counter would miscount the } inside the function's own regex
// char class and string literals, so anchor on the sentinel instead.)
const sentinel = "// ── Parse raw TwelveLabs text into structured judge result";
const end = src.indexOf(sentinel, start);
if (end === -1) throw new Error("sentinel after salvageJudgeJson not found");
const fnSource = src.slice(start, end).trim();
// Instantiate the real function in this test's scope.
const salvageJudgeJson = new Function(`${fnSource}; return salvageJudgeJson;`)();

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
