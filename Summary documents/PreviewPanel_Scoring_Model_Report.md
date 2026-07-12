# PreviewPanel Scoring Model — Study, Evidence & Specification

**Date:** 2026-07-10 · **Status:** Model v2 is shipped and live in the PreviewPanel
app; real-user validation infrastructure is deployed and accruing data.
**This document is self-contained** — it is the complete record of the correlation
study and the scoring model, written to be understood and replicated a year from
now without reference to any prior version. The one companion document is
`PreviewPanel_Operations_and_Roadmap.md` (how the system runs operationally); this one is the science. (Supersedes the Scoring Study Writeup v1/v2 lineage, both retained unmodified for history.)

**Scheduled touch-ups:** (1) ~~cohort_5 tier re-estimation for Dancing / Gaming /
Educational once ~24 new creators' data matures~~ **DONE 2026-07-12** — see §7's
v2.2 update; (2) first real-user validation numbers from the Phase-C dashboard;
(3) the ~Sept 2026 back-catalog 60-day drift retest.

---

## 1. What PreviewPanel is, and what the score claims

PreviewPanel is an AI "synthetic audience" web app: a creator uploads a short-form
video before posting it, and three judge personas (The Editor, The Trendsetter,
The Connector — powered by TwelveLabs Pegasus video understanding) return scored,
timestamped feedback. The original judge scores cluster in a narrow "good content"
band and do not by themselves predict performance — that observation motivated
this study.

**The score this study produced is a within-creator ranking aid**: it predicts how
a video is likely to perform *relative to that creator's own typical video*, from
content alone, before posting. It is explicitly **not** a virality forecaster and
not a cross-creator quality judgment. Every design decision below follows from
that framing.

## 2. The prediction problem

Predict, at upload time, the within-creator ranking of a video's day-30
engagement rate — using only information available before posting (the video
file, its content as read by AI systems, and pre-post metadata).

**Ground truth (fixed for every experiment in this program):** the within-creator
ranking of observed `WEC_rate = (likes + 3·shares + 5·saves) / views`, measured
at day-30 video age. Comments are excluded from the rate target. Rate (not raw
count) is used because it normalizes reach; within-creator (not global) because
follower count dominates raw performance and the product question is "which of
*your* videos is strongest."

**Training target:** `y = ln( winsor₁,₉₉( WEC_rate / creator LOO-median WEC_rate ) )`
— each video expressed as log-lift over its own creator's leave-one-out median,
winsorized at the 1st/99th percentile of the ratio. LOO medians are always
computed within training folds only.

## 3. The dataset

### 3a. Creators and cohorts

Creators were recruited per objective (niche) through a structured discovery
process (Claude Cowork browsing TikTok with per-objective prompts), then vetted:
≥70% content purity for their declared objective, multi-hit engagement variance
(single-fluke profiles rejected), no repost/clip-farm or AI-farm accounts, no
funnel-dominant feeds, adults only. Tier bands: **small 1K–50K, mid 50K–500K,
large >500K followers** (the standing convention for all cohorts going forward;
an alternate 150K/750K band briefly used at cohort-3/4 enrollment was reconciled
— no creator sits in the disputed range, so the corpus is consistent with
50K/500K).

| Cohort | Small+mid videos | Collection mode |
|---|---|---|
| cohort_1 | 650 | Active daily monitoring (new posts captured at post time; day-30 scheduled) |
| cohort_2 | 2,222 | Active daily monitoring, then capped |
| cohort_3 | 684 | **Enrolled** back-catalog (see below) |
| cohort_4 | 462 | **Enrolled** back-catalog |
| cohort_5 | 400 | **Enrolled** back-catalog, Dancing/Gaming/Educational only (2026-07-12; 23 creators, `backcatalog_day30_equiv_2026_07` label) |
| Path-4 backfill | +114 (within c1/c2) | One-time back-catalog depth on existing creators |

**The `enrolled` collection mode (cohorts 3+):** creators are inserted with
`status='enrolled'` — outside the daily monitoring sweep entirely. Their videos
are collected **once, from the 30–90-day-old back-catalog window**, capped at
**20 videos per creator**, and their engagement counters are captured immediately
as day-30 *equivalents* (interval label `backcatalog_day30_equiv_*`). The license
for this: a dedicated age-stability study (phase5c, 2026-07-03) recaptured
~3,650 videos and found engagement **rate** essentially stable from day-30 to
~day-90 (drift R² ≈ 0.004). Caveat carried honestly: back-catalog collection
skews toward survivors (creators delete flops), and a 60-day repeat of the
stability check is scheduled for ~Sept 2026. A deliberate **non-backfill policy**
applies to cohort_1/2 (their pre-enrollment back-catalog is not retro-collected;
Path-4 was the one scoped exception).

