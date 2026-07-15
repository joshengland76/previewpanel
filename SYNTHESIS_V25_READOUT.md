# Synthesis v2.5 — Score-Aware Hero Line — Readout

App repo only, presentation layer. No dual-run gate — flag (`SYNTHESIS_V25`)
+ offline taste gate instead, per the prompt's explicit instruction. Judge
scoring, takeaways, splits, and every other part of synthesis are unchanged;
only the `gist` field's construction is affected, and only when the flag is
on.

## Task 1 — Scoring-context builder

New `buildScoringContext(job)` (`backend/server.js`) assembles, at synthesis
time:

- `negative_signals` — detected negative chip-backing signals, ordered by
  `|scoring_spec_v2.json weight|` desc, each tagged `high_impact: true` for
  the top tier (promotional tone -0.0911, question hook -0.0906, sponsored
  -0.0746, buy CTA -0.0572) vs. `false` for the rest (link CTA -0.0362, heavy
  text overlays -0.0257).
- `positive_signals` — same ordering (curiosity+inspiration combo +0.1394,
  save CTA +0.0541, inspiration +0.0535, follow CTA +0.0368, educational tone
  +0.0293).
- `panel_standouts` — highest/lowest-value axis **names only** (no numbers)
  among the 8 radar axes: 5 always-available judge-sourced axes (compelling,
  novel, emotionally_resonant, emotion_intensity, funny) + objective_fit,
  plus the 2 C_dims-derived trend axes (trend_alignment, trending_topic)
  when ready.

Detection logic is copy-identical to `DetectedSignals.jsx`'s chip roster
(combo supersedes standalone Inspiration; strict Inspiration definition) —
the hero line and the chip row can never disagree about what fired on the
same submission.

**Readiness**: `waitForCdimsReadiness()` polls `job.signalFields` up to 15s
(250ms interval) before proceeding. Investigated whether a judge-sourced
sponsored/brand signal exists independent of C_dims as a richer fallback —
it does not (judges' own schema has no sponsorship field; `is_sponsored`/
`sponsored_brand` are C_dims-only). So the fallback is: `panel_standouts`
still populates from the 6 always-available judge-sourced axes; the
negative/positive signal arrays are simply empty if C_dims genuinely isn't
ready in time (logged as `judges_only_timeout` vs. `cdims_ready`). Never
delays the result past the 15s bound.

## Task 2 — Prompt synthesis-v2.5

`backend/synthesisV25Addendum.txt` (new file) is appended to the existing
v2.4 system prompt (`synthesisSystemPrompt.txt`, untouched) only when
`SYNTHESIS_V25=true` — the flag-off path is byte-identical to before. Rules
added, scoped explicitly to RULE 3 (`gist`) only:

- **Priority rule**: if any `high_impact` negative signal is present, the
  "held back by" clause must lead with it, phrased non-judgmentally and
  correlationally (never scolding, never an instruction to remove
  something). At most one more factor follows; craft nits yield.
- No negative signals (or only non-high-impact ones) → gist unchanged from
  today's behavior.
- Positive signals may color the strength clause only when genuinely
  central — never bolted on.
- Hard rules carried through explicitly: one sentence, existing structure
  preserved, never mention models/scores/data/percentiles/internal field
  names, no duration/length advice ever, correlational phrasing only.

**Calibration pair** (real submission, the sponsored/promo video Josh
flagged, `job_1784083351546_vt8kq9`): the actual stored v2.4 gist —
*"The nostalgic 'Summer of 69' hook has genuine emotional pull and
relatability, but a static opening, no visual variety, and an abrupt ending
without a call to action are killing retention before the story lands"* —
completely misses the video's dominant signal (promotional/sponsored/
link-CTA, all real, all in the top negative tier). The addendum's target
rendering pairs this real "before" with a hand-written "after" that leads
with the sponsored/promotional framing instead, and embeds both directly in
the prompt as the anchor for tone.

