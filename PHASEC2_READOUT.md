# Phase C, Prompt 2 — Deploy C1, Day-30 Outcome Collection, Validation Dashboard Readout

**Status: ALL TASKS COMPLETE (0–4).** C1 is live in production with a working
build (a real, previously-undiscovered build-environment gap had to be fixed
along the way — see Task 0). The day-30 outcome collector and the validation
dashboard are both built, tested against real production data (including one
full synthetic end-to-end pass using a real, 32-day-old public TikTok video),
and the pipeline is confirmed idempotent and safe to run manually on a daily
cadence.

**Hard constraints honored**: the TwelveLabs keep-warm path was not touched.
All writes stayed inside the app repo (`backend/server.js`, `validation/`)
and the app's own Neon Postgres tables (`users`, `posted_videos`,
`preview_fingerprints`, `submissions`, `shadow_scores`) — no research-repo
file was written to, and no research-repo table was read or written.
**One deliberate exception, flagged explicitly**: see "Task 4 — roadmap tick"
below — the prompt asked for a `PROJECT_PLAN_v14.md` §5 update, but that file
lives in the research repo, which this same prompt's hard constraint
forbids touching. I did not edit it. The exact intended edit is drafted
below for a human (or a research-repo-side instance) to apply.

---

## Task 0 — deploy C1 to production

**Found and fixed a real, previously-latent build-environment bug along the
way.** `render.yaml` turned out to have never been wired to the live Render
service at all (the service was dashboard/API-configured, not created as a
Render "Blueprint") — every prior edit to that file across this project's
history was inert. Fixed by pushing the real build/start command and env
vars via the Render API directly, with the file rewritten to document this
and to warn against the same mistake in the future.

The first real build attempt then failed for real: Render's Node build
container has a **read-only `/var/lib/apt`** (`apt-get update` →
`Acquire (30: Read-only file system)`), so `apt-get install chromaprint`
can never work there. Fixed by downloading chromaprint's own prebuilt static
`fpcalc` binary (linux-x86_64, no shared-lib deps) straight into
`validation/` at build time via `curl | tar`; `fingerprint.py` now prefers
this bundled binary over a system `fpcalc`, falling back gracefully for
local dev. Build command uses `;` (not `&&`) between the fingerprinting
setup and the final `yarn install`, so a future hiccup fetching/building
fpcalc can never block the core app deploy.

**Verified post-deploy** (on a submission run well after the deploy had
settled, to dodge a blue-green routing artifact on the first, too-early
test): `preview_fingerprints` row landed with `submission_id` populated,
`prompt_version=judges-v2.1`, fingerprint computed in ~21s
(`frames=89 audio=yes duration=88.88`), user-facing output unchanged.
Boot logs show `SELF_RUN_ID` in the `production-<epoch>-<random>` format,
confirmed different across the blue-green transition — the atomic-claim +
role-scoping poller fix rode along correctly.

## Task 1 — day-30 outcome collector (`validation/collect_day30.py`)

Reimplements the research repo's `day30_metrics.py` discovery/collection
pattern locally (no research-repo imports):

- Eligible: `posted_videos.status IN ('scored','matched')`,
  `posted_at + 30d` inside `[now-7d, now]` (day 30–37 window),
  `day30_fetch_attempts < 3`, oldest-`posted_at`-first.
- Fetches current public counters via single-video `yt-dlp
  --dump-single-json` (`view_count`/`like_count`/`comment_count`/
  `repost_count`/`save_count` — field names confirmed against the reference
  script and against live yt-dlp output before trusting them).
- `wec_rate = (likes + 3*shares + 5*saves) / views`, `None` (not `0.0`) on
  zero/NULL views.
- On success: writes `day30_*` counters, `day30_wec_rate`, `collected_at`,
  `video_age_days_at_collection`; status → `day30_collected`.
- On failure: always bumps `day30_fetch_attempts` +
  `day30_fetch_last_attempt_at`/`_error`. A transient error just retries
  (cap 3); a deletion/privacy signal (keyword match against yt-dlp's own
  error text) marks `status='failed'` immediately with the reason string —
  deletion is itself a real outcome, not noise to retry away.
