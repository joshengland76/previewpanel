# Production Shadow-Scoring Enablement Checklist

Prepared by Claude Code (Phase B3, Task 4). **CC does not flip these flags —
Josh does**, after reading this. Everything below is invisible to users when
done correctly; nothing in this checklist changes any user-facing response.

## Prerequisites (should already be true before you start)

- [ ] Phase B3's poller instance-scoping fix (Task 1) is deployed to Render
      and confirmed live (check for `INSTANCE_ID=production` in Render's env
      vars — without it, the poller falls back to a `dev-<hostname>` id and
      the scoping logic still works, but it's safer to set it explicitly).
- [ ] `node backend/scoring/goldenVectorTest.mjs` passes (421/421, gate PASS)
      on the exact commit being deployed.
- [ ] `node backend/scoring/durationClampTest.mjs` passes on the same commit.

## Step 1 — set the C_dims key in Render

- [ ] Render dashboard → previewpanel-backend → Environment →
      `CDIMS_ANTHROPIC_API_KEY` = a real Anthropic API key. **Use a separate
      key from `ANTHROPIC_API_KEY` / `SYNTHESIS_ANTHROPIC_API_KEY`** if your
      Anthropic console supports per-key spend caps — this lets you cap C_dims
      spend independently without touching judging or synthesis budgets. If
      only one key is available, reusing `ANTHROPIC_API_KEY`'s value is safe
      (the key-separation pattern is about failure isolation via a distinct
      env var name, not necessarily a distinct underlying credential), but a
      dedicated key is preferable.

## Step 2 — flip the flags

- [ ] `EXTRACT_CDIMS=true`
- [ ] `SHADOW_SCORING=true`
- [ ] Leave `CLAMP_DURATION` unset (defaults `true`) unless you have a
      specific reason to see unclamped shadow predictions.
- [ ] Deploy (Render auto-deploys on push to `main`, or trigger manually).

## Step 3 — verify the first N shadow rows (recommend N=10-20, first day)

Run against the production Neon DB (read-only checks, no writes):

```sql
SELECT id, submission_id, created_at, model_version, prompt_version,
       pegasus_model, extract_cdims_status, prediction, calibrated_percentile,
       tier_at_score_time
FROM shadow_scores
ORDER BY id DESC
LIMIT 20;
```

Confirm:
- [ ] `prediction` and `calibrated_percentile` are populated (not all NULL).
- [ ] `prompt_version` reads `judges-v1.0` (or whatever `JUDGE_PROMPT_VERSION`
      is set to at deploy time — confirms Task 3's stamping reached prod).
- [ ] `extract_cdims_status` is mostly `"ok"` — if it's mostly
      `"failed: ..."`, check the reason string first (frame-sampling failures
      were the actual bug found in B2's smoke test; a recurrence here means
      something about the production file-retention path differs from local).
- [ ] `input_features` (JSONB) has C_dims-derived keys populated (e.g.
      `cl_big_funny`, `hook_strength_visual`) on the `"ok"` rows, confirming
      the extractor actually ran, not just recorded a stub.

## Step 4 — verify cost

- [ ] Anthropic console, filtered to the `CDIMS_ANTHROPIC_API_KEY` key (or the
      shared key if reused) — confirm per-call cost lands near **$0.03/video**
      (per Task 4's target; derived from 4 sampled frames + prompt text in,
      ~$3/M-in + $15/M-out sonnet-4-6 pricing — see `cdims.js`'s cost-logging
      line for the exact formula and per-call server logs for the observed
      figure). A cost sharply above this (e.g. $0.10+/video) likely means
      frame sampling or prompt construction regressed — stop and investigate
      before letting it run at volume.

### Projected monthly cost (C_dims only — TwelveLabs/judge cost is unchanged
### by these flags and already billed regardless)

| Submissions/month | @ $0.03/video |
|---|---|
| 100  | ~$3/month |
| 500  | ~$15/month |
| 2,000 | ~$60/month |

These are C_dims-extraction cost only. `SHADOW_SCORING`'s own compute
(Node scoring function, one Postgres INSERT) is negligible — no added API
cost, and storage growth is a few KB/row.

## Step 5 — confirm user-facing output is unchanged

- [ ] Submit one real test video through the production app (or ask a
      teammate to). Confirm the response looks exactly as it did before this
      deploy — no new fields, no score/percentile shown anywhere. (This is
      guaranteed by construction per `PHASEB2_READOUT.md`'s Task 5 finding:
      `runShadowScoringForJob` never writes to any field `/api/status`
      returns. Doing one live check anyway costs nothing and catches any
      regression in that guarantee introduced by later changes.)
- [ ] `DISPLAY_SCORE` stays `false` in production until B3's user-facing
      review (Task 5's score-display module is dark-launched deliberately —
      do not flip this flag as part of this checklist).

## Rollback

If anything above looks wrong: set `EXTRACT_CDIMS=false` and/or
`SHADOW_SCORING=false` in Render and redeploy (or just toggle without a code
change — both flags are read at request time, no restart-order dependency
beyond a normal Render env-var-change redeploy). No data cleanup is needed;
`shadow_scores` rows are inert and can simply stop accruing. If a botched
row needs removing, it's a plain `DELETE FROM shadow_scores WHERE id = ...`
— never touches `submissions` or any user-visible table.
