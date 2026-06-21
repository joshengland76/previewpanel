// Fixture "job" objects for the synthesis dry-run. Shape mirrors jobs[jobId] —
// only the fields buildSynthesisInput reads (platform, objective, videoDuration,
// results{ judgeId: { status, data } }). Content is illustrative.

export const FIXTURE_3JUDGE = {
  platform: "tiktok",
  objective: "business_finance",
  videoDuration: { secs: 48 },
  results: {
    critic: { status: "done", data: {
      overall: 7,
      dimensions: { hook_strength: 6, completion_likelihood: 7, share_save_worthiness: 5 },
      objective_fit: { score: 8, verdict: "hits", reasoning: "Communicates a core Business/Finance principle with authenticity." },
      reaction: "Solid, relatable message but a soft open.",
      moments: [
        { timestamp: "0:00", type: "drop", note: "Opening line is informative but lacks a curiosity gap to stop the scroll." },
        { timestamp: "0:21", type: "peak", note: "'We did our research' reinforces the value of due diligence — a natural peak." },
        { timestamp: "0:41", type: "drop", note: "Abrupt transition to the title card feels disconnected and undermines the payoff." },
      ],
      suggestions: ["Re-cut the first 4 seconds to start at 0:08.", "Add a closing takeaway overlay."],
    }},
    cool: { status: "done", data: {
      overall: 7,
      dimensions: { hook_strength: 7, completion_likelihood: 8, share_save_worthiness: 6 },
      objective_fit: { score: 8, verdict: "hits", reasoning: "Structure and tone align with what performs on TikTok in this niche." },
      reaction: "Clear, practical message with steady pacing.",
      moments: [
        { timestamp: "0:00", type: "peak", note: "Opening about investing in education creates a strong, high-intent hook." },
        { timestamp: "0:41", type: "peak", note: "Transition to the 'Two Cents' title card is clean and visually engaging." },
      ],
      suggestions: ["Add 5 searchable hashtags.", "Add a closing question to drive comments."],
    }},
    connector: { status: "done", data: {
      overall: 8,
      dimensions: { hook_strength: 8, completion_likelihood: 9, share_save_worthiness: 7 },
      objective_fit: { score: 9, verdict: "hits", reasoning: "Turns a financial concept into a human journey." },
      reaction: "Strikes a deeply personal chord.",
      moments: [
        { timestamp: "0:00", type: "peak", note: "Strong open; would hit harder with a visual cue like a notebook or camera." },
        { timestamp: "0:21", type: "peak", note: "'No background in camera work' is a quiet revelation that makes the viewer feel seen." },
      ],
      suggestions: ["Add a visual cutaway at 0:21.", "Lean into the personal story in the caption."],
    }},
  },
};

// Same video, but the Connector failed to return -> exercises the 2-judge partial path.
export const FIXTURE_2JUDGE_PARTIAL = {
  ...FIXTURE_3JUDGE,
  results: {
    critic: FIXTURE_3JUDGE.results.critic,
    cool: FIXTURE_3JUDGE.results.cool,
    connector: { status: "error", error: "Judge returned no verdict" },
  },
};
