# Personal-Percentile Group Dedup Readout

**Status: ALL TASKS COMPLETE, verified locally against 5 real repeat submissions.**
The prior pass (`POOL_CONSISTENCY_READOUT.md`) fixed the cross-user niche/
overall pools; this one closes the matching gap it explicitly flagged as
out of scope: a user's own **personal** percentile history still counted
every repeat run of the same video separately, so re-testing a video 5
times could wrongly cross the activation floor, or silently over-represent
one video in "rank X of N."

**Hard constraints honored**: app repo only; keep-warm not touched.

---

## Task 1 — personal pool = distinct videos

`fetchPersonalPredictions` (server.js) now returns full rows (`id`,
`prediction`, `fp_group_key`, `group_k`, `group_mean_prediction`) instead of
a flat prediction array. A new `dedupePersonalGroups()` (`percentilePools.js`)
collapses those rows to one entry per **distinct fingerprint group** before
`personalDisplay()` ever sees them:

- Rows with no `fp_group_key` (pre-dates fingerprinting, or the match never
  resolved) are each their own singleton group — never merged with anything.
- Within a real group, every member's `group_mean_prediction` already
  reflects the mean of *all* that group's raw predictions up to and
  including that row (shadow-scoring writes it that way, never retroactively
  updating older rows — see `POOL_CONSISTENCY_READOUT.md`), so the member
  with the highest `group_k` is simply the group's most up-to-date mean —
  no re-averaging needed here, just picking that one row per group.

`getScoreDisplay()` calls `dedupePersonalGroups(personalRows)` before
`personalDisplay()`, so the existing `PERSONAL_MIN_VIDEOS` (5) floor and
`PERSONAL_ORDINAL_CEILING` (20) logic — both unchanged — now operate on
distinct-video counts automatically, with zero changes to that logic itself.

The current submission's own comparison value passed into `personalDisplay`
was already the group mean when k≥2 (the prior prompt's `displayPrediction`,
passed straight through as `getScoreDisplay`'s `prediction` parameter) — no
change needed there, confirming the two prompts compose correctly.

**Code comment, as requested**: `fetchPersonalPredictions`'s query
deliberately does **not** filter on `pool_eligible` — that flag is
cross-user pool hygiene (epoch-backfilled false for the pre-launch period,
plus every non-first row of a fingerprint-matched group, gating the
niche/overall pools only). A user's own history is a different concern:
video identity there is the fingerprint group, not pool membership, so every
row this user ever scored is fetched and `dedupePersonalGroups()` does the
collapsing itself.

## Task 2 — tests

Two existing test files needed real fixes, not just additions: both
`scoreDisplayTest.mjs` and (indirectly, via the new dependency) exercised
`fetchPersonalPredictions` with plain number-array stubs (`[0.1, 0.2, ...]`),
which is no longer the real contract — a raw number has no `.fp_group_key`
or `.id`, so every entry would have collapsed into a single bogus group
under the naive fallback key. Added a `personalRows(videos)` builder
(`scoreDisplayTest.mjs`) that constructs properly-shaped rows — including
correct running `group_k`/`group_mean_prediction` for multi-run videos — and
converted every existing stub to use it, preserving each test's original
intent (a bare number → a one-element run list → a singleton group, same
behavior as before this change).

New coverage, matching the prompt's three scenarios exactly:
- **(a)** 5 runs of one video + 1 distinct video = 2 distinct groups →
  `personal` stays `null` (well below the 5-video floor, despite 6 raw rows).
- **(b)** 5 distinct videos, one run 3 times = 5 distinct groups → activates
  (`ordinal`, `total: 5`), and the repeated video counts once, at its running
  mean (0.3, not 0.1/0.3/0.5 three times) — verified the resulting rank is
  correct against that deduped pool.
- **(c)** Fresh single-video user (1 run, no group) → unchanged, still `null`
  (1 < 5), confirming the dedup path doesn't disturb the untouched case.

Also added direct unit coverage for `dedupePersonalGroups()` itself in
`percentilePoolsTest.mjs`: singleton rows stay separate, a 3-run group
collapses to exactly one entry valued at the latest row's mean, and a mixed
set (1 group of 3 + 2 singletons) dedupes to 3, not 5.

Both suites pass:
```
node scoring/percentilePoolsTest.mjs   -> GATE: PASS
node scoring/scoreDisplayTest.mjs      -> GATE: PASS
```

## Task 3 — verify live + docs

**Live pass**: reused the prior prompt's pattern — a short synthetic test
clip, one consistent `userId`, against the local backend with
`SHADOW_SCORING`/`DISPLAY_SCORE`/`EXTRACT_CDIMS`/`FINGERPRINT_PREVIEWS` all
on and real TwelveLabs/Claude calls against the shared Neon DB. Submitted
the **same** video **5 times in a row** as one user (sequentially, each run
allowed to fully complete before the next started, so each submission's
fingerprint match against the prior rows was for-real, not simulated):

- All 5 `shadow_scores` rows shared `fp_group_key='fp:113'`, with `group_k`
  incrementing 1→5 and a consistent `group_mean_prediction`, exactly as
  designed.
- The 5th run's `/api/status` response: `"personal": null` — **NOT
  activated**, despite 5 real raw submissions, because it's only **1**
  distinct video. This is the exact bug this readout fixes, confirmed live,
  not just in the unit tests: without the dedup, 5 raw runs would have
  crossed `PERSONAL_MIN_VIDEOS` and shown a (meaningless, self-referential)
  ordinal payload.
- `groupAverageNote: "Average of 5 analyses of this video."` also confirmed
  correct across all 5 repeats — a bonus regression check that the prior
  prompt's fix keeps working at k=5, not just k=2.

All 5 test submissions (`submissions.id` 6647–6651) and their
`shadow_scores`/`preview_fingerprints` rows were deleted from the shared DB
afterward — pure mechanical QA, not real usage.

**Docs**: `Summary documents/PreviewPanel_Operations_and_Roadmap.md` §1d —
one paragraph added: personal pool counts distinct fingerprint groups, not
runs, and is deliberately not `pool_eligible`-filtered (different concern),
with a pointer to this readout.

No frontend changes were needed — `VerdictHero.jsx`'s existing
`personalHeadline` rendering and `scoreDisplayCopy.js`'s `personalHeadline()`
copy function already consume whatever shape `personalDisplay()` returns;
only the *pool feeding into it* changed, not the display contract.

---

## What's left

Nothing further gates this. Committing and pushing now per this session's
established pattern; Render will pick up the backend-only changes on
deploy (~2 min) — no frontend rebuild needed this round.