### 3b. Final corpus (capstone snapshot, 2026-07-07)

| Scope | Videos | Creators |
|---|---|---|
| All tiers, day-30-scored TikTok | 5,109 collected / 4,897 scored | 259 |
| Small+mid after ≥2-judge filter | 3,857 | 207 |
| **Small+mid, floor-5 rankable (modeling population)** | **3,840** | **199** |
| Large tier (never trained on) | 1,067 | 51 |

Floor-5 = a creator needs ≥5 scored videos to be rankable. Sensitivity at floors
10/15 was tested (§6d) — floor-5 stands.

**cohort_5 is NOT part of this frozen snapshot.** The 400 cohort_5 videos
(3a) postdate the 2026-07-07 capstone snapshot and were never used to refit
or retrain the model — they were scored out-of-sample with the frozen shipped
artifact (`capstone_model_artifact_v2.pkl`) purely for the Dancing/Gaming/
Educational tier re-estimation in §7. The model itself, and the 3,840/199
population above, are unchanged by cohort_5.

### 3c. Feature sources (what the model sees)

Two independent AI readings of every video, plus controls, plus one mechanical
column:

- **TwelveLabs Pegasus judges (J_summary + J_dims):** the three judges' overall
  scores and consensus/dispersion statistics across their per-dimension
  `big_*` scores (compelling, emotionally_resonant, funny, novel, relatable,
  surprising, useful, visually_engaging, emotion_intensity, authentic, polished),
  plus objective-fit consensus. The judge prompt's scored-field instructions
  (roster, definitions, scales, JSON schema, weighting text) are formally part
  of the **model input contract** — frozen with the artifact, changeable only
  through the dual-run gate (§8c).
- **Claude dimensional extractor (C_dims):** an independent Anthropic API read
  (locked v1 prompt; 4 frames sampled at 10/35/60/85% of duration; ~$0.028/video)
  producing big-picture dimensions plus categoricals: caption_tone, hook_style,
  cta_type, emotion_primary/targeted/combination, specificity,
  text_overlay_density/role, plus hook strengths, trending signals, CTA/cover
  booleans.
- **Controls (Ctrl):** is_sponsored, has_brand_mention, risk_any (+ missing
  indicator) — covariates, never rewarded.
- **duration_secs** — the single mechanical column in the model (§6b).

