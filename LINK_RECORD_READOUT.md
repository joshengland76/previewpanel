# Own-Video Link-Runs → Track Record — Readout

A connected creator can now paste a link to **their own** posted TikTok and get
a graded Track Record row from it — no recruiter command, no worker ingest.
App repo (`server.js`); docs tick to `PreviewPanel_Operations_and_Roadmap.md`
(research repo). Exempt paths and keep-warm untouched.

## 1. What ships

On a link-fetch (`POST /api/fetch-video`) the backend extracts the author handle
(URL `@segment`, uploader-metadata fallback, normalized) and compares it to the
user's connected `tiktok_handle`:

- **Match →** it stages an idempotent `posted_videos` row for that
  `tiktok_video_id`, owned by the user, `posted_at` derived from the video-id
  Snowflake timestamp, caption carried through, tied **Tier-1** to *this very
  preview's* submission (`matched_submission_id`, `match_tier=1` — identical
  file). Outcome by the video's age at run time:
  - **< 30d** → `status='matched'`, no outcome yet; the existing day-30
    collector takes it at `posted_at+30`.
  - **30–100d** → the current public counters are captured as the day-30
    **equivalent** immediately (`is_day30_equiv=true`, WEC replicated
    byte-for-byte from `collect_day30.compute_wec_rate`); grading freezes it on
    the next pass — *a 30-day grade the moment they paste the link*.
  - **> 100d** → the row is staged at `status='day30_unavailable'` (a terminal
    state outside the collector's `('scored','matched')` set) and **never
    grades** — a >100-day-old video's current counters are no longer a valid
    day-30 proxy.
- **No match / no connected handle →** silent exclusion: an ordinary scored
  preview, **no** posted row, zero track-record UI. We never build a record from
  a video the user doesn't own.

Idempotent on `tiktok_video_id` against both a prior worker ingest and a repeat
link-run: `ON CONFLICT` fills ownership/caption gaps only and never overwrites a
real outcome. The preview's own prediction is written back to the row's `y_pred`
(needed so grading can freeze `times_typical`); the JOINED tab still **displays**
the matched preview's stored score via `matched_submission_id`, never a rescore.

## 2. Era assertion (addendum A)

**Link-run own-video pairs grade as JOINED rows and can NEVER enter the BLIND
era.** The provenance discriminator is `rowEra(row)`: it returns `joined` for
any row with `match_tier ∈ {1,2}` and `blind` only for `source IN
('study_history','prospect_report')` with no such match. A link-run always sets
`match_tier=1`, and the JOINED prediction is the preview's stored score under the
**user's chosen objective** — so nothing a user link-runs can land on the blind
board. **The blind board stays single-config by construction.**

## 3. Cross-era dedup (addendum B/C)

`tiktok_video_id` is UNIQUE, so a link-run of a video already on the user's blind
board hits that one physical row via `ON CONFLICT` and attaches `match_tier`
while leaving its blind `source` intact for provenance. `rowEra` now resolves
`match_tier` **ahead of** source, so the row migrates BLIND→JOINED and is thereby
excluded from the blind board's display, calls, and hero math — **one video, one
visible verdict, the user's own preview wins.** On migration the frozen blind
grade is cleared (it was measured against the blind median, the wrong pool) so
the JOINED pass re-freezes `times_typical` against the JOINED median; the day-30
outcome itself is retained. Ops note added under the two-era rule: *cross-era
duplicates resolve to the JOINED row.*

## 4. Research annotation (Task 2 — no UI)

`outcome_knowable_at_preview` (`none|partial|full`) is **derivable at query
time** per graded JOINED row from the matched preview's `created_at` vs the
video's `posted_at` and `posted_at+30d`: `none` = forward prediction, `partial` =
some engagement public, `full` = **retrodiction** (the full 30-day result was
already public — what every 30–100d own-video link-run is). Ratified decision:
the product displays all three **identically**; C3 research segments on the
annotation so retrodiction rows never inflate a forward-prediction hit rate.
Surfaced in the Phase-C C3 hook (derivation SQL included).

## 5. Live verification (proxy on thecolorfulpantry, full cleanup)

Real link-runs through the deployed backend, proxy connected to
`@thecolorfulpantry` (who has a 13-row graded blind board). Pre-test:
`blindGraded=13, JOINED=0, heroOwner=blind`.

| # | Test | Result |
|---|---|---|
| a | Link-run her real **35d** video (not in the prior ingest) | New row: `src=link_fetch, tier=1, matched→sub 7233, is_day30_equiv=true, wec=0.0849, ageAtCollection=35, status=day30_collected`; graded → **JOINED, tt=1.00**, `totalGraded` 13→14 |
| b | Link-run a **ballerinafarm** URL from the same proxy | Silent exclusion: **no** link_fetch row, proxy owns **0** ballerinafarm rows; the creator's pre-existing prospect row left untouched (`user_id NULL, match_tier NULL`) |
| c | Repeat-run (a)'s URL | **1** row for that `tiktok_video_id` — idempotent, `matched_submission_id` preserved |
| d | Link-run a video **on her blind board** (age 44d, blind `tt=0.28`) | **Migrated** BLIND→JOINED: same row now `match_tier=1`, source retained as `prospect_report`, **re-graded** `tt 0.28→0.49`; `blindGraded` 13→12, JOINED 1→2, `totalGraded` unchanged at 14, blind hero recomputed |

**Collector "clock from posted date" guarantee** — asserted: `collect_day30.py`'s
discovery SQL gates on `posted_at + INTERVAL '30 days' <= now()` (and a recency
window), independent of when the row was created, so a video link-run at age 5d
is collected at *its* day 30, not 30 days after the link-run.

**`>100d` branch** — covered by unit test (a >100d run yields
`status='day30_unavailable'`, no `day30_wec_rate`, and a status outside both the
collector's and grading's eligible sets), not spent live.

**Cleanup verified:** all 21 thecolorfulpantry rows restored to their exact
snapshot (un-claimed, the test-(d) row un-migrated to `tt=0.28/verdict=hit/
call_type=weak/match_tier=NULL` — exact match); the one created link_fetch row
deleted; the proxy's 4 preview submissions/shadow_scores/fingerprints/synthesis
rows deleted; proxy user, redemption, temp invite code, and beta events deleted;
ballerinafarm's row confirmed untouched. Zero residue.

## 6. Unit tests

`backend/test_track_record_v5.mjs` (all green, real functions loaded from
`server.js`): age→outcome branches incl. **>100d**, the 30/100/101 boundaries,
WEC parity + zero-views guard, `posted_at`-from-id recovery + fallbacks, author
extraction, and the **cross-era dedup collision** (`{source:'study_history',
match_tier:1}` → `joined`; blind-without-match stays `blind`; `link_fetch` →
`joined`, never blind).

## 7. Git / deploy state

App repo `origin/main`: `3d59499` (own-video link path + cross-era dedup +
unit tests + runbook decision rules), `1181db7` (y_pred write-back — caught by
the live verify; a fresh JOINED row needs a non-null `y_pred` to grade). Research
repo `origin/main`: `8da2c01` (Ops §1a/§1e one-liners, two-era cross-era-dedup
note, C3 `outcome_knowable_at_preview` annotation). Backend live on Render
(`shortSha=1181db7`), no frontend change this round. New behavior needs no schema
migration — every column used (`is_day30_equiv`, `day30_*`, `match_tier`,
`matched_submission_id`, `video_age_days_at_collection`, `source`) already
existed. Exempt paths and keep-warm untouched.
