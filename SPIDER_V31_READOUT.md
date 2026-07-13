# Spider v3.1 Readout

Chips onto the card, positive/negative rows, parallel tooltips. App repo only.

## 1. What changed

### 1. Placement
`DetectedSignals` now renders **inside** `PerformanceRadar`'s own white card — at the
end, below the radar/legend/explainer, same card surface, same padding/typography.
`PreviewPanel.jsx` no longer renders `<DetectedSignals>` directly; it passes
`contentReadAxes`/`signalFields` straight through to `<PerformanceRadar>`, which
forwards them internally. The old outside-card call sites are gone.

### 2. Structure — two labeled sub-rows
Each rendered only when non-empty; the whole block absent when both are empty (no
empty states anywhere, at any level).

**"Other positive signals"** — Curiosity, Inspiration, the combined Curiosity +
Inspiration chip (unchanged from v3, distinct gold styling, unchanged tooltip), Save-
prompt CTA (unchanged), plus two new ones:

| Chip | Condition | Coefficient |
|---|---|---|
| Follow CTA | `cta_type === "follow"` | +0.0368 |
| Educational caption tone | `caption_tone === "educational"` | +0.0293 |

**"Negative signals"** (new row — muted blue-grey (`B.grey`) styling, deliberately not
alarming red, visually distinct from the warm-brown positives and the gold combo chip):

| Chip | Condition | Coefficient |
|---|---|---|
| Sponsored content | `is_sponsored_int === 1` | -0.0746 |
| Promotional caption tone | `caption_tone === "promotional"` | -0.0911 |
| Question-style hook | `hook_style === "question"` | -0.0906 |
| Buy CTA | `cta_type === "buy"` | -0.0572 |
| Link CTA | `cta_type === "link"` | -0.0362 |
| Heavy text overlays | `text_overlay_density === "heavy"` | -0.0257 |

All six coefficients confirmed negative in `scoring_spec_v2.json` before writing these
as "negative" signals — no discrepancies found against the prompt's categorization.

New chips use the house pattern (one sentence, correlational): positives — "In our
data, videos with [X] tend to outperform the creator's typical video." Negatives —
"...tend to underperform the creator's typical video." Sponsored gets the specified
expectation-setting variant instead of the plain negative template: "...useful to know
when comparing this result against your usual numbers, not a mark against the video
itself" — never punitive.

### 3. Trend-axis tooltips rewritten
Trend Alignment / Trending Topic now match the other six axes' structure and length
exactly — one-line description of what the dimension measures, plus a plain
correlational close, no hedging on magnitude (matching how e.g. "novel" or "funny"
never qualify their own coefficient size either):

- **Before:** "A content read (not a judge score) of how many recognizable
  trending-format patterns... In our data this carries a modest positive association
  with performance, a real but small signal rather than a strong lever."
- **After:** "How many recognizable trending-format patterns — sounds, edits,
  structural beats — this video picks up on. Videos that align with more of these
  patterns tend to perform better than those that don't."

"Not a judge score" and "modest positive association" are both gone — the content-read
legend marker already carries the source distinction, so the caveat was redundant with
existing UI, not a magnitude claim worth keeping once redundant.

## 2. Backend

Added `buildSignalFields(features)` to `contentReadAxes.js` — the single source of
truth for the five new raw fields (`ctaType`, `captionTone`, `hookStyle`,
`textOverlayDensity`, `isSponsored`), shared between `runShadowScoringForJob`'s live
path and the `/api/status` DB-fallback recovery path, identical shape either way. This
replaces the narrower `ctaType`-only field server.js exposed in v3 — `job.ctaType` /
the `ctaType` response field are gone, folded into `job.signalFields` /
`signalFields`. Same "current submission only" contract as
`computeContentReadAxes`/`computeTrendAxes`: no pool/corpus involvement, confirmed by
re-checking (as in v3) that every call site reads either this run's own `features` or
a single DB row's own `input_features` — never a multi-row query.

## 3. Verification

