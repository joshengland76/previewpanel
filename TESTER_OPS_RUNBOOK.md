# Tester Ops Runbook

Operational reference for running the test-user batch day to day. Companion
to `validation/OPERATIONS.md` (which covers the same daily cadence in more
mechanical detail) and `PreviewPanel_Operations_and_Roadmap.md` (the living
system doc). This file is the "what do I actually do, and is it healthy"
quick reference.

## Daily cadence (~2 minutes)

From the `PreviewPanel` repo root, once a day:

```bash
python3 validation/worker.py          # discover + score newly-posted videos
python3 validation/collect_day30.py   # collect real outcomes for day-30-eligible videos
python3 validation/dashboard.py       # read-only report -- run as often as you like
```

No LaunchAgent yet (deliberately deferred until the test batch is actually
live — see `validation/OPERATIONS.md` for why). Missing a day costs nothing:
`collect_day30.py`'s day 30–37 window absorbs it.

## What healthy looks like in week one

- **Shadow rows accruing.** Every real preview submission (TikTok, Reels, or
  Shorts) writes a `shadow_scores` row when `SHADOW_SCORING=true`. Check
  count is climbing:
  ```sql
  SELECT count(*), max(created_at) FROM shadow_scores WHERE is_posted_video IS NOT TRUE;
  ```
  As of this writing: 34 real previews scored, 1 fingerprinted (pre-tester-batch
  organic traffic).
- **`extract_cdims` ok-rate.** Claude C_dims extraction (`EXTRACT_CDIMS=true`)
  writes `shadow_scores.extract_cdims_status` per row: `ok`, `failed: <reason>`,
  `not_run` (flag was off), or `skipped_research_api` (research-API submissions
  don't run this path). Healthy ok-rate excludes `not_run`/`skipped_research_api`
  from the denominator:
  ```sql
  SELECT extract_cdims_status, count(*) FROM shadow_scores GROUP BY extract_cdims_status;
  ```
  Current baseline: 18 ok / 19 genuine attempts ≈ **95% ok-rate**. A sustained
  drop well below that across new tester submissions is worth investigating
  (frame-sampling failures, unusual video formats) before it's worth alarming
  on — one-off failures degrade gracefully (missing C_dims just means a
  thinner feature vector for that row, not a broken submission).
- **Cost line.** Per real preview submission: TwelveLabs judges
  ~$0.0262/min × video length + C_dims extraction ~$0.028/video ≈ **~$0.03–0.05
  typical video** (see Part B.6 below for the full projection). Nothing here
  should spike unexpectedly — if TwelveLabs or Anthropic API costs jump,
  check for a submission-volume anomaly or a stuck retry loop before assuming
  a pricing change.
- **Day-30 pipeline.** Once testers start posting, `validation/dashboard.py`'s
  funnel section is the single glance: posted videos by status, day-30
  pending/collected/failed counts. A pending count that never drains after
  day 37 means `collect_day30.py` isn't running — check the daily cadence
  actually happened.

## Rollback flags (Render env vars — flip off, no code deploy needed)

All of these degrade gracefully to "as if the feature were never added" when
turned off — none of them are load-bearing for the core scoring pipeline:

| Flag | Effect when `false`/unset |
|---|---|
| `SHADOW_SCORING` | Stops writing `shadow_scores` rows entirely (no percentile display, no validation data collection) |
| `DISPLAY_SCORE` | Score card / percentiles hidden from the end user (shadow scoring can keep running silently) |
| `FINGERPRINT_PREVIEWS` | Stops fingerprinting previews at submission (breaks Task 4's posted-video matching, but the core analysis is untouched) |
| `EXTRACT_CDIMS` | Skips Claude C_dims extraction (`shadow_scores.extract_cdims_status` becomes `not_run`; model falls back to a thinner feature vector) |
| `JUDGES_V21` | Reverts judge prompt to `judges-v1.0` |
| `JUDGE_CLAUDE_FALLBACK_ENABLED` | Disables the Anthropic-judge fallback path (requires `ANTHROPIC_API_KEY` too) |

The **keep-warm path has no flag and must never be touched** regardless of
what else needs rolling back.

## Anchor rescore + drift calendar

- **Anchor rescore: ~2026-08-09.** Re-runs the frozen anchor set against the
  live model to catch silent drift (API model updates, prompt regressions)
  before it accumulates.
- **Drift retest: ~2026-09.** Wider check, same purpose, longer horizon.
- **TL cost-constant reconciliation: ~2027-05** (annual).

## C3 entry criterion

Attribution analyses (C3 — e.g., do Tier-2 "changed after feedback" posts
beat the same user's Tier-1 posts?) start once **the first user reaches ≥5
`day30_collected` posted videos** — the same floor `dashboard.py`'s primary
metric already enforces per user. Check via:

```bash
python3 validation/dashboard.py   # "Qualifying users" line in section (b)
```

Until then, every collected video accrues into the "accruing, n=X of 5"
state — expected, not a bug.
