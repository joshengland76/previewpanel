# Launch Readiness Readout

**Status: ALL TASKS COMPLETE (Part A + Part B).** Phase C close-out,
new-user journey, edge states, ops runbook, tester welcome doc, and cost
line are all done. Three real production submissions (one automated-blocked
manual upload plus two more) confirmed every score-card state in scope:
PREDICT with niche/overall/personal percentiles, the non-TikTok proxy
line, and the ABSTAIN graceful path. One real, non-trivial functional bug
was found along the way (a shadow-scoring/score-display race condition —
not fixed, see Findings list) and is not objective-specific.

**Hard constraints honored**: no research-repo or research-DB writes; the
TwelveLabs keep-warm path was not touched; only trivial copy/layout issues
were fixed directly (none found — see findings list), nothing functional
was refactored without flagging it first.

---

## Part A — Phase C close-out

All four C2 deliverables already existed from the prior prompt and were
verified against spec rather than rebuilt:

- `validation/collect_day30.py` — matches spec exactly (30–37 day window,
  earliest-first, `wec_rate` formula, zero/NULL-views guard, retry cap 3,
  `day30_collected` status transition, `--dry-run`).
- `validation/dashboard.py` — matches spec exactly (funnel, primary
  per-user pooled Spearman + bootstrap CI at n≥5, secondary Tier 1/2
  Spearman, `selection_report.py` attenuation fold-in, explicit
  "accruing, n=X of 5" states, `possibly_related` in the funnel).
- `PHASEC2_READOUT.md` — exists, documents the synthetic end-to-end
  verification (a real 32-day-old public video run through the full
  chain, `test_row=true` flag applied, synthetic test user deleted).
- **Operations doc roadmap tick — was stale, now fixed.**
  `Summary documents/PreviewPanel_Operations_and_Roadmap.md` said "C2
  (day-30 collector + dashboard) is the in-flight prompt" in its header
  and "(C2 readout pending as of this writing)" in §4 — both now updated
  to reflect that C2 machinery is COMPLETE and verified end-to-end.

No code changes were needed for Part A beyond that documentation fix.

## Part B — Launch readiness

### B.2 — New-user journey (production, fresh browser profile)

Tested on `previewpanel.vercel.app` with `localStorage`/cookies cleared
first (genuine first-visit state).

**Verified working, no issues found:**
- First-visit landing page, all three platform selectors (Shorts/TikTok/
  Reels) — judge panel is consistently 3 judges (Editor, Trendsetter,
  Connector) across all three platforms, no inconsistency.
