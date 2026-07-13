# Readout-Screen Polish — Readout

App repo only, frontend + job metadata. `keep-warm` untouched.

## 1. Link-run display name

`source_url` is now stored in job/submission metadata for `link_fetch` runs:
`server.js`'s `POST /api/fetch-video` sets `sourceUrl: parsed.href` and
`linkDisplayUrl: cleanDisplayUrl(parsed.href)` on the job object;
`cleanDisplayUrl()` strips query/tracking params (`${hostname}${pathname}`,
trailing slash trimmed) and middle-truncates past 46 chars. `/api/status`
returns both fields every poll tick.

Frontend: the readout header's file-name slot renders a tappable `<a>`
(`href` = the original, uncleaned URL, so tapping opens the real post) showing
the cleaned string for link runs, and the original plain file-name `<div>` for
uploads — same slot, conditional on `linkDisplayUrl`. History entries use the
same cleaned string via `saveToHistory`'s `fileName` field.

**Bug found and fixed during live verification**: the first live link run
(TikTok, no objective) showed the cleaned URL correctly in the readout header
— but the saved History entry showed the literal string `"video"` instead.
Root cause: `saveToHistory`'s entry was built inside the polling `useEffect`'s
`poll()` closure, reading the `linkDisplayUrl`/`linkSourceUrl` **React state**
variables. That closure is created once when the effect starts (immediately
after job creation, before any poll tick has run), and never recreated on
later renders — so by the time the job finishes and `saveToHistory` runs, the
closure's local bindings for those two variables are still their day-one
value (`null`), even though the state itself had been updated correctly many
times over via `setLinkDisplayUrl`/`setLinkSourceUrl` (which is why the header
render — reading current state fresh on every render — was already correct).
Fixed by reading `data.linkDisplayUrl`/`data.sourceUrl` directly off the poll
response instead of the stale closure variables (`PreviewPanel.jsx`, commit
`086af98`). Re-verified live with a second link run after the fix deployed:
History now correctly shows `www.tiktok.com/@amymac…eo/7281263458203618606`.

## 2. Upload-box default

`showLinkInput`/`videoLinkUrl`/`linkFetchError` are reset in three places:
`reset()` (fires on every run completion, both success and error paths),
`restoreFromHistory()` (history entries always land on the file-picker view),
and the state is simply never set on fresh mount (default `false`). Verified
live: after a completed link run, "New Video" always returns to the dashed
file-picker box, never the link-input box, regardless of which mode the prior
run used.

## 3. Chip-row spacing

`DetectedSignals.jsx`'s wrapper div: removed `borderTop`/`paddingTop` (the
divider above "Other positive signals"), reduced `marginTop` 14→6 (tightens
radar-to-chips gap), added `marginBottom: 10` (the chip-to-"tap a judge" gap —
this margin is a no-op when the component renders `null`, so the "with vs.
without a negative row" cases both look correct without any conditional
logic). Verified via the dev harness (temp fixture with all six positive +
two negative signals forced on, then again with only positives): no divider
either way, consistent spacing above and below, layout collapses cleanly with
no residual gap when the negative row is absent.

## 4. Objective-fit vertex skip

`skipObjectiveFit = !OBJECTIVE_OPTIONS.includes(objective)`, computed in
`PreviewPanel.jsx` (covers blank and free-typed/custom objectives alike,
using the same 19-item canonical list the objective picker already enforces)
and passed to both `<PerformanceRadar>` call sites.

In `PerformanceRadar.jsx`: the `axes` array stays all 8 entries (angles are a
pure function of fixed index `i` and `axes.length`, both unchanged) —
`activeIndices` excludes the Objective Fit index when skipping. `polyPoints`,
the avg-view per-vertex dot circles, and `computeLabelPlacements` (whose
internal chord-spacing math now correctly divides by 7 rather than 8 when
skipping, so label-collision detection among the 7 *actually plotted* labels
stays accurate) all iterate `activeIndices` instead of the full 8. The spoke
line + axis label for Objective Fit render at `opacity: 0.4` when skipped,
with an SVG `<title>` on the group giving the hover tooltip: "Select a content
category to have the panel score objective fit." The same override replaces
`DIMENSION_INFO.objective_fit`'s normal descriptive text in the "What do
these signals mean?" panel when skipped. No angle recomputation anywhere —
removing one index from the point list just draws a straight chord between
its two neighbors, which is why the "no distortion of neighboring angles"
requirement holds by construction rather than by extra logic.

