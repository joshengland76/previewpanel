// Track Record v5 unit tests -- exercises the REAL era logic from server.js
// (extracted by name with a string/template/comment-aware brace matcher, so no
// re-implementation drift). Covers: era separation + leakage, JOINED prediction
// identity, per-era CALL floor, hero handoff at n=6, retirement at n=20, and
// null-config gating.  Run: node backend/test_track_record_v5.mjs
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const CS = JSON.parse(fs.readFileSync(path.join(__dirname, "scoring", "call_semantics.json"), "utf8"));

// Brace matcher that skips '...' "..." `...${}` // /* */ so template-literal
// braces don't throw off the depth count.
function fnSource(name) {
  const m = new RegExp(`\\nfunction ${name}\\s*\\(`).exec(src);
  if (!m) throw new Error(`not found: ${name}`);
  // Skip the parameter list (which may be a destructured `{ ... }`) to the
  // real body brace: match the params' ( ) then take the next {.
  let p = src.indexOf("(", m.index), pd = 0;
  for (; p < src.length; p++) { if (src[p] === "(") pd++; else if (src[p] === ")") { pd--; if (pd === 0) { p++; break; } } }
  let j = src.indexOf("{", p), depth = 0, mode = "code";
  const tmplReturn = []; // depths at which a } closes a ${ } and returns to tmpl
  for (; j < src.length; j++) {
    const ch = src[j], nx = src[j + 1];
    if (mode === "line") { if (ch === "\n") mode = "code"; continue; }
    if (mode === "block") { if (ch === "*" && nx === "/") { mode = "code"; j++; } continue; }
    if (mode === "sq") { if (ch === "\\") j++; else if (ch === "'") mode = "code"; continue; }
    if (mode === "dq") { if (ch === "\\") j++; else if (ch === '"') mode = "code"; continue; }
    if (mode === "tmpl") {
      if (ch === "\\") j++;
      else if (ch === "`") mode = "code";
      else if (ch === "$" && nx === "{") { mode = "code"; depth++; tmplReturn.push(depth); j++; }
      continue;
    }
    // mode === code
    if (ch === "/" && nx === "/") { mode = "line"; j++; continue; }
    if (ch === "/" && nx === "*") { mode = "block"; j++; continue; }
    if (ch === "'") { mode = "sq"; continue; }
    if (ch === '"') { mode = "dq"; continue; }
    if (ch === "`") { mode = "tmpl"; continue; }
    if (ch === "{") { depth++; continue; }
    if (ch === "}") {
      if (tmplReturn.length && tmplReturn[tmplReturn.length - 1] === depth) {
        tmplReturn.pop(); depth--; mode = "tmpl"; continue;
      }
      depth--;
      if (depth === 0) { j++; break; }
    }
  }
  return src.slice(m.index + 1, j);
}
function constSource(name) {
  const m = new RegExp(`\\nconst ${name} = \\[[\\s\\S]*?\\];`).exec(src);
  if (!m) throw new Error(`const not found: ${name}`);
  return m[0];
}

const CALL_SIZE_TIERS = CS.sizeTiers, CALLS_TIER = CS.callsTier, AVERAGES_TIER = CS.averagesTier;
const GRADED_WINDOW = CS.gradedWindow, JOINED_RETIREMENT = CS.joinedRetirement, AGGREGATE_MIN = 4, BASELINE_MIN = 4;

const fns = ["topBottomK", "callsTierFor", "averagesTierFor", "assignRankCalls",
  "computeEraAggregates", "shapeEra", "computeMilestone", "assembleTrackRecordResponse", "rowEra",
  "trFixtureDate", "trFixtureEra", "trFixtureRows", "buildTrackRecordFixture"]
  .map(fnSource).join("\n\n");
const consts = ["TR_FIXTURE_OBJS", "TR_FIXTURE_CAPS", "TR_BLIND_SPECS", "MILESTONE_TIERS"].map(constSource).join("\n");
const api = new Function(
  "CALL_SIZE_TIERS,CALLS_TIER,AVERAGES_TIER,GRADED_WINDOW,JOINED_RETIREMENT,AGGREGATE_MIN,BASELINE_MIN,console",
  fns + "\n" + consts + "\nreturn { shapeEra, assembleTrackRecordResponse, buildTrackRecordFixture, trFixtureEra, trFixtureRows, rowEra, topBottomK, computeMilestone };"
)(CALL_SIZE_TIERS, CALLS_TIER, AVERAGES_TIER, GRADED_WINDOW, JOINED_RETIREMENT, AGGREGATE_MIN, BASELINE_MIN, console);

let failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };

// helper: build an era of n rows with a clean top>bottom gradient. joined=true
// vs false gives disjoint fixture ids, so the two eras never share a row.
function gradientEra(n, joined) {
  const specs = [];
  for (let i = 0; i < n; i++) {
    const f = n > 1 ? i / (n - 1) : 0;
    specs.push({ prediction: 0.9 - f * 1.2, percentile: Math.round(95 - f * 90), outcome: 2.2 - f * 1.8 });
  }
  return api.trFixtureEra(api.trFixtureRows(specs, { joined }));
}
const joinedEra = (n) => gradientEra(n, true);
const blindEra = (n) => gradientEra(n, false);

// 1. era separation + no leakage (assembleTrackRecordResponse asserts leakage)
{
  const p = api.buildTrackRecordFixture("mixed");
  const bIds = new Set(p.eras.blind.graded.map((g) => g.postedVideoId));
  ok(!p.eras.joined.graded.some((g) => bIds.has(g.postedVideoId)), "era separation: joined/blind share a postedVideoId");
}

// 2. JOINED prediction identity -- shapeEra preserves each row's prediction (the
//    preview score it was handed), never rewrites it.
{
  const rows = api.trFixtureRows([
    { prediction: 0.42, percentile: 61, outcome: 1.3 },
    { prediction: 0.71, percentile: 74, outcome: 1.8 },
  ], { joined: true });
  const era = api.trFixtureEra(rows);
  const byId = new Map(era.graded.map((g) => [g.postedVideoId, g.prediction]));
  ok(byId.get(rows[0].id) === 0.42 && byId.get(rows[1].id) === 0.71, "JOINED prediction identity: shapeEra changed a prediction");
}

// 3. per-era CALL floor -- no calls below n=6, calls at n>=6 (topBottomK)
{
  ok(api.topBottomK(5) === null, "call floor: n=5 should have no calls");
  ok(api.topBottomK(6) === 2, "call floor: n=6 should be k=2");
  ok(joinedEra(5).hasCalls === false, "call floor: n=5 era hasCalls should be false");
  ok(joinedEra(6).hasCalls === true, "call floor: n=6 era hasCalls should be true");
}

// 4. hero handoff at n=6 -- JOINED owns the hero once it has calls
{
  const blind = blindEra(6); // reuse gradient as a populated blind
  const at5 = api.assembleTrackRecordResponse({ handle: "t", welcomeSeen: true, state: "active", blind, joined: joinedEra(5), blindNullConfig: false });
  const at6 = api.assembleTrackRecordResponse({ handle: "t", welcomeSeen: true, state: "active", blind, joined: joinedEra(6), blindNullConfig: false });
  ok(at5.heroOwner === "blind", "hero handoff: joined n=5 must NOT own the hero");
  ok(at6.heroOwner === "joined", "hero handoff: joined n=6 must own the hero");
}

// 5. retirement at n=20 -- blind retires once joined graded n>=20
{
  const blind = blindEra(6);
  const at19 = api.assembleTrackRecordResponse({ handle: "t", welcomeSeen: true, state: "active", blind, joined: joinedEra(19), blindNullConfig: false });
  const at20 = api.assembleTrackRecordResponse({ handle: "t", welcomeSeen: true, state: "active", blind, joined: joinedEra(20), blindNullConfig: false });
  ok(at19.retired === false, "retirement: joined n=19 must NOT retire blind");
  ok(at20.retired === true, "retirement: joined n=20 must retire blind");
}

// 6. null-config gating -- only the null-config set carries the flag
{
  ok(api.buildTrackRecordFixture("null-blind").eras.blind.nullConfig === true, "null-config gating: null-blind must be nullConfig=true");
  ok(api.buildTrackRecordFixture("blind-only").eras.blind.nullConfig === false, "null-config gating: blind-only must be nullConfig=false");
  ok(api.buildTrackRecordFixture("mixed").eras.blind.nullConfig === false, "null-config gating: mixed must be nullConfig=false");
}

// 7. rowEra discriminator
{
  ok(api.rowEra({ source: "study_history" }) === "blind", "rowEra: study_history -> blind");
  ok(api.rowEra({ source: "prospect_report" }) === "blind", "rowEra: prospect_report -> blind");
  ok(api.rowEra({ source: "app", match_tier: 1 }) === "joined", "rowEra: matched own post -> joined");
  ok(api.rowEra({ source: "app", match_tier: null }) === null, "rowEra: unmatched own post -> null (neither era)");
}

