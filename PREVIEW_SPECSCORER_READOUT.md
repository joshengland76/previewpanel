# Preview Enhancements Readout — Python spec-scorer, $0 Section B, backfill + idempotency

App repo (+ research DB reads, no research-repo Python imports). **Hard
constraint honored:** the TwelveLabs keep-warm/warm-up path was not touched.

## Task 1 — Python spec-scorer

`validation/spec_scorer.py` — a pure-Python port of `backend/scoring/
scorer.js` + `buildFeatures.js`, split the same way the JS side is:
- `score_features(features, spec)` — pure, unclamped, no DB/network.
  Direct port of `scoreFeatures()`.
- `build_features_from_stored(...)` — assembles the flat feature dict
  from STORED research data (a `submissions` row + a
  `research_pp_runs_claude` row + `research_videos.is_sponsored`/
  `.sponsored_brand`) instead of a live job's in-memory judge results.
  Direct port of `buildScoringFeatures()`, including the duration clamp
  (an input-shaping step, deliberately NOT inside `score_features`, same
  split as the JS side keeps for exactly the same reason — golden vectors
  include out-of-range durations with `expected_yhat` computed unclamped).

No research-repo import — reads `scoring_spec_v2.json`/
`golden_vectors_v2.json` from the app repo's own canonical copies
(`backend/scoring/`).

**Acceptance, run before any use:**
```
$ ./_venv/bin/python3 spec_scorer.py
[spec_scorer] golden-vector gate: 421 rows, max abs diff = 1.388e-16 (row: 5265)
[spec_scorer] PASSED: all 421 rows within 1e-9.
```

## Task 2 — Study Section-B from stored features