**Tested and permanently cut** (each closed at full statistical power; do not
reopen without genuinely new evidence): audio DSP/music/recovered blocks (except
duration; §6b's decomposition), all other mechanical-video columns, the
hook/transcript/OCR "v2.1" field set (null at stratum, full-corpus, and
per-objective under the clean partition), pairwise judge features E5/E6, and
rank-/weight-variant training targets (§6d).

### 3d. The partition decision (settled)

Every video is grouped under its **creator's declared objective**
(`research_creators.objective`) — not an independent per-video content
classification. Measured disagreement between the two: **71.8% match / 28.2%
slippage**, wildly uneven by niche (Myth Busting creators' content matched the
per-video read ~10% of the time). Creator-level is what the product actually
does (users declare an objective at signup), gives 100% fold validity in every
objective, and rescued objectives the per-video partition had destroyed
(Myth Busting: undefined → +0.42 PREDICT). All prior per-video-partition results
were treated as void and re-run fresh.

## 4. Method discipline (how every claim was earned)

- **Cross-validation:** GroupKFold(k=5) × 3 repeats by creator — every creator
  fully held out; folds persisted to a map and reused identically by every
  experimental arm, so all comparisons are **paired per-creator deltas on
  identical folds** with **creator-level bootstrap 95% CIs**.
- **Pre-registration:** a prereg document written before Stage 1, amended only
  in dated, logged entries *before* each affected analysis ran (35 amendments
  through the platform-framing gate). The winner rule was pre-declared:
  an arm qualifies only with a **positive** paired delta, CI excluding zero,
  and sign-consistent repeats; ties break to the most parsimonious design.
- **The lockbox:** 30 creators (15.1% of rankable small+mid), split off before
  any model was fit, untouched by every fit/selection/readout, evaluated
  **exactly once** at the end against a reading guide committed to the prereg
  *before* the result was seen. Winsor bounds were frozen at a dev-only value
  throughout selection specifically so the lockbox could not leak into its own
  target definition.
- **Leakage audit:** no post-publication metric ever enters the feature matrix
  (enforced by an assert-exclusion list in the pull script); no creator-identity
  feature; standardization/encoding fit on training folds only; LOO baselines
  in-fold.
- **Honest baselines:** results were never compared to the prior model's stale
  headline (different corpus, different partition); the baseline is always the
  locked design refit fresh on the same data and folds.

## 5. The capstone rebuild — what was tested

### 5a. Architecture bakeoff (six architectures, locked features, same folds)

The incumbent **global additive ElasticNet** was re-tested against: objective
partial pooling (mixed model), LightGBM regression (objective categorical,
nested tuning), LightGBM lambdarank (groups = creator), a two-stage global +
per-objective shrunken slope correction, and a within-creator feature-centered
ElasticNet. **None beat the baseline.** Lambdarank was confirmed significantly
*worse* (Δ −0.0306, CI excludes zero). Partial pooling hit a random-slope
convergence boundary in 15/15 folds — the model itself reporting no objective
heterogeneity to exploit; the slope-correction arm tuned itself to maximum
shrinkage in 15/15 folds, confirming the same from the frequentist side.
**Conclusion: the performance signal in this data is global and additive.**
(A methodological note that matters for anyone extending this: under the
creator-level partition, objective is constant within a creator, so any
per-objective *intercept* provably cannot move within-creator Spearman —
only slope-level effects can.)

### 5b. Feature ladder → the duration finding

Re-testing previously-cut blocks under the clean partition, two qualified
(`M_mech` Δ +0.0242; `A_recovered` Δ +0.0255, both CI-excluding, sign-consistent)
— with suspiciously similar magnitudes and a shared near-duplicate column. A
pre-registered forensic decomposition resolved it:

- **duration_secs alone (1 column) matched or beat both full blocks** (F2
  0.2728 vs F1-joint 0.2714; statistically indistinguishable).
- **Everything else in both blocks, with duration removed, showed no reliable
  lift** (F3 CI includes zero).
- The lift **survived exclusion of all provenance-mixed back-catalog rows** (F4
  still qualifies) and a within-creator provenance-correlation screen found no
  confound (max |r| 0.154, all below the 0.3 flag line).
- Coefficient attribution confirmed classic collinearity: duration and
  audio-duration split credit when together; duration (100% coverage) wins.

**Why round 1 missed it:** duration was never tested alone — only diluted inside
a 9-column block whose group ablation had standard errors wide enough to hide a
real +0.02 effect. A genuine null and a diluted single-column signal are
indistinguishable in a group test at that power. **Standing lesson: decompose any
qualifying (or near-qualifying) block to single columns before verdicting it.**

A pre-registered **negative control** (the Pegasus-version flag, provably inert
for a within-creator metric because version is ~constant within creator) came
back Δ ≈ 0.0000 — the harness does not manufacture lift.

### 5c. Is duration real? The evidence chain

- Univariate, duration alone: **+0.205** pooled within-creator Spearman — ~83%
  of the full 111-column model's own pooled signal, from one trivially computed
  column.
- **Denominator test:** positive against the rate target (+0.205), the raw
  engagement count (+0.162), and raw views (+0.100) — a pure loop-inflation /
  denominator artifact would show ≈0 on count and views.
- **Age-controlled reread** (true-day-30-only subset, removing back-catalog age
  heterogeneity): duration-vs-count **+0.173 [CI +0.112, +0.234]** — the
  accrual/completion story survives age control; a direct confound check found
  no material within-creator age relationships.
- **Shape:** mean target rises monotonically across within-creator duration
  quintiles (0.94 at ~15s median → 1.24 at ~82s+); a natural-cubic-spline arm
  added nothing over the linear term, consistent with the monotone shape.
- **Interpretation guard (binding for all product copy):** this is a
  within-creator **correlate over roughly 15–82 seconds in this corpus**, not a
  causal instruction. The model *will* score a longer cut of the same content
  higher, all else equal — the product must present that carefully and never as
  "make videos longer" advice. At inference, duration is **clamped to the
  training support [p1 = 5s, p99 = 273.2s]** as an input-conditioning policy
  (the scoring formula itself is unclamped to preserve artifact parity; the
  clamp lives in feature assembly).

### 5d. Training-signal and population sensitivity (all null)

Rank-transformed training targets, alternate engagement weight grids ({1,1,1},
{1,5,10}), expanded training with 2–4-video creators, and the duration spline —
none beat the simple design. Floor lenses on identical predictions: pooled
WC-Spearman **0.2728 / 0.2709 / 0.2513** at floors 5/10/15 (fewer creators and
more-homogeneous catalogs at higher floors; no hidden stronger model behind a
stricter inclusion rule). Floor-matched *retrains* showed duration's edge over
baseline **widening** at 10+ (+0.0328) and holding at 15+ (+0.0221), both CIs
excluding zero.

## 6. Results — three honest numbers with three different jobs

| Number | Value (WC-Spearman / precision@decile) | Job |
|---|---|---|
| Dev-CV (selection) | 0.2728 / 0.6694 | Chose the winning design; optimistic by construction |
| **Lockbox (generalization)** | **0.2508 / 0.5968** | The honest held-out claim — one evaluation, pre-committed reading guide, **PASS** |
| Full-corpus CV (estimation) | 0.2753 / 0.6844 | Built the tier table on the largest population |
| Large-tier transfer (pooled) | 0.2137 / 0.6923 | Directional context only; never trained on |

The lockbox sat 0.022 below dev-CV — the **measured selection optimism** of the
entire multi-stage search, which is exactly what the lockbox exists to price.
The final-corpus duration lift over the identical no-duration baseline:
**+0.0216** (baseline 0.2538 → 0.2753). Winner-only robustness lenses all held
(true-day-30-only evaluation +0.0287, CI excluding zero). Public-facing
generalization claim: **≈ +0.25 held-out within-creator rank correlation; top-
decile picks beat the creator's typical engagement about 2 in 3 times.**

## 7. Per-objective calibration — tier policy v2.1

Tiers gate the product's *confidence language*, not the score itself (one global
formula scores every video). Policy v2.1 (a deliberate product-calibration
choice, logged as such): **PREDICT** = rankable n ≥ 5 AND one-sided bootstrap
P(WC > 0) ≥ 0.95 AND precision@decile ≥ 0.55; **PROVISIONAL** = positive point
estimate, precision > 0.50, but short of a PREDICT bar; **ABSTAIN** = precision
≤ 0.50, or P(WC>0) < 0.80, or non-positive estimate; **THIN** = n < 5. (The
originally shipped v2 table had a code bug — its own precision≤0.50 clause was
never checked, mislabeling Gaming and Educational; fixed and logged separately
from the policy change.)

