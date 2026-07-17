# Preview Polish v4 Readout

Pill de-duplication, bet-card source, header branding, no-call cells. App
repo (template + generator) + research repo (Ops doc §1e one-liner).
**Hard constraint honored:** the TwelveLabs keep-warm/warm-up path was
not touched.

## Task 1 — row-pill de-duplication

`pill_text()` split into two: `pill_text` (unchanged full form, "Nth
percentile · scope") kept for the bet card's single, context-free
instance, and new `pill_text_short` ("Nth percentile", no suffix) for
every row pill in both tables — both share a new `_clamped_ordinal()`
helper (Polish v3's 1st–99th clamp, factored out rather than duplicated).
The comparison basis moved to a new "OUR SCORE" column subline, dynamic
per mode (`percentile among recent <objective> videos` /
`percentile among the last 1,000 videos we've scored`), substituted once
via `render_html` and applied to both table headers with a single
`.replace()` (the static template shows identical subline text in both
header cells, so one global replace catches both).

Gave the score `<td>` an explicit `class="score"` (both in the generator
and the static template's sample rows) and added `td.score{white-space:
nowrap}` — the pill + TOP/BOTTOM badge cluster can't wrap onto two lines
regardless of column-width pressure from other content. `ROW_A_RE`/
`ROW_B_RE` updated to match the new `class="score"` marker.

**Verified zero wrapping** at the explicit test case named in the prompt:
`thecolorfulpantry --objective "Food & Drinks/Cooking"` (21 characters,
the longest of the 19 canonical objective strings) — the column header's
own subline wraps to two lines as expected (it's prose, not a pill), but
every row's pill+badge cluster stayed on one line, visually confirmed at
full render resolution.

## Task 2 — bet card is Section-B only

New `bet_card_fields(section_b, mode, objective)`, a pure function
(unit-tested, not inline string-building) — picks the highest-scored
Section-B video only, `{"empty": True}` when Section B has none.
**Deliberately does not touch** the hero sentence's own best-bet-fallback
branch (Polish v3, still `section_a + section_b`) — different question
("what's still unproven" vs. "what scored best overall"), confirmed by
re-reading the prompt's own scoping ("BET CARD ="), not assumed.

Empty-state copy: exactly `"Nothing posted in the last 30 days — your
next video is your strongest bet. Run it first."`, with the pill `<span>`
and `.note` div both fully absent (not empty/hidden) from the rendered
markup, not just visually blank.

**Real behavior change, visually confirmed**: jamieegabrielle's bet card
now shows "Your life isn't stuck..." (Jun 30, 80th percentile) — a real
Section-B video — where the prior round's render showed "everyone's
dragging emma grede..." (99th percentile), which was actually a
**Section-A** video that only won on raw score. The card now answers "what
have I bet on that hasn't resulted yet," not "what's my best score ever."

```
$ ./_venv/bin/python3 test_generate_preview.py
All hero_contrast + mark_top_bottom_pills + bet_card_fields tests passed
(n=3,4,5,6,8 + no-result-rows case, all 4 tick branches at n=8,
bet card empty/non-empty branches).
```

## Task 3 — header branding swap

Supersedes Polish v3 Task 1's restructure outright (that round's
`.header-left` flex-column, kicker-above-the-rule design is gone, not
layered on top of). Logo now stands alone on the left, `height:70px`
(was 54px), `width:auto`. `PERFORMANCE PREVIEW` moved into `.who` as its
first child, right-aligned, same small-caps CSS as before (`font-size:
10px; letter-spacing:.22em; ...`), sitting above `.handle`. `header`'s
`align-items` changed `stretch` → `flex-start` — neither column needs to
match the other's height anymore (that was specifically a Polish v3
mechanism for the old space-between kicker placement, now moot).

Re-verified one-page fit at 8A+5B per the prompt's explicit instruction —
rendered `thecolorfulpantry --objective` (the known-tightest case from
prior rounds) immediately after this change, before touching anything
else: still 1 page, no new spacing adjustments needed this round.

## Task 4 — no-call cells

Middle (non-pill) Section-A rows: `mark_html` for `pill_tick is None` now
renders `<span class="no-call">no call</span>` (`font-size:8.5px;
font-style:italic; color:var(--muted)`) instead of an empty string.
Footer legend extended within budget: `"...above-/below-typical results;
middle rows: no call."` — same sentence, one clause appended, still one
line of the 3-line footer.

## Task 5 — re-rendered all three, verified

| Document | Pages | Send-check | New spend |
|---|---|---|---|
| jamieegabrielle --study --objective "Aesthetic/Vibes" | 1 | STRONG (top=1.36× bottom=0.64× gap=+0.71×) | $0 (`--reuse-section-b-hours 19`, same 5 rows as prior rounds, checked before running) |
| thecolorfulpantry --prospect --objective "Food & Drinks/Cooking" | 1 | INVERTED (top=1.24× bottom=1.26× gap=-0.02×) | $0 |
| thecolorfulpantry --prospect --overall | 1 | INVERTED (top=1.24× bottom=1.26× gap=-0.02×) | $0 |

All three confirmed visually (full-page 135dpi renders, not just
`pdf_page_count`): no pill wrapping anywhere (including the long-name
case), bet card sourced from Section B in every document (jamieegabrielle
and both thecolorfulpantry renders each show a real, distinct Section-B
video in the card, matching that document's own Section-B table row),
logo-left/kicker-right header layout, and "no call" italic text present
on every middle row (verified in all three — jamieegabrielle has 2, each
`thecolorfulpantry` render has 2).

## Task 6 — doc ticks

Checked `RECRUITMENT_RUNBOOK.md` for stale screenshot-affecting prose
(grepped for "divider," "kicker," "logo," the old pill format) —
**nothing found**. The runbook is commands/costs/objectives-focused and
never described the visual layout in enough detail to go stale from this
round's changes; no edit needed, confirmed rather than skipped silently.
Ops doc §1e one-liner added.

## Files changed

**App repo (`~/PreviewPanel`):**
- `Recruitment/performance_preview_template.html` — header HTML/CSS
  restructure, OUR SCORE subline (both tables), row pills shortened
  (sample data), `class="score"` + nowrap, no-call CSS + sample rows,
  footer legend.
- `validation/generate_preview.py` — `_clamped_ordinal`, `pill_text_short`,
  `bet_card_fields`, `score_section_a` signature simplified (mode/objective
  no longer needed), `row_a_html`/`row_b_html` `class="score"`, `ROW_A_RE`/
  `ROW_B_RE` updated, `render_html`'s bet-card + score-subline substitution.
- `validation/test_generate_preview.py` — `test_bet_card()` added.

**Research repo (`~/correlation-research`):**
- `PreviewPanel_Operations_and_Roadmap.md` — §1e Polish v4 one-liner.

## Git / deploy state

- Commit: `e6e1d4d`, on `origin/main`.
- Pushed: Y.
- Deployed — Render (backend): N/A, no `backend/` files changed this
  round (template + generator + docs only).
- Deployed — Vercel (frontend): N/A, no frontend files changed.

## STOP

Per the prompt's own instruction — no further work started after this
readout.