// 8. v5.1 MILESTONE flag logic (computeMilestone)
{
  const cm = api.computeMilestone;
  ok(cm(5, true, {}).milestoneModal === null, "milestone: n=5 -> no modal");
  ok(cm(6, true, {}).milestoneModal === 6, "milestone: n=6 welcome-seen -> 6");
  ok(cm(9, true, {}).milestoneModal === 9, "milestone: n=9 -> 9");
  ok(cm(12, true, {}).milestoneModal === 12, "milestone: n=12 -> 12");
  // one-per-session: highest UNCROSSED tier only
  ok(cm(12, true, { 6: true, 9: true }).milestoneModal === 12, "milestone: highest uncrossed = 12");
  ok(cm(12, true, { 6: true, 9: true, 12: true }).milestoneModal === null, "milestone: all crossed -> none");
  ok(cm(9, true, { 6: true }).milestoneModal === 9, "milestone: 6 crossed, n=9 -> 9");
  // 4th tier at n>=40 (window cap)
  ok(cm(40, true, {}).milestoneModal === 40, "milestone: n=40 -> 40");
  ok(cm(40, true, { 6: true, 9: true, 12: true }).milestoneModal === 40, "milestone: highest uncrossed = 40");
  ok(cm(12, true, { 6: true, 9: true, 12: true }).milestoneModal === null, "milestone: n=12 all-of-12 crossed, 40 not reached -> none");
  // welcome outranks on first visit -> no modal, just backfill
  ok(cm(9, false, {}).milestoneModal === null, "milestone: welcome-unseen -> no modal (welcome outranks)");
  // BACKFILL GUARD: first-visit qualifying record marks all applicable tiers, no modal
  const bf = cm(14, false, {});
  ok(bf.milestoneModal === null && JSON.stringify(bf.backfill) === JSON.stringify([6, 9, 12]),
    "backfill guard: first-visit n=14 marks [6,9,12] (not 40, n<40), shows nothing (ballerinafarm day one)");
  ok(JSON.stringify(cm(40, false, {}).backfill) === JSON.stringify([6, 9, 12, 40]), "backfill guard: first-visit n=40 marks all four");
  ok(JSON.stringify(cm(7, false, {}).backfill) === JSON.stringify([6]), "backfill guard: first-visit n=7 marks [6] only");
}

// 9. v5.1 BADGE fixtures -- neutral persistence + red unseen + zero-hiding
{
  const fresh = api.buildTrackRecordFixture("badge-fresh");
  const seen = api.buildTrackRecordFixture("badge-seen");
  const mixed = api.buildTrackRecordFixture("badge-mixed");
  ok(fresh.totalGradedCount === 14 && seen.totalGradedCount === 14,
    "badge: neutral M persists across fresh/seen (both 14)");
  ok(fresh.unseenGradedCount === 14 && seen.unseenGradedCount === 0,
    "badge: red unseen = 14 fresh, 0 after seen (clears on view)");
  ok(mixed.previewsCount === 24 && mixed.unseenGradedCount === 3, "badge-mixed: 24 previews + red 3");
  ok(fresh.previewsCount === 0, "badge: previews count 0 hides (zero-hiding)");
  // red unseen SUPPRESSED below 6 graded (neutral count still shows)
  const sub6 = api.buildTrackRecordFixture("badge-sub6");
  ok(sub6.totalGradedCount === 4 && sub6.unseenGradedCount === 0,
    "badge-sub6: 4 graded, red suppressed (0) below the 6-graded threshold");
  // milestone fixtures compute their modal via real logic
  ok(api.buildTrackRecordFixture("milestone-6").milestoneModal === 6, "fixture milestone-6 -> modal 6");
  ok(api.buildTrackRecordFixture("milestone-12").milestoneModal === 12, "fixture milestone-12 -> modal 12");
  ok(api.buildTrackRecordFixture("milestone-40").milestoneModal === 40, "fixture milestone-40 -> modal 40");
  // welcome-noprepop: no blind data, welcome unseen
  const wp = api.buildTrackRecordFixture("welcome-noprepop");
  ok(wp.blindGradedCount === 0 && wp.welcomeSeen === false, "welcome-noprepop: no blind data + welcome unseen (no-prepop variant)");
}

if (failures.length) {
  console.log(`FAILED (${failures.length}):`);
  for (const f of failures) console.log("  - " + f);
  process.exit(1);
}
console.log("All Track Record v5 + v5.1 tests passed (era separation, prediction identity, call floor, hero handoff, retirement, null-config, rowEra, milestone ladder + backfill guard + one-per-session, badge neutral/unseen/zero-hiding, welcome-noprepop).");