**Updated 2026-07-12 (`tiers_v2_2.json`) — cohort_5 re-estimation.** Dancing,
Gaming, and Educational/How-To were re-estimated after enrolling 23 cohort_5
creators (see `COHORT5_READOUT.md`); the other 16 PREDICT objectives below are
unchanged from v2.1. Predictions pool two out-of-sample sources per objective:
existing creators' cached ENDGAME full-corpus CV out-of-fold predictions
(unchanged), and cohort_5's own creators scored with the frozen shipped
artifact (`capstone_model_artifact_v2.pkl`, never refit — out-of-sample by
construction since it was never fit on any cohort_5 row).

**Result: 16 PREDICT / 1 PROVISIONAL / 2 ABSTAIN / 0 THIN.**

| Objective | n | WC-Spearman ± SEM | Prec@decile | P(WC>0) | Tier |
|---|---|---|---|---|---|
| Travel | 10 | +0.446 ± 0.060 | 0.819 | 1.000 | PREDICT |
| Myth Busting | 7 | +0.421 ± 0.097 | 0.789 | 1.000 | PREDICT |
| Makeup/Beauty | 15 | +0.384 ± 0.076 | 0.863 | 1.000 | PREDICT |
| Business/Finance | 13 | +0.369 ± 0.064 | 0.662 | 1.000 | PREDICT |
| Storytelling | 12 | +0.368 ± 0.058 | 0.698 | 1.000 | PREDICT |
| Fashion | 7 | +0.366 ± 0.087 | 0.745 | 1.000 | PREDICT |
| Aesthetic/Vibes | 12 | +0.333 ± 0.109 | 0.766 | 1.000 | PREDICT |
| Food & Drinks/Cooking | 9 | +0.307 ± 0.126 | 0.659 | 0.992 | PREDICT |
| Funny Videos/Comedy | 13 | +0.295 ± 0.092 | 0.656 | 1.000 | PREDICT |
| Fitness/Wellness | 15 | +0.256 ± 0.054 | 0.729 | 1.000 | PREDICT |
| **Gaming** | **18** | **+0.183 ± SEM n/a** | **0.507** | **0.991** | **PROVISIONAL** (was ABSTAIN) |
| ASMR | 11 | +0.223 ± 0.098 | 0.648 | 0.990 | PREDICT |
| Life Hacks | 11 | +0.223 ± 0.072 | 0.621 | 0.999 | PREDICT |
| Fun Facts | 8 | +0.219 ± 0.101 | 0.564 | 0.988 | PREDICT |
| Shopping | 7 | +0.195 ± 0.092 | 0.744 | 1.000 | PREDICT |
| **Educational/How-To** | **20** | **+0.188 ± SEM n/a** | **0.464** | **1.000** | **ABSTAIN** (unchanged label; now shows percentiles — see below) |
| Pets/Animals | 7 | +0.151 ± 0.083 | 0.654 | 0.983 | PREDICT |
| Cars/Automotive | 13 | +0.138 ± 0.069 | 0.657 | 0.986 | PREDICT |
| **Dancing** | **14** | **+0.020 ± SEM n/a** | **0.609** | **0.613** | **ABSTAIN** (confirmed model limitation, see below) |

