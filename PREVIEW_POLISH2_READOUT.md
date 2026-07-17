# Preview Polish v2 Readout

Checkmark presentation, 8-row minimum, layout fit, stamp redesign, carried-over
fixes, on top of the prospect-report pipeline + generator (`PREVIEW_PIPELINE_
READOUT.md`). App repo (template) + research repo (Ops doc §1e). **Hard
constraint honored:** the TwelveLabs keep-warm/warm-up path was not touched.

## Task 1 — checkmark semantics made visual

Rule unchanged: (score in the shown set's top half) == (result ≥1.0×) —
self-relative, deliberately not pool-relative. Code comment added at the
tick-computation site in `score_section_a()` explaining why: a creator
whose whole catalog sits below the pool median would show an all-miss
column despite the model ranking their own videos perfectly against each
other; pool standing is what the percentile pill already says, this column
answers a different question.

Presentation: a hairline `<tr class="typical-divider">` row (centered,
letterspaced "— your typical —", 8.5px, muted) inserted after
`ceil(n/2)` real rows via a new `build_section_a_rows_html()` — the
template's own static sample divider is stripped first (`ROW_A_DIVIDER_RE`)
since its position is fixed for the 8-row sample but the real divider's
position depends on each creator's actual row count. Match column header
renamed "Called it?" (CSS `text-transform:uppercase` handles the caps).
✓ rendered large (14px, `--good`); a miss renders as a real ✗ (11px,
`--low`, 75% opacity) replacing the old near-invisible dash. Footer legend
rewritten within 3 lines: "✓/✗ = whether our higher-rated half matched an
above-typical result."

## Task 2 — Section A minimum of 8 rows

Removed the shrink-to-fit retry loop entirely (see Task 3) — `main()` now
renders once at a fixed target. `study_section_a`'s query already had no
day-count upper bound (verified, not just assumed); `prospect_section_a`
reads only `is_day30_equiv=true` rows, which `worker.py --prospect` only
ever writes within the phase5c 30–100-day license window
(`PROSPECT_AGED_MAX_DAYS=100`, already the existing constant, now
commented as the license boundary at both the `select_prospect_videos`
site and here). Both cap at exactly 8 via the existing
`size_section_a_window()`, and render fewer only when genuinely fewer
exist — `main()` prints a `NOTE` (not a warning) when that happens, never
pads or errors. `worker.py`'s `PROSPECT_MAX_AGED_DEFAULT` raised 12→14
(the Task 4 dress rehearsal's own observed ~1/8 failure rate was the
basis for that number, not a round guess). Header meta line's window
dates were already derived from the actual rendered rows' real
`posted_at` values, so "extending the lookback" falls out for free — no
separate window-stating logic needed.

## Task 3 — layout + one-page fit at 8A + 5B

First pass (logo 34px, handle 21px, header/hero margins tightened, table
font 10.5px) got jamieegabrielle's real 8A+5B render to 2 pages — footer
alone spilled over by roughly a centimeter. Second pass tightened
section-h margins (10px 0 5px → 7px 0 4px), td/th padding (5px/5.5px →
3.5px/4px), the divider row's own padding (3px → 1.5px), insight/pitch/
footer top-margins (8px/8px/7px → 5px/5px/5px), and the print-media
overrides (`.page` padding 8px→6px, `td` padding 4px→3px, `.hero` margin
9px→5px, `@page` margin 8mm→7mm) — all spacing, zero font-size changes
beyond what Task 3 itself specified. Re-rendered: **1 page**, verified via
PyMuPDF (`doc.page_count`, not `mdls` — see the prior readout's Bug #3).
`main()` now prints `NOTE: N pages -- ... shipping as-is` if a future
creator's data genuinely doesn't fit at 8A+5B; it no longer has any
mechanism to drop rows or shrink type in response.

## Task 4 — stamp redesign

Removed `.stamp` (`position:absolute; top:-14px; transform:rotate(6deg)`)
and its HTML entirely — confirmed via the prior readout that this exact
badge overlapped the "Day-30 check-in" header even in Josh's own
unmodified template. Replaced with `.chip-predicted`: a flat, inline,
gold-outline/gold-bg chip placed as the third child of the Section-B
`.section-h` flex row (kicker, rule-spacer, chip) — no `position:absolute`
anywhere, so no overlap is possible by construction, not just avoided by
tuning an offset. Gold border kept on the Section-B table
(`.onrecord table`). Text: "Predicted `<render date>` · before results
exist" (CSS uppercases it).

## Task 5 — hero-contrast guard + unit tests

`hero_contrast()` rewritten to return `{"k": 2|3, "top": mean, "bottom":
mean}` or `None`: n≥6 usable rows (a real `result_x`) → k=3; n∈{4,5} → k=2
(a k=3 read at n=5 would pull the middle-ranked row into both the top and
bottom set); n<4 → `None`. `render_html()` branches on this: `hero` truthy
→ the existing "N highest/lowest averaged X×/Y×" sentence with N
substituted; `hero` is `None` but a best bet exists → "Your strongest bet
so far: ..." framing instead; neither → the original "results still
pending" copy, unchanged.

New `validation/test_generate_preview.py` (no DB/network — pure function
over synthetic rows), covering exactly the prompt's list:

```
$ ./_venv/bin/python3 test_generate_preview.py
All hero_contrast tier tests passed (n=3,4,5,6,8 + no-result-rows case).
```

n=3→`None`, n=4→k=2, n=5→k=2, n=6→k=3, n=8→k=3 (with a value-sanity check
on the n=8 numbers), a no-overlap assertion at every tier, and a case
confirming rows with `result_x=None` don't count toward n at all.

## Task 6 — re-rendered both documents

**jamieegabrielle** (`--study --objective "Aesthetic/Vibes"
--reuse-section-b-hours 24`): confirmed the exact same 5 research_videos
candidates (by `source_url`, same order) and the exact same 5 existing
`shadow_scores` rows (ids 659–663, `source='link_fetch'`,
`objective='Aesthetic/Vibes'`) were still the only rows in a 24h window
before running — **zero new `/api/fetch-video` calls**, confirmed by the
run's own log (`reusing 5 existing Section-B row(s) -- $0 marginal API
cost`, no `live link-fetch:` lines). 8 Section-A rows (window extended to
May 1 – Jun 2, vs. the prior render's 5-row May 11 – Jun 2), divider
after row 4, "Called it?" column, flat chip, 21px handle, 34px logo — 1
page.

**thecolorfulpantry** (`--prospect`, both `--objective "Food &
Drinks/Cooking"` and `--overall`): zero API calls either mode (prospect
mode never calls the live endpoint at all — same $0-marginal-cost proof
as the original dress rehearsal, now also hitting the full 8-row target
instead of the old shrink-to-fit's 4). Real mix of ✓/✗ in the rendered
table (large green ticks, small rust misses), visually confirmed at 300dpi
crop. Both 1 page.

| Render | Section A | Section B | Pages | New API cost |
|---|---|---|---|---|
| jamieegabrielle --objective | 8 (extended to May 1) | 5 (reused) | 1 | $0 |
| thecolorfulpantry --objective | 8 | 5 | 1 | $0 |
| thecolorfulpantry --overall | 8 | 5 | 1 | $0 |

## Task 7 — readout annotation

Appended a labeled `CORRECTION` to `PREVIEW_PIPELINE_READOUT.md`'s
sanity-diff interpretation (not a silent rewrite — the original
interpretation stays, the correction follows it), per the exact text
supplied: dominant gap components are fresh-vs-stored measurement
(cross-referenced against `PHASEB4B_READOUT.md`'s C8 correction, which
independently found Spearman 0.634–0.811 for raw judge scores between a
fresh rescore and a stored score across two Pegasus eras — confirmed this
citation is real before using it, not taken on faith) and within-creator
spread compression at n=7, not primarily in-sample-vs-OOF; 0.536 sits
inside that same banked range; Task 4's own prospect-mode numbers are
unaffected (every one of them is a fresh live-path score, nothing
stored/OOF mixed in).

## Files changed

**App repo (`~/PreviewPanel`):**
- `Recruitment/performance_preview_template.html` — header/logo/handle
  sizing, td/th/divider/chip CSS, sample-row HTML (divider, Called-it
  column, ✓/✗), footer legend, print-media tightening.
- `validation/generate_preview.py` — `hero_contrast` tiered rewrite,
  `build_section_a_rows_html`, `row_a_html` miss styling, chip
  substitution in `render_html`, `main()`'s shrink-loop removed, Section-B
  reuse mechanism (`_recent_reused_section_b_rows`,
  `--reuse-section-b-hours`).
- `validation/worker.py` — `PROSPECT_MAX_AGED_DEFAULT` 12→14.
- `validation/test_generate_preview.py` — new.
- `PREVIEW_PIPELINE_READOUT.md` — Task 7's labeled correction appended.

**Research repo (`~/correlation-research`):**
- `PreviewPanel_Operations_and_Roadmap.md` — §1e Polish v2 ticks.

## Git / deploy state

- Commits: pending this readout's own commit — all Polish v2 changes are
  template/generator/worker-default/docs, no `server.js` changes this
  round, so nothing requires a Render deploy.
- Pushed: pending — will push immediately after this file is committed.
- Deployed — Render (backend): N/A, no backend files changed this
  session.
- Deployed — Vercel (frontend): N/A, no frontend files changed this
  session.
- Research repo (`~/correlation-research`): Ops doc §1e edit, committed
  alongside this readout's own commit sequence.

## STOP

Per the prompt's own instruction — no further work started after this
readout.