- `--dry-run` and `--limit` flags; 2s politeness delay between videos.

**Verified**: empty-state (0 eligible, no crash); real success path against
a live public video (correct field mapping, correct `wec_rate` math, correct
status transition, confirmed idempotent on re-run); transient-failure path
(a nonexistent video ID correctly bumped the attempt counter rather than
being misclassified as permanently gone).

Schema additions (`backend/server.js`, idempotent
`ADD COLUMN IF NOT EXISTS`): `day30_wec_rate`, `video_age_days_at_collection`,
`day30_fetch_attempts`, `day30_fetch_last_attempt_at`, `day30_fetch_last_error`,
`test_row` (Task 3), `possibly_related` (Task 2, see below).

## Task 2 — validation dashboard (`validation/dashboard.py`)

Read-only report against live tables, five sections:

- **a. Funnel**: users connected, previews scored (+fingerprinted), posted
  videos by status, matches by tier (+ `possibly_related` count), day-30
  pending/collected/failed.
- **b. Primary metric**: per-user Spearman(posted-video `y_pred`, observed
  `day30_wec_rate`) over that user's `day30_collected` videos; users need
  ≥5 to qualify; pooled = **unweighted mean across qualifying users**, with
  a 95% bootstrap CI (B=2000, resampled over users). Every scored posted
  video from a connected user counts here, matched or not — noted both in
  the code's docstring and in this readout, since match tier exists for
  C3's attribution questions, not model validation.
- **c. Secondary**: Spearman(preview `y_pred`, posted `wec_rate`), restricted
  to Tier 1/2 matched pairs, reported per tier.
- **d. Attenuation context**: reuses (imports, doesn't reimplement — it's
  app-repo code) `selection_report.py`'s posted-vs-unposted preview
  ŷ summary.
- **e.** Every section prints an explicit `"accruing, n=X of 5"` line below
  floor rather than a misleading zero/NaN.

The pooled-metric and bootstrap-CI definitions are reimplemented locally
(no research-repo import) — they mirror the research repo's
`capstone_stage4.py::pooled_wc` (group by user, ≥5 pairs, nonzero variance,
one Spearman per user, unweighted mean across users) and
`stage1_arm_b.py::bootstrap_ci` (percentile bootstrap over that per-user
array, B=2000, seed=7), restated in `pooled_spearman()`'s and
`bootstrap_ci()`'s docstrings in `dashboard.py`.

**Also fixed in passing**: `fingerprint.py`'s `classify_tier()` has always
computed `possibly_related` (a Tier-3 match with audio agreement but
mismatched duration), but `worker.py` only ever logged it to stdout — never
persisted it, so the funnel couldn't report it. Wired it through
`worker.py`'s ingest payload → `server.js`'s `/api/validation/ingest` →
a new `posted_videos.possibly_related` column.

**Verified**: empty-state (all five sections handle zero real data
gracefully — confirmed against production, which already had 34 real scored
previews, 1 fingerprinted, 0 posted videos, all correctly reflected);
synthetic multi-user data (one user with 6 correlated pairs → correct
`n=6, ρ=+1.000`; one user with only 3 pairs → correctly excluded as
sub-floor, correctly counted in the "of N users with any collected videos"
denominator) — confirmed threshold enforcement, Spearman math, and pooling
are all correct before relying on them for real data.

## Task 3 — end-to-end verification without waiting 30 days

Used the worker's own `list_recent_videos()` (no research-repo listing code)
against a real public profile (`@tiktok`) to find a video **32 days old at
verification time** (`7649091368656194847`, true `upload_date` 2026-06-08).
Added a `--posted-at` override to `worker.py`'s `--file` test mode (defaults
to `now()`, unchanged for every other caller) so the row could be ingested
with its *true* historical `posted_at` instead of today's date.

Ran the full chain against **production** (`PP_API_BASE` pointed at
`https://previewpanel.onrender.com`):

