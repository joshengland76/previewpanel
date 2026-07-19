# Objective-Conditioning Diagnostic

**Question under test:** the ricotta-tart video (@ballerinafarm, tiktok
`7657403397162716429`) scored **84th percentile** on the prospect
Performance Preview (null objective) but **36th** in the app (objective
"Life Hacks"). Josh's control: a "Food & Drinks/Cooking" app re-run scored
the *same* ~40th, which argues *against* simple objective-mismatch. This
diagnostic decomposes the gap arithmetically, isolates the upstream cause,
and runs a controlled three-arm experiment. **No fixes, no code changes.**

All ŷ values are the capstone-v2 model output (`scoring_spec_v2.json`,
`spec_hash=b7dca6ee49b2882d`). Overall percentile = midrank against the
same last-1,000 pool `generate_preview.py` uses.

---

## The two historical runs

| run | shadow_scores id | objective | source | judges (c/t/conn) | objfit | ŷ | overall pctl |
|-----|------|-----------|--------|-------------------|--------|------|------|
| A (prospect) | 757 | **null** | prospect_report | 7 / 7 / 7 | *null* | **+0.06685** | **84** |
| B (app)      | 759 | Life Hacks | link_fetch | 2 / 2 / 3 | 1 | **−0.08471** | **36** |

Same `prompt_version` (judges-v2.1), `pegasus_model` (pegasus1.5),
`spec_hash`. Δŷ(A−B) = **+0.151559**.

---

## Task 1 — the 84→36 gap reconciles exactly from stored features

Both ŷ values reproduce **bit-for-bit** from stored `input_features`
through a from-scratch re-implementation of `scorer.js`
(residual = 0.00e+00 both runs). Ranked in the identical overall pool:

- ŷ_A = +0.06685 → **84th** (matches the report)
- ŷ_B = −0.08471 → **36th** (matches the app headline)

So the swing is a **pure ŷ difference under one consistent percentile
system** — not a disagreement between the PDF's and the app's percentile
math. The app's stored `calibrated_percentile` for B was 38.28 (the
objective-calibrated variant); the plain overall-pool midrank is 36.

**Per-feature Δcontribution (A − B), reconciling to Δŷ = +0.151559:**

| model column | x_A | x_B | coef | Δcontrib |
|---|---:|---:|---:|---:|
| **objfit_consensus** | 0.000 | −4.253 | +0.0285 | **+0.121348** |
| jc_novel | 0.234 | −3.283 | +0.0277 | +0.097509 |
| jc_emotionally_resonant | 1.392 | −3.249 | +0.0202 | +0.093524 |
| jc_visually_engaging | 0.858 | −3.219 | −0.0211 | −0.085827 |
| jc_useful | 0.125 | −2.247 | −0.0302 | −0.071528 |
| jc_relatable | 0.471 | −3.532 | −0.0179 | −0.071475 |
| jc_compelling | 0.000 | −4.356 | +0.0118 | +0.051411 |
| jc_surprising | −0.412 | −2.470 | −0.0111 | −0.022788 |
| jc_emotion_intensity | −0.241 | −1.927 | +0.0120 | +0.020203 |
| critic_score | 0.000 | −4.366 | +0.0042 | +0.018488 |
| jc_funny | 0.207 | −1.243 | +0.0122 | +0.017706 |
| (11 smaller terms) | | | | net −0.017072 |
| **SUM** | | | | **+0.151559** ✓ |

**Group subtotals (A − B):**

| group | Δcontrib | share |
|---|---:|---:|
| **objfit_consensus** | **+0.121348** | **80.1%** |
| judge_summary (critic/trend/conn/avg) | +0.018488 | 12.2% |
| judge_dims (jc_*/jd_*) | +0.007846 | 5.2% |
| C_dims judge-layer (cl_big_*) | +0.003897 | 2.6% |
| duration / other | −0.000019 | ~0% |

Two structural facts make this table read the way it does:

1. **`objfit_consensus` alone is 80% of the A−B gap.** In run A the
   objective is null, so no judge produced an `objective_fit` score →
   `objfit_consensus` is null → the scorer median-imputes it to
   **standardized 0, i.e. the corpus median raw 8.333** (a *good* fit).
   In run B it is a real, very-low value (raw 1.0 → std −4.253). The
   feature has **`has_missing_indicator = false`**, so a null objective is
   silently treated as an *average-to-good* objective fit.