`prompt_version` is now computed per-row (`synthesis-v2.4` or
`synthesis-v2.5` depending on the flag) instead of a hardcoded constant, so
historical rows stay attributable to which prompt produced them.

## Task 3 — Taste gate (offline, before enabling)

Regenerated v2.4 and v2.5 gists for 8 diverse real submissions (reconstructed
from `submissions` + `shadow_scores.input_features` via the real
`buildSynthesisInput`/`synthesizePanel`/`buildScoringContext`, no mocking of
the actual Anthropic call):

| # | Video | Negative signals | v2.4 gist | v2.5 gist |
|---|---|---|---|---|
| 1 | **Sponsored/promo/link-CTA (Josh-flagged)**, `job_1784083351546_vt8kq9` | promotional (HIGH), sponsored (HIGH), link CTA | "The video has genuine authenticity and relatability working in its favor, but a weak hook and no clear standout moments or suggestions from the panel mean it needs significant rethinking before it's ready to post." | "This video has a genuine authenticity and relatability that give it real emotional grounding, but its promotional, sales-forward caption tone and sponsored-feeling framing are the kinds of signals that tend to significantly dampen organic engagement in our data." |
| 2 | **Paris crookie (canonical, no signals)**, `job_1782064973233_5aup4b` | none | "A visually appetizing, emotionally authentic crookie video that lands its payoff well — the panel found nothing to fix, so the main thing to watch is whether the save/share pull is strong enough to maximize reach." | "A crave-worthy crookie video that nails the emotional arc of food discovery — authentic reactions, strong close-ups, and a satisfying payoff — with no major issues holding it back." |
| 3 | Low-score how-to (Instagram), `job_1783886801530_psw30z` | none | "The video has genuine authenticity and some useful potential, but it never delivers on its How-To promise — showing gear without explaining process or giving viewers a clear takeaway." | "The video has a genuine sense of authenticity and some perceived usefulness, but it shows equipment without explaining the process, leaving viewers with no clear tutorial structure or takeaway." |
| 4 | Mid-score cooking (Instagram), `job_1783900387920_6pjv87` | none | "Authentic and relatable food content that hits its objective, but the panel sees room to sharpen the hook and push novelty before posting." | "A food-forward crookie taste-test with genuine authenticity and strong relatability, though it lacks the novelty and surprise that tend to push food content from solid to shareable." |
| 5 | High-score travel (TikTok), `job_1784055094853_gw8wut` | none | "A well-rounded travel video that earns its post with strong visuals and practical logistics, though the panel had no specific moments or fixes to surface — watch for ways to push novelty and emotional intensity further." | "A well-rounded travel video that pairs aspirational visuals with practical itinerary and cost details, landing as both inspiring and useful — the panel found no significant weaknesses holding it back." |
| 6 | Mid-score cooking (TikTok), `job_1784088466352_4jn7wb` | none | "A solid, authentic food-hunt video that hits the core objective, but the panel sees room to sharpen the hook and push share-worthiness before posting." | "A solid food-hunt video built around a viral item, with genuine authenticity and clear visual payoff, but the panel sees room to sharpen novelty and surprise to push it from watchable to truly shareable." |
| 7 | Very-low-score gaming (YouTube), `job_1783884796714_b7w2j4` | none (educational tone, positive) | "All three judges agree this video contains no gaming content whatsoever, making it impossible to serve the Gaming objective in its current form." | "This real-world military aviation footage has some visual engagement and an educational tone, but it contains no gameplay, commentary, or gaming context of any kind, making it unrecognizable as a Gaming video on YouTube." |
| 8 | Mid-score aesthetic/vibes (YouTube), `job_1783829525656_0i4dk7` | none | "A visually cohesive mood piece that nails its aesthetic objective, but the panel offered no specific moments or fixes to push it further." | "A visually cohesive mood piece that nails its aesthetic objective through candlelight and classical atmosphere, though the panel sees room to push novelty and surprise to lift it from pleasant to truly memorable." |

