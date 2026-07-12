# COHORT5_READOUT — cohort_5 enrollment, back-catalog collection, tier re-estimation

**Date:** 2026-07-12. **Scope:** research repo (`correlation-research`) + Neon
research DB, plus one conditional app-repo change (Phase 3d). Design
pre-registered in `correlation-research/analysis/modeling/reports/improve_v2/COHORT5_PREREG.md`
before any cohort_5 number existed. Full prompt executed end-to-end; this is
the closing readout.

## Phase 0 — pre-flight

- **`classify_tier()` threshold fix**: `cohort3_backfill.py`'s tier
  breakpoints moved from cohort_3/4's informal 150K/750K to the standing
  convention (small 1K–50K, mid 50K–500K, large >500K). Historical rows not
  re-tiered. This also brought `cohort3_backfill.py` under version control
  for the first time — it had been relied on for two prior cohorts without
  ever being committed.
- **Dedup check**: none of the 28 candidate handles (24 keeps + 4 reserves)
  already existed in `research_creators`. Clean.

## Phase 1 — re-verification and enrollment (23 of 24 planned)

Every handle was re-checked live against the standing bars (≥10 videos
posted 30–90 days ago, cadence, account reachability) via yt-dlp, plus a
manual title spot-check for the two flagged purity concerns.

| Objective | Planned keeps | Enrolled | Deviation |
|---|---|---|---|
| Dancing | 9 | 9 | `biancadance88` failed the 10-video floor (9 mature) — the prompt's own "cadence dipped" flag was confirmed real. Replaced by reserve `staccatostark` (10 mature). |
| Gaming | 8 | **7** | `puckykat` no longer exists under that handle — confirmed via yt-dlp extractor failure *and* a direct page check ("Couldn't find this account"), not a transient scraping hiccup. Replaced by reserve `playfulpuffer`. `ecocacolaaa` separately failed the 10-video floor (7 mature) — no second Gaming reserve existed to fill this gap, so Gaming landed at 7. Per the prereg's own promotion rule, a 1-creator shortfall is below the ">2 below, STOP" threshold, so enrollment proceeded rather than halting. |
| Educational/How-To | 7 | 7 | All 7 keeps passed cleanly, no substitutions needed. |

Both explicitly flagged purity concerns checked out clean via a 10–12 video
title spot-check: `itsmephiz` (sponsored-density risk) showed genuine
gaming-commentary content throughout; `vudooom` (indirect feed verification)
showed a genuine gaming feed (slower cadence than peers — 26 days since last
post at verification time — but within the 30-day dormancy convention).

**Enrolled:** 23 creators, `status='enrolled'`, `cohort='cohort_5'`, tier
classified under the fixed thresholds, `follower_count_current` and
`follower_count_at_start` both populated from a live scrape at enrollment
(closing the fleet-wide gap where `follower_count_at_start` had been 100%
NULL for every prior cohort).

## Phase 2 — back-catalog collection

400 videos collected across 23 creators (target was 20/creator; several
landed lower where the 30–90-day mature supply was thinner — e.g.
`staccatostark`/`textuuri`/`yaboiwiilly` at 10). Every creator clears the
≥5-scored acceptance floor by a wide margin.

| Objective | Creators | Videos collected | Videos scored |
|---|---|---|---|
| Dancing | 9 | 180 | 180 |
| Gaming | 7 | 132 | 132 |
| Educational/How-To | 7 | 88 | 88 |
| **Total** | **23** | **400** | **400** |