2. **The judge dimensions collapsed ~3 SD but net to only +0.0078**,
   because the model's coefficients on those dims carry **mixed signs**
   (e.g. jc_novel +0.0277 but jc_useful −0.0302), so a uniform drop
   largely cancels. And among the judge *summary* scores, **only
   critic_score has a non-zero coefficient (0.0042)** — `avg_score`,
   `trendsetter_score`, `connector_score` all have coefficient **0.0000**.
   The famous "7/7/7 vs 2/2/3" barely touches ŷ directly.

---

## Task 2 — what actually differs upstream

### 2a. Judge prompt (`buildTLPrompt`, server.js)
The objective renders through one variable, `objectiveLens`, which is
`objective ? "...big block..." : ""`. When objective is **null the entire
block is the empty string.** With an objective it injects:
- an **"OBJECTIVE FIT — REQUIRED EVALUATION"** section demanding a 1–10
  `objective_fit` output, and
- a **"CATEGORY PERFORMANCE CONTEXT — Apply this category-specific
  knowledge when scoring _all dimensions_ (not just objective_fit), since
  the creator's objective changes what predicts performance"** block,
  followed by the per-objective rubric. For Life Hacks: *"Hook must
  immediately demonstrate the problem being solved — viewers must
  self-identify as having the problem within 3 seconds… weight
  save-worthiness heavily."*

The JSON output schema also omits the `objective_fit` field entirely when
objective is falsy (server.js:1964). So a null-objective run instructs the
judges to score **every base dimension neutrally**, with **no category
lens and no objective_fit field**.

### 2b. C_dims extractor (`cdims.js`)
`extractCdims({...})` takes **no objective parameter.** Its prompt injects
`{objectives}` = the full list and the model **classifies the objective
itself**. The C_dims call never receives the app-selected objective →
C_dims features are objective-blind. Confirmed empirically: `cl_big_useful`,
`hook_style` (visual_promise), `caption_tone` (conversational),
`specificity` (specific) are **identical across all three historical runs.**
(C_dims does receive `caption`; the TwelveLabs judges receive **no caption
at all** — `buildTLPrompt` has no caption parameter.)

### 2c. `objfit_consensus` when objective is null (`buildFeatures.js`)
```
objFitScores = [critic,trendsetter,connector]_objective_fit_score, filter != null
objfit_consensus = objFitScores.length ? mean : null
```
Null objective → no `objective_fit_score` from any judge → `objfit_consensus
= null` → scorer imputes to the **median (raw 8.333, std 0)**, with **no
missing indicator** to flag it. Verified per run: A raw=null (std 0,
contrib 0.000000); B raw=1 (std −4.253, contrib −0.121348); C raw=6 (std
−1.353, contrib −0.038611).

### 2d. Josh's control (Food & Drinks re-run) + full input-path diff
A third historical run exists — the Food & Drinks/Cooking app run:

| run | id | objective | judges | objfit | ŷ | overall pctl |
|---|---|---|---|---|---|---|
| A | 757 | null | 7/7/7 | null | +0.06685 | 84 |
| B | 759 | Life Hacks | 2/2/3 | 1 | −0.08471 | 36 |
| C | 760 | Food & Drinks | 5/7/7 | 6 | −0.08742 | 35 |

**The paradox is real in the historical data:** C (a *well-fitting*
objective, judges 5/7/7, objfit 6) landed at the *same* ~35th as B (a
mismatch). Decompositions:

- **A − C (Δŷ +0.15428):** judge_dims **+0.10439 (68%)**, objfit_consensus
  +0.03861 (25%), judge_summary +0.00740 (5%).
- **B − C (Δŷ +0.00272, ≈ 0):** judge_dims +0.09655 and objfit_consensus
  **−0.08274** nearly cancel — B has worse objfit but its lower base dims
  partly offset in the model's mixed-sign space.

**Every video-derived input is identical across all three historical
runs:** duration 172.6/172.62/172.62 s; C_dims categoricals identical.
The *only* things that vary are the objective field and the **judge
dimension draws**, which track the objective:

| jc dim | A (null) | B (Life Hacks) | C (Food) |
|---|---:|---:|---:|
| jc_novel | 6.00 | 1.00 | 4.67 |
| jc_useful | 7.33 | 1.00 | 5.67 |
| jc_emotionally_resonant | 8.00 | 1.33 | 5.67 |
| jc_visually_engaging | 8.00 | 1.67 | 6.33 |

So the judges scored the **identical video's base qualities** completely
differently based purely on the objective label (they see neither caption
nor C_dims). This is the **category-lens conditioning of 2a acting on the
base dimensions**, not just objfit.

But note C ≈ B in ŷ despite very different objfit/judges — a hint that
**single-draw noise is large**, which Task 3 tests directly.

---

## Task 3 — controlled three-arm experiment (~$0.24 spend)

