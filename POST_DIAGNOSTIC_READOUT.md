# Post-Diagnostic Actions — Readout

Follow-on to `OBJECTIVE_CONDITIONING_DIAGNOSTIC.md`: record the findings
durably, ship the validated-config option + honesty line, quantify scoring
noise, standardize the date basis, refresh the welcome-modal copy, and park
the two larger experiments. App repo + research-repo docs. Exempt paths
untouched; keep-warm untouched.

## T0 — diagnostic committed
`OBJECTIVE_CONDITIONING_DIAGNOSTIC.md` committed as `d920ebe` (app repo)
before this dispatch began.

## T1 — durable record
- **Scoring Model Report §8e** ("Objective conditioning and the
  null-objective configuration"): the two channels (objfit ≈80% + the
  category lens on the base dims), the impute mechanics (null →
  median-imputed raw 8.333, no missing indicator, **0 of 4,897** corpus rows
  objective-blind), the judge-summary zero-coefficients fact
  (avg/trendsetter/connector = 0.0000; only critic 0.0042 + objfit 0.0285),
  the structural-generosity consequence, and the single-draw-variance open
  question.
- **Ops §1e**: prospect-ingest validated-vs-null configuration note + the
  UTC posted-date basis declaration.

## T2 — validated-config option for prospects
- `worker.py --prospect` gains optional **`--objective "<canonical>"`**,
  validated against the 19 canonical objectives (`tiers_v2_2.json`'s
  `per_objective` keys) and rejected outside `--prospect`. It passes through
  `/api/validation/ingest` so the judges get the category lens +
  `objective_fit` — the config matching the app and the corpus.
