# Hotfix v2 Readout — Neon reconnect + per-video Section-B resumability

App repo. Supersedes the previous reconnect hotfix — that one had not
actually landed in this repo (no matching commit, no guard present at
start), so all five tasks were built fresh rather than as deltas. Doc
ticks to `PreviewPanel_Operations_and_Roadmap.md` (research repo). **Hard
constraint honored:** the TwelveLabs keep-warm/warm-up path was not
touched.

## Task 1 — reconnect guard

Local `DB` class (no research-repo imports) added identically to both
scripts — `db.query(sql, params, fetch=None|'one'|'all', cursor_factory=,
commit=)` is the single choke point every query in each script goes
through, reopening the connection and retrying once on
`psycopg2.OperationalError`.

- `generate_preview.py`: every query-executing function converted from
  raw `conn.cursor()/execute()/fetchall()/close()` to `db.query(...)` --
  `fetch_live_pool_rows`, `creator_research_video_ids`, `study_creator_id`,
  `study_section_a`, `study_section_b` (including the confirmed crash
  site — the post-poll `shadow_scores` read inside the per-video retry
  loop), `prospect_rows`. `main()`'s `conn = db_connect()` → `db = DB()`.
- `worker.py --prospect`: same treatment for `run_prospect_mode`'s own
  two query sites (the idempotency pre-check, and the post-`process_one_video`
  read — the direct analogue of generate_preview.py's crash site),
  `capture_day30_equivalent` (its UPDATE runs right after
  `day30.fetch_current_metrics`'s HTTP call), and
  `report_concentration_watch_stat` (runs after the entire batch — the
  longest idle-exposure window of all). `process_one_video`'s own `conn`
  param is unused on the prospect path (user_id is always None there, so
  its only conn-consuming branch short-circuits) — left untouched, called
  with `db.conn` rather than widening its signature for a param it
  wouldn't use. `run_scan_mode`/`run_file_mode` (other worker.py modes)
  were out of scope per the prompt's own "worker.py --prospect's long
  loop" framing and were not touched.

## Task 2 — per-video reuse (replaces batch-level)

New `shadow_scores.source_url` column (nullable `TEXT`,
`ADD COLUMN IF NOT EXISTS`), populated only for `link_fetch` jobs —
threaded from `job.sourceUrl` through `recordShadowScore`'s new
`sourceUrl` param into the INSERT (`backend/server.js`,
`backend/scoring/shadowScore.js`). Rows written before this column
existed simply have `source_url = NULL` and don't match — same as any
other cache miss, no mechanism depends on backfilling every historical
row (see Task 3 for the two rows that DID get backfilled, and why).

`_recent_reused_section_b_rows` (batch-level, required an exact row-count
match) removed outright, replaced by `_reused_row_for_url` + a rewritten
`study_section_b`: for each Section-B candidate, look up the most recent
`shadow_scores` row matching that exact `source_url` (+ objective, if in
objective mode) within `--reuse-section-b-hours`. The split is computed
up front (before any live fetches start) so the honest
`"reusing K of N; fetching N-K"` line prints as a plan, not a running
tally — matching the old log line's shape. `--reuse-section-b-hours` now
defaults to `24` (was `None`/off); passing `0` disables reuse and forces
a full live re-fetch, same as before.

**Follow-up fix, found during live verification (Task 4):** a video
`_fetch_video`/`_poll_status` genuinely can't reach (see below) used to
raise an uncaught `HTTPError` straight out of the loop, crashing the
*entire* script — directly undermining per-video resumability, since one
bad video could still cost the other N-1. Now caught
(`requests.exceptions.RequestException`, `TimeoutError`) and treated the
same as an explicit non-`done`/`partial` status: log `FAILED (...) --
skipping this video` and continue. Commit `ce5b447`, pushed after Task 4
uncovered it live.

`RECRUITMENT_RUNBOOK.md` updated: the `--study` workflow section now
describes per-video reuse and the new default/`0`-disables behavior; new
**"If it crashes"** section explains the SSL message is a timeout during
scoring (not bad data), already-scored videos are safe, and re-running
the same command resumes rather than re-spending.

## Task 3 — duplicate cleanup

Identified via `file_size_mb` (exact match within each pair, distinct
between pairs — a materially stronger signal than judge-score variance,
which showed real spread even between confirmed duplicates) plus
chronological/positional reasoning from the known crash pattern (both
crashes died ~2 videos in, processing candidates in the same
posted_at-DESC order each time):

| tiktok video | kept (earliest) | duplicate → `pool_eligible=false` |
|---|---|---|
| 7663215890762091789 | `shadow_scores.id=677` (submission 7202) | `id=679` (submission 7204) |
| 7661672478363667725 | `shadow_scores.id=678` (submission 7203) | `id=680` (submission 7205) |

Backfilled `source_url` on the two **kept** rows (677, 678) with their
correct TikTok URLs — they predate the new column, so without this
backfill Task 2's per-video reuse would never have recognized them, and
Task 4's very first verification run would have re-spent on all 7
instead of reusing 2. This is the deliberate link between Task 2 and
Task 3: the dedup pass is also the one moment this hotfix has the
per-video identity in hand to retroactively populate the new column.

**Aesthetic/Vibes pool verified:** 16 → 14 rows (exactly the 2 duplicates
removed, confirming the pool wasn't at its 100-row window cap and both
duplicates had been inflating it).

## Task 4 — verify live

Required deploying the backend (`source_url` column + threading) to
Render first, since Section B's live fetches hit production
(`PP_API_BASE=https://previewpanel.onrender.com`); confirmed live via
`/version` before proceeding (`d42c9b5`, then `ce5b447` after the
follow-up fix).

```
$ ./_venv/bin/python3 generate_preview.py --study marisjones --objective "Aesthetic/Vibes"
[generate_preview] reusing 2 of 7; fetching 5
```

**Matches the acceptance criteria's own reuse split exactly.** However,
the live run surfaced two things worth reporting honestly rather than
glossing over:

1. **3 of the 5 "fetching" videos failed** — `422` from
   `/api/fetch-video`, tracing to yt-dlp being unable to reach those
   specific posts from Render's IP right now. Confirmed from THIS
   machine's own IP that 4 of the 5 URLs are perfectly reachable via
   yt-dlp directly (only one is genuinely IP-blocked everywhere) — so
   this is a Render-IP-specific access issue (the same class of
   datacenter-IP limitation already documented for YouTube elsewhere in
   this repo), **not a defect in this hotfix**. It's what surfaced the
   Task-2 follow-up fix above, though: before that fix, the very first
   `422` would have crashed the whole run exactly like the original
   Neon-idle crash did, just from a different cause.
2. **Section A is 0/8 for marisjones** — none of their 9 aged (30+ day)
   candidates are present in the frozen OOF snapshot
   (`oof_task2_F2_full_corpus.parquet`, 2026-07-07). Pre-existing and
   unrelated to this hotfix (this creator simply isn't in that frozen
   modeling population); `study_section_a` did exactly what it's
   supposed to do — skip rather than fabricate.

Given (1), the full "5 successful new fetches, ~$0.50" outcome wasn't
achievable in this environment at this moment — 2 of the 5 succeeded.
**The resumability mechanism itself is nonetheless directly confirmed**
by the second run:

```
$ ./_venv/bin/python3 generate_preview.py --study marisjones --objective "Aesthetic/Vibes"
[generate_preview] reusing 4 of 7; fetching 3
```

4 of 7 (the 2 backfilled + the 2 that succeeded on the first run) were
correctly recognized and reused at zero cost; only the 3 still-failing
videos were retried (and failed again, consistent with an ongoing
IP-access issue rather than a one-off blip). This is exactly the
crash-recovery behavior the hotfix targets: partial progress from a
previous run is recovered, not re-spent, and only genuinely-missing
videos are retried. Both renders completed, 1 page each, send-check
printed (`N/A` both times — Section A is empty for this creator, so
there's no top/bottom contrast to check; not a hotfix concern).

**Recommendation:** the Render-IP TikTok access issue is worth a
follow-up look (not in this hotfix's scope) if it persists — it would
affect any `--study`/`--prospect` fetch, not just this one.

## Task 5 — new-script checklist

Added to `PreviewPanel_Operations_and_Roadmap.md` §1e, framed explicitly
as the third instance of a new validation/ script missing an
already-standing pattern (role scoping → caption fidelity → now the
Neon reconnect guard): Neon reconnect guard, politeness delays, the 5 AM
window rule, the disk-cleanup convention, and a git/deploy state line in
its own readout.

## Files changed

**App repo (`~/PreviewPanel`):**
- `backend/server.js` — `source_url` column migration;
  `recordShadowScore` call site passes `sourceUrl` for `link_fetch` jobs.
- `backend/scoring/shadowScore.js` — `sourceUrl` param threaded into the
  INSERT.
- `validation/generate_preview.py` — `DB` class; every query function
  converted; `_recent_reused_section_b_rows` removed,
  `_reused_row_for_url` + rewritten `study_section_b` added;
  `--reuse-section-b-hours` default `None`→`24`; follow-up
  request-exception handling around the per-video live fetch.
- `validation/worker.py` — `DB` class; `capture_day30_equivalent`,
  `report_concentration_watch_stat`, `run_prospect_mode` converted.
- `Recruitment/RECRUITMENT_RUNBOOK.md` — `--study` workflow + new
  "If it crashes" section.

**Research repo (`~/correlation-research`):**
- `PreviewPanel_Operations_and_Roadmap.md` — §1e Hotfix v2 one-liner +
  new-script checklist.

**Database (applied directly, ahead of the backend deploy):**
- `ALTER TABLE shadow_scores ADD COLUMN IF NOT EXISTS source_url TEXT`
- `shadow_scores.id IN (679, 680)` → `pool_eligible = false`
- `shadow_scores.id = 677` → `source_url` backfilled (video 7663215890762091789)
- `shadow_scores.id = 678` → `source_url` backfilled (video 7661672478363667725)

## Git / deploy state

- Commits: `d42c9b5` (Tasks 1–3, doc updates), `ce5b447` (Task 4
  follow-up fix), both on `origin/main`.
- Pushed: Y.
- Deployed — Render (backend): Y, confirmed live via `/version`
  (`d42c9b5` at first check; `ce5b447` only touches `validation/`, no
  redeploy needed for it).
- Deployed — Vercel (frontend): N/A, no frontend files changed.

## STOP

Per the prompt's own instruction — no further work started after this
readout. The Render-IP TikTok access issue noted under Task 4 is flagged
for awareness, not picked up as new work here.
