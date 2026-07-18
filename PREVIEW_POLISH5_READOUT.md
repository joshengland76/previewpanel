# Preview Polish v5 Readout

Adaptive hero, verdict remap, header branding final. App repo (template +
generator) only — no research-repo edit besides the Ops and Roadmap §1e
one-liner. **Hard constraint honored:** the TwelveLabs keep-warm/warm-up
path was not touched.

## Task 1 — shared metrics, single source with pills

New `topbottom_metrics(section_a_scored)` replaces `hero_contrast`
outright — same tiering (`_topbottom_k`, same 2·k≤n no-overlap guarantee)
extended with the calls-record fields Polish v5 needs. Returns `k`,
`top_rows`/`bottom_rows`, `top_avg`, `bottom_avg`, `gap`, `calls_correct`,
`calls_total` (== 2k). `mark_top_bottom_pills` no longer re-sorts/
re-selects independently — it calls `topbottom_metrics` itself and reads
`top_rows`/`bottom_rows` straight off it, so the row pills and the hero/
verdict can never disagree about which rows are top/bottom or whether a
call was right.

## Task 2 — impressiveness tiers

`averages_tier(gap)`: ≥0.5→3, ≥0.2→2, ≥0.0→1, <0→0 (each threshold is its
bucket's inclusive lower bound — an exact boundary value always resolves
to the higher named tier, never ambiguous). `calls_tier(correct, total)`:
two scales by `calls_total` (6 → 6/5→3, 4→2, 3→1, ≤2→0; 4 → 4→3, 3→2,
2→1, ≤1→0).

```
$ ./_venv/bin/python3 test_generate_preview.py
All topbottom_metrics + mark_top_bottom_pills + bet_card_fields +
impressiveness-tier/tie-break tests passed (n=3,4,5,6,8 +
no-result-rows case, all 4 tick branches at n=8, bet card
empty/non-empty branches, averages/calls tier boundaries,
pick_hero_form tie-break, send_check_verdict remap).
```

