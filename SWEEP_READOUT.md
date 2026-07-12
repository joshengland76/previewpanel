# SWEEP_READOUT — Consolidated sweep (copy sync, label policy v2.2, spider rebuild, accounts, objective-column rename, morning-chain integration)

**Date:** 2026-07-12. **Scope:** both repos (PreviewPanel app + correlation-research).
Keep-warm untouched throughout, per standing instruction.

## A. Copy + number sync

Recomputed the true prereg amendment count (N) from `CAPSTONE_PREREG_v2.md` +
`COHORT5_PREREG.md`: **36**, not the recalled "38" — the app one-pager's prior
value was actually 35, one behind. Updated in three places: the app's
`/methodology` page (`MethodologyModal.jsx` + the static
`frontend/public/methodology.html` duplicate), and
`Summary documents/How_the_PreviewPanel_Score_Was_Built.md` (confirmed to live
in the **app** repo, not the research repo as the original prompt assumed).

- "our judging panel" → "our AI judging panel" everywhere it appears.
- Tiers paragraph rewritten to mirror the one-pager: 18/19 niches carry a
  score, 2 of those 18 show a plain-language "still building confidence"
  caveat, Dancing (the 19th) is suppressed entirely (doesn't clear the
  two-axis display gate).
- Correlation/precision figures synced: **+0.28 cross-validated across all
  199 study creators; +0.25 on a sealed 30-creator holdout opened exactly
  once**; precision reframed as **"68% of the time — more than 2 in 3 (coin
  flip = 1 in 2)"**.
- Deleted the stale "not yet complete" validation sentence from the
  methodology modal's "What it can't do" section. Confirmed the *separate*,
  still-accurate "What's happening now" paragraph (which discloses the live
  real-user validation study) was left untouched — that disclosure was never
  the stale part.

