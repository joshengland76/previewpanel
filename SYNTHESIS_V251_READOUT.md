# Synthesis v2.5.1 — Advice-Vocabulary Guard — Readout

One-line addendum change to `backend/synthesisV25Addendum.txt`, same
`SYNTHESIS_V25` flag, same offline taste-gate discipline as v2.5.

## Task 1 — Addendum change

Added to the HARD RULES section (final wording, after one revision — see
Task 2):

> Never write the words "surprise," "surprising," or "surprised" in the
> gist, in ANY role — not as advice ("be more surprising"), not as a
> descriptive shortfall ("surprise is the weakest link"), not paired with
> novelty ("novelty and surprise"). This holds even though the judges' raw
> dimensions include a literal `surprising` field — that field feeds
> takeaways/scoring, never gist vocabulary. If describing what's missing,
> name novelty, emotional resonance, or intensity instead; if the panel
> raised a specific concrete moment, describe that moment, not a generic
> "more surprise" framing. Novel yes; jarring no.

## Task 2 — Regeneration + a real finding worth documenting

Regenerated pairs #4, #6, #8 (the three v2.5 taste-gate rows that used
"novelty and surprise" as a stock weak-area phrase) and spot-checked #1 and
#2.

**First wording didn't hold.** The initial draft only banned framing
"more surprising" as an actionable *goal* ("never frame 'more surprising'...
as the goal"). Regenerating with that wording fixed #4 and #8 but **left #6
unchanged** ("novel yes; jarring no" ...still followed by "novelty and
surprise scores suggest..."), and — worse — introduced "surprise" into **#2**
where it hadn't appeared before, in direct violation of the rule's own
intent. Retested #2 and #6 three times each against the first wording: both
failed consistently (3/3), confirming this wasn't sampling noise — the model
was reading "surprise" as a passive/descriptive shortfall, which the
"framed as a goal" wording didn't cover.

**Strengthened wording** (quoted in Task 1) bans the words outright,
regardless of grammatical role, and explicitly calls out that the judges'
raw `surprising` dimension field is real input data but not gist
vocabulary. Retested #2 and #6 three times each again: 0/6 mentions of
"surprise"/"surprising" this time.

**Final regenerated gists** (all confirmed "surprise"-free):

| # | Video | v2.5 gist (before this fix) | v2.5.1 gist (after) |
|---|---|---|---|
| 4 | Mid-score cooking (Instagram) | "...though it lacks the novelty and surprise that tend to push food content from solid to shareable." | "...though its novelty and emotional intensity are modest enough to limit how far it travels beyond an already-interested audience." |
| 6 | Mid-score cooking (TikTok) | "...but the panel sees room to sharpen novelty and surprise to push it from watchable to truly shareable." | "...though its novelty and emotional intensity don't quite reach the level that drives saves and shares." |
| 8 | Mid-score aesthetic/vibes (YouTube) | "...though the panel sees room to push novelty and surprise to lift it from pleasant to truly memorable." | "...held back by limited novelty and low emotional intensity that may reduce its save-and-share ceiling." |

**Spot-checks:**

| # | Video | v2.5 gist | v2.5.1 gist | Verdict |
|---|---|---|---|---|
| 1 | Sponsored/promo/link-CTA | "...its promotional, sales-forward caption tone and sponsored-feeling framing are the kinds of signals that tend to significantly dampen organic engagement in our data." | "...its promotional, sales-forward caption tone and sponsored-feeling framing are the kind of signals that tend to dampen engagement in our data." | No regression — same substance, same structure, trivial wording variance. |
| 2 | Paris crookie (canonical) | "...with no major issues holding it back." | "...with novelty and utility as the areas leaving a little performance on the table." | **Real drift, flagged honestly rather than papered over.** Length/structure/voice are unchanged and no hard rule is violated (no "surprise," no scores/models mentioned, one sentence), but the substantive claim changed from "no major issues" to naming specific soft spots. This isn't caused by the new rule targeting this video (it never mentioned surprise) — it's the kind of incidental drift any addendum edit can cause via sampling variance, compounded by this offline test harness's own limitation: fixtures are rebuilt from `submissions` table columns only (no real judge moments/suggestions, which aren't persisted there), so the model has less real judge prose to anchor to than a live run would. Recommend a live re-check on this exact video before treating v2.5.1 as fully settled if this distinction matters. |

## Task 3 — Deploy

Committed (`1f1a75b`) and pushed. Learned from the Synthesis v2.5 rollout's
env-race mistake, so this time: recorded the pre-deploy `/version` baseline
(`sha=d3bc141`, `startedAt=2026-07-15T04:45:44.160Z`) *before* pushing,
polled Render's deploy API until `status=live` for the new commit, then
independently confirmed via `/version` that the running process actually
restarted afterward — `sha=1f1a75b`, `startedAt=2026-07-15T23:07:17.892Z`,
well after the pre-deploy baseline. No env var was touched this time (this
change is a plain source file read at module load, same mechanism as the
v2.4/v2.5 system prompt files), so the earlier race condition (env var set
via API while a different deploy was already mid-build) doesn't apply here
regardless — confirmed the boot time anyway per the prompt's explicit
instruction not to skip that step again.

## Files changed

- `backend/synthesisV25Addendum.txt` — one new HARD RULES bullet (see
  Task 1 for final wording).

## STOP

Per the prompt's explicit instruction — no further work started after this
readout.
