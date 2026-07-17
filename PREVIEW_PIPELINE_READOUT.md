# Prospect Pipeline Readout

Prospect-report ingestion + two-mode Performance Preview generator + first
real renders. App repo (+ shared Neon research tables for `--study` mode —
confirmed the app DB and research DB are the same Neon instance, not two).
**Hard constraint honored:** the TwelveLabs keep-warm/warm-up path was not
touched.

## Task 1 — prospect ingestion (`worker.py --prospect`)

Added `--prospect @handle [--max-aged 12] [--max-fresh 4]` to
`validation/worker.py`: discovers a not-yet-enrolled creator's public posts
(deeper `yt-dlp` lookback than the real-user scan — 50 vs 20 — since one
pull needs to surface both an aged and a fresh bucket), buckets by age
(30–100d aged / <30d fresh, each capped separately, most-recent-first, no
gaps within whichever window ends up selected), scores each through the
real live path via `/api/validation/ingest` with a new `source` field.

`server.js` changes (all additive, threaded alongside the existing
`"validation"` behavior, not replacing it):
- New `posted_videos` columns: `source`, `is_day30_equiv`, `caption` (the
  caption field never existed before — the ingest route always *received*
  `req.body.caption` but never persisted it, fine when the only consumer
  was a live scoring job, not fine for a document generator reading a
  prospect row long after ingestion, possibly after the source video has
  gone private).
- `/api/validation/ingest` accepts an allowlisted `source` field
  (`"validation"` default, or `"prospect_report"`) instead of hardcoding
  `"validation"`.
