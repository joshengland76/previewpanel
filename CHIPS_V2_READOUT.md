# Chips v2 + Caption Fidelity — Readout

App repo + one research-DB read-only query. Model is FROZEN — this was
input fidelity + display taxonomy only, no scoring-spec changes.

## Task 1 — Corpus base-rate table (research DB, read-only)

**Full study corpus** (`analysis/modeling/data/snapshots/2026-07-07-capstone/modeling_table_capstone.parquet`
— the frozen day-30-scored population the model was actually fit against: 4,897 videos, 258 creators):

| Feature | Count | % |
|---|---|---|
| emotion_primary/targeted_inspiration | 530 / 4,897 | 10.8% |
| emotion_combination_curiosity_inspiration | 353 / 4,897 | 7.2% |
| emotion_combination_curiosity_delight | 1,036 / 4,897 | 21.2% |
| caption_tone_educational | 1,347 / 4,897 | 27.5% |
| caption_tone_promotional | 433 / 4,897 | 8.8% |
| cta_type_save | 157 / 4,897 | 3.2% |
| cta_type_follow | 211 / 4,897 | 4.3% |
| cta_type_buy | 225 / 4,897 | 4.6% |
| cta_type_link | 212 / 4,897 | 4.3% |
| hook_style_question | 419 / 4,897 | 8.6% |
| is_sponsored_int | 599 / 4,897 | 12.2% |
| has_brand_mention_int | 992 / 4,897 | 20.3% |
| text_overlay_density_heavy | 399 / 4,897 | 8.1% |

Note: `emotion_primary` and `emotion_targeted` agree on 4,875/4,897 rows (99.6%) —
`emotion_targeted` is a back-compat column `parser.py` populates directly from
`emotion_primary`, so the two are functionally the same signal in this corpus,
not an independent check.

