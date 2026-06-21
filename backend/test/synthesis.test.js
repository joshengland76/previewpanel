// Offline unit tests for the panel-synthesis pure logic — NO network, NO API key.
// Run from backend/:  node test/synthesis.test.js
//
// Imports the REAL functions from server.js. The entry-point guard in server.js
// means this import does NOT boot the server (no DB, no listen, no network).

import assert from "node:assert/strict";
import { computeSynthesisVerdict, buildSynthesisInput } from "../server.js";

let failed = 0;
function test(name, fn) {
  try { fn(); console.log("  ✓", name); }
  catch (e) { failed++; console.error("  ✗", name, "\n      " + String(e.message).split("\n")[0]); }
}

// ── computeSynthesisVerdict: rounding (Math.round, half-up) + action thresholds ──
// thresholds: headline >= 8 post, 5-7 polish, <= 4 rework.
console.log("computeSynthesisVerdict — rounding + action thresholds");
test("7.5 rounds to 8 -> post (post/polish boundary)", () => {
  assert.deepEqual(computeSynthesisVerdict([7.5]), { headline_score: 8, action: "post" });
});
test("7.49 rounds to 7 -> polish (post/polish boundary)", () => {
  assert.deepEqual(computeSynthesisVerdict([7.49]), { headline_score: 7, action: "polish" });
});
test("4.5 rounds to 5 -> polish (polish/rework boundary)", () => {
  assert.deepEqual(computeSynthesisVerdict([4.5]), { headline_score: 5, action: "polish" });
});
test("4.49 rounds to 4 -> rework (polish/rework boundary)", () => {
  assert.deepEqual(computeSynthesisVerdict([4.49]), { headline_score: 4, action: "rework" });
});
test("two judges -> average of the two ([6,9]=7.5 -> 8 post)", () => {
  assert.deepEqual(computeSynthesisVerdict([6, 9]), { headline_score: 8, action: "post" });
});
test("two judges ([5,6]=5.5 -> 6 polish)", () => {
  assert.deepEqual(computeSynthesisVerdict([5, 6]), { headline_score: 6, action: "polish" });
});
test("single judge ([9] -> 9 post)", () => {
  assert.deepEqual(computeSynthesisVerdict([9]), { headline_score: 9, action: "post" });
});
test("single judge ([3] -> 3 rework)", () => {
  assert.deepEqual(computeSynthesisVerdict([3]), { headline_score: 3, action: "rework" });
});

// ── buildSynthesisInput: normalization (critic->editor, cool->trendsetter) + panel ──
console.log("buildSynthesisInput — normalization + deterministic panel");
function mkData(overall, moments = []) {
  return {
    overall,
    dimensions: { hook_strength: overall },
    objective_fit: { score: overall, verdict: "hits", reasoning: "x" },
    moments,
    suggestions: ["s"],
  };
}
const baseJob = { platform: "tiktok", objective: "business_finance", videoDuration: { secs: 48 } };

test("all three present -> critic->editor, cool->trendsetter, connector->connector", () => {
  const job = { ...baseJob, results: {
    critic: { status: "done", data: mkData(7) },
    cool: { status: "done", data: mkData(7) },
    connector: { status: "done", data: mkData(8) },
  }};
  const { judges, panel } = buildSynthesisInput(job);
  assert.deepEqual(judges.map((j) => j.name), ["editor", "trendsetter", "connector"]);
  assert.deepEqual(panel, { judges_present: ["editor", "trendsetter", "connector"], judges_missing: [] });
});

test("connector errored -> present [editor,trendsetter], missing [connector]", () => {
  const job = { ...baseJob, results: {
    critic: { status: "done", data: mkData(7) },
    cool: { status: "done", data: mkData(7) },
    connector: { status: "error" },
  }};
  const { judges, panel } = buildSynthesisInput(job);
  assert.deepEqual(panel.judges_present, ["editor", "trendsetter"]);
  assert.deepEqual(panel.judges_missing, ["connector"]);
  assert.equal(judges.length, 2);
});

test("single judge (only critic done) -> present [editor], missing []", () => {
  const job = { ...baseJob, results: { critic: { status: "done", data: mkData(6) } } };
  const { panel } = buildSynthesisInput(job);
  assert.deepEqual(panel, { judges_present: ["editor"], judges_missing: [] });
});

test("panel matches job.results (a NULL-overall judge counts as missing)", () => {
  const job = { ...baseJob, results: {
    critic: { status: "done", data: mkData(7) },
    cool: { status: "done", data: { overall: null } }, // returned but unscored
    connector: { status: "timeout" },
  }};
  const { panel } = buildSynthesisInput(job);
  assert.deepEqual(panel.judges_present, ["editor"]);
  assert.deepEqual(panel.judges_missing.sort(), ["connector", "trendsetter"]);
});

test("sentiment is included ONLY when present on a note", () => {
  const job = { ...baseJob, results: {
    critic: { status: "done", data: mkData(7, [
      { timestamp: "0:21", type: "peak", note: "with type" },
      { timestamp: "0:10", note: "no type" },
    ]) },
  }};
  const { judges } = buildSynthesisInput(job);
  const notes = judges[0].timestamped_notes;
  const withType = notes.find((n) => n.note === "with type");
  const noType = notes.find((n) => n.note === "no type");
  assert.equal(withType.sentiment, "peak");
  assert.equal("sentiment" in noType, false, "a note with no type must serialize without a sentiment key");
  assert.equal(noType.t_seconds, 10);
});

if (failed) { console.error(`\n${failed} test(s) FAILED`); process.exit(1); }
console.log("\nAll synthesis unit tests passed.");