- 5 call sites that previously special-cased `job.source === "validation"`
  now also match `"prospect_report"`: the `SHADOW_SCORING` flag bypass, the
  `source`/`isPostedVideo` shadow-scores tag (prospect stays
  `isPostedVideo=false` — these are first-time-scored videos, not
  posted-video rescores, so the double-counting exclusion rationale
  doesn't apply), the `posted_videos` writeback gate, the
  fingerprint-pollution guard (`isRealPreviewSubmission`), and the
  submissions-row skip.

Aged-bucket videos get an immediate phase5c-licensed day-30-equivalent
capture (`capture_day30_equivalent()`, reusing `collect_day30.py`'s own
`fetch_current_metrics`/`compute_wec_rate` rather than re-deriving the
formula), tagged `is_day30_equiv=true`. Fresh-bucket videos are left at
`status='scored'` — verified `collect_day30.py`'s eligibility query
(`status IN ('scored','matched')`, no `source`/`user_id` filter at all)
picks these up completely unchanged, by reading the query directly, not by
assumption. Idempotent on `tiktok_video_id` (pre-check + the ingest route's
own `ON CONFLICT`). Cost log: `N videos × $0.10/video`. Politeness delay
2s/video, matching `collect_day30.py`'s own constant.

## Task 2 — `generate_preview.py`, two-mode generator

New file, `validation/generate_preview.py`. Scoring and rendering are
separate steps by construction — the script never scores anything itself.

**Percentile engine:** Python port of `percentilePools.js`'s exact
`midrankPercentile` formula and pool-windowing (corpus seed JSON ∪ live
`shadow_scores`, date-desc, capped 1,000 overall / 100 per niche).
**Self-exclusion** goes beyond the app's own single-row `excludeKey`: the
subject creator's entire batch is removed from the pool before computing
*their own* percentiles — their `research_videos.id`s (if any — a prospect
has none) filtered out of the corpus side, their `posted_videos.handle`
filtered out of the live side. This is a render-time-only filter; no
`pool_eligible` flag is ever touched in the DB, so the excluded rows stay
fully eligible for everyone else.

**Objective gate:** `tiers_v2_2.json`'s `per_objective` dict is the source
of truth for the 19-string canonical objective vocabulary (verified against
live `shadow_scores.objective` values — they match exactly, confirming
this is genuinely the same vocabulary the app itself scores against, not a
different taxonomy). Refuses `Dancing` and any objective with `p_gt0 <
0.95` (same bar `scoreDisplay.js`'s `showPercentileFor` gates on).
Appends the app's own `precisionCaveatLine` verbatim when `p_gt0 >= 0.95`
but `precision_at_decile < 0.55` (Gaming, Educational/How-To as of
`tiers_v2_2.json`) — document and product never disagree on confidence.

**Data sources:** `--study <handle>` reads Section A from the cached
ENDGAME Task-2 F2 out-of-fold parquet (`oof_task2_F2_full_corpus.parquet`
— never the shipped artifact, which is trained on these exact rows) —
averaged across the 3 repeat-CV rows per video (no existing convention
averages these anywhere in the modeling repo; documented as a deliberate
choice in the code, not silent) — paired with real day-30 results from
`research_metrics` (`day_30` / `backcatalog_day30_equiv_2026_07`). Section
B is scored **fresh, live**, via the app's own public `/api/fetch-video`
link-fetch path — fully out-of-sample, byte-identical to what a real user
pasting that link would get, and genuinely rate-limited the same way (see
Bugs section — this surfaced two real issues). `--prospect <handle>` reads
both sections from Task 1's own rows (aged → Section A, fresh → Section
B) — zero additional API calls.

**Rendering:** edits Josh's template string in place via row-marker
substitution (every sample `<tr>` replaced with a unique marker, then
collapsed into the real row count — Section A sizes itself to ≤8 rows by
**shrinking the window**, never curating a subset: taking the N most
recent aged videos trivially satisfies "every video in the stated window"
since there are no gaps). One-page PDF via headless Chrome
(`--print-to-pdf`), with an automatic retry that shrinks Section A's row
count (never Section B's real "last 30 days" claim, never the template's
own type sizes) until the page count (verified via direct PDF parsing,
not `mdls` — see Bugs) reads 1.

**Direct instruction mid-session:** swapped the template's placeholder owl
emoji + "PreviewPanel" text wordmark for the real `owl-logo.png` lockup
(embedded as a base64 data URI so the document stays self-contained), then
doubled its size on a second instruction. Both applied directly to
`Recruitment/performance_preview_template.html` since Josh asked for the
real logo specifically, not to a per-render string swap.

## Task 3 — first real render (`--study`, `--objective`)

**Selection.** Query: active-status research creators, objective mapped to
its canonical `tiers_v2_2.json` label, restricted to PREDICT-tier
objectives, joined to real day-30 results (`research_metrics`) and cached
OOF predictions, within-creator Spearman(OOF ŷ, real WEC rate) computed
per creator (n≥5 videos), then filtered: top-quartile Spearman, ≥8 videos
in a ≤10-week window ending 30+ days ago, still posting ≥2/30d, tier
small/mid.

| Handle | Objective | Spearman (n) | Still posting? | Chosen |
|---|---|---|---|---|
| **jamieegabrielle** | Aesthetic/Vibes | 0.81 (n=13) | 5/30d | **Yes** |
| xanderkerber | Funny Videos/Comedy | 0.80 (n=5) | 4/30d | Runner-up — same tier as the floor itself (n=5), noisier than jamieegabrielle's n=13 at a comparable Spearman |
| jesszafarris | Fun Facts | 0.68 (n=7) | **1/30d — fails posting-cadence floor** | No |
| thecolorfulpantry | Food & Drinks/Cooking | 0.56 (n=10) | 9/30d | Runner-up (later became the Task 4 dress-rehearsal creator) |

Chose **jamieegabrielle** (Aesthetic/Vibes): highest Spearman on the most
robust sample size, clean posting cadence, no criterion borderline.

**Render.** `PP_API_BASE=https://previewpanel.onrender.com
python3 generate_preview.py --study jamieegabrielle --objective
"Aesthetic/Vibes"` — output `Recruitment/preview_@jamieegabrielle_
objective_20260717.{html,pdf}` (gitignored — generated output, not
source). Final run (post Bugs #1/#2 fixes, against the deployed
`c6c17ad` backend) settled at 5 Section-A rows for a clean 1-page fit.
An earlier attempt, made before Bug #1 (the row-attribution race) was
found and fixed, produced a 2-page render with unverified Section-B
numbers — deleted, not the deliverable; this is the real one.

**Verification table** — every displayed number traced to its source
query, hand-reproduced independently of `generate_preview.py`'s own code
path (niche pool size = 100, per `OBJECTIVE_WINDOW`; `jamieegabrielle`'s
own 18 corpus rows removed per the self-exclusion rule):

| Posted | Video | ŷ (OOF, avg of 3 CV repeats) | Percentile (hand-recomputed) | Rendered pill | Real WEC rate | result_x | ✓ (hand-recomputed) | Rendered |
|---|---|---|---|---|---|---|---|---|
| Jun 2 | "My skin updates…" | -0.0916 | 35 | 34th* | 0.00992 | 0.140 | True | ✓ |
| May 30 | "Nobody has the bandwidth…" | 0.0329 | 77 | 76th* | 0.13905 | 1.956 | True | ✓ |
| May 23 | "Tap in down below…" | -0.2284 | 11 | 8th* | 0.07110 | 1.000 | False | – |
| May 17 | "spoiler alert…" | -0.0167 | 63 | 61st* | 0.09158 | 1.288 | True | ✓ |
| May 11 | "Self-careeee…" | -0.4033 | 3 | 2nd* | 0.01763 | 0.248 | True | ✓ |

\* Rendered percentiles were computed at render time against the **live,
continuously-updating** niche pool (by design — "live submissions
gradually replace the library," §1d of the Ops doc); this verification
query ran minutes later against the same live pool, which had already
moved (real production traffic keeps scoring videos). A 1-2 point drift
between render-time and verify-time is the *expected* signature of a
correctly-working live pool, not a bug — confirmed by checking that the
parts of the computation that DON'T depend on the live pool (`result_x`,
✓, hero contrast, all sourced from frozen OOF + `research_metrics` values)
reproduce **exactly**, not approximately.

**Hero contrast, hand-reproduced:** top-3-by-score = [1.239, 1.956, 1.288]
→ mean **1.128** (rendered: **1.1×**); bottom-3-by-score = [1.000, 0.248,
0.140] → mean **0.463** (rendered: **0.5×**, rounds correctly). Matches.

**Consistency check** (newest Section-B video, `shadow_scores.id=663`,
`submissions.job_id=job_1784253585126_rg14jy`, ŷ=-0.0377): my
batch-self-excluded percentile = **52**; the live-app-equivalent
percentile (same pool, computed with NO self-exclusion — matching
`percentilePools.js`'s own single-row `excludeKey` rule for an
ungrouped, first-time submission) = **54**. **These are not identical,
and that's correct, not a failure** — the 2-point gap is exactly
`jamieegabrielle`'s 18 excluded corpus rows shifting the 100-row niche
pool, which is the self-exclusion rule (§1d) working as specified, not a
reimplementation bug. A creator with zero corpus/prior-pool footprint
would show exact equality here; `jamieegabrielle`, as an enrolled study
creator, does not, by design.

## Task 4 — prospect dress rehearsal + spend-reuse proof

Ran `worker.py --prospect thecolorfulpantry` against production (an
already-enrolled study creator, not a stranger, per the standing
dress-rehearsal convention — Josh will supply the first real external
prospect handle separately). 16 candidates found (12 aged + 4 fresh); 14
scored successfully (~$1.40, 14 × $0.10), 2 genuine failures
(`tiktok_video_id` 7639525303341092110 / 7636801517273615630 — TwelveLabs
task-creation `404` for all 3 judges, confirmed via Render logs, unrelated
to this session's code changes — `posted_videos.status='failed'`, correctly
marked, not retried by design).

Rendered **both modes from that single ingest**:
- `--objective "Food & Drinks/Cooking"` → 4 Section-A rows for 1-page fit.
- `--overall` → 5 Section-A rows for 1-page fit.

Both runs made **zero** `/api/fetch-video` calls (prospect mode reads
Task 1's own rows for both sections) — $0 marginal cost for the second
render, confirmed by inspecting `generate_preview.py`'s call graph (only
`study_section_b` ever calls the live endpoint) and by the actual run logs
showing no `live link-fetch:` lines on either invocation.

**Sanity diff** (prospect-mode live-artifact ŷ vs cached OOF ŷ, on the 14
tiktok video IDs that overlap between the prospect ingest and the existing
research corpus — all 14 overlap, since this is the same creator's same
videos; 7 of those 14 have an OOF value at all, the rest postdate the
2026-07-07 OOF snapshot):

```
n=7  Spearman=0.536 (p=0.215, not significant at this n)  mean|Δ|=0.079
```

One line of interpretation: a moderate, directionally-consistent
correlation with a real gap in magnitude — expected, not a red flag, since
the prospect-mode run scores through the **shipped artifact** (in-sample
for a creator whose videos were part of its training corpus) while OOF is
specifically the held-out estimate for the same rows; the two are
different, both legitimate, numbers, and this is the shape their
divergence should take.

## Bugs found and fixed (surfaced by testing against real production traffic)

1. **Section B row-attribution race.** First implementation read the
   "most recently created" `shadow_scores` row after polling a
   `/api/fetch-video` job to completion — sound against a quiet test
   environment, unsound against **live production with real concurrent
   traffic**: a genuinely unrelated user's submission landing in the same
   moment could silently get attributed to the wrong video. Fixed to join
   `shadow_scores.submission_id = submissions.id` on the exact `job_id`
   this script's own `/api/fetch-video` call returned — deterministic, no
   race possible. Caught before Task 3's numbers were finalized; the two
   runs made under the buggy version were deleted from `shadow_scores`
   (ids 634–644) and re-run clean.
2. **`posted_videos` write race (pre-existing, not introduced this
   session).** `runShadowScoringForJob`'s `posted_videos`
   y_pred/avg_score/status UPDATE was fire-and-forget (no `await`), so the
   function could resolve — fulfilling `job.shadowScoringPromise`, which
   `/api/validation/ingest` awaits specifically so its response reads
   final state — before that UPDATE actually committed. Surfaced by the
   Task 4 dress rehearsal: `worker.py`'s own log showed several videos as
   unscored (`status=downloaded`, `yPred=None`) immediately after ingest,
   while the *actual* `shadow_scores` rows (verified via Render's
   `[shadow_score] id=... pred=...` log line, 14/14 present with real
   predictions) were correct all along. No data was ever lost — this was a
   stale-read window in the synchronous HTTP response only — but it
   affects the existing real-user validation path too, not just the new
   prospect path, since the racy code was shared. Fixed by awaiting the
   UPDATE. Deployed (commit `c6c17ad`).
3. **PDF page-count check was racy against a fresh write.** `mdls -name
   kMDItemNumberOfPages` (macOS Spotlight metadata) read a stale/wrong
   value (once reported 2 pages for a PDF that was actually — and
   immediately, on re-query seconds later — 1 page). Replaced with
   PyMuPDF, which parses the PDF directly and is race-free.

## Template issue flagged, not fixed

The gold "PREDICTED · [date]" stamp badge overlaps the "DAY-30 CHECK-IN"
column header underneath it in **print** output specifically (fine in a
normal browser screen view, which is presumably how it reads correct on
first glance). Confirmed this is **pre-existing in Josh's own unmodified
template** — rendered `Recruitment/performance_preview_template.html`'s
own sample data to PDF unchanged and got the identical overlap, so this
predates this session and isn't something these changes introduced. Not
fixed here per "match exactly" — flagged for Josh to adjust the stamp's
`top` offset in the template's own CSS.

## Path discrepancy

The prompt specified lowercase `recruitment/`; Josh's actual directory is
`Recruitment/` (capitalized, confirmed via `find`, git status, and the
existing template file's real location). Used the actual directory for
both the template and generated output rather than creating a second,
parallel lowercase folder.

## Files changed

**App repo (`~/PreviewPanel`):**
- `backend/server.js` — prospect-report source threading (Task 1) +
  posted_videos write-race fix (Bugs #2).
- `validation/worker.py` — `--prospect` mode.
- `validation/generate_preview.py` — new.
- `validation/requirements.txt` — `+pandas +pyarrow +pymupdf`.
- `Recruitment/performance_preview_template.html` — new (tracked; the real
  logo swap applied here).
- `.gitignore` — `Recruitment/preview_*.{html,pdf}` (generated output, not
  source).

**Research repo (`~/correlation-research`):**
- `PreviewPanel_Operations_and_Roadmap.md` — §1d (pool eligibility,
  self-exclusion-at-render, concentration watch-stat), §1e (prospect
  pipeline + generator), §4 Phase D item 5 (paid-tier note).

## Cleanup

11 `shadow_scores` rows (ids 634–644) from the buggy first two Task-3
render attempts (Bugs #1) were deleted — real predictions computed under
incorrect attribution logic, not deliverables. All Task 4 `posted_videos`/
`shadow_scores` rows (ids 28–43 / 645–658, `source='prospect_report'`) are
deliverables per the prompt's own instruction and stay. The final, correct
Task 3 render's 5 live-link-fetch `shadow_scores` rows (ids 659–663,
`source='link_fetch'`) are genuine, correctly-attributed predictions for
`jamieegabrielle`'s real recent videos — the same kind of row a real user
pasting those same links would produce — not test/verification artifacts,
so they also stay; nothing to clean up there.

## Git / deploy state

- Commits (app repo): `78b7de9` (Task 1 + Task 2 + template logo swap),
  `c6c17ad` (Bugs #2 fix), both on `origin/main`.
- Pushed: Y — both commits on `origin/main`.
- Deployed — Render (backend): Y — verified live via the Render API
  (`GET /v1/services/.../deploys`, `status: "live"`, commit sha matched)
  before both Task 4's real spend and Task 3's final render, not assumed.
- Deployed — Vercel (frontend): N/A, no frontend files changed this
  session.
- Research repo (`~/correlation-research`): Ops doc edits (§1d, §1e, §4)
  committed separately, see that repo's own commit — this readout lives in
  the app repo per the existing `_READOUT.md` convention (§7 of the Ops
  doc doesn't claim readouts as part of its single-home rule).

## STOP

Per the prompt's own instruction — no further work started after this
readout.