1. Created a test identity (`users` row, real `tiktok_handle='tiktok'`).
2. Downloaded the real video via `worker.py`'s own `download_video()`.
3. `worker.py --file ... --posted-at 2026-06-08T00:00:00` → POSTed to prod
   → `status=scored`, `y_pred=0.2276`, `avg_score=8.0`,
   `prompt_version=judges-v2.1` (no preview match — expected, this test
   user never submitted a preview; unmatched Tier-3 path taken correctly).
4. `collect_day30.py` (against prod) → fetched real counters
   (`views=198200 likes=11800 shares=933 saves=2137`) →
   `wec_rate=0.1276` → `status=day30_collected`.
5. `dashboard.py` (against prod) → funnel correctly showed 1 user, 1
   `day30_collected` video, day-30 collected=1; primary metric correctly
   printed `"accruing, n=1 of 5"` (not a misleading zero); secondary
   correctly printed `"accruing, n=0 of 5"` (no Tier 1/2 match, as
   expected).

**Cleanup decision (documented per the prompt's instruction to state
which)**: the synthetic `posted_videos` row was **flagged
`test_row=true`, not deleted** — both `dashboard.py` and
`collect_day30.py`'s queries already exclude `test_row=true` rows, so it's
invisible to all reporting/future collection going forward while remaining
as an audit trail that this verification actually happened. The synthetic
**test `users` row was deleted** (not flagged) — unlike `posted_videos`,
the `users` table has no test-exclusion flag, and the dashboard's "users
connected" count has no way to filter it out, so leaving it would have
permanently shown a fake `1` instead of the real (currently zero) count.
Local download artifacts (`validation/_e2e_test/`) were deleted. Confirmed
post-cleanup: dashboard shows a clean, all-zero funnel again, exactly as
if this test had never run.

## Task 4 — operations note + roadmap tick

**Operations note**: `validation/OPERATIONS.md` — the manual daily cadence
(`worker.py` then `collect_day30.py`, ~2 minutes total, both idempotent and
safe to run late or skip a day given the 30–37 day collection grace window)
and why a LaunchAgent is deliberately deferred until a real batch of
connected users/posted videos exists to schedule around.

**Roadmap tick — drafted, NOT applied** (see the hard-constraint conflict
noted at the top of this readout). The exact edit intended for
`PROJECT_PLAN_v14.md` §5's "Phase C — Real-user validation" section
(currently reads "Status: not started"):

> **Status: machinery COMPLETE (2026-07-10).** Handle-connect attribution,
> preview fingerprinting, fingerprint match tiers (Tier 1/2/3 +
> `possibly_related`), posted-video rescoring, the day-30 outcome collector,
> and the within-user Spearman validation dashboard are all built, deployed
> to production, and verified end-to-end (including one full synthetic
> day-30 pass on a real public video, bypassing the 30-day wait). Real-user
> data collection starts clean from this point forward (`test_row`-flagged
> synthetic rows excluded from all reporting).
>
> **Entry criterion for C3 (attribution analyses): first users reaching ≥5
> collected (`day30_collected`) posted videos** — the same floor
> `dashboard.py`'s primary metric already enforces per user.
>
> **Standing calendar**: anchor rescore ~2026-08-09; drift retest
> ~2026-09; `cohort_5` enrollment = Phase D.

Whoever next touches the research repo (or Josh directly) can paste this in;
I did not write it there myself.

---

## Summary of files touched (app repo + `validation/` only)

- `render.yaml`, `backend/server.js` — build fix, schema migrations
  (`day30_*`, `test_row`, `possibly_related` on `posted_videos`).
- `validation/fingerprint.py` — bundled-`fpcalc` preference.
- `validation/collect_day30.py` (new) — Task 1.
- `validation/dashboard.py` (new) — Task 2.
- `validation/worker.py` — `possibly_related` payload wiring, `--posted-at`
  override.
- `validation/requirements.txt` — explicit `numpy`/`scipy` (previously only
  transitive via `imagehash`).
- `validation/OPERATIONS.md` (new) — Task 4.
- This file.

All test/synthetic data created during this prompt's verification passes
has been cleaned up or explicitly flagged (`test_row=true`) as documented
above. Production DB currently reflects only real traffic: 34 real scored
previews, 0 real posted videos (clean slate for C2's actual data collection
to begin).
