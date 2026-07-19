# Track Record v4 — Readout

Rank-based call semantics across both surfaces, a three-section tab
restructure, welcome modal v3 (with a timing fix), and PDF alignment. App
repo + PDF/template + Ops doc. Exempt paths untouched; keep-warm untouched.

## 1. Call semantics v2 — RANK, one shared module

`backend/scoring/call_semantics.json` is now v2: it holds **`sizeTiers`**
(the `_topbottom_k` boundaries) instead of the retired 70/30 percentile
threshold. **Exact boundaries (reported per the prompt):**

| graded-window size n | k (top & bottom each) |
|---|---|
| n ≥ 6 | **3** |
| n ∈ {4, 5} | **2** |
| n < 4 | **none** (no calls — not enough spread) |

`2k ≤ n` at every tier, so the top and bottom groups never overlap. A
**call** is the TOP k / BOTTOM k of the creator's graded window, ranked by
stored prediction DESC with a deterministic tie-break (**posted_at DESC,
then id DESC**). TOP-k rows are `strong` calls, BOTTOM-k `weak`, the rest
`none`. Verdict from the frozen result: a strong call hits iff
`times_typical ≥ 1.0`, a weak call hits iff `< 1.0`.

Both surfaces read the same file: `server.js` (`topBottomK`,
`assignRankCalls`) and `generate_preview.py` (`_topbottom_k`,
`mark_call_chips`). The test suite was rewritten for rank semantics — it now
proves the DEFINING property (the opposite of v3's): a row's call **depends
on the set it's ranked in** (weak in a 6-set, none in an 8-set). All tests
pass.

**Freeze-rule consequence (documented deviation from a literal per-row
freeze):** a call is a rank over the whole set, so it is *not* a frozen
per-row property. What freezes is the **RESULT** — `times_typical` (the
×typical 30-day outcome, computed once against the creator median at first
grading) and the pill percentile. `call_type`/`verdict` became a
denormalized cache the grading pass **re-ranks over the window on each tab
load** (`gradeTrackRecordForUser`: step 1 freezes the result, step 2
re-ranks). This is what keeps the tab's three sections and the "N of M" hero
internally consistent and identical to the PDF's Section A as the window
grows. `sync_study_history.py` no longer pre-computes `call_type` (rank
can't be decided per-row at sync — only the pill percentile is written).

**One-time semantics migration (2026-07-19):** re-graded every existing
graded row under the rank rule. **1 user (the single pre-launch proxy),
14 graded rows, k=3, 7 of 14 reclassified** from the old threshold values.
No real users had seen tabs. Idempotent (re-running yields the same rank the
deployed grading pass now computes on tab load).

## 2. Welcome modal v3

**Timing (2a):** the modal now renders **the instant identity is confirmed,
with no form flash.** Cause of the old flash: the modal's visibility was
derived from the `trackRecordSummary` fetch, which resolves *after* the gate
closes and the form mounts — so the form painted first. Fix: the
`/api/invite/redeem` response now returns a **`welcomeNeeded`** flag (true
when the claim gave the user ≥1 posted video and they're not yet welcomed),
and `onBound` sets `welcomeForced` synchronously on the same tick the gate
closes. The reactive summary-based condition remains as the fallback for
other paths. **Verified live on two creators** — the modal appeared
immediately after "That's me" both times, no form frame in between.

**Copy (2b):** exact v3 copy shipped — title "Know before you post.", the
full body paragraph (ending "…we brought receipts."), primary filled
button **"Run a video"** (+ subtext) → dismiss to form, secondary bordered
button **"See how our predictions did on your videos"** (+ subtext) → open
the tab. One-time server-side persistence (`users.track_record_welcomed`)
unchanged.

## 3. Track Record restructure

**Hero (3a)** — verified with REAL dynamic values (not the example
numbers):
- ballerinafarm: **"We called it on 2 out of 6."** · window **May 1–Jun
  19** · strongest averaged **1.1×** (green) / weakest **0.9×** (rust).
- thecolorfulpantry: **"We called it on 4 out of 6."** · window **Apr 7–Jun
  16** · **1.3×** / **0.7×**.

Line 1 (the stat) stands out (20px, bold). Line 2 = window + strongest/
weakest averages with green/rust number coloring. The 2-of-3 study claim
moved OUT of the hero (the welcome modal carries it now).

**Sections (3b):** three sections, each score-descending —
**VIDEOS WE PREDICTED AS TOP PERFORMERS** (top-k, green header) →
**VIDEOS WE PREDICTED AS BOTTOM PERFORMERS** (bottom-k, rust header) →
**OTHER VIDEOS IN THAT TIMEFRAME** (the rest, minimal italic "no call"
cards). The **ON THE RECORD / pending section is removed entirely** —
pending/no-outcome rows render nowhere (collector + grading unchanged;
display only). The commented-out vestige line is present but OFF.

**Cards (3c):** caption snippet with the short date appended ("… · Jun
10"); "OUR PREDICTION SCORE" label over the percentile pill + CALLED
STRONG/WEAK chip on the same line; "30-DAY RESULT (LIKES/SHARES/SAVES PER
VIEW)" label over the multiplier, **color-coded** (green ≥ 1.0×, rust <
1.0×, bold); verdict chip unchanged (✓ Called it / ✗ Missed). No-call rows
show only caption + date + italic "no call". **The thecolorfulpantry
regression confirmed ✗ Missed renders correctly** (rust chip) on a mixed
record — e.g. an 84th-percentile CALLED STRONG video whose real result was
0.61× → ✗ Missed.

*Known display edge case (noted, not fixed):* a called row whose true
`times_typical` is just under 1.0 (e.g. 0.996) shows "1.00×" after 2-decimal
rounding while its color/verdict correctly use the true value (rust, ✗). The
verdict logic is right; only the rounded label looks borderline.

## 4. PDF alignment

Section A markers are back to **TOP N / BOTTOM N pills** (existing
green/rust tints) — these ARE the calls; ✓/✗ only on pill rows. Hero
sentence 2 aligned to the app wording ("The videos we predicted would be
strongest averaged X× … Those we predicted would be weakest averaged Y×");
adaptive tiering (averages vs calls form) computes over the rank groups;
footer legend updated. **Re-rendered `jamieegabrielle --study --overall`**
(Section B reused, ~$0): 8 Section-A rows → k=3 → **3 TOP 3 + 3 BOTTOM 3
pills**, hero "strongest averaged 1.4× … weakest averaged 0.6×". Doc and tab
now tell one rank story (the tab labels the same calls CALLED STRONG/WEAK;
the PDF labels them TOP/BOTTOM — same underlying rank, per spec).

## 5. Live verification (ballerinafarm + thecolorfulpantry proxies)

- Modal v3 appeared **instantly** post-confirm on both, exact copy.
- Tab showed the three sections with each creator's **real** hero stat,
  window, and averages (reported above).
- Cards matched 3c; no pending section; ✗ Missed rendered correctly on
  thecolorfulpantry's mixed record.
- Activity telemetry still logging (`session_open`, `track_record_view`
  observed during the walk).
- **Full cleanup (hardened explicit-id convention):** un-claimed 18
  (ballerinafarm) + 21 (thecolorfulpantry) posted_videos back to
  `user_id=NULL`; deleted both proxy users, both redemptions, and codes
  `JQNJJYTJ`/`J69DY8VH` (plus the leftover `NRBAQNQS` proxy found holding
  ballerinafarm's rows). Final state verified: **0 proxy users, 0 claimed
  rows, 0 codes.** Throwaway browser session cleared. Migration scratch
  script deleted.

## 6. Docs

- **Ops §1a** gained a **(Track Record v4)** paragraph: rank semantics v2 +
  the freeze-rule change + the dated migration note; the tab is the overall
  (last-1,000) percentile basis, labeled, with the niche-pool toggle
  deliberately not built (niche percentiles live in the `--objective`
  supplement PDF).
- **`RECRUITMENT_RUNBOOK.md`** send-check / adaptive-hero section updated to
  rank-group wording (TOP k / BOTTOM k, "predicted would be strongest/
  weakest").

## Git / deploy state

- **App repo (`PreviewPanel`):** `9ba1f36` (v4 code: call_semantics.json,
  server.js, generate_preview.py, sync_study_history.py, test suite, PDF
  template, RUNBOOK, frontend) + this readout. Render backend confirmed live
  on `9ba1f36`; Vercel frontend confirmed live (modal v3 copy present). The
  one-time rank migration ran against prod post-deploy.
- **Research repo (`correlation-research`):** `f4cda8b` (Ops §1a v4).

## STOP
Per the dispatch's final instruction.
