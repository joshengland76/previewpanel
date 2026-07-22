# Track Record v5 — Readout

A two-era Track Record — a **blind test** (predictions we made before the
creator joined) and **graded previews** (their own preview calls, graded against
real 30-day outcomes) — built on the current live UI, with a dev fixture harness
so the states could be reviewed before any real JOINED data exists. App repo
(server.js + PreviewPanel.jsx + call_semantics.json + studyCopy.js) + docs.
Exempt paths untouched; keep-warm untouched. `record_config` was NOT implemented
(superseded).

## 1. Era model — derived from provenance

Discriminator (`rowEra`, server.js), from existing columns only:

- **BLIND** = `source IN ('study_history','prospect_report')` — the prepopulated
  rows synthesized for a creator's board before they ever used the app.
- **JOINED** = the creator's own posted video that fingerprint-matched one of
  their previews (`match_tier` 1|2) and has a collected day-30 outcome.
- An own post with no matching preview belongs to neither era (renders nowhere).

Eras **never rank against each other.** Each grades independently: its own median
("typical"), its own rolling 40-window, its own call ranking (v3 tier ladder),
verdicts, adaptive hero, and section-average sublines. A loud **leakage
assertion** fires if any window ever mixes eras.

**JOINED prediction/percentile = the preview's own stored score the user saw** —
never a rescore. The tab shows the **overall last-1,000 (all-objective)** rank of
that preview prediction, the same basis the BLIND rows use and the big-gauge
number shown at preview time. (An earlier build mistakenly used the preview's
per-objective `calibrated_percentile`; corrected to overall last-1,000 during
review.)

## 2. Grading — per era, frozen

`gradeTrackRecordForUser` partitions a user's collected outcomes by era and
freezes `times_typical` (result ÷ era median) independently per era, then ranks
each era's rolling window. Per-era floors: BLIND keeps `BASELINE_MIN` (4);
JOINED grades from its first outcome (it renders as soon as ≥1 row is graded).
The DB call_type/verdict cache is legacy — the v5 endpoint recomputes calls per
era via the shared `shapeEra`.

## 3. Endpoint + UI

`/api/track-record` returns `eras.{joined,blind}` (each: graded rows, aggregates,
gradedCount, hasCalls), `heroOwner`, `retired`, and BLIND `nullConfig`. Shaping
runs through pure `shapeEra` / `computeEraAggregates`.

- **JOINED renders first** once it has ≥1 graded row: kicker "Since you joined".
  Below the call floor (n<6) its rows list plainly — no call pills, no verdict
  chips, **no progress counter of any kind**.
- **Hero ownership:** JOINED owns the primary hero once it has calls (n≥6);
  until then the BLIND hero leads. **Both eras render their full hero + pool
  statement + board identically** (the compressed "yellow box / mini-summary"
  was cut during review — mixed's blind hero matches building's exactly).
- **BLIND** kicker "Before you joined — our blind test". A **null-config** BLIND
  set appends "These videos were scored without a content category — category
  choice can shift a video's score." under its hero; a study-objective set gets
  no such sentence.
- **Pool statement** (both eras): "Prediction scores are percentiles among the
  last 1,000 videos we've scored." Under a hero it's the pool subline; for a
  JOINED era with no hero yet it's appended to the "Since you joined" sub.
- **Retirement:** JOINED graded n≥20 (`joinedRetirement`=20 in
  call_semantics.json) → the BLIND era stops rendering (data retained).
- JOINED cards carry a muted **outlined objective tag** after the percentile.
  Hero copy: "…never seeing a single like, share, or save." Section title:
  "Other Videos in That Timeframe." No-call cards use the full card width.
- **Welcome modal (Task 4):** copy unchanged. It says "we scored **a batch** of
  your videos" — there is no numeric N to source, so nothing keys off an era.

## 4. Fixture harness (Task 8) — see it before it's real

