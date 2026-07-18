# Track Record Readout — the Performance Preview, live in the app

App repo. **Hard constraints honored:** keep-warm not touched. Exempt
paths (research_api, `/api/validation/ingest`, prospect worker) stay
completely exempt — unaffected by this dispatch (grep-reconfirmed: still
exactly 2 `checkBetaGate`/`recordBetaSubmissionEvent` call sites,
`/api/analyze` and `/api/fetch-video`), plus a fresh live smoke test of
`/api/validation/ingest` after the final deploy. Zero new scoring spend:
grading is pure math over already-scored data; the one new script
(`sync_study_history.py`) reads existing OOF predictions and recorded
research outcomes, never runs a judge or extraction call.

## Task 1 — Grading engine

`posted_videos` gains `call_type`, `times_typical`, `verdict`,
`graded_at`, `baseline_n_at_grading`, `overall_percentile_at_grading`
(all nullable, migrated via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

`gradeTrackRecordForUser(userId)` (server.js): for a creator with ≥4
(`BASELINE_MIN`) collected outcomes (`status='day30_collected'`, both
provenances — a real `collect_day30.py` capture and a `--prospect`
day-30-equivalent snapshot land in the same status), computes `typical`
= median `day30_wec_rate` across ALL their collected outcomes (including
already-graded ones — freezing a verdict doesn't remove that row's
WEC_rate from the shared baseline pool), then grades every still-ungraded
row: `overall_percentile_at_grading` ≥70 (`CALL_STRONG_PCTILE`) = strong,
≤30 (`CALL_WEAK_PCTILE`) = weak, the middle = `none` (displayed, never
graded as hit/miss); `times_typical` = row outcome ÷ typical; `verdict` =
hit/miss/no_call per the design constants exactly. **`verdict IS NOT
NULL` is each row's own permanent idempotency guard** — the `UPDATE`'s
own `WHERE ... AND verdict IS NULL` means a graded row is never revisited,
even as the pool or baseline later drifts.

**Design decision, made after the incident below:** the prediction used
for percentile computation is read directly from `posted_videos.y_pred`
(written from the exact same value at ingest time, `/api/validation/
ingest`'s own write-back), NOT joined from `shadow_scores`. This decouples
grading from `shadow_scores`'s own, separate lifecycle — see the incident
section for why that decoupling exists.

## Task 2 — `GET /api/track-record`

Runs `claimHandleHistory` (idempotent safety net, catches a handle
connected via the plain manual path rather than a pre-linked code) then
`gradeTrackRecordForUser` (idempotent) for the requesting user, then
returns:
- `pending`: `status IN ('scored','matched')` rows — caption snippet,
  live overall-pool percentile pill (via `y_pred`, same pool math as
  every other percentile in the app), check-in date (`posted_at + 30d`).
- `graded` / `ungradedResolved`: `status='day30_collected'` rows, split
  on `verdict IS NOT NULL`. Ungraded-resolved rows show raw engagement +
  their creator's current baseline count (below `BASELINE_MIN`, or no
  usable prediction).
- `aggregates`: `{hits, graded, avgTimesTypicalStrong, avgTimesTypicalWeak}`
  — gated at ≥4 (`AGGREGATE_MIN`) graded (hit|miss, no_call excluded)
  calls; `gradedCallCount` is sent unconditionally (feeds the
  sub-threshold "N calls on the books" copy).
- `state` enum: `no_handle` → `no_posts_yet` → `pending_only` →
  `baseline_forming` → `active`, checked in that precedence order.
- `unseenGradedCount`: count of `graded_at > lastSeenAt` (client-supplied
  query param, from its own `localStorage` stamp) — feeds the tab badge.

## Task 3 — UI

`TrackRecordPanel` (new component, `PreviewPanel.jsx`) behind a
"Previews | Track Record" segmented control on the existing History
surface — Previews (`HistoryPanel`, untouched) stays the default tab.
Sections: **ON THE RECORD** (pending, gold/`VALENCE.split` accent, check-
in dates) above **GRADED** (score pill + `x.xx× your typical` + big
✓/muted ✗/italic "no call", or baseline-forming rows with raw engagement
+ "baseline forming (n of 4)"). Aggregate header ("Called it: N of M" +
study-context line) when ≥`AGGREGATE_MIN`; "Building your track record —
N calls on the books" below it. `no_handle` state carries a "Connect
TikTok" CTA wired to the existing `AccountSettingsTrigger` modal (shared
`showAccountSettings` state, no second modal instance). "YOU PREVIEWED
THIS" badge on `match_tier <= 2` rows. Percentiles are overall-pool only
(no niche percentile — posted videos carry no user-declared objective).
Unseen-graded badge on the Track Record tab itself
(`localStorage.pp_track_record_last_seen`, no push infra — deferred to
the paid build per the prompt's own note).

## Task 4 — Copy alignment

`TESTER_WELCOME.md`'s pre-linked sentence now names the real surface:
"so your Track Record tab starts populated the moment you're in"
(previously the vaguer "history and track record"). Checked the
methodology modal/page (`MethodologyModal.jsx`, `methodology.html`) for
anything already promising Track Record content — no mentions exist
either way, so no line was needed there, confirming the prompt's own
expectation.

## Incident: accidental shadow_scores deletion during Task 5 cleanup

**What happened.** Cleaning up after the `thecolorfulpantry` pre-linked
test (Task 5a), a `DELETE FROM shadow_scores WHERE user_id = $1 AND
is_posted_video IS NOT TRUE` — intended to remove ONE test submission's
shadow_scores row — also matched her **15 real prospect-ingest
shadow_scores rows** (prospect rows are correctly written
`is_posted_video=false, pool_eligible=true`, per server.js's own comment:
"prospect rows stay isPostedVideo=false and pool-eligible like any other
first-time submission" — so they matched the same attribute filter as
the one row I actually meant to delete). All 15 were permanently deleted.

**Actual impact, verified:**
- `posted_videos` rows (all 18) are fully intact — `y_pred`, `avg_score`,
  `day30_wec_rate`, everything Track Record itself reads, untouched.
- Lost: the 15 rows' `input_features` JSON, `calibrated_percentile`, and
  related metadata — unrecoverable without a real re-scoring spend.
  Practical consequence: `generate_preview.py`'s spider-chart per-axis
  breakdown (reads `input_features`) would be degraded/missing for these
  15 historical rows in a *future* `--prospect`/`--study` render for her;
  the core score/PDF is unaffected (reads `y_pred`/`avg_score` from
  `posted_videos` directly).
- **Re-ingesting to restore fidelity was never actually viable**, decision
  aside: `worker.py`'s scan/prospect loop checks `SELECT id, status FROM
  posted_videos WHERE tiktok_video_id = %s` and skips existing rows
  entirely — there's no code path that re-scores an already-present
  `tiktok_video_id`. A forced re-score would also write a fresh
  `prediction` value likely inconsistent with the `y_pred` already frozen
  on `posted_videos` (a new live judging run, not a replay of the
  original one) — restoring exact historical fidelity was never on the
  table, only a fresh, different one.
- **Pool participation, verified (no restoration, just the record):**
  prospect rows are `is_posted_video=false, pool_eligible=true` (34 of 36
  remaining prospect_report shadow_scores rows carry this combination,
  confirming the deleted 15 almost certainly did too) — meaning they
  WERE eligible for `fetchShadowRows()`'s WHERE clause and so were
  active members of the live "overall" pool before deletion. Practical
  effect on real users' percentiles: negligible. `OVERALL_WINDOW` caps
  the pool at 1,000 rows; current eligible `shadow_scores` alone total
  541, plus the 3,840-row frozen corpus — total candidates (≈4,381) far
  exceed the 1,000-row window, so removing 15 recent rows just means 15
  slightly-older corpus/shadow rows backfill those slots instead of the
  window shrinking. No before/after size comparison was captured (this
  was discovered after the fact), but the math above makes a
  measurable-difference outcome very unlikely.
- **Root cause, fixed:** the cleanup used an attribute filter
  (`user_id = $1 AND is_posted_video IS NOT TRUE`) instead of an explicit
  id list captured at fixture-creation time. Every cleanup step after
  this incident (the `jamieegabrielle` verification below) captures exact
  ids first and deletes/updates only by `id = ANY(...)`. This rule is now
  documented in `PreviewPanel_Operations_and_Roadmap.md`'s cleanup-
  convention bullet.
- **Decision (user-directed):** leave the deleted data as-is — no
  re-ingest spend. `thecolorfulpantry` remains the mixed-record fixture
  for this readout's Task 5a exactly as originally scoped.

**Separate, pre-existing issue surfaced by this investigation (not
caused by this dispatch, not fixed here):** `validation/generate_preview.
py`'s shared `DB` class (also used by `backfill_source_url.py`) never
sets `autocommit` and never calls `.commit()`. Verified empirically this
session (`INSERT` → `conn.close()` without commit → row not found from a
fresh connection): writes through this class are rolled back on process
exit unless the caller commits explicitly. This means
`backfill_source_url.py`'s own prior readout claim ("backfilled: 15") was
likely never actually persisted — the 16 `shadow_scores` rows currently
showing a non-null `source_url` appear to be ordinary real `link_fetch`
submissions accumulated since, not that backfill's output. Flagged here
for awareness; not investigated or fixed further, out of this dispatch's
scope. `sync_study_history.py` (this dispatch, below) explicitly calls
`db.conn.commit()` per row specifically because of this discovery.

## Task 3b — Study-history synthesis (`validation/sync_study_history.py`)

New Mac-side script (venv/DATABASE_URL pattern). For an OOF-covered
research creator's aged (30+ day), outcome-resolved videos: synthesizes
`posted_videos` rows directly — `y_pred` from the same frozen OOF
snapshot `generate_preview.py --study`'s Section A reads
(`oof_task2_F2_full_corpus.parquet`), `avg_score` from
`research_pp_runs_pegasus15` where present, outcome from
`research_metrics.weighted_engagement_rate` (`interval_label IN
('day_30','backcatalog_day30_equiv_2026_07')`, `is_day30_equiv` preserved
per which one matched), `status='day30_collected'`, `source=
'study_history'`, `user_id=NULL` (unclaimed, same as a prospect row).

**Percentile computed at SYNC time**, not claim time — reusing
`generate_preview.py`'s own Python pool port (`build_pools`/
`midrank_percentile`, self-excluding the creator, identical to `--study`
Section A's own convention) — written into `call_type`/
`overall_percentile_at_grading` directly. `gradeTrackRecordForUser` was
extended to check for these already-present values and skip
recomputation when found, deriving only `times_typical`/`verdict` from
whatever's stored — so a study-history row's percentile is guaranteed
identical to what a `--study` PDF would show for the same video, and
never silently disagrees with it. Honest, documented limitation (in both
the script and server.js): this is the pool as it exists at sync time,
not as it existed whenever the video was actually posted — no historical
pool snapshot is reconstructable. **No `shadow_scores` row is ever
written for these** — they carry no `input_features`/judge data and
never participate in the live pools (`fetchShadowRows` only reads
`shadow_scores`, which this script never touches) — display data only,
by construction, not by a filter that could be gotten wrong.

Idempotent on `tiktok_video_id` — a video already present from ANY source
is skipped. `beta_admin.py mint --handle` auto-invokes it inline
(`--no-sync` to skip); a non-study or no-OOF-coverage handle just reports
plainly and mint proceeds. `RECRUITMENT_RUNBOOK.md` gained one line.

## Task 5 — Verify live

All rows run against production (`previewpanel.onrender.com`), commit
`18f6e28` (final).

**(a) Pre-linked rich case — `thecolorfulpantry`.** Mint `TRVERIFY_A`
(`--handle thecolorfulpantry`), redeem → confirm → claim (18
`posted_videos`, 15 `shadow_scores`). Tab opened **`active`** day one:
10 `day30_collected` rows graded in one pass (5 `no_call`, 4 `weak`, 1
`strong`; `aggregates: {hits:2, graded:5}` — "Called it: 2 of 5",
correctly excluding the 5 `no_call` rows). **Hand-verified against raw
DB math** (median WEC_rate recomputed independently): id 30 (`weak`,
`times_typical=0.340 < 1.0` → `hit`) and id 33 (`strong`,
`times_typical=0.794 < 1.0` → `miss`) — both bit-exact matches, plus a
third (id 29, `weak`/`miss`) checked for good measure. Idempotency:
reload → identical `graded_at` timestamps, no regrading. A real
submission (`/api/fetch-video`) for the now-connected user succeeded.
**Incident occurred during this case's cleanup** — see above.

**(b) Cold case.** Fresh `user_id`, no handle → `{"state":"no_handle"}`.
Connected a fresh throwaway handle with zero posted rows →
`{"state":"no_posts_yet"}`.

**(c) Baseline gate.** Fixture: 3 synthetic `day30_collected` rows for a
throwaway handle (explicit ids captured at insert time). Tab →
`{"state":"baseline_forming", "graded":[], "ungradedResolved":[3 rows,
each baselineN:3]}`, `aggregates: null` — no verdicts, no record line,
exactly as specified.

**(d) Idempotency** — confirmed in both (a) (`thecolorfulpantry` reload)
and the `jamieegabrielle` re-sync below (zero new rows both times).

**(e) Regression.** `HistoryPanel`/Previews received zero code changes
(diff-reviewed) — only a sibling tab was added alongside it. A real
`/api/fetch-video` submission succeeded post-deploy. Exempt paths:
grep-reconfirmed unchanged (2 call sites) plus a fresh live
`/api/validation/ingest` smoke test (fake handle, unbound `user_id`) —
succeeded untouched (`postedVideoId: 106`, left in place per this
session's established precedent of not deleting minimal structural-
verification artifacts, same as the metering dispatch's ids 87/89).

**Task 3b verification — `jamieegabrielle`.** `beta_admin.py mint
--label "track-record verify (jamie)" --max-redemptions 1 --code
TRVERIFY_JAMIE --handle jamieegabrielle` auto-synced 13 study-history
rows inline. Redeem → confirm → claim (18 `posted_videos` total: 13
study-history + 5 pre-existing fresh prospect rows; 7 `shadow_scores`
from the prospect rows only, as designed). Tab opened **`active`** with
**"Called it: 9 of 9"** — a genuinely strong record (4 `no_call`, 4
`weak` all hits, 5 `strong` all... — precisely: 9 graded, 0 misses).
Pending rows' percentile pills populated correctly (3, 4, 98, 0, 52 —
confirms the `y_pred`-based pending-percentile fix). **Hand-verified two
verdicts** against research-DB values: id 100 (`strong`, `pct=100`,
`times_typical=1.174 ≥ 1.0` → `hit`) and id 105 (`weak`, `pct=3`,
`times_typical=0.479 < 1.0` → `hit`), both bit-exact against an
independently recomputed median. Re-ran the sync post-claim: `0`
synthesized, `13` skipped — idempotent.

**Cleanup (hardened convention — explicit id lists only, captured before
any write):**
- `jamieegabrielle`: captured exact `posted_videos` ids (18) and
  `shadow_scores` ids (7) claimed by the test `user_id` BEFORE resetting
  anything; reset `user_id` to `NULL` by those exact ids only. **The 13
  synthesized `study_history` rows and their grades were deliberately
  KEPT** (per direction — durable deliverables, pre-staging her real
  future invite), verified: `13` rows present, `13` still graded, `0`
  still claimed. Test redemption/code/users row deleted.
- `thecolorfulpantry`: verified clean at `18` total / `0` claimed / `0`
  graded (fully reset to pre-incident, pre-test state) / `0` remaining
  test redemptions or codes.
- Baseline-gate fixture (3 rows) and cold-case throwaway user: deleted
  by explicit id, verified `0` remaining.

## Task 6 — Docs

`PreviewPanel_Operations_and_Roadmap.md`: §1a gained item 11 (grading
constants, freeze rule, baseline/aggregate floors, the `y_pred`
decoupling decision, day-one claim via `sync_study_history.py`); §4 Phase
D gained item 6 (Track Record ships free during beta, flagged as the
paid tier's flagship at launch); the cleanup-convention bullet gained the
explicit-id-list hardening rule with the incident cross-reference.

## Files changed

**App repo (`~/PreviewPanel`):**
- `backend/server.js` — `posted_videos` grading columns;
  `gradeTrackRecordForUser`; `GET /api/track-record`; `y_pred`-based
  (not `shadow_scores`-joined) prediction lookup, in both the grading
  loop and the pending-row percentile pill; study-history-aware skip of
  percentile recomputation.
- `frontend/src/PreviewPanel.jsx` — `TrackRecordPanel` + row components;
  segmented control; unseen-badge fetch/state.
- `validation/sync_study_history.py` — new.
- `validation/beta_admin.py` — `mint --handle` auto-sync, `--no-sync`.
- `TESTER_WELCOME.md`, `Recruitment/RECRUITMENT_RUNBOOK.md` — copy.

**Research repo (`~/correlation-research`):**
- `PreviewPanel_Operations_and_Roadmap.md` — §1a item 11, §4 item 6,
  cleanup-convention hardening.

**Database:**
- 15 `shadow_scores` rows for `thecolorfulpantry` permanently deleted
  (incident, see above) — no restoration performed, per user direction.
- 13 `study_history` `posted_videos` rows for `jamieegabrielle`:
  synthesized, verified, KEPT (durable, pre-staged for her real invite).
- All other test artifacts from this dispatch (invite codes,
  redemptions, users rows, fixture rows): created, verified, deleted by
  explicit id.

## Git / deploy state

- Commits: `447dbb3` (Tasks 1–4 + initial verification), `18f6e28`
  (`y_pred` decoupling + Task 3b), `00bb479` (this readout), on
  `origin/main`, pushed.
- Deployed — Render (backend): Y, confirmed live via `/version`
  (`18f6e28`) before the `jamieegabrielle` verification pass.
- Deployed — Vercel (frontend): auto-deployed from the same pushes; all
  Task 5 verification ran via direct API calls against production (the
  same server-side logic the UI calls into), not an independent browser
  session — noted, not claimed otherwise.
- Research repo: `0b0a17f`, pushed.

## STOP

Per the prompt's own instruction — no further work started after this
readout. The `backfill_source_url.py` commit-bug discovery and the
`generate_preview.py` `input_features` gap for `thecolorfulpantry`'s 15
rows are flagged for awareness, not picked up as new work here.
