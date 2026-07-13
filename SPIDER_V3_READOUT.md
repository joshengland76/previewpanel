# Spider v3 Readout

Presence signals become chips; trend axes replace them on the radar. App repo only.

## 1. Why

A zero-rate analysis (done live in this conversation, against the production DB) found
Curiosity and Inspiration sat at a near-certain 0 vertex on ~99% of submissions. Almost
all of that was structural, not a real absence of signal: 409 of 415 pool-eligible rows
were `research_api` bulk-corpus videos that explicitly skip C_dims extraction by design
(cost/speed tradeoff), so they could never have shown anything else. Of the small number
of rows where C_dims actually ran, ~71% showed a genuine nonzero read. A radar vertex
that spends nearly all its life at the origin reads as broken even when it's accurate —
this is a UX/framing fix, not a bug fix.

## 2. What changed

### Removed
- Curiosity and Inspiration as radar **axes** (`PerformanceRadar.jsx`'s `CONTENT_READ_AXES`).

### Added — two new radar axes (`TREND_AXES`)
Direct 0-10 reads of two already-stored C_dims fields (`computeTrendAxes()`,
`backend/scoring/contentReadAxes.js`), not emotion-name matching like Curiosity/
Inspiration were:

| Axis | Field | Coefficient (`scoring_spec_v2.json`) | Tooltip framing |
|---|---|---|---|
| Trend Alignment | `trending_alignment_signals` | +0.0209 | "modest positive association" |
| Trending Topic | `trending_topic_likelihood` | +0.0138 | "modest positive association" |

Both coefficients are genuinely small (comparable to the smallest of the six kept
judge-axis coefficients, ~0.012–0.028) — tooltips say so explicitly rather than
overselling a real but minor signal.

### Added — "Detected signals" chip row (`DetectedSignals.jsx`, new component)
Renders directly beneath the radar. Curiosity/Inspiration's underlying detection logic
(`computeContentReadAxes()`) is **unchanged** — same three-field check (primary/
secondary/combination), same 0-10 scale — just re-surfaced as presence (value > 0),
not a graded vertex:

| Chip | Condition | Tooltip |
|---|---|---|
| Curiosity | `curiosity > 0` | unchanged framing from the old axis tooltip |
| Inspiration | `inspiration > 0` | unchanged framing from the old axis tooltip |
| Curiosity + Inspiration | both detected | "the strongest positive pattern in our study data" — literally true: `emotion_combination_curiosity_inspiration` (+0.1394) is the single largest coefficient in the entire model |
| Save-prompt CTA | `cta_type === "save"` | "one of the stronger positive associations... among the signals we track" — `cta_type_save` is +0.0541, one of the larger individual dummy coefficients, meaningfully above the trend axes |

**No empty state.** The component returns `null` outright when zero chips are earned —
confirmed in the dev harness (STATUS_NULL_SYNTHESIS fixture, both signals absent): the
row is completely gone from the DOM, not a "nothing detected" message.

## 3. Point 4 — current-submission-only confirmation (required verification)

Grepped every call site of `computeContentReadAxes`/`computeTrendAxes` and
`percentilePools.js` directly:

```
percentilePools.js: any reference to contentReadAxes/trendAxes/cta_type?  →  none

All call sites:
  server.js:1881  computeContentReadAxes(c.input_features)   -- inside resolveFingerprintGroup,
                                                                  same-user/same-video fingerprint
                                                                  fold (DB column only, see below —
                                                                  NOT the corpus percentile pool)
  server.js:2598  computeContentReadAxes(features)            -- this run's own features
  server.js:2604  computeTrendAxes(features)                  -- this run's own features
  server.js:4136  computeContentReadAxes(row.input_features)  -- single-row DB recovery lookup
  server.js:4137  computeTrendAxes(row.input_features)        -- single-row DB recovery lookup
```

None of the five call sites reads from a multi-row corpus/pool query. The one call site
that touches *other* rows (`resolveFingerprintGroup`'s `existingContentReadAxes`, line
1881) is the same-user/same-video fingerprint grouping mechanism built in the prior
session (`fp_group_key`/`group_mean_content_read_axes`) — a different, pre-existing
feature, not the percentile corpus pool. As a bonus fix while in this code: **removed**
the swap that used to overwrite `job.contentReadAxes` with that fingerprint-group mean
before sending it to the frontend. A "detected" chip now always reflects *this specific
analysis*, never an average across a repeat-tested video's history. (The
`group_mean_content_read_axes` DB column and its fold logic in `shadowScore.js` are left
alone — still recorded for backend/research use — this only stops the user-facing
payload from consuming it.)