- `generate_preview.py` reads the config its rows were scored under and
  **prints the stamp** (`validated-config (objective='…')` /
  `null-config (objective-blind judges)`), and **refuses to render a handle
  whose rows mix configs** (one creator, one config — mixed predictions
  aren't comparable). Verified live: the mixed-config diagnostic handle was
  correctly refused; a single-objective handle stamped
  `validated-config (objective='Food & Drinks/Cooking')`; a null handle
  stamped `null-config`.
- `RECRUITMENT_RUNBOOK.md`: niche-pure → ingest **with** `--objective`,
  render `--objective`/`--overall`; multi-niche → null config, render
  `--overall`.

## T3 — honesty line
A null-config render appends one footer sentence:
*"Scores in this preview were produced without a content-category lens; in
the app your scores use the category you select, so numbers can differ."*
Verified live: present in the null-config render's HTML, **absent** from the
validated-config render's HTML.

## T4 — noise quantification (the ~$6 study)

**Design.** 12 videos stratified by objective (Food & Drinks, Life Hacks,
Funny/Comedy, ASMR) × predicted-score band (low/mid/high), **including the
ricotta video**. Each scored **4 fresh same-objective draws** through the
same `/api/validation/ingest` path (validated config). 48 draws total,
handle `_noise_study`, all `pool_eligible=false` (kept + listed below).

> **The 18-run mp4** ("ScreenRecording_05-01-2026 23-32-44_1.mp4") — the
> file that established the documented 0.025 SD — is **no longer on disk**
> (a 2026-05-01 test upload, not retained), so it could not be re-scored
> fresh. Its **40 historical DB predictions** are used as the benchmark
> instead (SD 0.0315, range −0.054…+0.083 — consistent with 0.025).

**Per-video ŷ across 4 draws:**

| video | objective | band | mean ŷ | **SD** | min | max | range |
|---|---|---|---:|---:|---:|---:|---:|
| 4641 | Life Hacks | low | −0.4560 | **0.0107** | −0.4685 | −0.4449 | 0.0236 |
| 4685 | Life Hacks | high | −0.0168 | **0.0112** | −0.0250 | 0.0022 | 0.0273 |
| 1075 | Food & Drinks | low | −0.0880 | **0.0168** | −0.1084 | −0.0707 | 0.0377 |
| 4823 | ASMR | mid | −0.0827 | **0.0211** | −0.1047 | −0.0495 | 0.0552 |
| 970 | Food & Drinks | mid | −0.0552 | **0.0234** | −0.0917 | −0.0296 | 0.0621 |
| 469 | Life Hacks | mid | 0.0279 | **0.0267** | −0.0045 | 0.0572 | 0.0617 |
| 1161 | Funny/Comedy | high | 0.0777 | **0.0284** | 0.0311 | 0.1039 | 0.0728 |
| 3645 | Funny/Comedy | low | −0.1182 | **0.0295** | −0.1532 | −0.0826 | 0.0707 |
| ricotta | Food & Drinks | — | 0.1257 | **0.0301** | 0.0818 | 0.1648 | 0.0830 |
| 1034 | Food & Drinks | high | −0.0260 | **0.0340** | −0.0596 | 0.0214 | 0.0810 |
| 2876 | ASMR | low | −0.2744 | **0.0367** | −0.3192 | −0.2208 | 0.0984 |
| 244 | Funny/Comedy | mid | 0.0937 | **0.0490** | 0.0255 | 0.1631 | 0.1376 |

**Per-video SD distribution (n=12): median 0.0275, mean 0.0265, range
0.0107–0.0490. 0 of 12 exceeded 2× the documented figure (0.05).**

**Batch effect (per-draw mean residual, each video centered on its own
4-draw mean):** draw 1 **+0.0207**, draw 2 −0.0064, draw 3 −0.0112,
draw 4 −0.0030.

**Plain-language answer — is 0.025 typical, or heavy-tailed?**
**0.025 is typical, not an underestimate.** Across 48 fresh draws the
per-video SD clusters tightly around the documented figure (median 0.0275),
the 18-run mp4's own 40 historical runs agree (0.0315), and **no video
showed a heavy tail** — the widest was 0.049 (video 244), still under 2×.
There is mild, real video-dependence (SD spans ~4.5×, 0.011→0.049) but no
outlier videos. A single prospect score is therefore typically stable to
**~±0.05 ŷ (≈ ±10–15 percentile points at mid-distribution)**.

This **refines** the diagnostic's alarming "Δŷ 0.220" observation: that
swing paired one *anomalous* historical draw (the Food run at ŷ −0.087)
against a fresh one — but ricotta's four fresh Food draws sit stably at
0.082–0.165 (SD 0.030), confirming the −0.087 was a **rare outlier draw,
not the typical case**. Typical run-to-run noise is ~0.025–0.03; rare large
excursions exist but were not reproduced in 48 draws.

A small batch signal is present (draw 1 ran +0.021 more generous across all
12 videos than draws 2–4) — an order of magnitude smaller than the
diagnostic's historical-vs-fresh batch gap.

**Honest limitation.** The spec called for draws "spread across ≥2 sessions
at different times of day." In practice all 48 draws ran in a **continuous
~1-hour block** (draw starts 07:28 → 08:12 UTC, ~15 min apart). So the
batch-effect test has **limited power to detect time-of-day / cross-session
harshness** — the draw-1 +0.021 shift is the only within-block session
signal, and the diagnostic's much larger (~day-apart) batch effect is
neither confirmed nor refuted here. A genuine multi-hour / multi-day repeat
is the follow-up if the batch effect matters for the invite decision.

## T5 — date basis standardized on UTC
**Mechanism confirmed:** a TikTok video's `posted_at` derives from its real
UTC upload instant — the video ID itself encodes it (`id >> 32` = Unix
seconds; for the ricotta video that's 2026-07-01 03:56:01 UTC, matching
yt-dlp's `timestamp` 03:56:25 UTC within seconds). TikTok's app shows that
instant in the **viewer's** device zone, so a late-evening US post reads one
calendar day earlier in-app than its UTC date. **This is timezone framing,
not a data bug** (the instant is correct).

**Decision (per this dispatch's recommendation): one declared basis — the
UTC-derived calendar date, as-is, no per-viewer guessing.** Standardized
across the PDF (`generate_preview.py fmt_date` normalizes to UTC), the
in-app Track Record tab (`trFormatDate` now `timeZone: "UTC"`), and the
docs (Ops §1e declaration). **This reverts the earlier US/Eastern
best-effort conversion** — Eastern is itself a per-region guess (wrong for
non-Eastern and international creators); the single declared UTC basis is
consistent and honest. `worker.py` still captures the precise UTC
`timestamp` (more reliable than the flat-playlist date-only field), now kept
in UTC.

*Tradeoff, stated plainly:* a US creator viewing their own Track Record will
see the UTC date, which can be one day ahead of what TikTok shows them
locally. This was accepted in favor of a single, declared, consistent basis.

## T6 — welcome modal copy v2
Replaced the modal text. Title **"We've been keeping score."**; body proves
the value proposition ("we scored N of your recent TikToks from the content
alone — never seeing a single view count — then checked our predictions…");
**two equal-weight choice cards** (identical styling, neither subordinate)
with sublines — *See your track record / How our calls on your videos turned
out.* and *Score your next video / Get its predicted percentile, what's
working, and what to fix — before you post.*; footer micro-line *Your track
record lives under History whenever you want it.* Verified live on a fresh
proxy: equal visual weight confirmed, **both paths work** (See → History on
the TR segment; Score → dismiss to form), and **one-time persistence** is
intact (each choice sets `users.track_record_welcomed=true` server-side;
the reactive re-check re-shows it only if the flag is reset).

## T7 — parked (Ops §4, no execution)
- **Objective-less judge counterfactual** — re-judge a stratified ~600-video
  subsample objective-blind, refit under the same CV folds, compare. **Est.
  ~$35–45.** Gated behind this noise study.
- **Per-video judge seeding from the existing C_dims 19-way classification**
  — seed each video's judge prompt from its inferred (not creator-declared)
  objective; scope as a ~200-video three-arm subsample first. **Est.
  ~$10–15.** Distinct from the settled creator-level partition decision.

## T8 — verification summary
- **Config stamp lands** (validated-config ingest WITH objective):
  `shadow_scores.objective='Food & Drinks/Cooking'`; render stamped
  `validated-config`. ✓
- **Null-config render shows the honesty line** (present in HTML, absent
  from the validated render). ✓
- **Modal copy v2 live on a fresh proxy**, both paths + persistence. ✓
- **Refuse-mixing** on a mixed-config handle. ✓

## Experiment artifacts

**Kept (noise study — `pool_eligible=false`, listed):** handle
`_noise_study`, `posted_videos` id 143–190 (48), `shadow_scores` id 765–812
(48). All out of every pool; retained as the noise-study record.

**Cleaned up (hardened explicit-id convention):** T8 verify handles
`_t8_validated` / `_t8_null` (2 videos + shadow rows) deleted; the
jamieegabrielle modal proxy fully torn down — 20 `posted_videos` un-claimed
back to `user_id=NULL` baseline, 4 proxy `users` + 4 `redemptions` deleted,
invite codes `3GTW9FB5` and `757JRM79` deleted. Final state verified: 0
jamieegabrielle users, 0/20 claimed, 0 t8 rows, 0 noise rows pool-eligible.
Scratch scripts + downloaded videos deleted. (The three
`_diagnostic_objcond` rows from the prior diagnostic remain as that
readout documented them — `pool_eligible=false`, inert.)

## Git / deploy state
- **App repo (`PreviewPanel`):** `f7a77ed` (worker.py --objective,
  generate_preview config stamp + honesty line + UTC, RECRUITMENT_RUNBOOK,
  frontend modal v2 + UTC dates) + this readout. Frontend deployed via
  Vercel (modal v2 + UTC dates confirmed live); Render redeploy was a no-op
  (no `server.js` change).
- **Research repo (`correlation-research`):** `af07cf0` (Scoring Model
  Report §8e; Ops §1e config + date basis; Ops §4 parked items).

## STOP
Per this dispatch's final instruction.