Verified via the dev harness on the real Full/crookie fixture, toggling a
`skipObjectiveFit` prop live: skipped view shows Funny→Trend Align as a direct
line (no vertex, no numeric label, no dot) with Objective Fit's spoke/label
visibly muted; both the bold avg polygon and the isolated-judge ghost line
skip identically. Re-confirmed against production: a restored canonical-
objective history entry ("Food & Drinks/Cooking") renders Objective Fit fully
normal (8.0, unmuted, connected both sides); the two live no-objective link
runs (below) both show it muted/skipped.

## 5. Live verification

Commits: `3554a0f` (all four items), `086af98` (stale-closure fix, found
during this verification pass).

**(a) Link run** — real short TikTok video, no objective selected, submitted
via `POST /api/fetch-video` on production
(`https://previewpanel.vercel.app/`). Result: header shows
`www.tiktok.com/@amymac…eo/7281263458203618606` as a tappable link (href
resolves to the original, uncleaned URL — confirmed via `read_page`); History
entry after the fix shows the same cleaned string (first attempt, pre-fix,
showed the literal `"video"` — see bug above); "New Video" afterward returns
to the default file-picker box.

**(b) No-objective run** — the same link run above (no objective selected):
Scorecard renders 7 plotted vertices, Objective Fit's spoke/label visibly
muted (~40% opacity), chord runs straight from Funny to Trend Align with no
distortion of the neighboring spokes, "What do these signals mean?" panel
shows the override tooltip for Objective Fit.

**(c) Canonical-objective file run** — re-opened an existing History entry
("Food & Drinks/Cooking" objective, file upload, real crookie-hunt video,
pre-dating this change) against the newly-deployed code: Objective Fit
renders fully normal (numeric label 8.0, full color, connected on both
sides) — confirms canonical-objective submissions are unaffected by the skip
logic. (A live end-to-end file-upload submission could not be exercised in
this pass — browser automation's file-upload tool rejected local filesystem
paths in this environment; the existing-entry re-render against the deployed
bundle is an equivalent check of the render path itself, which is the only
code this prompt touches for file runs.)

**(d) Chip-row spacing** — confirmed both with and without a negative row via
the dev harness (item 3 above): no divider, tightened radar gap, consistent
gap before "tap a judge to isolate" in both cases.

## Files changed

`backend/server.js` (`cleanDisplayUrl`, job/response fields for
`sourceUrl`/`linkDisplayUrl`), `frontend/src/PreviewPanel.jsx` (reset/restore
state, polling handler, `saveToHistory`, render-slot link, `skipObjectiveFit`
prop, and the stale-closure fix), `frontend/src/components/PerformanceRadar.jsx`
(vertex-skip logic), `frontend/src/components/DetectedSignals.jsx` (spacing).

Research repo: `PreviewPanel_Operations_and_Roadmap.md` §1a ticked (commit
`2cc90b9`).

## Verification summary

- `node scoring/scoreDisplayTest.mjs`, `percentilePoolsTest.mjs`,
  `axisPoolsTest.mjs`: all PASS (unaffected by this frontend-only change, run
  anyway per convention).
- `node --check server.js`: clean, every commit.
- `npx vite build`: clean, every commit.
- Dev-harness visual checks (screenshots, reverted before commit): objective-
  fit skip on both 8-vertex and 7-vertex cases, chip-row spacing with and
  without a negative row.
- Live production verification: two real link-fetch runs (one pre-fix
  showing the bug, one post-fix confirming the resolution), one restored
  canonical-objective history entry, upload-box reset confirmed after a
  completed run.

## STOP

Per the prompt's explicit instruction — no further work started after this
readout.
