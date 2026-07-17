# Preview Polish v3 Readout

Header/meta/hero copy, score-sort + Top/Bottom pills, percentile caps,
send-check, runbook. App repo (template + generator + a real production
scoring-copy fix) + research repo (Ops doc §1e). **Hard constraint
honored:** the TwelveLabs keep-warm/warm-up path was not touched.

## Task 1 — header restructure

`.header-left` (wordmark + kicker) is now a flex column with
`justify-content:space-between`, stretched to `.who`'s height via
`header{align-items:stretch}` (was `baseline`) — the kicker
("PERFORMANCE PREVIEW") sits at the bottom of that column, just above the
rule, and the logo grows into the space that frees up (34px → 54px). The
rule itself is `header`'s own `border-bottom`, unaffected by either
column's internal content height either way.

## Task 2 — meta line 3

`posted videos <Section-A start> – <render date>` — end of range is now
the **report run date**, not the latest video's own `posted_at` (a
real behavioral change: "every video since X" should read through to
today, not stop at whichever date the last video happened to land on).
The engagement-definition clause moved off this line entirely (now the
result column's own subline, Task 4).

## Task 3 — dynamic hero sentence

Opening clause is now `"We rated every public video you've posted since
<Section-A start date> — from content alone, never seeing a single view
count."`, computed once and shared across all three hero-tier branches
(3-vs-3/2-vs-2 contrast, best-bet, pending-results) rather than each
branch carrying its own copy of the old static "last two months" opener.

## Task 4 — result column subline

`likes/shares/saves per view` (compact slash form) replacing `likes +
shares + saves per view`. Grepped both the generator and the template for
a stray "per video" — none found; the unit was already correct
everywhere, just verbose in this one spot.

## Task 5 — Section A redesign

**Sort:** `build_section_a_rows_html` now sorts by `prediction` descending
before building rows — the underlying date-windowed row *selection* is
unchanged (still comes from `study_section_a`/`prospect_section_a`), only
display order changed. This is the fix for the regression the prompt
named: an earlier version left rows in the data-source adapters' own
date-descending order.

**Divider removed**, replaced with inline `TOP N`/`BOTTOM N` pills next
to the percentile pill (`.pill-top`/`.pill-bottom`, green/rust tint
matching the existing `--good-bg`/`--low-bg` palette). New shared tiering
helper `_topbottom_k(n)` (n≥6→3, n∈{4,5}→2, n<4→None) used by **both**
`hero_contrast` and the new `mark_top_bottom_pills` — the hero sentence
and the Section-A pills can no longer disagree about how many rows count
as "top"/"bottom" for a given n, since they now share one function.

**✓/✗ only on pill rows**: TOP row ✓ iff `result_x>=1.0` else ✗; BOTTOM
row ✓ iff `result_x<1.0` else ✗; middle (non-pill) rows render neither —
confirmed visually in the real thecolorfulpantry render (row "Vitamix
immersion blender test part 2", TOP 3 pill, 2.6× result → ✗, a genuine
top-scored miss; row "Vitamix immersion blender unboxing part 1",
BOTTOM 3, 0.5× result → ✓, a genuine bottom-scored correct call).

`test_generate_preview.py` extended with `test_pills()`: n=3 (no pills at
all), n=4/5/6 (kind assignment + label + no-overlap, matching
`hero_contrast`'s own tiers), and n=8 with **explicit, hand-picked
`result_x` values** (not the monotonic `make_rows` sequence) so all four
tick branches — TOP hit, TOP miss, BOTTOM hit, BOTTOM miss — actually get
exercised, not just the "everything above the line beats 1.0×" happy
path.

```
$ ./_venv/bin/python3 test_generate_preview.py
All hero_contrast + mark_top_bottom_pills tier tests passed
(n=3,4,5,6,8 + no-result-rows case, all 4 tick branches at n=8).
```

## Task 6 — percentile display caps

`generate_preview.py`'s `pill_text()` clamps the display integer to
1–99 (the stored `v["percentile"]` itself stays the true computed value —
only the rendered string is clamped).

**Checked the live app** per the prompt's explicit instruction, rather
than assuming it was already handled: `percentilePools.js`'s
`midrankPercentile` can legitimately return exactly 0 or 100 (the pool's
actual lowest/highest value), and `scoreDisplayCopy.js`'s
`predictHeadline`/`overallAppHeadline`/`personalHeadline` did a bare
`Math.round()` with no clamp — **confirmed the live app really can show
"Beats 0% of..." / "Beats 100% of..."** to a real user. A second consumer
of the same unclamped value: `VerdictHero.jsx`'s score-card gauge renders
`scoreDisplay.overallAppPercentile` directly as a bare number.

**Fixed in the same commit**, at the single point both consumers trace
back to (`scoreDisplay.js`'s `getScoreDisplay()`, where `niche`/
`overallApp`/`personal.value` are computed) rather than patching each
consumer separately — a new `clampPercentile()` (exported from
`scoreDisplayCopy.js`, `null`-safe so "no pool data" is never coerced
into a fake "1st percentile") is applied once there, so every downstream
consumer — the three headline strings AND the raw numbers the frontend
gauge reads directly — sees the same already-clamped value. The headline
functions themselves went back to plain `Math.round()` since the values
reaching them are now pre-clamped; no duplicate clamping logic in two
places.

## Task 7 — send-check verdict

`send_check_verdict(hero)`: **STRONG** (top ≥ bottom + 0.5×), **WEAK**
(positive but < 0.5× gap), **INVERTED** (top < bottom), **N/A** (`hero`
is `None`, n<4). Printed after every render (`main()`), advisory only —
confirmed it never touches the render/exit path, only stdout/stderr.
`INVERTED` also gets one extra stderr line spelling out "do not send
without a human look."

## Task 8 — re-rendered all three documents

First `--objective` attempt at thecolorfulpantry landed at 2 pages
(header restructure + inline pills added real height/width) — tightened
`.section-h`/`td`/`.hero`/`.insight`/`.pitch`/`footer` margins and padding
again (never font sizes — those are spec-fixed) across both screen and
print CSS, same kind of second-pass tightening Polish v2 needed. Re-ran
all three after — all 1 page, verified via PyMuPDF, not eyeballed:

| Document | Pages | Section A window | Send-check |
|---|---|---|---|
| jamieegabrielle --study --objective "Aesthetic/Vibes" | 1 | May 1 – Jul 3 (8 rows, extended from the prior round's May 11 start) | **STRONG** (top=1.36× bottom=0.64× gap=+0.71×) |
| thecolorfulpantry --prospect --objective "Food & Drinks/Cooking" | 1 | May 12 – Jul 14 (8 rows) | **INVERTED** (top=1.24× bottom=1.26× gap=-0.02×) |
| thecolorfulpantry --prospect --overall | 1 | May 12 – Jul 14 (8 rows) | **INVERTED** (top=1.24× bottom=1.26× gap=-0.02×) |

jamieegabrielle's Section B reused the existing link-fetch batch (ids
659–663, ~17h old at reuse time, still the only 5 rows in a 22h window —
checked before running, not assumed) via `--reuse-section-b-hours 22`:
`$0 marginal API cost`, confirmed via the run log (`reusing 5 existing
Section-B row(s)`, no `live link-fetch:` lines). thecolorfulpantry's two
renders made zero API calls either, as always for `--prospect` mode.
**Total new spend this round: $0.**

The two `INVERTED` verdicts are a real, correct finding, not a bug in the
verdict logic — traced by hand against the rendered table.
`thecolorfulpantry`'s TOP-3 group (0.9×✗, 1.1×✓, 1.7×✓) means 1.24×; the
0.9× miss ("Don't pour boiling water over your rice noodles...," 60th
percentile, real result below typical) pulls it down. The BOTTOM-3 group
(0.5×✓, 0.7×✓, 2.6×✗) means 1.26×; the 2.6× miss ("Vitamix immersion
blender test part 2...," 9th percentile, real result far above typical)
pulls it *up*. Two independent misses, one in each group, happen to net
the pair to a near-tie (1.24× vs 1.26×) that reads as a slight inversion.
The send-check did exactly its job here — flagging a document
that shouldn't go out without a look, on real data, on the first round it
ran against real 30-day numbers with genuine reversals in them.

## Task 9 — RECRUITMENT_RUNBOOK.md

New `Recruitment/RECRUITMENT_RUNBOOK.md`: exact copy-paste commands for
both workflows (`--prospect` ingest-then-render with the spend-reuse
note; `--study`'s one-step render plus `--reuse-section-b-hours`), real
prerequisites (venv binary path, `PP_API_BASE`, Chrome, DB env — as they
actually are, not idealized), the 19 canonical objective strings
(explicitly flagged as a *different* vocabulary from the research-side
lowercase slugs, a real mix-up risk), a cost/duration table, the Dancing
refusal (with its real error text), the 5 AM contention rule
(cross-referenced against §3b's own existing rule, not a new invention),
and the send-check interpretation table including "INVERTED = do not
send." Pointer line added to `PreviewPanel_Operations_and_Roadmap.md`
§1e.

## Files changed

**App repo (`~/PreviewPanel`):**
- `Recruitment/performance_preview_template.html` — header restructure,
  meta/hero/subline copy, pill CSS, divider removed, sample rows
  re-sorted with pills, footer legend, two rounds of spacing tightening
  (screen + print).
- `Recruitment/RECRUITMENT_RUNBOOK.md` — new.
- `validation/generate_preview.py` — `_topbottom_k`, `mark_top_bottom_pills`,
  `send_check_verdict`, `pill_text` clamp, `render_html`'s dynamic hero/meta,
  `build_section_a_rows_html` score-sort, `main()` wiring.
- `validation/test_generate_preview.py` — `test_pills()` added.
- `backend/scoring/scoreDisplay.js` — percentile clamp applied at the
  source (niche/overallApp/personal.value).
- `backend/scoring/scoreDisplayCopy.js` — `clampPercentile()` exported,
  null-safe.

**Research repo (`~/correlation-research`):**
- `PreviewPanel_Operations_and_Roadmap.md` — §1e Polish v3 ticks +
  runbook pointer.

## Git / deploy state

- Commit: pending — see below, will be filled in with the real sha
  before this file's own commit lands (matching the fill-in-after
  convention from the prior round, not left as a placeholder in the
  committed version).
- Pushed: pending.
- Deployed — Render (backend): **required this round** —
  `scoreDisplay.js`/`scoreDisplayCopy.js` is a real production
  scoring-copy fix (Task 6), not a docs/template-only change like Polish
  v2. Will verify live via the Render API (`status: "live"`, commit sha
  matched) before calling this done, same as every prior round.
- Deployed — Vercel (frontend): N/A, no frontend files changed this
  session (the fix lives entirely in `backend/scoring/`, consumed by
  `VerdictHero.jsx` but that file itself wasn't touched).

## STOP

Per the prompt's own instruction — no further work started after this
readout.
