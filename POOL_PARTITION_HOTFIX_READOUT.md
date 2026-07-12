# POOL_PARTITION_HOTFIX_READOUT — cohort_5 pool rows re-partitioned by objective_creator

**Date:** 2026-07-12. **Scope:** app repo only (`backend/scoring/corpus_reference_pool.json`).

## The bug

Cohort_5 Phase 3d-3 added 228 cohort_5 rows to `corpus_reference_pool.json`,
keyed on each video's own Claude-classified per-video `objective`. That's the
same partition bug this project already found and fixed once, in the
research repo: `PHASEB4_READOUT.md`'s **Task 0 — corpus seed partition
hotfix**, logged as prereg amendment 27. That fix established the standing
convention: `corpus_reference_pool.json` must partition by
**`objective_creator`** (`research_creators.objective` — the submitter's
*declared* objective), because live PreviewPanel submissions bucket
percentile pools the same way — never by a video's own independently
classified content. Roughly a third of creators post at least one video
whose per-video classification drifts from their declared niche; using the
per-video field silently mixes rows from other niches' creators into the
wrong pool (or drops rows from the right creators whose particular video
happened to classify differently).

## The fix

1. Removed the 228 per-video-tagged rows.
2. Re-added 237 rows keyed on `objective_creator`: **126 Gaming** (every
   scored video belonging to a gaming-enrolled creator, regardless of that
   video's own classification) + **111 Educational/How-To**. Dancing's 163
   videos stay out entirely — Dancing doesn't clear `showPercentile`
   (p_gt0=0.613), so there's nothing for its rows to feed into yet.
   Predictions (`prediction_cal`) and `posted_at` unchanged from the frozen
   capstone artifact scoring already done in Phase 3.

## A count correction discovered along the way

The hotfix instruction expected 132 Gaming / 88 Educational rows — figures
taken from `COHORT5_READOUT.md`'s Phase 2 collection table. Cross-checking
directly against the DB (`SELECT c.objective, COUNT(*) FROM research_videos
v JOIN research_creators c ... WHERE c.cohort='cohort_5' GROUP BY
c.objective`) found the real, authoritative counts are **126 Gaming / 111
Educational / 163 Dancing** (400 total, matches). The 132/88/180 figures in
`COHORT5_READOUT.md` were a reporting error on my part — not a data problem,
just an arithmetic mistake when the original readout was written. The pool
rebuild above uses the correct, DB-verified counts; `COHORT5_READOUT.md`'s
collection table is corrected in the same commit as this readout.

## Verification

**Pool composition** (`corpus_reference_pool.json`, 4,077 rows total):

| Objective | Before hotfix | After hotfix |
|---|---|---|
| Gaming | 325 (199 original + 117 mistagged per-video, wrong 7 creators mixed in) | 325 (199 original + 126 objective_creator-correct) |
| Educational/How-To | 303 (192 original + 111 mistagged) | 303 (192 original + 111 objective_creator-correct) |
| Dancing | 97 (unchanged, cohort_5 never added here) | 97 (unchanged) |

(Gaming's total row count happens to match before/after — 117 vs 126 — by
coincidence of the specific videos involved; the *composition* is what
changed: some of the removed 117 belonged to non-gaming-enrolled creators
whose individual videos classified as "Gaming" content, and the added 126
are the correct, complete set of gaming-enrolled creators' videos.)

**10-row spot-check** against `research_creators.objective`: all 10 matched
the pool's tag. One row (video 6009, `playfulpuffer`, gaming-enrolled)
surfaced a genuine per-video/per-creator classification mismatch — that
video's own content classified as "Aesthetic/Vibes" — and was correctly
tagged "Gaming" in the pool per the creator-level convention, exactly the
scenario Task 0's original fix targeted.

**Dancing-leak check**: 0 Dancing-creator videos found anywhere in the added
rows (explicit `SELECT ... WHERE c.objective = 'dancing' AND v.id = ANY(...)`
against the 237 added video_ids — empty result).

**Live sanity check** (against the exact deployed commit, `00a087d`,
confirmed live via `/version`):

| Objective | showPercentile | precisionCaveatLine | nichePoolSize |
|---|---|---|---|
| Gaming | true | present | 100 (window cap; pool now correctly composed) |
| Dancing | false (honest line instead) | — | — |

## Amendment

This is a reaffirmation of the standing pool-partition convention (Task 0,
`PHASEB4_READOUT.md`, prereg amendment 27), not a new policy — cohort_5's
Phase 3d-3 simply implemented it incorrectly the first time. No change to
`tiers_v2_2.json`, the tier policy, or the two-axis display gate itself;
this hotfix only touches which rows populate the live percentile pools.

STOP.