- **Endpoint:** `GET /api/track-record?fixture=<name>` returns the same payload
  shape, computed by the REAL `shapeEra`/tier/hero functions over in-memory rows.
  No DB reads, no writes, no scoring spend; one log line per request; unknown
  name falls through to normal behavior.
- **Frontend:** `?trdemo=<name>` renders the panel from that payload through the
  exact same components (no bypass), in a phone-width frame past the gate.
  Reachable on the deployed URL; no links point to it.
- The fixtures supply only realistic predictions + outcomes (varied captions,
  dates, objectives, percentiles); **k, calls, verdicts, group averages, hero
  form/ownership and retirement are all computed by the real logic.**

What the real logic computed for each of the 6 fixtures (verified via the live
endpoint):

| fixture | heroOwner | retired | JOINED | BLIND |
|---|---|---|---|---|
| blind-only | blind | — | empty | n=6 k=2 · 4/4 · averages-ratio 2.9× |
| building | blind | — | n=3 · **no calls** (plain list) | owns hero |
| handoff | **joined** | — | n=7 k=2 · 3/4 | full board |
| mixed | joined | — | n=9 k=3 · **4 of 6** (top-pick miss + weak miss) | full board |
| null-blind | blind | — | empty | **nullConfig — caveat shows** |
| retired | joined | **true** | n=21 k=4 · 8/8 | omitted (retired) |

**Josh reviewed all six on his phone and signed off**, after three revision
rounds folded in: app font on the demo frame, remove the "you previewed this"
badge (full-width no-call cards), era-specific pool statements, the overall
last-1,000 JOINED percentile fix, "like, share, or save," and cutting the yellow
box so the blind hero renders identically in every scenario.

The harness is retained as a permanent dev tool. **It holds no real data and
cannot write** (in-memory rows only; the endpoint never touches the DB on a
fixture request).

## 5. Research rider — uniform null-config rescores

The ingest endpoint's borrow-from-matched-preview objective path is removed:
**every posted-video rescore now runs objective-blind (null config)** unless an
explicit `--objective` is passed (which shapes the BLIND era of a prospect
ingest only). This keeps the C3 primary metric — within-user ranking of a
creator's own posted videos — under a single scoring regime
(`OBJECTIVE_CONDITIONING_DIAGNOSTIC.md`). Preview-vs-outcome stays the secondary
metric under user-chosen configs. **Census:** zero matched posted-video rescores
exist yet (all `match_tier` NULL), so no config mix and no already-mixed user
windows to flag — the change starts from a clean slate.

## 6. Verification

- **Unit** (`backend/test_track_record_v5.mjs`, all green): era separation +
  leakage, JOINED prediction identity (shapeEra never rewrites the preview
  score), per-era call floor, hero handoff at n=6, retirement at n=20,
  null-config gating, `rowEra` discriminator. Tests load the REAL functions from
  server.js (string/template-aware extraction — no re-implementation).
- **Live fixtures:** all 6 rendered on the deployed frontend at 390px, real
  logic confirmed (table above).
- **Real endpoint on live proxies:** jamieegabrielle → BLIND-only, study-config,
  **no** null sentence; ballerinafarm → BLIND-only, null-config, sentence shows.
  Both cleaned up (codes fresh, rows unclaimed).
- `node -c server.js` OK; `npm run build` OK.

## 7. Git / deploy state

App repo on `origin/main`: v5 landed across `a1128b1` (two-era model + fixtures),
`7fcef23` / `536e80c` / `8fd52aa` (review rounds), plus this commit (research
rider + tests + docs). Backend live on Render, frontend on Vercel. Docs: Ops §1
item 11 gained a **(Track Record v5)** block and the Phase-C bullet a **C3 hook +
rescore-regime** note; RECRUITMENT_RUNBOOK gained the "prospect `--objective`
shapes the BLIND era only" note. Exempt paths and keep-warm untouched.