Verified live via browser screenshot (collapsed dropdown + the deeper "How we
validated it" modal) before shipping.

**App repo:** `e40217f`.

## B. Tier label policy v2.2

New policy, single-bar test (replaces v2.1's two-bar test):

```
PROVISIONAL := rankable_n >= 5 AND P(WC>0) >= 0.95 AND precision < 0.55
ABSTAIN     := P(WC>0) < 0.95 (or non-positive)
```

This exactly matches `showPercentileFor()`'s own display gate
(`showPercentile = p_gt0 >= 0.95`), so a tier's *label* can no longer lag what
the two-axis display gate already shows on screen. State display behavior
itself (the two-axis gate) did **not** change — this was a labeling
consistency fix, not a display-logic change.

Implemented as a clean relabel (`relabel_tiers_v2_2.py`, research repo) over
already-computed stats — no re-estimation. Only one label actually changed:
**Educational/How-To, ABSTAIN → PROVISIONAL** (its `p_gt0=1.00` already
cleared the old v2.1 threshold; only the stale label needed fixing). New
bucket counts: **16 PREDICT / 2 PROVISIONAL / 1 ABSTAIN / 0 THIN.**

Verified `getScoreDisplay()` output is byte-identical before/after the
relabel (showPercentile=true, caveat line present, both before and after) —
confirming `scoreDisplay.js` never actually read the tier string for the
display decision.

Updated: `tiers_v2_2.json` (both repos), Scoring Model Report §7 (added a
"Tier label policy v2.2" paragraph, fixed the bucket-count line and the
Educational/How-To table row), Ops doc §2, and `COHORT5_PREREG.md` (new dated
amendment section).

**App repo:** `5573ded`. **Research repo:** `b0fccf0`.

## C. Spider chart rebuild

Removed 4 axes with negative or net-zero model-coefficient association:
surprising (−0.0111), relatable (−0.0179), visually_engaging (−0.0211), useful
(−0.0302). Kept the 5 with positive coefficients: compelling (+0.0118), novel
(+0.0277), emotionally_resonant (+0.0202), emotion_intensity (+0.0120), funny
(+0.0122), plus Objective Fit.

Added two new **content-read** axes — Curiosity and Inspiration — computed
deterministically from already-stored C_dims fields (`emotion_primary`/
`targeted`/`combination` + intensity), scaled 0–10. Not judge-scored: no ghost
lines, no per-judge averaging, marked with a "†" and a footnote clarifying
they're the same number for every judge. These two were chosen because
they're the only emotions with nonzero coefficients anywhere in the model's
C_dims fields — `emotion_combination_curiosity_inspiration` (+0.1394) is the
single largest categorical coefficient in the entire model.

Final layout: **8 axes.** New `backend/scoring/contentReadAxes.js` computes
the two new axes; `server.js` wires it into the live scoring path plus a
`shadow_scores`-backed DB fallback (mirroring the existing `job.scoreDisplay`
recovery pattern). `PerformanceRadar.jsx` rewritten for the 8-axis layout;
`PreviewPanel.jsx` threads the new field through.

Verified live via the dev preview harness (`?preview=verdict`) with a toggle
between a "content-read present" fixture (Curiosity 7.5, Inspiration 6.0 —
both render with real values) and an "absent" fixture (both axes collapse
cleanly to 0.0, the other 6 axes unaffected). Reverted the temporary dev-only
toggle from `VerdictPreview.jsx` after verification, per standing practice.

**App repo:** `cd8440d`.

## D. Accounts UX

Removed the "required"/"optional" framing between TikTok and Instagram/
YouTube. This surfaced a real inconsistency: both the frontend (blocked Save
without a TikTok handle) and the backend (`POST /api/user/connect` 400'd the
same case) actually *enforced* TikTok as mandatory — contradicting the
sweep's own premise that nothing enforces it. Removed both enforcement
points; the `users` table already has no `NOT NULL` constraint on any handle
column, so this was UI/API gatekeeping only, not a schema requirement. TikTok
remains the only platform the validation worker (Task 4, Phase C) actually
scans this phase — that's now just a fact about what happens next, not a
form rule.

Added a disclosure line to the connect card: handles are used only to compare
predictions against real 30-day results, never posted publicly, with a link
to `/methodology`.

Added a one-time, dismissible nudge under the score card: shown only the
first time a synthesis-ready result renders with no TikTok connected,
tracked via a `localStorage` seen-flag so it never resurfaces on later
results even if ignored or dismissed.

Verified live: Accounts modal renders with no asterisk/no "(optional)"
labels and the new disclosure box; clicking Connect with every field blank
now reaches the network instead of being blocked client-side; the nudge
renders under a history-restored score card and dismisses cleanly.

**App repo:** `7241c0d`.

## E. Objective-column rename

`research_videos.objective` (the per-video Claude-classified topic label) was
renamed to **`claude_topic_label`**, to stop reading like a duplicate of
`research_creators.objective` (the creator's enrolled study-partition
objective — the real partition key, per `categorization_check.md` and the
Task 0 / cohort_5 pool-partition hotfix history). `research_creators.objective`
is completely unaffected.

Research showed `research_videos` exists **only** in the research repo
(SQLite `research.db`, mirrored to Neon) — the app repo has no such table.
The only cross-repo dependency is the JSON field name `"objective"` POSTed to
`/api/research/submit`/`/api/research/eval`, deliberately left unchanged
(wire-format contract, not a schema reference).

**Verified against isolated scratch copies before touching anything real**,
per the sweep's own instruction:
- Neon: a full table clone (`CREATE TABLE ... AS TABLE research_videos`),
  renamed, queried with rewritten versions of all 6 direct-SQL consumer
  patterns, then dropped.
- SQLite: a copied `research.db`, renamed, Stage D's `UPDATE` and the CSV
  export re-tested against it.

Applied the real migration only after that passed: `ALTER TABLE ... RENAME
COLUMN` on both the live SQLite file (via a new `_rename_column_if_needed`
migration helper, called from `init_db()` alongside the existing
`_add_column_if_missing` pattern) and Neon (plus a matching index rename).
Row counts matched exactly before/after (6265/6268 Neon, 6266/6268 SQLite).

14 SQL-authoring files updated across the research repo (parser.py,
nightly_chain.py, submit_to_pp.py, pipeline_status.py, path4_scope.py,
build_drift_samples.py, acoustid_probe.py, eligible_count.py, pull_data.py,
capstone_pull.py, pull_cohort5.py, stage1_rebuild_roster_6f.py,
inventory_and_repull.py, validate_cohort3.py, and a dated analysis query
file) — each aliasing the renamed column back to `AS objective` (or `AS
objective_video` where that alias already existed), so the ~35 downstream
pandas/analysis scripts that consume the built dataframes see zero change.

**Verified against the real, migrated databases**: `submit_to_pp.py`'s
actual `discover_eligible()`/`count_deferred_exclusions()` functions run
correctly (0 eligible today, cross-checked against the standalone
`eligible_count.py` script — traced to the pipeline being caught up on
judge-scored videos, not a query defect); a full `pipeline_status.py` run
completes end-to-end including the rewritten "Connector failure rate by
objective" table with real data.

`research.db.pre_sweep_e_backup` left alongside `research.db` as a
pre-migration snapshot.

**Note on repo hygiene:** this repo had substantial unrelated, uncommitted
work in progress from other concurrent sessions mixed into several of the
same files (parser.py, pipeline_status.py, pull_data.py,
inventory_and_repull.py — an "enrolled" creator-status lifecycle change and a
`research_pp_runs_claude` dedup fix, unrelated to this sweep). Rather than
sweep that in, only this sweep's specific hunks were staged into each commit
(via targeted blob injection), leaving the other sessions' in-progress work
untouched and still uncommitted in the working tree. Two files
(`capstone_pull.py`, `validate_cohort3.py`) are themselves pre-existing
untracked files from another session; their one-line fixes are applied on
disk but were not swept into any commit.

**Research repo:** `fb86cba`. **App repo:** no changes needed.

## F. Morning-chain integration

Added steps 5–6 to `run_morning.py`: the real-user validation worker
(`validation/worker.py`) and day-30 outcome collector
(`validation/collect_day30.py`) — both live in the **app** repo, a separate
checkout from the research repo `run_morning.py` itself lives in. New
`PREVIEWPANEL_ROOT` env var (default `~/PreviewPanel`) locates it; `run_step()`
gained a `root` parameter so it can resolve and `cwd` into a script outside
the research repo's own `PROJECT_ROOT`; `PP_VALIDATION_VENV_PYTHON` points at
the app repo's own `validation/_venv` (separate deps — psycopg2, requests,
imagehash/pillow — unrelated to the research pipeline's venv).

**Isolated failure handling**: both steps added to `NON_FATAL_STEPS`, same
treatment as the existing `audio-features` step — a failure in this
separate-repo, still-early-stage validation pipeline must never block
nightly-chain/submit-to-pp/day_30.

Found and fixed a real environment gap while verifying: the app repo's
`validation/_venv` was missing `psycopg2-binary` and `requests` — both listed
in `validation/requirements.txt` but never actually installed, which would
have made these steps fail on every run. Installed from that same
requirements file.

Verified live, twice: (1) a run with a deliberately broken
`PREVIEWPANEL_ROOT` logs both steps as failed, marks them `(non-fatal)` in
the summary, and still exits 0; (2) a run against the real PreviewPanel
checkout completes both steps successfully end-to-end.

`pipeline_status.py` gains a **"Real-user validation"** panel: connected
TikTok-account count, `posted_videos` broken down by status, and the same
day-30 fetch retry-cap accounting (1–2 attempts = retrying, ≥3 = retired)
already used for the research pipeline's own day_30 state. Reads
`users`/`posted_videos` directly — same physical Neon DB `pipeline_status.py`
already queries, no cross-repo import needed. Verified live against the real
database: 0 connected users, 1 `day30_collected` row — an expected
pre-launch reading, not an error.

**Research repo:** `11dd3e6`. **App repo:** no changes needed.

## G. follower_snapshot retirement (evidence-gated)

Evidence reported first, per the sweep instruction: **37 active creators, 94
enrolled**, and **445 videos already 30+ days old still awaiting day_30
collection**. The roster is not zero and the study is still actively
collecting — so the sweep's conditional second half ("if roster is ZERO,
propose gating `creator_monitor` too") does not apply. `creator_monitor.py`
was correctly left untouched.

Added a self-contained `FOLLOWER_SNAPSHOT_ENABLED` flag (default `False`)
gating `follower_snapshot.py`'s `main()` — an early-return with a clear log
line, no DB connection attempted when disabled. Kept local to the file
rather than importing a shared config module, since the shared
`feature_extraction_config.py` already in this repo is itself an uncommitted
file from concurrent work — depending on it would have made this commit's
import break on a fresh clone.

This retires the actual risk surface (a real-site TikTok-profile scrape,
the same rate-limit/IP-block failure mode already observed in day_30's
yt-dlp fetches) without deleting anything: `research_creator_follower_history`
and `nightly_chain.py`'s backfill step are untouched, and
`research_videos.follower_count_at_post_time` for future videos falls back
to the existing, already-accepted "current count, flagged `assumed=TRUE`"
proxy (the same mechanism already used for the cohort_3 backfill) rather
than the day-accurate history lookup. Flip the flag back to `True` to
resume — no schema change needed either way.

Verified live: running the script now logs the disabled message and exits 0
with no DB connection attempted; a full `run_morning.py` pass still shows
`follower-snapshot` succeeding as Step 0.

**Research repo:** `9e1c3be`. **App repo:** no changes needed.

## Summary of commits

| Sweep | App repo | Research repo |
|---|---|---|
| A | `e40217f` | — |
| B | `5573ded` | `b0fccf0` |
| C | `cd8440d` | — |
| D | `7241c0d` | — |
| E | — | `fb86cba` |
| F | — | `11dd3e6` |
| G | — | `9e1c3be` |

All app-repo commits deployed and verified live (Render `sha` match via
`/version`, Vercel bundle grepped for the relevant literal strings). All
research-repo commits pushed to `origin/main`, each confirmed 0 commits
behind before pushing.

Keep-warm was not touched at any point in this sweep.

STOP.