`study_section_b` now checks THREE tiers per candidate, cheapest first:
1. **Stored research features ($0)** — the morning chain
   (`submit_to_pp.py` + parser.py's Stage-D) may have already scored this
   exact video for an active creator, entirely independent of this
   script. Judge data lives in `submissions` (joined via `file_name` —
   the SAME join key `submit_to_pp.py`'s own `DISCOVERY_QUERY` uses;
   there is no FK id linking `research_videos` to `submissions`). C_dims
   lives in `research_pp_runs_claude` (joined via `video_id`, a real FK).
   Eligible when ≥2 of 3 judges are present AND a C_dims row exists —
   `spec_scorer.py` scores it locally, no network call at all.
2. **Per-video reuse** (Hotfix v2) — unchanged, for candidates Tier 1
   didn't cover.
3. **Mac-side live fetch** (Transport hotfix) — unchanged, last resort.

Console reports the three-way split:
```
[generate_preview] stored-features: 8, live-fetched: 0, unfetchable: 1
```
Day-30 check-in dates are unchanged (`posted_at + 30d`) regardless of
which tier scored a video — an active creator's real day-30 outcome also
arrives independently via the research pipeline's own `day30_metrics.py`
capture, same as any other `research_videos` row.

## Task 3 — Global source_url backfill

`validation/backfill_source_url.py` (idempotent, re-runnable). Two
provenances, two outcomes:
- `source IN ('prospect_report', 'validation')`: linked via
  `shadow_scores.posted_video_id → posted_videos.{handle,
  tiktok_video_id}`, both always populated for these jobs — fully
  **determinable**: `https://www.tiktok.com/@{handle}/video/{tiktok_video_id}`.
- `source = 'link_fetch'`: linked via `submissions`, but
  `submissions.file_name` for a link-fetch job is a generic placeholder
  (`"<platform>_link_fetch.mp4"`), not the video's own id — **genuinely
  undeterminable**, reported as such rather than guessed at (e.g. never
  reconstructed via timing/ordering heuristics against a creator's
  candidate list — that's a manual, case-by-case forensic technique from
  Hotfix v2's own dedup, not a safe bulk rule for every historical row).

```
$ ./_venv/bin/python3 backfill_source_url.py
[backfill_source_url] backfilled: 15
[backfill_source_url] undeterminable (source='link_fetch', ...): 51
```

Notably, jamieegabrielle's own historical Section-B rows (the ones that
motivated this task, Transport hotfix Task 6) are `source='link_fetch'`
— they fall in the **undeterminable** 51, not the recovered 15. This
backfill does not retroactively fix her specific prior gap; what it DOES
fix is every `prospect_report`/`validation`-sourced row (which Task 1's
`sourceUrl` threading already prevents from recurring going forward for
ALL sources, since `--study` Section B no longer uses `link_fetch` at
all). The legacy 51 will simply age out of the 24h reuse window and never
matter again.

## Task 4 — Ingest idempotency guard

`/api/validation/ingest` now checks, before doing ANY work: does a
`shadow_scores` row with this exact `sourceUrl` and a non-null
`prediction` already exist within the last 24h? If so, return that
result directly (`{postedVideoId, status, yPred, avgScore, idempotent:
true}`) without re-running judging at all.

**Root-cause hypothesis this closes:** `/api/validation/ingest` is
synchronous (awaits full judging before responding). Its client timeout
used to sit almost exactly at the server's own internal cap
(`waitForJobCompletion`'s `maxWaitMs`) — under real load, the client gave
up with a `Read timed out` while the server kept going and wrote a real,
successful `shadow_scores` row moments later (Transport hotfix's own
timeout-headroom fix addressed the *symptom* — the client no longer
gives up prematurely — but didn't prevent a genuine retry, from either
the caller or a re-run of the script, from re-scoring an already-
succeeded video). This guard closes that specific gap at the server,
regardless of what the client does.

**Not applied to `/api/fetch-video`:** that endpoint returns a `jobId`
immediately and the caller polls `/api/status` separately — it never
holds a client connection open across the judging window, so it doesn't
share this specific blocking-POST race.

## Task 5 — Verify

**(a) Golden-vector acceptance** — see Task 1. Passed, 1.4e-16 max diff.

**(b) Active-creator `--study` render** (`thecolorfulpantry`,
`"Food & Drinks/Cooking"`):
```
[generate_preview] stored-features: 8, live-fetched: 0, unfetchable: 1
[generate_preview] 8 Section-A + 8 Section-B rows -> 2 page(s)
[generate_preview] SEND-CHECK: STRONG (... ) -- coverage: Section A: 10 of 13
fetchable; Section B: 8 of 9 fetchable
```
8 of 9 Section-B videos scored at $0 (nonzero stored-features count,
confirmed). The 1 unfetchable video failed judging server-side on BOTH
attempts (run 1: `status=downloaded, yPred=null`; run 2: `status=failed`)
— a genuine per-video scoring failure, not a transport or code defect;
logged and skipped gracefully both times, no crash.

**Hand-verification:** submitted one of the 8 stored-features videos
(`.../video/7662113443335425294`) through the live app's own real path
(`/api/fetch-video`, ~$0.10) and compared:
- `spec_scorer` (from stored features): ŷ = **-0.11848**
- Live app (fresh judging run): ŷ = **-0.07941**
- **Delta = 0.0391 ≈ 1.56 SD**, against the documented same-session
  repeat-run noise scale (`PreviewPanel_Scoring_Model_Report.md` §5b: 18
  identical production runs of one unchanged video measured **ŷ SD ≈
  0.025**). A ~1.5 SD delta between two INDEPENDENT judging runs of the
  same video (stored, from whenever the morning chain scored it, vs. a
  brand-new live run just now) is squarely within normal single-
  comparison noise — not a red flag, and exactly the kind of variance
  that documented figure exists to explain. `spec_scorer`'s OWN math is
  separately proven bit-exact via the golden-vector gate (Task 1); this
  comparison is about judge/C_dims input variance between two scoring
  runs, not the scorer's arithmetic.

**(c) Re-run the same render** — identical result both times
(`stored-features: 8, live-fetched: 0, unfetchable: 1`); the one
genuinely-failing video was retried and failed again on the SAME grounds
each time (a real per-video judging failure, not a caching gap) — no
additional live cost incurred between runs, confirming true $0 marginal
cost on the stored-features tier.

**(d) `--prospect` regression check** (`thecolorfulpantry`, same
objective):
```
[generate_preview] SEND-CHECK: MIXED (averages: top=1.24x bottom=1.26x
gap=-0.02x (tier 0) | calls: 4 of 6 (tier 2) | max_tier=2) -- hero form: calls
```
**Identical to every prior render of this creator** across Polish v4/v5
and the Transport hotfix — zero regression confirmed. `--prospect` mode
never touches `study_section_b` at all, so this was expected, but worth
confirming rather than assuming.

**Observation (pre-existing, not a regression):** the (b) `--study` and
(d) `--prospect` renders for the same handle+mode+date share an identical
output filename (`stem = f"preview_@{handle}_{mode}_{date_tag}"` doesn't
distinguish data source) — running (d) right after (b) overwrote (b)'s
2-page `--study` PDF on disk with (d)'s 1-page `--prospect` one. Both
renders' full console output is captured above regardless. Not fixed
here (out of this dispatch's scope) — flagged for awareness since this
verification pass is exactly the kind of back-to-back-different-mode
sequence that triggers it.

## Task 6 — Docs

`RECRUITMENT_RUNBOOK.md`: active-creator-cheapest note, the
stored-features/live-fetched/unfetchable log line, confirmed the
`--reuse-section-b-hours` default-24h flag is already omitted from the
default-case example commands (no change needed there — Hotfix v2
already left it that way). `PreviewPanel_Operations_and_Roadmap.md` §1e:
one-liner covering `spec_scorer.py`, the three-tier split, the backfill,
and the idempotency guard.

## Cleanup convention

Downloaded videos: unchanged from Transport hotfix
(`finally: local_path.unlink(missing_ok=True)`); `validation/_downloads/`
confirmed empty after this session's renders. `validation/_downloads/`
is gitignored.

## Files changed

**App repo (`~/PreviewPanel`):**
- `validation/spec_scorer.py` — new.
- `validation/backfill_source_url.py` — new.
- `validation/generate_preview.py` — `study_section_b` three-tier
  rewrite; `_stored_research_features`, `SUBMISSION_FEATURE_COLUMNS`,
  `CDIMS_FEATURE_COLUMNS`; `import spec_scorer`.
- `backend/server.js` — `/api/validation/ingest` idempotency guard.
- `Recruitment/RECRUITMENT_RUNBOOK.md` — active-creator cost note,
  provenance log line.

**Research repo (`~/correlation-research`):**
- `PreviewPanel_Operations_and_Roadmap.md` — §1e Enhancements one-liner.

**Database:**
- 15 `shadow_scores` rows backfilled with `source_url` (Task 3).

## Git / deploy state

- Commit: `d531d91` (Tasks 1–4, docs), on `origin/main`, pushed.
- Research repo: `b306698`, pushed.
- Deployed — Render (backend): Y, confirmed live via `/version`
  (`d531d91`) before Task 5's live verification began.
- Deployed — Vercel (frontend): N/A, no frontend files changed.

## STOP

Per the prompt's own instruction — no further work started after this
readout. The filename-collision observation (Task 5) and the
consistently-failing Section-B video for thecolorfulpantry are flagged
for awareness, not picked up as new work here.
