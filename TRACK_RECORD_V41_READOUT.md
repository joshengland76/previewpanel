# Track Record v4.1 — Readout

Tier table v3 (k=2/3/4, floor raised to 6), a rolling 40-video graded
window, an adaptive hero (Option A), verdict-side rounding, and one unified
three-section structure across both surfaces — with Section B removed so
`--study` renders for $0. App repo + shared `call_semantics.json` + PDF/
template + Ops/Runbook docs. Exempt paths untouched; keep-warm untouched.

## 1. Call tiers v3 + rolling window (`call_semantics.json` v3)

The shared module is now **v3**. `sizeTiers` raise the k table and the
floor; a new `gradedWindow` bounds the ranked set.

| graded-window size n | k (top & bottom each) | calls total 2k |
|---|---|---|
| n < 6 | **none** (floor raised from 4 → 6) | 0 |
| 6 – 8 | **2** | 4 |
| 9 – 11 | **3** | 6 |
| 12 – 40 | **4** | 8 |

`2k ≤ n` at every tier; groups never overlap. A **call** is the TOP k /
BOTTOM k of the creator's graded window, ranked by stored prediction DESC
(tie-break **posted_at DESC, id DESC**). The **graded window** is the
`gradedWindow` (40) most-recent graded videos by `posted_at`: it expands to
40 then **rolls** — older rows leave the display (`times_typical` stays
frozen; `call_type`/`verdict` re-rank live over the current window). At the
full window k=4/40 is the top/bottom **decile** — the study's own
top-vs-bottom construction. Applied in both the `server.js` grading pass and
the `/api/track-record` endpoint slice (and the PDF's Section A), so a
rolled-out row is never displayed or counted on either surface.

## 2. Adaptive hero — Option A, one decision, both surfaces

`call_semantics.json` also carries the shared impressiveness-tier
boundaries: **`callsTier`** by the hit fraction C_hits/2k (5⁄6 → 3, 2⁄3 → 2,
1⁄2 → 1) and **`averagesTier`** by the top-vs-bottom gap (0.5 → 3, 0.2 → 2,
0.0 → 1). The hero leads with whichever tier is higher (**tie → averages**).

- **Averages lead** → ratio form: `"Our top picks outperformed our bottom
  picks by R×."` (R = top_avg/bottom_avg, 1dp, capped `"10×+"`), with
  `"Called it: H of C"` folded into the body. Guard: needs ≥2 top and ≥2
  bottom AND bottom_avg > 0.1, else the pair form `"Top picks: X× · bottom
  picks: Y×."`
- **Calls lead** → `"We called it on H out of C."`, averages in the body.
- **Both tiers 0** → neutral `"Every call — hit and miss — below."`

The server computes `heroForm` + `averagesSubForm` from the shared tiers and
the frontend renders them; the PDF computes its own via `pick_hero_form`.
The send-check log prints the same decision, so the document and the log can
never describe two different sentences.

## 3. Verdict-side rounding

The ×typical label now always sits on the verdict's **own** side of 1.0:
round 1dp; if that shows `1.0` while the true value ≠ 1.0, escalate to 2dp;
if 2dp still shows `1.00`, force `0.99×`/`1.01×` toward the true side. Shared
by tab cards (`fmtTimesTypical`) and PDF (`fmt_result_x`), unit-tested on
0.996 → 0.99, 0.995 → 0.99, 1.004 → 1.01, exact 1.0 → 1.0.

## 4. PDF restructured to the tab structure; Section B removed

One structure, both surfaces: **hero → top performers (k) → bottom
performers (k) → other (remaining graded, no call)**. Each section keeps the
labeled PDF column conventions (OUR PREDICTION SCORE + call pill; color-coded
30-DAY RESULT; CALLED IT? with ✓/✗ or "no call"). **Section B was removed
entirely** — the on-record table, PREDICTED chips, check-in dates, and "your
strongest recent bet" card — kept only as a **dormant commented template
block** (`@@SECTIONS@@` placeholder + commented on-record strip in
`performance_preview_template.html`). Consequently **`--study` does no
Section-B fetching and renders for $0** end to end; `--prospect` ingest is
unchanged (fresh videos still fetched, surface once day-30 matures).

## 5. Migration + live verification (2026-07-19 → 07-20)

`call_type`/`verdict` are a denormalized cache the grading pass re-ranks on
every tab load, so the "migration" is automatic on load — no separate
script. All three boards recomputed under v3 tiers:

| board | surface | n | k | calls H/C | strong avg | weak avg | hero |
|---|---|---|---|---|---|---|---|
| ballerinafarm | live tab | 14 | 4 | 4 / 8 | 1.12× | 0.81× | averages · ratio **1.4×** |
| thecolorfulpantry | PDF | 10 | 3 | 4 / 6 | 1.62× | 0.78× | averages · ratio **2.1×** |
| jamieegabrielle | PDF | 13 | 4 | 8 / 8 | 1.58× | 0.58× | averages · ratio **2.7×** |

ballerinafarm re-ranked cleanly to 4 strong / 4 weak / 6 none; its hero
picks averages because the gap tier (2) outranks the calls tier (1, at
exactly 4/8 = ½). Both PDFs re-rendered at **$0**.

**Live tab walk** (proxy redeem of jamieegabrielle's study history, then full
restore + teardown): the tab rendered all three sections (Top 4 Predictions
4 / Bottom 4 Predictions 4 / OTHER 5), the averages-lead hero
("outperformed our bottom picks by 2.7×. Called it: 8 of 8", window
"Apr 6–Jun 2"), `Top 4`/`Bottom 4`/`no call` pills, 8 ✓ Called-it and 0
missed, verdict-side rounding (strong rows all >1.0, weak rows all <1.0), and
the untouched welcome modal ("we brought receipts…"). **Tab and PDF are
structurally identical.** *Caveat:* this Chrome instance ignored
`resize_window` (innerWidth pinned at 1440, screenshots returned blank), so
the phone-width check was done via the rendered DOM rather than a
phone-width screenshot — the layout is the same React tree at any width.

**Proxy teardown was exact:** the 20 pre-existing `prospect_report` NULL-user
rows were snapshotted before redeem and restored byte-for-byte (user_id NULL
+ original call_type/verdict, **0 mismatches / 20 rows**); the redemption,
proxy user row, and single-use invite code were deleted; browser localStorage
cleared and the proxy tab closed. DB is identical to its pre-walk state.

## 6. Tests, docs, git/deploy state

- `validation/test_generate_preview.py` rewritten for v4.1 — the k=2/3/4
  tiers, the raised floor (n<6 → none), `calls_tier` at 5⁄6·2⁄3·1⁄2, the new
  `fmt_result_x` edge cases, and the rank-dependence property (0.5 is a
  strong call in a 6-set, none in a 12-set). **All green.**
  `node -c server.js` OK; `npm run build` OK.
- **Docs:** Ops §1 item 11 gained a **(Track Record v4.1)** block; the
  RECRUITMENT_RUNBOOK gained the tier table, the "$0 / Section-B dormant"
  cost + workflow notes, the fresh-video note, the raised floor, and the
  v4.1 send-check + adaptive-hero wording.
- **Git/deploy state:** app repo committed at **`bd5f28a`** and pushed to
  `origin/main`; backend live on Render (`/version` → `bd5f28a`) and frontend
  auto-deployed on Vercel. Mac-side `generate_preview.py` /
  `performance_preview_template.html` / test file are updated locally (no
  deploy). Exempt paths and keep-warm untouched.