**Claims-to-statistics mapping (why the table above no longer fully determines
what the product shows):** a percentile makes a *ranking* claim ("beats N% of
similar videos"), backed by P(WC>0) — the confidence that within-creator rank
correlation is genuinely positive. A high percentile *reading* as "pick this
one" is a separate *precision* claim, backed by precision@decile — whether the
top-decile-predicted videos actually over-perform. Historically these were
conflated: the PREDICT label required both, so an objective failing precision
alone was fully suppressed even when its ranking claim was solid. As of the
cohort_5 pass, the product's display gate reads these two statistics directly
(`showPercentile = P(WC>0) ≥ 0.95`, independent of the tier label) rather than
the tier string — see `PreviewPanel_Operations_and_Roadmap.md` §1d. Gaming and
Educational/How-To both clear the ranking bar (P(WC>0) ≈ 0.99–1.00) without
clearing precision (0.51, 0.46) — they now show real percentiles paired with a
caveat line, rather than staying suppressed pending a hypothetical third
display state. **Dancing is the one confirmed model limitation from this
pass**: even at n=14 (up from 5), P(WC>0)=0.613 is far below the 0.95 ranking
bar — the model does not yet demonstrate a reliable within-creator ranking
signal for this niche, and its percentile stays suppressed with the existing
honest-line copy. This is a real, stated limitation, not a data-volume
artifact to paper over — more cohort_5-style enrollment could resolve it, or
could confirm Dancing genuinely needs different features/signal than the
current locked feature set captures.

## 8. Measurement stability — versions, drift, and prompt governance

The model's inputs come from external AI systems that change under stable
labels. This section is the durable record of how that is handled.

### 8a. Pegasus 1.2 → 1.5 (the version blend)

Cohorts 1/2 were scored ~95%+ on Pegasus 1.2; cohorts 3/4 are 100% Pegasus 1.5.
Measured on dual-scored videos: 1.5 scores every judge field systematically
lower, propagating to a **constant −0.033 ŷ offset (~3.2%)**. A constant shift
cannot reorder videos within a creator, so **ranking is immune** — confirmed by
a version-standardized-features arm (null) and by the all-1.5 cohorts ranking
fine inside pooled CV. The exposure is *presentation*: an all-1.5 input stream
compared against a mostly-1.2 reference would read systematically low. Fix
(implemented): **version-consistent presentation references** — empirical
1.5-only reference distributions for the 11 objectives with sufficient native
1.5 data (a per-objective check showed the constant-shift construction is NOT a
clean substitute — 11 of 12 testable objectives disagreed materially), the
constant-shift construction as a marked interim for the other 8. The whole
question dissolves as live (all-1.5) submissions displace the corpus from the
comparison pools.

### 8b. Temporal drift behind stable version labels

Evidence accumulated that Pegasus's behavior moves over months even within one
version label. The clean measurement (same-quantity, per era): rerunning the
*unchanged* judge prompt months later reproduces stored raw judge scores only
moderately (Spearman 0.811 [0.49, 0.94] for the 1.5 era; 0.634 [0.20, 0.86] for
the older 1.2 era) — **but the full model prediction is heavily damped against
that drift: ŷ-vs-ŷ 0.953–0.960 in both eras**, because no single drifting field
carries much of the 56-weight design. Flagged-anomaly reruns (fresh read ≤2
where stored production said ≥8) ran at 3.6% of judge calls; 22/26 *confirmed*
on rerun — reproducible judge harshness on borderline content, not transience.
**Standing instrument:** a 30-video **anchor set** is rescored through the full
live path monthly (~$2/run, `anchor_history.jsonl`); alert thresholds
|median Δŷ| > 0.02 or rank correlation < 0.95. Every scored row carries
`prompt_version` and `pegasus_model`, and an internal frozen-reference
percentile field, so any future drift is auditable per-row.

**Same-session repeat-run variability** (distinct from the drift above, which
is measured months apart — this is immediate, same-day run-to-run noise on an
*unchanged* video): 18 identical production runs of one test video measured
**ŷ SD ≈ 0.025**, translating to roughly **±10 niche-percentile points** at
mid-distribution (a video sitting near the 50th percentile can plausibly land
anywhere from the low-40s to low-60s on a repeat run with zero real change).
Decomposed by weighted contribution to ŷ across those runs: the variance is
concentrated in the CDIMS (Claude-vision) extraction features and the
judge-consensus/disagreement aggregates (`jc_`/`jd_` mean/std-dev across the
3 judges), not any single judge's headline score — consistent with this
section's broader finding that individual input channels are noisier than the
full model's damped output. This is the same extractor-reliability pattern as
8a/8b above, now quantified at the single-video level rather than across
versions or months. Full methodology, data, and a second confirming video are
in `PRELAUNCH_FIX_READOUT.md`'s "Repeat-scoring variability analysis" section.
Operational response: `POOL_CONSISTENCY_READOUT.md`'s fingerprint-group
averaging (repeat runs of the same video are detected and averaged before
display) directly targets this noise source, rather than leaving users to see
a different number each time they re-test the same cut.

### 8c. Judge-prompt governance (the input contract)

**Durable rule:** the judge prompt's scored-field instructions are part of the
model's input contract — changing them requires a **dual-run gate**: fresh-vs-
fresh scoring of the same videos in the same session (never fresh-vs-stored,
which confounds prompt effects with drift), against a same-prompt test-retest
**noise floor**. The measured noise floor: **Spearman(N1,N2) = 0.985** — same-day
judge scoring is highly reproducible; the judge channel is signal, not noise.
Current production prompt **judges-v2.1** passed this gate (ŷ shift +0.0036
[−0.0024, +0.0096], Spearman vs v1 0.979 across 150 videos) and changed *prose
only*: removed the three "optimal length: N seconds" lines (a causal-duration
policy violation), steered advice toward the model-weighted dimensions with
correlational framing, kept all scored fields byte-identical. The cautionary
precedent: an earlier v2.0 draft that *dropped* two zero-weight scored fields
shifted scores broadly and was abandoned — **field drops destabilize scoring
out of proportion to their token savings; the scored roster stays at v1's
permanently.**

### 8d. Platforms (Reels / Shorts)

The app lets users declare TikTok, Reels (internal code `instagram`), or Shorts
(`youtube`); the selector conditions the judge prompt's framing and
platform-specific dimension text. A pre-registered **framing gate** (30 videos ×
3 arms, same session) showed platform framing does not meaningfully move model
inputs: Reels Δ −0.002 (Spearman 0.984), Shorts Δ +0.004 (0.981) vs TikTok
framing. **Decision: one model serves all platforms; percentile pools stay
unified; a single honest copy line marks the score as TikTok-validated and a
strong proxy elsewhere. Platform-specific models are an explicit post-validation
question** — they would require platform-specific outcome data that does not
yet exist.

## 9. Real-user validation (designed, deployed, accruing)

The corpus is vetted study creators; PreviewPanel's real users are not — this
was the study's top limitation and is now a measurement in progress rather than
an open question. The deployed design:

- **Identity-lite:** persistent client UUID + connected TikTok handle
  (Instagram/YouTube handles collected for future platform work; TikTok is the
  validated/scanned platform).
- **Preview fingerprinting at submission:** perceptual frame hashes (pHash,
  1 fps, 10% border crop), chromaprint audio fingerprint, duration — computed
  before the converted file is deleted.
- **Posted-video discovery and direct rescoring:** a worker scans connected
  handles' public posts, downloads, fingerprints, and runs each posted video
  through the *full live scoring path* (~$0.10/video). **Every scored posted
  video from a connected user validates the model** — match status is
  irrelevant to validity, because the research corpus itself was downloaded
  posted videos; this is the model evaluated in exactly its validated setting.
- **Match tiers (for attribution questions, not validity):** Tier 1 same cut
  (frame overlap > 0.90); Tier 2 modified-same-footage (overlap 0.15–0.90, or
  audio match with duration agreement ≤2s); Tier 3 different. **Audio agreement
  never solo-qualifies** (trending-sound reuse would false-match). Thresholds
  stress-tested at scale: 5,995 cross-pairs of distinct videos → 100% Tier 3,
  max false overlap 0.028 (5× margin under the 0.15 floor); 20/20 synthetic
  transforms landed their expected tier.
- **Day-30 outcome collection:** counters captured in a 30–37-day window
  (retry cap 3; deletion recorded as an outcome), `WEC_rate` computed
  identically to the study.
- **The validation metric:** per-user Spearman(posted-video ŷ, observed
  WEC_rate) for users with ≥5 collected posted videos; pooled unweighted across
  users with a bootstrap CI — the study's own metric, on real users.
- **Selection-bias instrumentation:** users will preferentially post their
  high-scoring previews, which range-restricts posted sets and *attenuates*
  measured correlation; shadow-scoring every preview lets this be quantified
  (posted-vs-unposted preview ŷ) instead of confounding the result. Expect the
  real-user number to read *below* +0.25 partly for this mechanical reason.

## 10. Standing riders and closed questions (do not re-litigate without new evidence)

- **TwelveLabs removal:** three independent tests, all inconclusive with the
  same small-negative direction (−0.0133 / −0.0175 / −0.0183, every CI
  straddling zero) → **TL stays in the model**; and since Pegasus runs on every
  submission for the judge-feedback product anyway, model inputs are free.
- **$345 historical Pegasus-1.5 rescore:** closed, not justified (version mix
  twice shown a non-issue).
- **fun_facts hook-field escalation:** 1 marginal positive in 19 uncorrected
  per-objective tests at n=4 — the expected false-positive base rate; no
  backfill spend; recheck only if coverage grows organically.
- **v3 sharpened C_dims extractor:** parked. Weight mass concentrates in a few
  Claude fields (emotion_combination — also the noisiest big-weight feature,
  test-retest ≈0.80 in the extractor-reliability study), so a sharpened prompt
  is the one identified lab avenue if a future correlation push is ever wanted;
  post-validation question.
- The "+0.9 ceiling" suggested by extractor noise analysis is illusory (it
  assumes noise-free features would preserve current effect sizes); K-averaging
  extractor reads does not help. Remaining headroom is new information channels
  or sharper prompts, not de-noising.

## Appendix A — Model specification (replication)

**The executable ground truth is `scoring_spec_v2.json`** (exported from
`capstone_model_artifact_v2.pkl`): feature order, standardization means/SDs,
one-hot category lists incl. infrequent/missing handling, coefficients,
intercept, winsor bounds, duration clamp bounds, and version-calibration
metadata. A JSON-only reference scorer and a 421-row `golden_vectors_v2.json`
acceptance suite reproduce the pkl to ~1e-16; any reimplementation must pass the
golden vectors. Human-readable summary:

- **Architecture:** global additive ElasticNet (one formula for all objectives;
  objective is *not* a model input — it gates confidence language only).
- **Design:** 116 columns after one-hot expansion (`OneHotEncoder
  (min_frequency=25)`; column count is corpus-dependent) = J_summary 5 +
  J_dims 22 + C_dims (17 numeric + 9 categoricals expanded) + Ctrl 3 +
  duration_secs 1. **56 of 116 nonzero** in the shipped fit (vs round 1's 35 of
  111 — same core drivers, more diffuse).
- **Fit population:** 199 creators / 3,840 rows (dev + lockbox, selection
  closed). Shipped winsor bounds lo=0.110784, hi=3.505625 (selection-phase
  frozen dev-only bounds were lo=0.1106, hi=3.4696 — retired with the lockbox).
- **Top-10 coefficients by |weight|** (standardized): emotion_combination_
  curiosity_inspiration +0.1394 · caption_tone_promotional −0.0911 ·
  hook_style_question −0.0906 · is_sponsored_int −0.0746 · specificity_specific
  −0.0589 · cta_type_buy −0.0572 · **duration_secs +0.0566** ·
  cl_big_compelling +0.0562 · cta_type_save +0.0541 ·
  emotion_targeted_inspiration +0.0535. (Same anchors as round 1:
  curiosity+inspiration rewarded; promotional tone, sponsorship, buy-CTAs, and
  question-hooks penalized.)

**Full 56-row nonzero coefficient table** (exported from `scoring_spec_v2.json`,
sorted by |standardized coefficient| descending; group taxonomy matches the
inventory below). *Sign stability note*: `scoring_spec_v2.json` carries the
single shipped fit only — it has no per-feature bootstrap/refit stability
field, so that column is omitted here rather than filled with an estimate;
the closest available stability evidence is the aggregate one (round 1 → v2:
"56 of 116 nonzero... same core drivers, more diffuse", above).

| Feature | Group | Standardized coefficient |
|---|---|---|
| `emotion_combination_curiosity_inspiration` | C_dims (categorical) | +0.1394 |
| `caption_tone_promotional` | C_dims (categorical) | -0.0911 |
| `hook_style_question` | C_dims (categorical) | -0.0906 |
| `is_sponsored_int` | Ctrl | -0.0746 |
| `specificity_specific` | C_dims (categorical) | -0.0589 |
| `cta_type_buy` | C_dims (categorical) | -0.0572 |
| `duration_secs` | Mechanical | +0.0566 |
| `cl_big_compelling` | C_dims (numeric) | +0.0562 |
| `cta_type_save` | C_dims (categorical) | +0.0541 |
| `emotion_targeted_inspiration` | C_dims (categorical) | +0.0535 |
| `emotion_primary_inspiration` | C_dims (categorical) | +0.0535 |
| `cl_big_useful` | C_dims (numeric) | +0.0474 |
| `cl_big_surprising` | C_dims (numeric) | -0.0431 |
| `cta_type_follow` | C_dims (categorical) | +0.0368 |
| `cta_type_link` | C_dims (categorical) | -0.0362 |
| `jc_useful` | J_dims | -0.0302 |
| `caption_tone_educational` | C_dims (categorical) | +0.0293 |
| `objfit_consensus` | J_summary | +0.0285 |
| `jc_novel` | J_dims | +0.0277 |
| `text_overlay_density_heavy` | C_dims (categorical) | -0.0257 |
| `text_overlay_role_none` | C_dims (categorical) | +0.0218 |
| `jc_visually_engaging` | J_dims | -0.0211 |
| `trending_alignment_signals` | C_dims (numeric) | +0.0209 |
| `jc_emotionally_resonant` | J_dims | +0.0202 |
| `specificity_vague` | C_dims (categorical) | +0.0200 |
| `jc_relatable` | J_dims | -0.0179 |
| `jd_useful` | J_dims | -0.0174 |
| `emotion_combination_curiosity_delight` | C_dims (categorical) | +0.0168 |
| `emotion_combination_other` | C_dims (categorical) | -0.0148 |
| `cl_big_visually_engaging` | C_dims (numeric) | +0.0140 |
| `trending_topic_likelihood` | C_dims (numeric) | +0.0138 |
| `cover_text_promises_value` | C_dims (numeric) | -0.0135 |
| `cta_present` | C_dims (numeric) | -0.0129 |
| `jc_funny` | J_dims | +0.0122 |
| `jc_emotion_intensity` | J_dims | +0.0120 |
| `jc_compelling` | J_dims | +0.0118 |
| `text_overlay_density_none` | C_dims (categorical) | +0.0118 |
| `risk_any` | Ctrl | +0.0113 |
| `jc_surprising` | J_dims | -0.0111 |
| `jd_funny` | J_dims | +0.0096 |
| `cl_big_novel` | C_dims (numeric) | +0.0092 |
| `hook_strength_visual` | C_dims (numeric) | +0.0076 |
| `jd_surprising` | J_dims | -0.0075 |
| `cl_big_polished` | C_dims (numeric) | -0.0072 |
| `text_overlay_density_moderate` | C_dims (categorical) | -0.0052 |
| `hook_strength_audio` | C_dims (numeric) | -0.0050 |
| `cl_big_relatable` | C_dims (numeric) | +0.0046 |
| `jd_emotionally_resonant` | J_dims | -0.0044 |
| `critic_score` | J_summary | +0.0042 |
| `cl_big_emotionally_resonant` | C_dims (numeric) | +0.0042 |
| `jd_emotion_intensity` | J_dims | +0.0041 |
| `hook_style_story` | C_dims (categorical) | -0.0038 |
| `cl_big_funny` | C_dims (numeric) | -0.0038 |
| `jd_visually_engaging` | J_dims | +0.0014 |
| `jd_relatable` | J_dims | -0.0004 |
| `cl_big_authentic` | C_dims (numeric) | -0.0003 |

**Full 116-column inventory** (source-tagged; from `data_dictionary_v2.json`):

- *J_summary (TwelveLabs):* avg_score, critic_score, connector_score,
  trendsetter_score, objfit_consensus.
- *J_dims (TwelveLabs cross-judge consensus jc_* / dispersion jd_*):*
  authentic, compelling, emotion_intensity, emotionally_resonant, funny, novel,
  relatable, surprising, useful, visually_engaging (×2), plus
  tiktok_rewatch_potential, tiktok_seo_strength.
- *C_dims numeric (Claude):* cl_big_{authentic, compelling,
  emotionally_resonant, funny, novel, polished, relatable, surprising, useful,
  visually_engaging}, hook_strength_audio, hook_strength_visual,
  trending_topic_likelihood, trending_alignment_signals, cta_present,
  cover_text_promises_value, direct_address, emotion_primary_intensity,
  emotion_secondary_intensity, audio_likely_trending.
- *C_dims categoricals (one-hot):* caption_tone_*, hook_style_*, cta_type_*,
  emotion_primary_*, emotion_targeted_*, emotion_combination_*, specificity_*,
  text_overlay_density_*, text_overlay_role_* (each with an
  `infrequent_sklearn` bucket).
- *Ctrl:* is_sponsored_int, has_brand_mention_int, risk_any (+ risk_any__miss).
- *Mechanical:* duration_secs (clamped to [5, 273.2]s at feature assembly).

## Appendix B — Key artifacts (repo paths)

Research repo: `capstone_model_artifact_v2.pkl` + `tiers_v2_1.json`
(`analysis/modeling/data/artifacts/v2_capstone/`); `CAPSTONE_PREREG_v2.md`
(full amendment trail) + all stage readouts
(`analysis/modeling/reports/capstone/`); snapshot + fold map + anchor files
(`analysis/modeling/data/snapshots/2026-07-07-capstone/`);
`data_dictionary_v2.json`. App repo: `backend/scoring/scoring_spec_v2.json`,
`golden_vectors_v2.json`, `reference_distributions_v2.json`,
`corpus_reference_pool.json`, `scorer.js`. Operational documentation:
`PreviewPanel_Operations_and_Roadmap.md`.