**Gate result: pass.** #1 (the only row with a HIGH-IMPACT negative signal)
correctly leads the "held back by" clause with the sponsored/promotional
framing, non-judgmentally, correlational phrasing. #2–8 (no high-impact
negative signal) stay materially unchanged in voice, length, and structure —
no scoring-context leakage, no drift.

## Task 4 — Enable + live verify

Flipped `SYNTHESIS_V25=true` in production (Render env var + code deploy,
sha `d3bc141`).

**Deploy-timing bug found and fixed during this step**: the first live test
(a real re-run of the Josh-flagged sponsored TikTok,
`job_1784090003061_yz2298`) came back with `prompt_version: synthesis-v2.4`
and a gist that didn't mention the sponsored/promotional framing at all —
despite the flag showing `true` in Render's stored config. Root cause: the
env var was set via the Render API *while* the code deploy triggered by the
same git push was already mid-build; Node snapshots `process.env` once at
process boot, so that running container never had the flag. Offline
reconstruction confirmed this wasn't a signal-detection bug — the video's
real `shadow_scores.input_features` (`cta_type=buy`, `caption_tone=promotional`,
`is_sponsored_int=1`) fed cleanly into `buildScoringContext()` and produced
the correct high-impact negative_signals; the flag was just never live.
Fixed by explicitly triggering a second deploy and confirming the new
process's boot time via the `/version` endpoint before re-testing.

**Live verification, post-fix** (same TikTok link,
`https://www.tiktok.com/t/ZP8GvSrDt/`, re-run + one clean video):

| Job | prompt_version | Signals | Gist |
|---|---|---|---|
| `job_1784091623044_lno613` (sponsored/promo, submission 7129) | **synthesis-v2.5** | `cta_type=buy`, `caption_tone=promotional`, `is_sponsored=1` | "A fast, relatable life-hack video built around the instant satisfaction of steam removing wrinkles, but its promotional, sales-forward framing and purchase-push call to action are the kind of sponsored-feeling tone that tends to dampen engagement in our data." |
| `job_1784091909482_v67e1h` (clean video, submission 7130) | **synthesis-v2.5** | `cta_type=none`, `is_sponsored=0` | "This Paris crookie hunt delivers strong appetite appeal and genuine unscripted moments, but a slow opening and a few missed opportunities to surface insider details and engagement hooks are leaving retention and saves on the table." |

Both confirmed: the sponsored/promotional video's hero line now leads with
the dominant negative signal, phrased non-judgmentally and correlationally
("tends to dampen engagement in our data"); the clean video's hero line is
indistinguishable from v2.4 style (strength + held-back-by, no
scoring-context mention).

**Rollback**: unset `SYNTHESIS_V25` (or set to `false`) on Render and
redeploy — every job reverts to the byte-identical v2.4 prompt and path.

## Task 5 — Ops doc tick

`correlation-research/PreviewPanel_Operations_and_Roadmap.md` §1a, item 7
("Synthesis layer") — dated note added covering: scoring-context payload,
priority rule, flag name, 15s readiness wait + fallback, `prompt_version`
stamping, and the deploy-timing gotcha encountered while enabling it (a real
instance of the pre-existing §1c warning that Render env-var changes don't
auto-redeploy — here compounded by racing an in-flight code deploy).

## Files changed

- `backend/server.js` — `buildScoringContext`, `computePanelStandouts`,
  `waitForCdimsReadiness`, `SYNTHESIS_V25` flag, dual system-prompt loading,
  per-row `prompt_version`, `synthesizePanel`'s new `scoringContext` param.
- `backend/synthesisV25Addendum.txt` — new, the v2.5 prompt addition.
- `backend/env.template` — `SYNTHESIS_V25` documented.
- `correlation-research/PreviewPanel_Operations_and_Roadmap.md` — §1a dated
  note.

## STOP

Per the prompt's explicit instruction — no further work started after this
readout.
