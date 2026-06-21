// ─────────────────────────────────────────────────────────────────────────────
// MANUAL DEV TOOL — NOT imported by prod, NOT wired into any route or build step.
//
// Eyeball real synthesis output offline, without a full /api/analyze upload. It
// runs the REAL buildSynthesisInput (normalization + deterministic panel) and the
// REAL synthesizePanel (one live Anthropic call) against hand-built fixtures, then
// prints the synthesis JSON and the synthesisStatus the app would set.
//
// Usage (a throwaway SYNTHESIS_ANTHROPIC_API_KEY is fine):
//   SYNTHESIS_ANTHROPIC_API_KEY=sk-ant-... node scripts/synth_dryrun.js
//   (optional) SYNTHESIS_MODEL=claude-haiku-4-5-20251001   ← this is the default
//
// Importing server.js does NOT boot the server (entry-point guard), so no DB,
// no HTTP listener, and no scoring path is touched.
// ─────────────────────────────────────────────────────────────────────────────

import { synthesizePanel, buildSynthesisInput } from "../server.js";
import { FIXTURE_3JUDGE, FIXTURE_2JUDGE_PARTIAL } from "./synth_fixtures.js";

if (!process.env.SYNTHESIS_ANTHROPIC_API_KEY) {
  console.error("Set SYNTHESIS_ANTHROPIC_API_KEY (a throwaway key is fine) to run the dry-run.");
  process.exit(1);
}

async function run(name, job) {
  console.log(`\n──────────── ${name} ────────────`);
  const { judges, video, panel } = buildSynthesisInput(job);
  console.log(`present: [${panel.judges_present.join(", ")}]   missing: [${panel.judges_missing.join(", ")}]`);
  const syn = await synthesizePanel(judges, video, panel);
  console.log(`synthesisStatus: ${syn ? "ready" : "failed"}`);
  console.log(JSON.stringify(syn, null, 2));
}

await run("3-judge happy path", FIXTURE_3JUDGE);
await run("2-judge partial (Connector missing)", FIXTURE_2JUDGE_PARTIAL);
console.log("\nDry-run complete.");