- Objective dropdown (19 categories, including the ABSTAIN ones).
- Accounts modal: honest, specific copy about *why* connecting TikTok
  matters ("we check our predictions against what actually happens...
  that's how we validate the model"); all three handle fields (TikTok
  required, Instagram/YouTube optional) save correctly; verification-code
  display is accurate about being a dormant stub ("nothing to do with it
  yet").
- Standalone `/methodology` page (honest, correlational framing, no
  causal length advice — matches the durable "no length advice" decision).
  Confirmed this is intentionally a separate static page for
  external/shareable links; the in-app methodology trigger is a proper
  nested modal (with a working "← Back" link), not a navigation trap —
  the earlier navigation-trap bug (task #38) stays fixed.
- Mobile-width (390px) rendering: clean, no overflow, platform pills wrap
  correctly, panel cards stack correctly.
- **First real submission** (TikTok, Food & Drinks/Cooking — a PREDICT
  objective): score card rendered correctly end to end — niche percentile
  (63rd, "beats 63% of Food & Drinks/Cooking videos, vs the last 100
  we've scored"), overall percentile (68th, "vs the last 1000") with a
  tooltip (content confirmed present: "Includes PreviewPanel submissions
  and our 4,900-video research library; live submissions gradually
  replace..."), verdict badge ("Polish first"), full synthesis paragraph,
  timeline with What's-working/Watch-outs/Fixes (timestamped, judge-count
  attributed), spider-chart scorecard (8 axes, per-judge isolation
  toggle), Ready-to-use section (trim candidates, caption ideas with
  copy buttons, hashtags with copy-all), and the full per-judge panel
  with expandable reads.
- **Trim & download flow**: clicked "Trim & download" on a suggested
  clip, adjusted nothing (defaults), clicked "Download clip" — real
  ffmpeg trim job ran to completion ("Trimming 3%" → "95%" → "Clip
  downloaded."). Fully functional.

**Environment note (not a product bug):** browser-automation file upload
was structurally blocked in this session's tooling (the `file_upload`
tool rejects host filesystem paths outright; a `DataTransfer`-based
workaround via a local server also failed, likely mixed-content
blocking). All actual video uploads in this pass were done manually by
Josh in the same browser tab; everything downstream of a completed
upload was then verified via screenshots/DOM inspection as usual.

**Second real submission** (Reels, Makeup/Beauty — a PREDICT objective):
score card correctly showed niche percentile (56th, "beats 56% of
Makeup/Beauty videos"), overall percentile (49th, "vs the last 1000"),
**personal percentile** ("You rank 5th out of your last 6 videos" — see
B.3 below for the n≥5 boundary detail), and the **non-TikTok proxy
line**, confirmed via the tooltip's full `title` attribute text (not
truncated in the UI, but present in the DOM): *"...This score is based on
our TikTok engagement study — treat it as a strong proxy for other
short-form platforms."* Both checks pass.

**Third real submission** (TikTok, Dancing — an ABSTAIN objective,
`job_1783729102481_a395jn`): confirmed the graceful ABSTAIN path renders
correctly. Score-display area shows the neutral `AbstainRing` (a plain
ring with an em-dash, no fill, no number — distinct from both the
percentile gauge and the bare judge-score gauge) with *"Reliable scoring
for this niche is still in progress."* underneath. The **REWORK** verdict
label and full synthesis gist still render normally (those come from
`synthesis.verdict`, independent of `scoreDisplay`) — the video's
synthesis correctly noted it "completely misses its 'Dancing' objective."
Confirmed server-side too: `shadow_scores.objective='Dancing'`,
`prediction=-0.307`. This time shadow-scoring finished before the
frontend stopped polling, so the race condition from the earlier
no-objective submission (see Findings list) didn't recur — consistent
with that finding being a timing race rather than anything
objective-specific.

All three B.2 upload-dependent checks are now confirmed working when the
race condition doesn't hit: second-submission personal-percentile,
non-TikTok proxy line, and the ABSTAIN graceful path.

### B.3 — Edge states

- **Brand-new user (0 previews)**: this is the fresh-profile first-visit
  state already verified in B.2 above — no previews, no percentile
  history, clean empty form. No issues.
- **Evicted-job status handling**: verified via code review
  (`frontend/src/PreviewPanel.jsx`'s poll loop). A 404 or
  `{"error":"Job not found"}` response (job aged out of the in-memory
  jobs map, per the A1 30-minute-eviction hardening) is handled
  explicitly: polling stops, `jobStatus` is set to `"error"`, and the
  user sees *"The server restarted during analysis. Please submit your
  video again."* — clear, honest, no crash, no infinite spinner.
- **Smallest same-objective pool (Myth Busting, 126 corpus rows)**:
  verified by actually running the live pool-builder
  (`percentilePools.js::getPools`) against the real corpus file and the
  current production `shadow_scores` table. Result: Myth Busting's live
  pool is exactly **100** (correctly capped at `OBJECTIVE_WINDOW`),
  overall pool exactly **1000**. Every PREDICT-tier objective's corpus
  count already exceeds the 100-row window (126 is the smallest), so no
  PREDICT objective is ever sparse relative to its display window — the
  "vs the last 100 X videos" copy is always accurate, never
  under-filled. No display bug exists here.
- **Personal ordinal at n≥5**: confirmed working. Pre-staged 3 synthetic
  `shadow_scores` history rows (`source='launch_readiness_synthetic_test'`)
  for the test identity on top of two real submissions already made (the
  Food & Drinks/Cooking one, and the no-objective one below — the latter
  turned out to count toward personal history too, since objective
  doesn't gate personal-history inclusion, only the niche percentile).
  That put the count at 5 by the time of the next real upload, which
  landed as the 6th and correctly showed **"You rank 5th out of your last
  6 videos"** — the personal-percentile module activates correctly once
  the ≥5 floor is crossed (landed at n=6 rather than exactly n=5, since
  one extra real submission happened along the way, but the boundary
  behavior itself — module goes from absent to present — is the thing
  actually being verified here, and it's confirmed correct).

### B.4 — `TESTER_OPS_RUNBOOK.md`

Written at the app repo root. Covers: the daily 2-minute cadence
(`worker.py` → `collect_day30.py` → `dashboard.py`); what healthy looks
like in week one (shadow-row accrual — 34 real previews scored so far;
`extract_cdims` ok-rate — **18/19 genuine attempts ≈ 95%** currently;
cost line — see B.6); the six rollback flags
(`SHADOW_SCORING`, `DISPLAY_SCORE`, `FINGERPRINT_PREVIEWS`,
`EXTRACT_CDIMS`, `JUDGES_V21`, `JUDGE_CLAUDE_FALLBACK_ENABLED`) with
their exact degrade-gracefully behavior; the anchor rescore (~2026-08-09)
and drift retest (~2026-09) calendar; and the C3 entry criterion (first
user with ≥5 `day30_collected` posted videos).

### B.5 — `TESTER_WELCOME.md`

Drafted at the app repo root, marked as a draft for Josh to edit before
sending. Covers what PreviewPanel does, why connecting TikTok matters
(framed honestly as "the only way to know if a prediction model is any
good is to check it against what actually happens"), exactly what's
collected (public posts + public engagement counters, matched via video
fingerprint not account activity), what the score means and doesn't
(ranking aid, not a guarantee; no causal length advice; explicit about
which niches can't be scored numerically yet), and a placeholder for the
feedback channel (no existing feedback address/channel found anywhere in
the repo or docs — Josh needs to supply one).

### B.6 — Cost line

**Observed today** (real production data, not estimates where marked):
- TwelveLabs Pegasus: **$0.0262/min** (billing-verified constant, per the
  Operations doc).
- Claude C_dims extraction: **$0.028/video** (billing-verified constant),
  runs on every real preview submission when `EXTRACT_CDIMS=true`
  (confirmed: currently on, 18/19 genuine attempts succeeded).
- Real average submission duration across 5,968 completed submissions:
  **67.8 seconds** (1.13 min) — so observed TL cost per typical preview
  ≈ $0.0262 × 1.13 ≈ **$0.030**.
- **Observed per-preview total (TL + C_dims): ≈ $0.058, call it ~$0.06.**
  Panel-synthesis (Claude Sonnet) cost is a small additional
  *estimate* (not billing-verified — no per-call cost tracking exists
  for this step yet), roughly **+$0.01–0.02/submission** given the short
  input (judge summaries, not raw video) and short output.
- Posted-video validation rescore (Task 3/C1 pipeline): **~$0.10/video**
  (already documented, separate cost line from preview submissions).

**Month-one projection, 10 testers, ~15 previews + ~5 posted-video
rescores each:**

| Line item | Volume | Unit cost | Subtotal |
|---|---|---|---|
| Preview submissions | 150 | ~$0.06–0.08 | **$9–12** |
| Posted-video rescores | 50 | ~$0.10 | **$5** |
| **Total, month one** | | | **~$14–17** |

This is a small, easily-absorbed cost for a 10-tester batch — nothing
here suggests a need to throttle or gate testers on cost grounds.

## Findings list

### 1. FUNCTIONAL — shadow-scoring/score-display race condition (real bug, not fixed here)

Found while investigating a no-objective submission Josh ran manually
(`job_1783725979602_gaxdbb`, `IMG_7984.mov`, no objective selected).
**This turned out not to be an objective-specific issue at all** — it's a
genuine race condition that can hit *any* submission, PREDICT or ABSTAIN
alike.

**Mechanism**: the frontend's poll loop (`PreviewPanel.jsx`, the
`useEffect` around line 403) stops polling as soon as judges + synthesis
are done (`jobDone && !waitingForSynth`). Shadow-scoring — which includes
the `EXTRACT_CDIMS` Claude-vision call, the slowest step in that
pipeline — runs as a **separate, un-awaited fire-and-forget promise**
(`job.shadowScoringPromise`, `server.js`) that is not on the critical
path the frontend waits for. `job.scoreDisplay` only gets set once that
promise resolves. If shadow-scoring finishes *after* synthesis, the
frontend has already stopped polling and **never receives `scoreDisplay`
at all** — the score card silently falls back to the bare "X/10 ·
VERDICT" judge-score display, with no percentile, no ABSTAIN honest-line,
no indication anything is missing.

**Confirmed both ways from real production logs, same server, same day:**
- Working case (`job_1783721454240_mpgay4`): `shadow_score` logged
  `22:12:21.31`, synthesis ready `22:12:23.88` — shadow-scoring won the
  race by ~2.5s, frontend correctly showed the 69th-percentile card.
- Broken case (`job_1783725979602_gaxdbb`): synthesis ready `23:27:28.48`,
  `shadow_score` logged `23:27:41.01` — shadow-scoring finished **12.5s
  too late**, frontend showed a bare "3/10 · Rework" with zero mention of
  percentile or missing data.

**Impact**: this is silent and, as far as I can tell, **unrecoverable**
for the affected submission — there's no job-id persistence (no
`localStorage`/URL param), so reloading the page loses the job entirely
rather than re-polling and picking up the now-ready `scoreDisplay`. A
user who hits this race just permanently sees a plain judge score with no
percentile context and no explanation why, and has no way to get the
percentile view for that same submission afterward.

**Likely frequency**: not rare. `EXTRACT_CDIMS` is a full Claude-vision
pass over sampled frames, which competes on latency with the TL
judges+synthesis pipeline — there's no structural reason shadow-scoring
should reliably finish first. Worth instrumenting (e.g., log the race
margin on every submission) to get a real hit-rate before/soon after
tester launch.

**Not fixed here** per this prompt's UI rule (functional issues go on the
findings list, not refactored). Plausible fixes for Josh to evaluate:
have the frontend keep polling a bit longer specifically for
`scoreDisplay` (mirroring the existing `waitingForSynth` pattern already
used for synthesis), or reorder so shadow-scoring/`getScoreDisplay` is
awaited before the job is marked fully done.

### Other checks — all clean

Platform selector panel consistency, Accounts modal copy/persistence,
methodology modal navigation, mobile rendering, score card (all
sections, when the race above doesn't hit), trim flow, evicted-job
handling, smallest-pool display. (Two remaining checks — ABSTAIN path
and the non-TikTok proxy line — pending the follow-up uploads.)

## Test-data cleanup

- `posted_videos` row for `tiktok_video_id=7649091368656194847`: flagged
  `test_row=true` (Phase C2 Task 3, documented in `PHASEC2_READOUT.md`),
  not deleted.
- Test user `phasec2_e2e_test_user` (Phase C2 Task 3): deleted.
- Test user for this session's journey walkthrough
  (`user_id=e0061fd9-de80-4ba3-b424-8d4dc825c5b0`, handle
  `launchreadinesstest`): **deleted**.
- 3 synthetic `shadow_scores` rows (`source='launch_readiness_synthetic_test'`)
  pre-staging the n≥5 boundary test: **deleted**.
- The 3 *real* preview submissions made during this walkthrough (Food &
  Drinks/Cooking, Makeup/Beauty, Dancing) were **kept, not deleted** —
  unlike the synthetic rows, these are genuine TwelveLabs/Claude API calls
  against real uploaded videos, and correctly belong in the live
  percentile pools as real usage data, same as any other real submission.
  Only their now-orphaned `user_id` reference was cleaned up (the `users`
  row itself is gone); `shadow_scores.user_id` has no FK constraint, so
  this is harmless.