`has_brand_mention_int` is **not** a Claude/C_dims field in the research
pipeline — it's mechanical (`research_videos.has_brand_mention`, computed by
`parser.py` from `@mentions` in the caption that aren't the creator's own
handle). The app's live approximation of the same feature name
(`buildFeatures.js`'s `has_brand_mention_int`) is built from a completely
different signal — Claude's `sponsored_brand` output — so the two aren't
directly comparable; flagged here, out of scope to reconcile under this prompt
(model frozen).

**Live app rows** (`shadow_scores.input_features`, the 89 rows where this
extraction has actually run):

| Feature | Count | % |
|---|---|---|
| emotion_primary/targeted_inspiration | 1 / 89 | 1.1% |
| emotion_combination_curiosity_inspiration | 2 / 89 | 2.2% |
| emotion_combination_curiosity_delight | 45 / 89 | 50.6% |
| caption_tone_educational | 14 / 89 | 15.7% |
| caption_tone_promotional | 2 / 89 | 2.2% |
| cta_type_save | 0 / 89 | 0.0% |
| cta_type_follow | 0 / 89 | 0.0% |
| cta_type_buy | 0 / 89 | 0.0% |
| cta_type_link | 1 / 89 | 1.1% |
| hook_style_question | 0 / 89 | 0.0% |
| is_sponsored_int | 1 / 89 | 1.1% |
| has_brand_mention_int | 1 / 89 | 1.1% |
| text_overlay_density_heavy | 1 / 89 | 1.1% |

`cta_type` distribution over these 89 rows: `{ "none": 88, "link": 1 }`.

The contrast is the finding: `curiosity_delight` is **2.4x** the corpus rate
live (50.6% vs 21.2%), while every caption-dependent CTA/hook feature is
**at or near zero** live versus a real 3-9% in the corpus. Both point at the
same root cause, confirmed in Task 2.

## Task 2 — Caption-path audit (before the fix)

The single `extractCdims()` call site (`server.js`, inside
`runShadowScoringForJob()`) hardcoded `caption: null` for every submission
source — file upload and link-fetch alike. `cdims.js`'s prompt template has
no conditional language for an empty caption (`caption_tone`'s enum doesn't
even offer a `none` option), so the model was always guessing
caption-dependent categoricals from video/audio alone. That's the direct
cause of the base-rate gap in Task 1: `cta_type_save/follow/buy/link` and
`hook_style_question` can't reliably be inferred without the actual caption
text, so they collapsed to ~0% live while the study corpus (real captions,
every row) shows 3-9%.

Separately, `curiosity_delight`'s live rate (50.6%) being more than double
the corpus rate (21.2%) is NOT a caption-path artifact — it traces to
Claude's `emotion_combination` field defaulting to that label unusually
often in this specific app corpus (see prior signal-frequency analysis this
session). Both findings are real but independent; caption fidelity (Task 3)
addresses the first, the chip roster change (Task 4) addresses the second by
simply not giving `curiosity_delight` a chip at all.

## Task 3 — Caption fidelity restoration

- **3a, link-fetch:** `meta.description` from the existing `--dump-json`
  probe (previously parsed only for `duration`, then discarded) is now
  stored on the job and passed to `extractCdims`. Ops doc note added under
  §1a.
- **3b, validation ingestion:** `validation/worker.py`'s discovery listing
  (`--flat-playlist`) doesn't reliably carry `description`, so a lightweight
  per-video `--dump-json` probe (`fetch_caption()`) runs before `post_ingest`,
  which now sends `caption` to `/api/validation/ingest`. Ops doc note added
  under §1e.
- **3c, file uploads (kept, not vetoed):** an optional "Planned caption"
  text field appears only after a file is selected; blank by default, never
  required, capped at 2000 chars, passed through to `extractCdims` when
  filled in.

## Task 4 — Chip roster v2 (display only)

- Removed the standalone **Curiosity** chip. Its old detection (primary,
  secondary, *or* a bare substring match in the combination label) carries
  no dedicated model coefficient and fires close to a coin flip in real
  data — curiosity now only shows as half of the **Curiosity + Inspiration**
  combo chip.
- **Inspiration** now keys strictly to `emotion_primary_inspiration` OR
  `emotion_targeted_inspiration` (new `signalFields.inspirationStrict`,
  `backend/scoring/contentReadAxes.js`) instead of the old broad read, and
  is suppressed whenever the combo fires (never both at once).
- No chip for `curiosity_delight` or any delight variant — +0.017 model
  weight at a ~21-52% base rate, below the bar on both signal strength and
  rarity.
- Educational tone and all six negative chips are unchanged. Save/Follow CTA
  chips are annotated in code as caption-dependent (they were structurally
  muted before Task 3; now fire on link-fetch, validation rescores, and
  file uploads with a planned caption).

## Task 5 — Live verification

Three real production submissions, all against sha `0e25626`:

**1. Link-fetch, real posted TikTok with a promotional/CTA caption**
(`@everyday_abby`, caption: *"NEW in from target 🔥 Click on the link in my
bio to shop OR come find so much more from me on IG ❤️ #womensfashion..."*)
— `job_1784083351546_vt8kq9`:

| Field | Value |
|---|---|
| caption_tone | **promotional** |
| cta_type | **link** |
| is_sponsored_int | 1 |
| emotion_primary / targeted | joy / joy |
| emotion_combination | joy_inspiration |

Caption reached C_dims and drove the extraction directly — `caption_tone`
and `cta_type` land exactly where the real caption's "click the link in my
bio to shop" language points. Chips: Promotional tone, Link CTA, Sponsored
all fire (all negative, all caption-driven); no Inspiration chip despite
`emotion_combination` containing "inspiration" as a substring — `emotion_
primary`/`emotion_targeted` are both "joy," so the new strict check
correctly does not fire (the old broad substring check would have). Radar/
score otherwise unaffected in kind — ran the normal 3-judge pipeline.

**2. Plain file upload, no caption** (same source video, re-uploaded with
no caption field) — `job_1784083386648_agn84l`:

| Field | Value |
|---|---|
| caption_tone | educational (guessed — no caption, per Task 2's finding) |
| cta_type | none |
| emotion_primary / targeted | curiosity / curiosity |
| emotion_combination | **curiosity_delight** |

This row classifies as `curiosity_delight` — exactly the case Task 5 asked
to confirm. No chip fires for it: the generic Curiosity chip no longer
exists, the combo chip requires the strict Inspiration condition too
(`emotion_primary`/`targeted` here are "curiosity," not "inspiration," so
`inspirationStrict` is false), and the standalone Inspiration chip is
gated the same way. Net: **no curiosity-family badge at all** on this
video, confirmed live.

**3. File upload with a planned caption** (Task 3c, same source video again,
this time with `caption: "Click the link in my bio to shop this now! Follow
for more 🛒🔥 #shopping #linkinbio"`) — `job_1784083393590_r543yh`:

| Field | Value |
|---|---|
| caption_tone | **promotional** |
| cta_type | **link** |

Identical video content, only the caption differs between test 2 and test
3 — and the caption-dependent fields flip from educational/none to
promotional/link accordingly. End-to-end confirmation that the optional
planned-caption field reaches `extractCdims` exactly like a real caption
would.

## Files changed

- `backend/server.js` — job.caption plumbing (link-fetch, file upload,
  validation ingest), extractCdims call site.
- `backend/scoring/contentReadAxes.js` — `inspirationStrict` field.
- `frontend/src/components/DetectedSignals.jsx` — chip roster v2.
- `frontend/src/PreviewPanel.jsx` — optional planned-caption field.
- `validation/worker.py` — `fetch_caption()`, threaded into `post_ingest`.
- `correlation-research/PreviewPanel_Operations_and_Roadmap.md` — §1a/§1e
  dated notes.

## STOP

Per the prompt's explicit instruction — no further work started after this
readout.
