# Pool Consistency Readout — Pool Hygiene + Same-Video Score Consistency

**Status: ALL TASKS COMPLETE, verified locally against real repeat submissions.**
Two problems from `PRELAUNCH_FIX_READOUT.md`'s variability analysis are fixed
here: (1) the niche/overall percentile pools were mostly the dev/test period's
own traffic plus Josh's own repeated test-file submissions, and (2) repeating
the same video gave a visibly different score each time, purely from model
noise, with no indication to the user that it was a repeat.

**Hard constraints honored**: app repo only; keep-warm not touched.

---

## Task 1 — pool eligibility

Added `shadow_scores.pool_eligible BOOLEAN DEFAULT true`. Both percentilePools
windows (niche + overall) now filter on it, via `SCORE_DISPLAY_FETCHERS.
fetchShadowRows`'s SQL (`AND pool_eligible`, alongside the unchanged
`is_posted_video IS NOT TRUE` exclusion) — same pattern, one more condition.

**Backfill**: one-time, date-bounded, idempotent (mirrors the existing
`pegasus_model` backfill's pattern exactly — safe to run on every boot
forever, since it only ever touches rows before a fixed instant):

```sql
UPDATE shadow_scores SET pool_eligible = false
WHERE created_at < '2026-07-12T00:22:39.032Z' AND pool_eligible IS DISTINCT FROM false
```

**Epoch: `2026-07-12T00:22:39.032Z`** — captured via `SELECT now()` against
the production DB at the moment this migration was written. All 66 rows that
existed at that instant (the entire dev/test period) are now excluded.

**Verified**: after the migration ran, zero real (non-corpus) rows remained
eligible for Food & Drinks/Cooking, Makeup/Beauty, or the overall pool —
confirmed both by direct query and by resolving `getScoreDisplay()` live
against production data before adding any new test traffic.

## Task 2 — fingerprint-group score consistency

At shadow-scoring time (`resolveFingerprintGroup()` in `server.js`), looks up
Tier-1 fingerprint matches among the *same user's own* other previews from
the trailing 30 days. No-op (returns immediately) if there's no `user_id`, no
fingerprint yet (fire-and-forget fingerprinting hasn't finished), or no
candidates — matching every "skip gracefully" case in the spec.

**Matching**: extended `validation/fingerprint.py` with a `--match-candidates`
CLI mode — one Python process compares the query fingerprint against a whole
batch of candidates (pure hash comparison, no video decoding, so this never
touches the ffmpeg concurrency semaphore `fingerprintPreviewForJob` uses).
Reuses `match_score()` unchanged; same "any error → skip, never block
scoring" failure contract as the rest of the fingerprinting subsystem.

**Grouping**: every `shadow_scores` row gets an `fp_group_key` at insert time
— either adopted from an existing matched group, or self-assigned (`'fp:' +
own id`) if it's a fresh singleton. This means any *future* submission that
matches *any* member of an existing group always finds a non-null key to
join, with no retroactive updates to older rows ever needed. `group_k` /
`group_mean_prediction` record the group's size and averaged ŷ as of that
row's own insert (older rows are never rewritten when new members join —
each reflects what was true when it was scored). **Pool rule**: only the
group's first row keeps `pool_eligible=true`; every subsequent match is
inserted `pool_eligible=false` directly (independent of the Task 1 backfill).

**Display**: `getScoreDisplay()` now takes a `groupK` dep; when the caller
passes the group's mean ŷ (k≥2) instead of the raw per-run prediction, the
returned payload includes `groupAverageNote: "Average of k analyses of this
video."` (null otherwise). The raw per-run `prediction` column is always
stored unchanged — averaging only affects the *display* and its percentiles,
never the underlying record. Both `runShadowScoringForJob` (the normal path)
and the `/api/status` DB-fallback recovery path (Pre-Launch Fix Task 1) now
compute this identically, so a job recovered via fallback shows the same
payload the original computation would have.

**Frontend**: `VerdictHero.jsx` renders `scoreDisplay.groupAverageNote` right
above the existing trim note, for both the percentile and ABSTAIN views.
`localStorage` history already stores the whole `scoreDisplay` object
verbatim (from the Pre-Launch Fix work) — since the averaged prediction and
the note are just fields on that same object, history entries carry the
averaged display automatically; no separate frontend change was needed for
that part of the task.

