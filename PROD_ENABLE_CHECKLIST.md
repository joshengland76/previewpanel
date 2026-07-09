# Production Shadow-Scoring Enablement Checklist

**Status: EXECUTED — all flags live in production as of 2026-07-09**
(`EXTRACT_CDIMS=true`, `SHADOW_SCORING=true`, `DISPLAY_SCORE=true`,
`CDIMS_ANTHROPIC_API_KEY` set, reusing `SYNTHESIS_ANTHROPIC_API_KEY`'s
underlying credential under its own env var name per Josh's decision).
Originally prepared in Phase B3 as a flags-off dry-run guide; Phase B3b
executed it. Kept as the reference doc for what "enabled" means and how to
verify/roll back — re-read Step 3-4 below whenever `shadow_scores` or the
score display looks wrong.

## Prerequisites (confirmed true before enablement)

- [x] Poller instance-scoping fix deployed and live-verified (3/3 local
      submissions against live prod, zero races — see `PHASEB3_READOUT.md`).
      `INSTANCE_ID=production` set in Render.
- [x] `node backend/scoring/goldenVectorTest.mjs` — 421/421, PASS.
- [x] `node backend/scoring/durationClampTest.mjs` — PASS.
- [x] `node backend/scoring/percentilePoolsTest.mjs` — PASS (Phase B3b).
- [x] `node backend/scoring/scoreDisplayTest.mjs` — PASS (Phase B3b).

## Step 1 — C_dims key (done)

- [x] `CDIMS_ANTHROPIC_API_KEY` set in Render via the Render API, value
      copied from `SYNTHESIS_ANTHROPIC_API_KEY` (Josh's explicit choice —
      same underlying Anthropic credential, separate env var name, so a
      C_dims outage/quota issue still can't touch the synthesis code path,
      though spend isn't capped independently since it's one account).

## Step 2 — flags (done)

- [x] `EXTRACT_CDIMS=true`
- [x] `SHADOW_SCORING=true`
- [x] `DISPLAY_SCORE=true` (Phase B3b — the score card is now live, not
      dark-launched; the frontend-side `DISPLAY_SCORE_ENABLED` gate was
      removed, so the backend flag is the only switch now)
- [x] `CLAMP_DURATION` left unset (defaults `true`)
- [x] Deployed (Render, commit `cbaf4ec`, manually triggered redeploy since
      env-var-only changes don't auto-redeploy on Render — a code push does,
      an API env-var PUT does not; use `POST /v1/services/{id}/deploys` or
      the dashboard's manual deploy button after any future env-var-only change)

## Step 3 — verify shadow rows

Run against the production Neon DB (read-only checks, no writes):

```sql
SELECT id, submission_id, created_at, model_version, prompt_version,
       pegasus_model, objective, extract_cdims_status, prediction,
       calibrated_percentile, tier_at_score_time
FROM shadow_scores
ORDER BY id DESC
LIMIT 20;
```

Confirm:
- [ ] `prediction` and `calibrated_percentile` are populated (not all NULL).
- [ ] `objective` is populated (Phase B3b — needed for the pool engine's
      per-niche window; a NULL here means that row won't contribute to any
      objective's pool, only the overall-1000 pool).
- [ ] `prompt_version` reads `judges-v1.0` (or current `JUDGE_PROMPT_VERSION`).
- [ ] `extract_cdims_status` is mostly `"ok"` — if mostly `"failed: ..."`,
      check the reason string first (frame-sampling failures were the actual
      bug found in B2's smoke test, fixed via `retainedTrims`).
- [ ] `input_features` (JSONB) has C_dims-derived keys populated on `"ok"` rows.

## Step 4 — verify cost

- [ ] Anthropic console, filtered to the reused key — confirm per-call cost
      lands near **$0.03/video** (4 sampled frames + prompt text in, ~$3/M-in
      + $15/M-out sonnet-4-6 pricing). Sharply above this (e.g. $0.10+/video)
      likely means frame sampling or prompt construction regressed.

### Projected monthly cost (C_dims only — TwelveLabs/judge cost is unchanged
### and already billed regardless of these flags)

| Submissions/month | @ $0.03/video |
|---|---|
| 100  | ~$3/month |
| 500  | ~$15/month |
| 2,000 | ~$60/month |

## Step 5 (Phase B3b) — verify the pool engine and score card

The static `active_reference_by_objective` grid no longer feeds the display
(it stays wired only into `shadow_scores.calibrated_percentile`, an internal
analytical field — see `percentilePools.js`'s header comment). Niche/overall
percentiles now come from `corpus_reference_pool.json` (3,840-row frozen
small+mid floor-5 seed, see `PHASEB3B_READOUT.md` Task 1) UNION live
`shadow_scores` rows, windowed (objective: 100, overall: 1,000), refreshed on
every shadow write or a 10-minute TTL.

- [ ] Submit a real video (Step 6 of Phase B3b — Josh submits one phone
      video). Confirm the `/api/status` response's `scoreDisplay` field is
      non-null, `showPercentile: true` for a PREDICT-tier objective, and the
      headline reads "Top N% in {objective}" with an integer N.
- [ ] Confirm `scoreDisplay.nichePoolSize` is sane for the chosen objective —
      most PREDICT objectives have 100+ corpus rows, but **Myth Busting has
      only ~24** (a genuine thin-niche finding from Task 1, not a bug) —
      don't be alarmed if that specific niche's pool is small.
- [ ] Confirm an ABSTAIN-tier objective (Gaming, Educational/How-To, Dancing)
      still shows `showPercentile: false` and the honest line, with NO
      percentile of any kind (niche, overall, or personal) — the tier gate
      is binary and suppresses all three, not just niche.
- [ ] Confirm the "How this score works" link opens the modal, and
      `/methodology` loads on the live Vercel frontend with the correct
      numbers (259 creators, ~4,900 videos, 16/19 niches, +0.25 held-out rank
      correlation, ~68% top-tier precision).

## Rollback

- **Full rollback**: set `EXTRACT_CDIMS=false`, `SHADOW_SCORING=false`,
  `DISPLAY_SCORE=false` in Render, then trigger a redeploy (env-var-only
  changes need a manual redeploy, see Step 2's note). No data cleanup
  needed; `shadow_scores` rows are inert and simply stop accruing.
- **Display-only rollback** (keep shadow-scoring running invisibly, just hide
  the card again): set `DISPLAY_SCORE=false` only. This is the lowest-risk
  partial rollback if the score card itself needs more design/copy work but
  the underlying data pipeline is fine.
- A botched row: `DELETE FROM shadow_scores WHERE id = ...` — never touches
  `submissions` or any other user-visible table.
