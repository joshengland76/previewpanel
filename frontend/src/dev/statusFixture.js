// Dev-preview /api/status fixtures (dev-only; not used by the live app).
//
// STATUS_FULL is the REAL recorded crookie response on synthesis v2.2 (see
// realStatusCrookie.js) — real takeaways, splits:[], action "post".
// The rest are constructed to exercise specific states against the v2 contract
// (takeaways + consensus.splits).

import { STATUS_FULL } from "./realStatusCrookie.js";
export { STATUS_FULL };

// Real Full data, Editor's clips stripped — exercises the clips empty state while
// captions (Connector) + hashtags (Trendsetter) stay populated.
export const STATUS_NO_CLIPS = {
  ...STATUS_FULL,
  results: {
    ...STATUS_FULL.results,
    critic: { ...STATUS_FULL.results.critic, data: { ...STATUS_FULL.results.critic.data, clips: [] } },
  },
};

// Real Full data + ONE injected genuine split (incompatible stances on the same
// point) — exercises the conditional "Where they disagree" card.
export const STATUS_WITH_SPLITS = {
  ...STATUS_FULL,
  synthesis: {
    ...STATUS_FULL.synthesis,
    consensus: {
      splits: [
        { question: "Should the 0:23 bakery-line transition stay or be cut?",
          positions: [
            { judge: "editor", stance: "Cut it — the jump is abrupt and breaks visual continuity." },
            { judge: "connector", stance: "Keep it — the line-waiting beat builds the 'is it worth it?' tension." },
          ] },
      ],
    },
  },
};

const judgeData = (overall) => ({
  overall,
  dimensions: {
    hook_strength: overall,
    completion_likelihood: overall - 1,
    share_save_worthiness: overall - 2,
    rewatch_potential: overall - 1,
    seo_strength: overall,
  },
  objective_fit: { score: overall + 1, verdict: "hits", reasoning: "Delivers on the Food & Drinks objective with strong appetite appeal." },
  reaction: "A relatable, well-structured food-travel beat.",
  positives: "Clean establishing hook and a satisfying payoff moment.",
  delivery: "Steady pacing with clear, energetic narration.",
  content: "A focused quest for a viral treat, with a clear payoff.",
  platformFit: "Strong TikTok fit — hook, completion, and save potential all land.",
  moments: [],
  suggestions: [],
});

// 2-judge partial: the Connector failed; synthesis from the two present (v2 shape).
export const STATUS_PARTIAL = {
  status: "partial",
  synthesisStatus: "ready",
  duration: 58,
  error: null,
  results: {
    critic: { status: "done", data: judgeData(7) },
    cool: { status: "done", data: judgeData(8) },
    connector: { status: "error", error: "Judge returned no verdict" },
  },
  synthesis: {
    verdict: {
      headline_score: 8, // round((7+8)/2) -> "post"
      action: "post",
      gist: "Without the Connector's emotional read, the Editor and Trendsetter still land on a confident, platform-ready cut — re-run for the full picture before you decide.",
    },
    panel: { judges_present: ["editor", "trendsetter"], judges_missing: ["connector"] },
    consensus: { splits: [] },
    takeaways: [
      { kind: "strength", text: "The opening Eiffel Tower shot is a strong, scroll-stopping location hook that signals travel-food instantly.",
        judges: ["editor", "trendsetter"], t_seconds: 0, impact: null,
        takes: [{ judge: "editor", text: "Clean establishing shot." }, { judge: "trendsetter", text: "High-intent travel-food signal that stops the scroll." }] },
      { kind: "watchout", text: "The line-waiting stretch around 0:20 sags and risks losing momentum before the payoff.",
        judges: ["editor"], t_seconds: 20, impact: null,
        takes: [{ judge: "editor", text: "Pacing dips here — tighten it." }] },
      { kind: "fix", text: "Cut the first 4 seconds and open on the 0:08 hook to remove dead air and land the location instantly.",
        judges: ["editor", "trendsetter"], t_seconds: 8, impact: "high",
        takes: [{ judge: "editor", text: "Open at 0:08." }, { judge: "trendsetter", text: "Open directly on the bakery approach." }] },
    ],
  },
};

// Connector DESELECTED on the order screen (not part of the panel). Unlike the
// partial-failure case, the Connector has NO results entry and is NOT in
// judges_missing — so every component simply omits it (an intentional 2-judge
// panel), with no "didn't return" treatment anywhere.
export const STATUS_DESELECTED = {
  status: "done",
  synthesisStatus: "ready",
  duration: STATUS_PARTIAL.duration,
  error: null,
  results: {
    critic: STATUS_PARTIAL.results.critic,
    cool: { ...STATUS_PARTIAL.results.cool, data: { ...STATUS_PARTIAL.results.cool.data, hashtags: ["ParisFood", "CrookieVibes", "TikTokEats", "ViralSnack", "FoodTok"] } },
  },
  synthesis: {
    ...STATUS_PARTIAL.synthesis,
    verdict: { ...STATUS_PARTIAL.synthesis.verdict, gist: "The Editor and Trendsetter agree this is a confident, platform-ready cut with a strong hook." },
    panel: { judges_present: ["editor", "trendsetter"], judges_missing: [] },
  },
};

// Synthesis failed/null — overview renders NOTHING; parent falls back to the raw
// judge view (judges still completed).
export const STATUS_NULL_SYNTHESIS = {
  status: "done",
  synthesisStatus: "failed",
  duration: 58,
  error: null,
  results: {
    critic: { status: "done", data: judgeData(7) },
    cool: { status: "done", data: judgeData(7) },
    connector: { status: "done", data: judgeData(8) },
  },
  synthesis: null,
};