New coverage: every named boundary value for both tier functions
(0.5/0.2/0.0 exactly, and calls_total=4-vs-6's full scale each), plus
`pick_hero_form`'s tie-break — equal non-zero tiers → averages; equal
**zero** tiers → neutral, NOT averages (confirms 0==0 doesn't fall into
the generic tie rule); one tier strictly higher → that form; `hero=None`
→ `best_bet`/`pending`. `send_check_verdict`'s STRONG/MIXED/DO NOT
SEND/N/A remap tested against all four max-tier cases plus the
hero-is-None path.

## Task 3 — adaptive hero sentence 2

New `pick_hero_form(hero, strongest)` is the single source deciding which
of five forms renders — used both inside `render_html` (to build the
sentence) and returned outward so `main()` can log it, so the document
and the console can never describe two different sentences.

- **averages** (current sentence, unchanged wording): `hero["top_avg"]`/
  `hero["bottom_avg"]` fields renamed from the old `hero_contrast`'s
  `top`/`bottom` — same values, same rendering.
- **calls** (new): `"We made calls on your N highest- and N lowest-rated
  — and got <b>C of 2N</b> right."` — green only when C/2N ≥ .67.
- **neutral** (new, both tiers 0): `"Every call — hit and miss — is in
  the table below."` No boast fabricated.
- `best_bet`/`pending` are the pre-existing n<4 branches, unchanged,
  just now named/routed through the same single decision point.

## Task 4 — send-check remap

`send_check_verdict` now takes `max(averages_tier(gap),
calls_tier(correct, total))`: **STRONG** at max tier 3, **MIXED** at 1–2,
**DO NOT SEND** at 0 (both signals), **N/A** when `hero` is `None`.
Console always prints both metrics AND the hero form:

```
[generate_preview] SEND-CHECK: MIXED (averages: top=1.24x bottom=1.26x
gap=-0.02x (tier 0) | calls: 4 of 6 (tier 2) | max_tier=2) -- hero
form: calls
```

`Recruitment/RECRUITMENT_RUNBOOK.md`'s send-check section rewritten for
the new three-verdict scale (STRONG/MIXED/DO NOT SEND, "MIXED = read the
doc before sending; DO NOT SEND is final"), plus a new "Reading the
adaptive hero" section documenting the five sentence forms.

## Task 5 — header branding final

`.wordmark img` grows 70px → 85px. New `.brand` flex group
(`align-items:center`) wraps the logo and `.doc-title` ("PERFORMANCE
PREVIEW") together — the row's height is set by the (taller) logo, so
centering a single line of small text against it lands it on the logo's
vertical midline by construction, no manual offset. `.doc-title` moved
out of `.who` entirely; `.who` is now handle+meta only. `header`'s own
`align-items:flex-start` (governing `.brand` vs `.who` against each
other) and everything below the header rule are untouched. Re-verified
one-page fit at 8A+5B immediately after the change (see Task 6) —
still 1 page.

## Task 6 — re-rendered all three, verified

| Document | Pages | Send-check | Hero form | New spend |
|---|---|---|---|---|
| jamieegabrielle --study --objective "Aesthetic/Vibes" | 1 | STRONG (top=1.36× bottom=0.64× gap=+0.71× tier 3 \| calls 6/6 tier 3) | averages | $0 (`--reuse-section-b-hours 72`, same 5 rows as Polish v4, checked before running) |
| thecolorfulpantry --prospect --objective "Food & Drinks/Cooking" | 1 | MIXED (gap=-0.02× tier 0 \| calls 4/6 tier 2) | calls | $0 (`--prospect` reads already-scored rows, no live fetch) |
| thecolorfulpantry --prospect --overall | 1 | MIXED (gap=-0.02× tier 0 \| calls 4/6 tier 2) | calls | $0 |

**Acceptance confirmed exactly as specified:** thecolorfulpantry's
objective render reads the calls form — *"We made calls on your 3
highest- and 3 lowest-rated — and got **4 of 6** right"* — verdict MIXED
("4 of 6" rendered in plain (non-green) bold: 4/6 = .667, just under the
.67 bar). jamieegabrielle is unchanged on the averages form, verdict
STRONG, and its gap/calls values (top=1.36×, bottom=0.64×, gap=+0.71×)
match Polish v4's render exactly (same reused Section-B batch, same
Section-A data).

All three visually confirmed at full-page render (not just
`pdf_page_count`): header shows the bigger logo with "PERFORMANCE
PREVIEW" beside it on the logo's midline, right block is handle+meta
only, no pill wrapping, one page each.

## Task 7 — doc ticks

Ops and Roadmap §1e Polish v5 one-liner added (research repo).
`RECRUITMENT_RUNBOOK.md`'s send-check section rewritten (Task 4, above).

## Files changed

**App repo (`~/PreviewPanel`):**
- `Recruitment/performance_preview_template.html` — header restructure
  (`.brand` group, logo 70→85px, `.doc-title` moved beside the logo,
  `.who` reduced to handle+meta).
- `validation/generate_preview.py` — `topbottom_metrics` (replaces
  `hero_contrast`), `AVG_TIER_STRONG_GAP`/`AVG_TIER_GOOD_GAP`,
  `averages_tier`, `calls_tier`, `pick_hero_form`, `send_check_verdict`
  remap, `mark_top_bottom_pills` now derives from `topbottom_metrics`,
  `render_html`'s hero-sentence branch rewritten + now returns
  `(html, hero_form)`, `main()` updated for the new return + console log.
- `validation/test_generate_preview.py` — import/field renames
  (`hero_contrast`→`topbottom_metrics`, `top`/`bottom`→`top_avg`/
  `bottom_avg`), new `test_impressiveness_tiers()`.
- `Recruitment/RECRUITMENT_RUNBOOK.md` — send-check section rewritten,
  new "Reading the adaptive hero" section.

**Research repo (`~/correlation-research`):**
- `PreviewPanel_Operations_and_Roadmap.md` — §1e Polish v5 one-liner.

## Git / deploy state

- Not yet committed — holding for explicit confirmation before
  commit/push, per this session's standing practice.
- Deployed — Render (backend): N/A, no `backend/` files changed this
  round (template + generator + docs only).
- Deployed — Vercel (frontend): N/A, no frontend files changed.

## STOP

Per the prompt's own instruction — no further work started after this
readout, pending commit/push confirmation.