### Dev harness (fixture-based, pre-deploy)
Three scenarios via `VerdictPreview.jsx`'s three dev-toggle cases (temp-edited,
screenshotted, then `git checkout --` reverted):
- **"Full" (Test A — positive only):** curiosity=6, inspiration=4, cta_type=follow,
  caption_tone=educational → on-card block appeared with a border-top divider inside
  the same white card; "OTHER POSITIVE SIGNALS" row showed all 5 expected chips
  (Curiosity, Inspiration, combined, Follow CTA, Educational tone); no negative row.
- **"With a split" (Test B — negative only):** is_sponsored=true,
  caption_tone=promotional, hook_style=question, cta_type=buy,
  text_overlay_density=heavy → "NEGATIVE SIGNALS" row rendered with muted grey chips
  (Sponsored content, Promotional tone, Question-style hook, Buy CTA, Heavy text
  overlays — 5 of 6 possible, since `cta_type` is a single categorical value and
  can't be both "buy" and "link" simultaneously); no positive row.
- **"Fallback" (Test C — clean):** all fields neutral/none → confirmed by scrolling
  past where the block would sit: straight from "What do these signals mean?" to "The
  full panel," no divider, no gap, nothing rendered.
- Tapped "Educational tone" in Test A: tooltip revealed exactly "In our data, videos
  with an educational caption tone tend to outperform the creator's typical video." —
  confirms the house-pattern template renders correctly through the new `SignalRow`
  wrapper.

### Live (real production data, post-deploy — sha `6a5873b`)
Ran the actual deployed `computeContentReadAxes`/`buildSignalFields` (imported
directly, not reimplemented) against real `extract_cdims_status = 'ok'` rows (55 at
verification time):

- **Case A — ≥1 positive chip:** submission 7085 — `curiosity: 6` → Curiosity chip
  earned, no negative fields present.
- **Case B — negative signal(s):** submission 6583 — `is_sponsored: true` → Sponsored
  content chip earned (also `curiosity: 4`, so this real submission shows both rows
  at once — expected, not a bug, the two rows are independent).
- **Case C — clean video, no block:** submission 6658 — `curiosity: 0, inspiration: 0,
  cta_type: none, caption_tone: inspirational` (not in the detected list),
  `hook_style: visual_promise` (not question), `text_overlay_density: none`,
  `is_sponsored: false` → zero chips either way, block absent.

### Deploy verification
- Render backend: `/version` → sha `6a5873b` ✅
- Vercel frontend bundle: contains `"Other positive signals"`, `"Negative signals"`,
  `"Follow CTA"`, `"Educational tone"`, `signalFields`, and both new trend-axis
  tooltip strings (`"tend to perform better than those that don[']t"`, `"tend to
  outperform ones that aren[']t"`) — and **zero** remaining occurrences of `"modest
  positive association"` in the compiled bundle, confirming the caveat was fully
  removed, not just from the source file the build happened to skip. ✅

### Regression + build
`node scoring/scoreDisplayTest.mjs` and `node scoring/percentilePoolsTest.mjs`: both
PASS. `node --check` clean on `server.js` and `contentReadAxes.js`. `npx vite build`:
clean.

## 4. Files changed

- `backend/scoring/contentReadAxes.js` — added `buildSignalFields()`.
- `backend/server.js` — `job.signalFields` replaces `job.ctaType`; `/api/status`
  response + DB-fallback recovery updated accordingly.
- `frontend/src/components/PerformanceRadar.jsx` — renders `<DetectedSignals>` inside
  its own card; rewrote `trend_alignment`/`trending_topic` `DIMENSION_INFO` entries;
  new `contentReadAxes`/`signalFields` props.
- `frontend/src/components/DetectedSignals.jsx` — rebuilt around two `SignalRow`
  sub-rows (positive/negative); six new chip conditions; new house-pattern tooltips.
- `frontend/src/PreviewPanel.jsx` — removed the outside-card `<DetectedSignals>` call
  sites; `signalFields` state replaces `ctaType` state; both `<PerformanceRadar>`
  call sites now also pass `contentReadAxes`/`signalFields`.

## 5. Ops doc

One-line tick to `PreviewPanel_Operations_and_Roadmap.md` §1a (research repo, commit
`d80a177`) — item 8's "Extras" bullet now describes the on-card two-row (positive/
negative) chip layout.

## STOP

Per the prompt's explicit instruction — no further work started after this readout.