Metrics captured under interval label `backcatalog_day30_equiv_2026_07`
(not plain `day_30`, per this prompt's explicit convention — distinct from
cohort_3/4's precedent, which used `day_30` directly) — `cohort3_backfill.py`
was extended with a `--day30-label` flag rather than hardcoding the new
label, so cohort_3/4 callers are unaffected.

**Real issue found and resolved: one duplicate submission.** A scheduled
`run_morning.py` job fired at its normal 5 AM window while the cohort_5
batch (started the previous evening) was still running long enough to
overlap it — exactly the collision this project's standing rule ("never run
submission batches across the 5 AM morning-chain window") exists to prevent,
here caused by duration rather than intentional scheduling. `run_morning.py`'s
bare Stage F submit step and the cohort_5 batch's own per-video submit call
both targeted video 6192 (`michi.japanese.se`) within about a minute of each
other. Swept all ~400 cohort_5 videos for this pattern — found exactly this
one instance, no others. Resolved by deleting the later of the two identical-
quality duplicate judge runs, per this project's established keeper-priority
convention (real score > `rejected_too_long` > earliest). Net extra cost:
~$0.05 (one duplicate TwelveLabs + Claude call).

**Cost:** 400 videos × ~$0.05/video all-in (established constant, see
`PreviewPanel_Operations_and_Roadmap.md` §3d) ≈ **$20**, plus the ~$0.05
duplicate above — essentially in line with the ~$24 estimate.

## Phase 3 — tier re-estimation

Predictions pooled two out-of-sample sources per objective: existing
Dancing/Gaming/Educational creators' cached ENDGAME full-corpus CV
out-of-fold predictions (unchanged), and cohort_5's own creators scored with
the frozen shipped artifact (`capstone_model_artifact_v2.pkl`, never refit).
`tier_policy_v2_1` applied mechanically — no new policy written.

| Objective | Old tier (n) | New tier (n) | WC-Spearman | P(WC>0) | Precision@decile |
|---|---|---|---|---|---|
| Dancing | ABSTAIN (5) | ABSTAIN (14) | +0.020 | 0.613 | 0.609 |
| Gaming | ABSTAIN (11) | **PROVISIONAL (18)** | +0.183 | 0.991 | 0.507 |
| Educational/How-To | ABSTAIN (13) | ABSTAIN (20) | +0.188 | 1.000 | 0.464 |

Only Gaming's tier *label* changed. All 16 other PREDICT objectives carried
forward unchanged from `tiers_v2_1.json` into `tiers_v2_2.json`.

## Phase 3d — ship verdict (modified from the original conditional)

The original prompt's Phase 3d ("ship only if ≥1 tier flips into/out of
PREDICT") ran into a real edge case: Gaming's flip was ABSTAIN→PROVISIONAL,
not into PREDICT — invisible to the app's old binary tier gate, so shipping
`tiers_v2_2.json` alone would have had zero visible effect. Surfaced this to
Josh, who redesigned the display gate rather than skip the ship: percentile
display now reads `P(WC>0) >= 0.95` directly, independent of the tier label,
with a separate precision-caveat line for objectives that clear the ranking
bar but not the top-pick precision bar.

**Shipped:**
- `tiers_v2_2.json` copied into the app repo (`backend/scoring/`);
  `scoreDisplay.js` and `shadowScore.js` repointed to it (`tiers_v2_1.json`
  retained, not deleted).
- `scoreDisplay.js`'s gate rewritten: `showPercentile = p_gt0 >= 0.95` (was
  `tier === "PREDICT"`); new `precisionCaveatLine` field, shown when
  `showPercentile` is true but `precision_at_decile < 0.55`.
- New copy constant in `scoreDisplayCopy.js`: "Percentiles here reflect
  validated ranking for this niche; our top-pick hit rate is still
  maturing."
- `corpus_reference_pool.json` gained 228 cohort_5 rows (117 Gaming + 111
  Educational/How-To, per-video-classified objective matching the pool's
  existing convention, native frozen-artifact predictions, no version
  shift). Dancing's cohort_5 rows were deliberately not added — Dancing
  doesn't clear `showPercentile`, so there's nothing for them to feed yet.
- Both backend unit-test suites updated and passing (`scoreDisplayTest.mjs`
  gained explicit two-axis coverage; `percentilePoolsTest.mjs` unaffected).
- Deployed; verified live against the exact deployed commit (`f1336ed`):

| Case | showPercentile | Caveat line | Result |
|---|---|---|---|
| Gaming | true | present | Percentile renders, pool window full at 100 (cohort_5 rows now dominate the recent window) |
| Educational/How-To | true | present | Same rule applies here too — not explicitly called out in the original ask, but a real, verified consequence of it |
| Dancing | false | — (honest line instead) | Stays fully suppressed, as before |
| Food & Drinks/Cooking (existing PREDICT) | true | absent (null) | Renders exactly as before |

**Dancing is stated as a confirmed model limitation**, not a data-volume
problem to paper over: even at n=14 (up from 5), P(WC>0)=0.613 is far below
the 0.95 bar. More cohort_5-style enrollment could resolve it, or could
confirm Dancing genuinely needs different signal than the current locked
feature set captures — an open question, not assumed either way.

## Documentation updates

- `PreviewPanel_Scoring_Model_Report.md` §3 (corpus counts, cohort_5 row
  added, explicitly marked as NOT part of the frozen training snapshot), §7
  (tier table updated to v2.2, claims-to-statistics mapping added, Dancing
  limitation stated), and the scheduled-touch-up note marked done.
- `PreviewPanel_Operations_and_Roadmap.md` §1d (two-axis gate documented),
  §3c (`follower_count_at_start` gap-closure noted), and the Phase D roadmap
  entry updated from "planned" to the actual outcome.

## Deviations from the original prompt (as amendments, not silent edits)

1. Gaming enrolled at 7, not 8 (Phase 1) — surfaced and confirmed with Josh
   before proceeding to Phase 2's real-cost collection.
2. Metrics interval label is `backcatalog_day30_equiv_2026_07`, not plain
   `day_30` — this prompt's own explicit instruction, a deliberate departure
   from cohort_3/4's precedent, implemented via a new `--day30-label` flag
   rather than a hardcoded change.
3. Phase 3d's conditional was redesigned mid-execution (two-axis gate
   instead of a binary ship/no-ship on the PREDICT label) — Josh's explicit
   direction after the ABSTAIN→PROVISIONAL edge case was surfaced.
4. Operations doc placement: Josh's instruction said "§1a documents the
   two-axis display rule"; the content fit §1d ("Percentile pools — how the
   displayed score works") far better than §1a (the submission pipeline
   section), so it was placed there instead of forcing a stale section
   number.

STOP.
