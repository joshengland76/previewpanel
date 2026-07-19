# Track Record v3 + unified call semantics + welcome modal + fixes — Readout

Dispatch: "Track Record v3 + unified call semantics + welcome modal + fixes."
App repo (`PreviewPanel`) + Recruitment template/generator edits +
research repo doc ticks (`PreviewPanel_Operations_and_Roadmap.md`).
Exempt paths (research_api, `/api/validation/ingest`, prospect worker
flow) untouched; keep-warm untouched.

## Task 1 — Unified call semantics

New file `backend/scoring/call_semantics.json` (`strongPercentile: 70`,
`weakPercentile: 30`) is the single physical source of truth, read
directly by:
- `backend/server.js` (`CALL_STRONG_PCTILE`/`CALL_WEAK_PCTILE` now
  loaded from this file, replacing hardcoded constants).
- `validation/generate_preview.py` (`call_type_for`, `mark_call_chips`
  replace the old rank-based `_topbottom_k`/`mark_top_bottom_pills`;
  `strong_weak_metrics` replaces `topbottom_metrics`, with no forced
  `2*k` split — `calls_total` is genuinely `len(strong)+len(weak)`,
  independent counts).
- `validation/sync_study_history.py` (same file, no hardcoded 70/30).

`calls_tier` generalized from two fixed lookup tables (valid only for
`calls_total ∈ {4,6}`) to a proportion-based scale (`ratio >= 0.8 → 3`,
`>= 0.65 → 2`, `>= 0.5 → 1`, else 0`) — chosen so the original 4/6 fixed
cases land on the identical tier. `averages_tier` is unchanged; only its
input changed (`strong_avg - weak_avg` instead of `top_avg - bottom_avg`).

**No historical regrade needed** — queried all 26 existing graded
`posted_videos` rows; `call_type` already matched
`overall_percentile_at_grading >= 70 ? strong : <= 30 ? weak : none`
with **zero mismatches**. The app's grading engine always used this
exact rule; only the PDF's rank-based system needed to change.

**One deliberate wording deviation from the literal prompt:** the
"calls form" hero sentence was NOT left byte-for-byte unchanged. The old
copy ("We made calls on your N highest- and N lowest-rated — and got C
of 2N right") assumes a fixed, symmetric N-and-N split, which is no
longer true once strong/weak counts are independent (e.g. 7 strong + 2
weak = 9, impossible under the old rank system). Kept it literally would
have produced factually wrong copy under the new semantics, so it now
reads "We made calls on your strong- and weak-scored videos — and got C
of N right." The decision logic (tier comparison, general two-part
structure) is unchanged; only the specific phrase implying a fixed split
was updated.

Test suite (`validation/test_generate_preview.py`) fully rewritten:
`test_call_type_for` (threshold boundaries incl. exact 70/30/None),
`test_call_chips` (all four tick branches + the same-percentile/
different-set-size invariant — the defining behavioral difference from
rank-based pills), `test_strong_weak_metrics` (≥2-of-each floor,
asymmetric counts, "none" rows never leak in, `result_x=None` never
counts), extended `calls_tier` coverage for asymmetric totals (5, 7, 9).
All pass: `./_venv/bin/python3 test_generate_preview.py`.

## Task 2 — Track Record hero v3

4-line structure in `TrackRecordPanel` (`frontend/src/PreviewPanel.jsx`):
line 1 the coverage-honest opening claim (always shown); line 2 the
strong/weak averages sentence with bolded green/rust numbers (gated on
≥2 strong AND ≥2 weak); line 3 "Called it: N of M" (gated on the
existing `aggregates`/`AGGREGATE_MIN` gate); line 4 the study-context
line. Below that gate, the pre-existing "Building your track record — N
calls" sub-threshold copy is preserved.

## Task 3 — Card redesign

New `TrCardLabel` (small-caps muted label) and `TrCardVerdictChip`
(colored pill: green "✓ Called it" / rust "✗ Missed" / italic "no call")
components. `TrackRecordGradedRow` rebuilt as a flex row: left side =
caption + "OUR SCORE" line (pill via new `trPillTextShort`, no "· all
videos" suffix + `TrackRecordCallChip` inline) + "30-DAY RESULT" line
(bold, ink-colored `B.black` — never gray) when a call was made; right
side = the verdict chip. `TrackRecordPendingRow` relabeled "OUR SCORE" +
gold "Day-30 check-in <date>" line. Legend line removed, replaced with
one subline under the section header: "Scores = percentile among the
last 1,000 videos we've scored · sorted by our score."

## Task 4 — Welcome modal

Replaces the old one-shot localStorage claim banner entirely (deleted:
`showClaimBanner`/`claimBannerCount` state, `TRACK_RECORD_BANNER_SEEN_KEY`,
the banner JSX, the `onBound` banner-trigger logic).

- **Backend:** `users.track_record_welcomed BOOLEAN DEFAULT false`
  migration; `GET /api/track-record` returns `welcomeSeen`; new
  `POST /api/track-record/welcome-seen { userId }` marks it seen.
- **Frontend:** new `TrackRecordWelcomeModal` component (title "Your
  track record is ready"; body states scored/graded counts; primary "See
  your track record" opens History on the Track Record segment; secondary
  "Run a video first" dismisses to the form). Visibility is derived:
  `trackRecordHasContent && trackRecordSummary?.welcomeSeen === false &&
  !welcomeModalDismissedLocally`. Both buttons call the welcome-seen
  endpoint before dismissing.

This is strictly more robust than the banner it replaces: the flag is
server-persisted and re-checked on every `/api/track-record` fetch, so a
missed first opportunity just means the next normal load shows it —
there's no single one-shot trigger to race.

## Task 5 — Header symmetry (required a real fix, not just a re-verify)

Static reading of the code (top:10px/right:0 vs top:10px/left:0,
identical box styling) suggested this was already correct from a prior
dispatch. **Measuring actual rendered widths proved otherwise:**
simulating the existing `@media (max-width: 400px)` compacted button
styles and computing real geometry at literal 375px/390px (this
environment's browser automation floors at ~500px CSS width — resize
requests below that render as 500px regardless of the requested value;
verified by reading `window.innerWidth` after each resize call) showed:

- The track-record badge case (inline flex sibling of the label) still
  overlapped the centered, never-shrunk logo by ~5–13px at 375–390px.
- The local-preview count text form ("History (24)") overlapped by
  ~35px — worse, since double-digit inline text runs wider still.

**Fix:** both count forms (local-history count and the track-record
unseen/graded badge) are now an absolute-positioned corner dot (the same
pattern the segmented Track-Record-tab badge already used), overlaying
the button's own padding box instead of widening it. Verified by
measurement post-fix: button width is now **identical regardless of
digit count** (70.26px whether showing "9" or "24"), giving positive
clearance at both 375px (+7.5px) and 390px (+15.0px) against the fixed
179.53px-wide logo. The logo itself was never touched, per the standing
"don't shrink the logo" constraint.

This shipped as its own follow-up commit (`9161f92`) after the
measurement caught the gap in what looked, on inspection alone, like
already-complete work.

## Task 6 — Scroll, attempt 3

New `scrollToTopRobust()` helper: fires `scrollTo(0,0)` synchronously,
again inside `requestAnimationFrame`, and again after a 150ms
`setTimeout` — replacing the single synchronous call in
`InviteGateScreen`'s `onBound` (the confirm→form transition). No
`autoFocus` attribute exists anywhere in the codebase (checked — none to
remove).

**Honest limitation:** this environment's browser automation cannot
reproduce iOS Safari's scroll-position restoration behavior (confirmed
in a prior dispatch — desktop-width emulation never triggers it). Final
verification of this fix can only happen on Josh's actual iPhone.

## Task 7 — Re-render + RECRUITMENT_RUNBOOK.md

Re-ran `generate_preview.py --study jamieegabrielle --overall` twice
($0 — Section B fully reused, `live-fetched: 0`). Also fixed two stale
spots the chip-rename missed on the first pass:
- The footer's "How to read this" paragraph still said "Top 3 / Bottom 3
  calls" (rank-based) — updated to "CALLED STRONG / CALLED WEAK calls."
  Added a snapshot-vs-ledger clarifying sentence: "This report is a
  snapshot as of the prepared date above — your live Track Record in the
  app keeps updating as more day-30 results land."
- A stale code comment referencing the retired `topbottom_metrics`
  function name (now `strong_weak_metrics`).

`RECRUITMENT_RUNBOOK.md`: updated the SEND-CHECK example and the
"Reading the adaptive hero" section to strong/weak vocabulary (removed
the "N-call board" fixed-size framing, now proportion-based). Added a
new "Which document is canonical: `--overall` vs `--objective`" section:
`--overall` is canonical (matches the in-app Track Record's exact
comparison basis, no tier gate); `--objective` is an optional niche-pure
supplement sent alongside, never instead, with the different-comparison-
pool caveat spelled out.

## Task 8 — Live verification, cleanup, docs

**Deploy:** committed/pushed in two commits — `355ea28` (Tasks 1–4, 6, 7)
and `9161f92` (Task 5's real fix, found during live verification). Render
backend confirmed live on `355ea28` before verification began, then on
`9161f92` was frontend-only (Vercel auto-deploy, confirmed via measurement
after redeploy — no Render restart needed).

**Proxy verification (jamieegabrielle, fresh code `DJW66MV2`):**
- Found and cleaned up a **leftover "Josh demo" proxy identity**
  (code `7RJNVJCU`, minted 2026-07-18, never torn down after an earlier
  dispatch's own live verification) that was silently occupying all 20
  of jamieegabrielle's `posted_videos` rows, which is why my fresh
  redemption initially found `state: "no_posts_yet"`. Un-claimed those
  rows, re-claimed them under the new fresh session (mirroring the exact
  `UPDATE posted_videos SET user_id=$1 WHERE handle=$2 AND user_id IS
  NULL` the server itself runs at confirm-time), and deleted the old
  leftover's redemption/user/invite_codes rows as part of this
  dispatch's cleanup.
- Welcome modal, primary path ("See your track record"): confirmed —
  correct scored/graded counts, opens History directly on Track Record.
- Hero: 4-line structure rendered exactly as specified, "Called it: 9 of
  9", bolded green/rust strong/weak averages.
- Cards: "OUR SCORE"/"30-DAY RESULT" labels, no-suffix pills, inline
  CALLED STRONG/WEAK chips, bold ink-colored result values, right-aligned
  "✓ Called it" verdict chips, "no call" rows correctly omitting the
  result line, pending row gold "Day-30 check-in" line.
- Subline under section header present, legend line gone.

**Regression check (thecolorfulpantry, fresh code `XUGMK3P3`,
`--no-sync` since rows already existed):** confirmed the "✗ Missed" chip
renders correctly (rust pill) on a genuinely mixed record (4 hit / 4
miss / 5 no_call / 8 ungraded).

**Header symmetry:** re-verified post-Task-5-fix by measurement (see
Task 5 above) — clears at both 375px and 390px now.

**Activity telemetry:** confirmed `session_open` and `track_record_view`
events logged to `user_events` for both proxy sessions during
verification.

**Cleanup (hardened explicit-id convention — captured id lists before
any write, never an attribute filter):** un-claimed 20
(jamieegabrielle) + 21 (thecolorfulpantry) `posted_videos` rows back to
`user_id = NULL`; deleted both redemptions, both `users` rows, and both
`invite_codes` rows (`DJW66MV2`, `XUGMK3P3`) — including the leftover
`7RJNVJCU` found along the way. Final state confirmed: zero `users` rows
for either handle, zero matching `invite_codes`, all `posted_videos`
rows unclaimed (`claimed: 0` for both).

## Ops and Roadmap tick

`PreviewPanel_Operations_and_Roadmap.md` §1a extended with a **(Track
Record v3)** paragraph after the `TRACK_RECORD_V2_READOUT.md` reference:
unified call semantics module, zero-mismatch historical verification,
hero v3, card redesign, welcome modal (server-persisted, self-healing),
and `--overall` as the canonical invitee document.

## Git / deploy state

- **App repo (`PreviewPanel`):** `355ea28` (Tasks 1–4, 6, 7), `9161f92`
  (Task 5 real fix), `d917302` (this readout). All pushed to
  `origin/main`. Render backend confirmed live on `355ea28` (`/version`
  sha match) before verification; `9161f92` is frontend-only, confirmed
  live via post-deploy measurement (Vercel auto-deploy, no Render
  restart).
- **Research repo (`correlation-research`):** `71cadb1` — only
  `PreviewPanel_Operations_and_Roadmap.md` touched and committed; the
  repo has many unrelated untracked research files from other in-flight
  work that this dispatch does not touch. Pushed to `origin/main`.

## STOP

Per the dispatch's own final instruction.