The other 6 judge-scored axes (Compelling/Novel/Emotionally Resonant/Emotion Intensity/
Funny/Objective Fit) are **unaffected** — they keep the fingerprint-group-mean smoothing
built and explicitly authorized in the prior session; nothing in this prompt touched that.

**No bug found** — the codebase was already compliant; this section is a confirmation,
not a fix, except for the one swap removed above (which tightened an already-correct
design rather than fixing a leak).

## 4. Verification

### Dev harness (fixture-based, pre-deploy)
Two `VerdictPreview.jsx` fixture cases (temp-edited, screenshotted, then `git checkout
--` reverted — no trace left in the repo):
- **"Present" case** (`trend_alignment: 7, trending_topic: 6`, `curiosity: 6, inspiration: 4`,
  `cta_type: "save"`): radar showed all 8 axes with no zero vertex; all 4 chips
  rendered; tapping the combined chip revealed the exact required tooltip text
  ("Curiosity and Inspiration both detected in the same video — the strongest positive
  pattern in our study data").
- **"Absent" case** (`trend_alignment: 3, trending_topic: 2`, `curiosity: 0, inspiration: 0`,
  `cta_type: "none"`): trend axes still graded sensibly (3.0/2.0, not zero); chip row
  completely absent from the DOM — confirmed by scrolling past where it would sit,
  straight from the Scorecard card to "The full panel," no gap or placeholder.

### Live (real production data, post-deploy — sha `6521db9`)
Ran the actual deployed `computeContentReadAxes`/`computeTrendAxes` (imported directly
from `backend/scoring/contentReadAxes.js`, not reimplemented) against real
`extract_cdims_status = 'ok'` rows in the production DB (54 such rows at verification
time):

- **Case A — chip(s) render:** submission 7079 — `inspiration: 4` (Inspiration chip
  renders), `curiosity: 0`, `cta_type: "none"` → exactly one chip earned. Trend axes:
  `trend_alignment: 2, trending_topic: 5` — both nonzero; combined with the
  structurally-nonzero judge axes (1–10 scale, confirmed no judge axis can ever be 0),
  no vertex on the radar sits at zero.
- **Case B — chip row absent:** submission 6658 — `curiosity: 0, inspiration: 0,
  cta_type: "none"` → zero chips earned, row renders nothing. Trend axes:
  `trend_alignment: 2, trending_topic: 5` — same values as Case A, confirming trend
  axes grade independently of whether any content-read chip fires.

(A combined Curiosity+Inspiration real-world example was searched for but not found
among current production rows with a valid `submission_id` — the combo chip's logic
is a simple AND of the two independently-verified individual conditions, and was
confirmed rendering correctly against the dev-harness fixture above.)

### Deploy verification
- Render backend: `/version` → sha `6521db9` ✅
- Vercel frontend bundle: contains `trendAxes`, `"Trend Align"`, `"Trending Topic"`,
  `"Save-prompt CTA"`, and the exact combined-chip tooltip string
  `"strongest positive pattern in our study data"` ✅

### Regression + build
`node scoring/scoreDisplayTest.mjs` and `node scoring/percentilePoolsTest.mjs`: both
PASS. `node --check` clean on `server.js` and `contentReadAxes.js`. `npx vite build`:
clean.

## 5. Files changed

- `backend/scoring/contentReadAxes.js` — added `computeTrendAxes()`; header comments updated.
- `backend/server.js` — `ownTrendAxes`/`job.trendAxes`/`job.ctaType` wiring in
  `runShadowScoringForJob`; removed the `job.contentReadAxes` group-mean swap;
  `/api/status` response + DB-fallback recovery extended for `trendAxes`/`ctaType`,
  simplified for `contentReadAxes` (no more group-mean preference).
- `frontend/src/components/PerformanceRadar.jsx` — `CONTENT_READ_AXES` → `TREND_AXES`;
  `contentReadAxes` prop → `trendAxes`; `DIMENSION_INFO` updated.
- `frontend/src/components/DetectedSignals.jsx` — new component, the chip row.
- `frontend/src/PreviewPanel.jsx` — new `trendAxes`/`ctaType` state, wired into both
  render branches alongside the existing `contentReadAxes`/`groupMeanBigPicture`.

## 6. Ops doc

One-line tick to `PreviewPanel_Operations_and_Roadmap.md` §1a (research repo, the
canonical home per the prior document-reconciliation pass) — item 8's "Extras" bullet
now reads: radar = 8 graded axes (6 judge-scored + 2 content-read trend) plus a
"Detected signals" chip row for presence-based positives, all current-submission-only.
Committed separately (research repo commit `edd1e53`) since it's a docs-only change in
a different repo, not app-repo code.

## STOP

Per the prompt's explicit instruction — no further work started after this readout.