**Known related gap, not addressed by this pass**: `fetchPersonalPredictions`
(a user's own personal-percentile history) is not filtered by
`pool_eligible` — a user's own repeat runs still count multiple times toward
their *personal* percentile. Out of scope per this prompt's literal wording
(which scopes `pool_eligible` to "percentilePools (both windows)," i.e.
niche + overall only), but worth knowing about if personal-percentile
self-inflation comes up later.

## Task 3 — copy guard

One line, added in two places (no new UI element):
- Methodology modal (`MethodologyModal.jsx`): "Scores naturally vary a few
  points between analyses of the same video; repeat runs of the same video
  are averaged."
- Score-card tooltip: appended the same sentence to the existing
  `poolInfoTooltip` copy (shown via the existing info-icon next to "Beats X%
  of the last 1,000 videos we've scored" — no new tooltip trigger needed).

## Task 4 — verify

Ran against the local backend (`SHADOW_SCORING`/`DISPLAY_SCORE`/
`EXTRACT_CDIMS`/`FINGERPRINT_PREVIEWS` all `true`, `PYTHON_BIN` pointed at a
local venv with `imagehash`/`pillow` installed) with real TwelveLabs/Claude
calls against the shared Neon DB, one consistent test `userId` throughout:

1. **First run** (small real test clip): `shadow_scores.id=110`,
   `pool_eligible=true`, `fp_group_key='fp:110'` (self-assigned), `group_k=1`,
   `groupAverageNote: null` — normal first-run behavior, unchanged.
2. **Second run, identical file, same user**: `shadow_scores.id=111`,
   `pool_eligible=false`, `fp_group_key='fp:110'` (adopted — Tier-1 match
   found), `group_k=2`, `group_mean_prediction` = exact mean of both runs'
   raw predictions. `/api/status` served `groupAverageNote: "Average of 2
   analyses of this video."` and a `nichePercentile` computed from the mean,
   not either run's raw value alone.
3. **Third run, genuinely different video, same user**: `shadow_scores.id=112`,
   `pool_eligible=true`, `fp_group_key='fp:112'` (own new group), `group_k=1`,
   `groupAverageNote: null` — confirms a fresh video is entirely unaffected by
   the existing group, exactly as it should be.
4. **Pool composition**: before this test, the "Travel" niche pool had zero
   real eligible rows (corpus-only, per Task 1). After all three test runs,
   exactly **2** real eligible rows existed — the two distinct videos (110,
   112) — not 3; the repeat (111) correctly never entered the pool. Confirms
   "pools corpus-clean before, and repeats don't inflate them after."

All three test submissions (`submissions.id` 6643/6644/6646) and their
`shadow_scores`/`preview_fingerprints` rows were deleted from the shared DB
after verification — pure mechanical QA, not real usage.

## Task 5 — doc ticks

- `Summary documents/PreviewPanel_Operations_and_Roadmap.md` §1d: added the
  `pool_eligible` rule, the exact backfill epoch, and a description of the
  fingerprint-group dedupe mechanism and its display behavior.
- `Summary documents/PreviewPanel_Scoring_Model_Report.md` §8b: added the
  measured same-session repeat-run variability (ŷ SD ≈ 0.025 across 18
  identical runs of one test video, ~±10 niche-percentile points at
  mid-distribution, concentrated in CDIMS + judge-consensus/disagreement
  features — consistent with the section's broader extractor-reliability
  theme), with a pointer to `PRELAUNCH_FIX_READOUT.md`'s full analysis and a
  note that this readout's fingerprint-group averaging is the direct
  operational response to that finding.

---

## What's left

Nothing further gates this. Local verification is complete and real; the
schema migration is idempotent and safe to deploy (it's already been proven
against the real production DB via the same connection string local dev
uses — the ALTER TABLE/backfill statements ran as part of `initDb()` during
this session's local server startup, against the shared Neon instance, not a
separate local database). Committing and pushing now per this session's
established pattern; Render will pick up the backend changes on deploy
(~2 min), Vercel will pick up the frontend changes (possibly slower, per the
Pre-Launch Fix readout's documented lag — verify via the logic-pattern-grep
method, not a byte/hash diff, if confirming the deploy).