Same video file, same day, **same ingestion path**
(`/api/validation/ingest`, file upload, `source=prospect_report`), varying
**only** the objective. Three fresh judging draws:

| arm | posted_video_id | shadow id | objective | judges | objfit | ŷ | overall pctl |
|---|---|---|---|---|---|---|---|
| A′ | 140 | 761 | null | 7/7/8 | null→8.33 | **+0.11577** | **93** |
| B′ | 141 | 762 | Life Hacks | 6/6/6 | 4 | **+0.02552** | **72** |
| C′ | 142 | 763 | Food & Drinks | 7/7/8 | 8.33 | **+0.13208** | **94** |

**Within this controlled batch, objective conditioning is real and
directional:**
- **Food ≈ null** (94th ≈ 93rd) — a *well-fitting* objective is
  indistinguishable from no objective.
- **Life Hacks is depressed ~0.09–0.11 ŷ (~21 pctl pts)** vs null/Food.
  Decomposition C′−B′ (Δŷ +0.10657): objfit_consensus **+0.07171 (67%)**,
  judge_dims +0.01564, other +0.01922. A′−B′ (Δŷ +0.09026): objfit
  +0.07171 again dominant.

**But run-to-run (batch) noise is much larger than the objective effect.**
Same video + same objective, fresh draw vs the historical draw:

| objective | historical ŷ (pctl) | fresh ŷ (pctl) | \|Δŷ\| | Δpctl |
|---|---|---|---|---|
| null | +0.0669 (84) | +0.1158 (93) | 0.049 | +9 |
| Life Hacks | −0.0847 (36) | +0.0255 (72) | **0.110** | **+36** |
| Food & Drinks | −0.0874 (35) | +0.1321 (94) | **0.220** | **+59** |

The Food arm alone swung **35th → 94th (Δŷ 0.220)** for the *same video,
same objective, same path* — just a different judging draw. That single-
draw variance **dwarfs** the objective-conditioning effect (~0.09–0.11)
and is **~9× the documented same-session ŷ SD of 0.025**
(`POOL_CONSISTENCY_READOUT.md` / `PreviewPanel_Scoring_Model_Report.md`
§5b, 18 identical runs of one *other* test video). The historical app
batch (B, C) was a systematically **harsh** draw (judges 2–5); the
prospect and all three fresh draws were **generous** (judges 6–8).

---

## Task 4 — corpus-level facts

### 4a. Provenance
Modeling table = **4,897 rows.** `objective_creator` and `objective_video`
are **non-null for 100%** of rows; **100%** carry ≥1 judge
`objective_fit_score` (98.9% have all three). **Every corpus video was
judged WITH its objective in the prompt — there are zero null-objective
corpus rows.** The null-objective path (prospect reports) is therefore an
**off-distribution input the model was never trained on**: at training
time `objfit_consensus` was always a real value, never the median-impute.

### 4b. Judge scores do vary by objective in the corpus
Per-objective means (corpus-wide avg_score 7.068 ± 1.109; objfit 7.987 ±
1.607):

| objective | n | avg_score | objfit |
|---|---:|---:|---:|
| Food & Drinks/Cooking | 258 | **7.645** | **8.721** |
| Fun Facts | 141 | 7.448 | 8.514 |
| Shopping | 178 | 7.468 | 8.253 |
| Educational/How-To | 556 | 7.290 | 8.339 |
| Life Hacks | 133 | 7.194 | 8.175 |
| … | | | |
| ASMR | 193 | 6.669 | 7.389 |
| Fitness/Wellness | 316 | 6.372 | 6.969 |
| Funny Videos/Comedy | 393 | 6.493 | 6.988 |

Spread of per-objective means: avg_score **6.37–7.65**, objfit
**6.97–8.72**. Two things follow: (i) judge scores *do* move by objective,
but modestly (~1.3 pts of avg_score); (ii) the null-impute target (raw
8.333) sits **near the top** of the objfit range — a null-objective video
is imputed to roughly a *Food/Educational-tier* objective fit. Food & Drinks
is, in fact, the **highest-objfit objective in the corpus (8.721)** — which
is why fresh arm C (correct objective, objfit 8.33) matched the null arm so
closely.

### 4c. Forward Δŷ from the spec agrees with Task 1
Judge-sourced feature coefficients (median / sd shown for the load-bearing
ones):

| feature | coef | median | sd |
|---|---:|---:|---:|
| objfit_consensus | **+0.0285** | 8.333 | 1.724 |
| jc_useful | −0.0302 | 7.000 | 2.670 |
| jc_novel | +0.0277 | 5.667 | 1.421 |
| jc_visually_engaging | −0.0211 | 6.667 | 1.553 |
| jc_emotionally_resonant | +0.0202 | 6.000 | 1.436 |
| jc_relatable | −0.0179 | 7.333 | 1.416 |
| jd_useful | −0.0174 | 0.577 | 0.601 |
| jc_emotion_intensity | +0.0120 | 5.000 | 1.384 |
| jc_compelling | +0.0118 | 7.000 | 1.377 |
| jc_funny | +0.0122 | 3.333 | 1.610 |
| jc_surprising | −0.0111 | 5.000 | 1.620 |
| critic_score | +0.0042 | 7.000 | 1.145 |
| **avg_score** | **0.0000** | 7.000 | 1.187 |
| **trendsetter_score** | **0.0000** | 7.000 | 1.307 |
| **connector_score** | **−0.0000** | 7.000 | 1.393 |

Moving **only** the judge-sourced features from the 7/7/7-run values to the
2/2/3-run values yields forward **Δŷ = +0.147681**, matching Task 1's
judge-attributable subtotal (objfit 0.121348 + judge_summary 0.018488 +
judge_dims 0.007846 = **0.147682**) to 6 decimals. The arithmetic is
internally consistent both directions.

---

## What is established vs. what remains unknown

### Established (each with its number)
1. **The 84→36 swing reproduces exactly** from stored features
   (residual 0.00e+00) and from the same overall pool (84th / 36th). It is
   a pure ŷ difference, not a percentile-system disagreement.
2. **`objfit_consensus` is the dominant model channel** for the A−B gap
   (0.121348 of 0.151559 = 80.1%). A **null objective is median-imputed to
   raw 8.333 (a good fit) with no missing indicator** — an off-distribution
   input the model never saw in training (Task 4a: 0 null-objective corpus
   rows).
3. **The judge *summary* scores barely matter to the model**:
   avg/trendsetter/connector coefficients are 0.0000; only critic_score
   (0.0042) is non-zero. The "7/7/7 vs 2/2/3" is almost cosmetic to ŷ.
4. **The objective conditions the *base* judge dimensions, not only
   objfit** (category-lens instruction, 2a): identical video scored
   jc_useful 7.33 (null) / 1.00 (Life Hacks) / 5.67 (Food). **C_dims and
   duration are objective-blind and identical across arms.**
5. **Within a same-session controlled batch, a mismatched objective
   depresses ŷ ~0.09–0.11 (~21 pctl pts)**, primarily through objfit
   (Task 3: null 93 ≈ Food 94 > Life Hacks 72). A **well-matched objective
   is indistinguishable from no objective.**
6. **The prospect (null-objective) path structurally scores higher** than
   any real-objective app scoring of the same content, for two compounding
   reasons: it dodges the objfit penalty (imputed to a good fit) **and** it
   applies no category lens to the base dimensions.

### Unknown / larger than expected
1. **Single-draw judging noise is very large** — same video + objective +
   path varied up to **Δŷ 0.220 / 59 pctl points** (Food arm, Task 3),
   ~9× the documented 0.025 SD (which was measured on a different, evidently
   more stable video). A single run's percentile is not reliable to
   anywhere near ±0.025 ŷ for this video.
2. **With n=1–2 draws per cell, the objective-effect magnitude cannot be
   cleanly separated from noise.** The *direction* (mismatch depresses
   score, via objfit) is well-supported and mechanistic; the *size* on any
   single video is uncertain. Josh's observed 84-vs-36 was a **combination**
   of a genuine objective effect **and** an unlucky harsh draw in the
   historical app batch — not either alone.
3. **Why the historical app batch (B, C) was systematically harsher** than
   the prospect + all three fresh draws (time-of-day, TwelveLabs state,
   or chance) is not determinable from this data.
4. **Whether the documented 0.025 SD understates typical variance** or this
   ricotta video is unusually high-variance ("borderline content," per
   `PreviewPanel_Scoring_Model_Report.md`) is not resolved here.

*No recommendations or fixes are offered, per scope.*

---

## Experiment artifacts (kept, marked out of pool)

The three Task-3 scored rows are set `pool_eligible=false` (done during the
run) and retained for the record:

| shadow_scores id | posted_video_id | handle | objective |
|---|---|---|---|
| 761 | 140 | _diagnostic_objcond | null |
| 762 | 141 | _diagnostic_objcond | Life Hacks |
| 763 | 142 | _diagnostic_objcond | Food & Drinks/Cooking |

All under the synthetic handle `_diagnostic_objcond` (never a real user;
excluded from every pool). Scratch scripts deleted.

## Git state
Readout only — `OBJECTIVE_CONDITIONING_DIAGNOSTIC.md`. No code, template,
or doc changes.
