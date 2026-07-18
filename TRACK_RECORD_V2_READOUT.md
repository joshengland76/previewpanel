# Track Record v2 Readout — internal identities, real scroll-to-top, PDF-mirrored TR, telemetry

App repo (+ research DB read for the caption backfill). **Hard
constraints honored:** keep-warm not touched. Exempt paths (research_api,
`/api/validation/ingest`, prospect worker) stay completely exempt —
grep-reconfirmed unchanged (2 `checkBetaGate`/`recordBetaSubmissionEvent`
call sites, `/api/analyze` and `/api/fetch-video`).

## Task 0 — Internal identities

`invite_codes.is_internal` / `users.is_internal` (nullable, default
false). `beta_admin.py mint --internal` sets the code flag; redeeming an
internal code (any code, pre-linked or not) upserts `users.is_internal =
true` for that `user_id`, regardless of claim status. `recordShadowScore`
(shadowScore.js) gained an `isInternal` param — `poolEligible = !fpGroup
&& !isInternal` — checked via one cheap `users` lookup per scoring pass
in `runShadowScoringForJob`. This closes the founder/team pool-pollution
class **structurally, at write time**, not as a one-time cleanup.

**Retro-flag:** found Josh's own real usage — invite code `3493GV8F`
("Josh demo"), redeemed by `user_id=f242fca0-c615-4cfb-a969-40f5cde23a4f`,
claiming 18 `jamieegabrielle` rows (5 `prospect_report` + 13
`study_history`). Flagged `is_internal=true` on both the code and the
user row. **Not retro-flagged:** any existing `shadow_scores` rows for
this identity — verified there are none (0 `shadow_scores` rows for this
`user_id` at flag time), so the "don't retro-flag rows already
pool-backfilled false by the epoch" caveat doesn't apply here — nothing
existed to consider either way. His `posted_videos` claim was left
completely untouched (not un-claimed) — this is real, durable usage, not
a test artifact.

## Task 1 — Scroll-to-top, for real

**Actual root cause, stated plainly:** iOS Safari's own scroll-position
restoration (on load and back-forward-cache restores) re-applies
whatever `scrollY` the page had at a *previous* visit, and does so
*after* React has already mounted and run its own effects — a single
`window.scrollTo(0,0)` fired once at gate-close time could still get
overwritten by Safari's own restoration landing slightly later. This is
Safari-specific behavior, not a function of viewport width, which is why
desktop Chrome at a narrow viewport (the prior verification method)
never reproduced it.

Fix: `history.scrollRestoration = "manual"` set once at app mount (opts
out of the browser's own restoration entirely) plus explicit
`window.scrollTo(0, 0)` at every real screen transition: app mount,
post-gate/post-confirm (both funnel through the same `onBound` callback,
already covered by one call site), and History open/close (a single
`useEffect` watching `showHistory`, covering every call site that
toggles it — the main button, the claim banner's "View it", the panel's
own close button — rather than adding a `scrollTo` at each one
individually, so a future new call site can't be missed).

**Audit for autofocus/anchors:** grepped for `.focus()`/`href="#`/
`scrollIntoView`. Found three `.focus()` calls, all explicit-user-action-
only (a "paste a link" reveal, an objective-field click, and the
Objective Guard modal's own 50ms-delayed focus, which only opens on an
explicit Submit click with an empty objective) — none fire automatically
on load or gate-close, so none are implicated in the reported bug.

## Task 2 — Header collision

**Fixed on the button side only, logo left untouched** (per explicit
direction mid-dispatch — an earlier draft of this fix also shrank the
logo at narrow widths as a "belt-and-suspenders" measure; reverted).
Two changes: (a) the graded-count suffix went from inline text
("· 9 graded") to a compact numeric badge — already a large reduction on
its own; (b) a `max-width: 400px` media query further compacts both
header buttons' font-size/padding for real margin, not a near-miss.
Measured (real DOM, this session): the History button (with a 2-digit
badge) renders **~99px** at default styles; the logo's own real ~1.83:1
aspect ratio (measured from the rendered image) leaves **~98px** of
clearance on each side of a 375px viewport with the logo at its normal,
untouched size — razor-thin without the button-side compaction, which is
exactly why it's there.

**Verified at 375/390px:** the browser automation tool's window resize
has a hard floor around 500px CSS pixels in this environment — every
resize attempt below that (375, 390) reported back as 500 via
`window.innerWidth`, so a literal rendered screenshot at those exact
widths wasn't obtainable. Verification instead used real measured
element widths (above) combined with the logo's actual aspect ratio to
confirm the arithmetic holds at 375/390px specifically, rather than a
visual screenshot at that literal size. Stated plainly, not glossed
over: this is a measurement-based verification, not a pixel screenshot
at the target width.

## Task 3 — Track Record v2

### (a) Data: caption + posted_at coverage

Audited before changing anything: **prospect rows already had 100%
caption coverage** (57/57 non-null) — `worker.py`'s `fetch_caption()` +
`/api/validation/ingest`'s `caption` column write have covered this
since Chips v2; nothing to backfill there. **`posted_at`:** only 3 rows
system-wide had a null value, all fake structural-verification artifacts
from earlier dispatches (`beta_verify_test_handle*`, ids 87/89/106) —
deleted (+ their 3 linked `shadow_scores` rows) rather than backfilled,
since they were never real data. `posted_at` is now 100% populated.

**The real gap: `sync_study_history.py`'s own synthesized rows never
captured caption.** Fixed: the script now selects `research_videos.
caption`, writes it on new rows, and one-time-backfills existing
`study_history` rows missing it (scoped per-handle, idempotent — a row
that already has a caption is untouched). Ran for `jamieegabrielle`:
**13 of 13 pre-existing rows backfilled** with real captions.

**Percentile clamp, applied at the same pass:** `clampPercentile`
(scoreDisplayCopy.js) imported into `server.js` and applied at both
percentile-computation sites (`gradeTrackRecordForUser`'s grading loop,
the pending-rows pill); `sync_study_history.py` gained its own matching
`clamp_percentile()`. One pre-existing out-of-range value found and
fixed directly (`jamieegabrielle` id 100: `overall_percentile_at_grading`
was a raw `100`, clamped to `99`).

### (b)-(e) Structure, rows, hero

Verified live (real browser, `thecolorfulpantry`, see Task 5) —
screenshots confirmed, not just code review:
- Hero → **"WHAT WE PREDICTED VS. WHAT HAPPENED"** (renamed from
  "GRADED", now sorted **score-descending** — confirmed: 92nd, 89th,
  84th, ... down to 8th in the rendered order) → **"ON THE RECORD"**
  (pending, gold accent, check-in dates) — exactly mirrors the PDF's own
  section order.
- Rows: caption snippet with date-posted fallback (`Posted <date>`,
  never the old generic "Posted video"); score pill in the standing
  ordinal vocabulary — **"92nd percentile · all videos"**, confirmed
  rendered exactly as specified, matching `generate_preview.py`'s own
  `pill_text_short`/`_clamped_ordinal` convention (the PDF's vocabulary,
  not the live score card's "Beats N%" framing, since Track Record IS
  the Performance Preview); **CALLED STRONG** (green tint) / **CALLED
  WEAK** (rust tint) chips inline after the pill on called rows only;
  big ✓ / muted ✗ on called rows; italic "no call" on middles; one
  legend line at list end — confirmed verbatim: "✓/✗ = whether our
  strong/weak calls matched above-/below-typical results · middle
  scores: no call".
- Hero averages sub-stat: confirmed rendered — "Strong calls averaged
  1.1x your typical · weak calls 0.9x" — gated on ≥2 of each type graded
  (`thecolorfulpantry`'s render had exactly this mix).
- Pending pills: same ordinal vocabulary, confirmed ("29th percentile ·
  all videos", etc., with check-in dates).

## Task 4 — Activity telemetry

`user_events(id, user_id, event, created_at, meta JSONB)`; `POST
/api/event` (fixed vocabulary only — `session_open`, `previews_view`,
`track_record_view`, `accounts_view`, `preview_run` — rejects anything
else, so this can never become an arbitrary analytics sink). Frontend
beacons: `session_open` (once per load, a ref guard against
`inviteStatus.bound` re-firing more than once), `previews_view` /
`track_record_view` (each time that segment becomes visible — not
once-only, repeat views are a real engagement signal), `accounts_view`
(each time the modal opens). `preview_run` is logged **server-side**, at
the two real submission-accept call sites (`/api/analyze`,
`/api/fetch-video`) — deliberately not a client beacon, so it can only
ever reflect a submission the gate actually accepted.

`validation/pipeline_status.py` — **new script** (no prior script by
this name existed; created fresh rather than folding into `dashboard.py`,
which covers a different concern — model-validation stats, not tester
engagement). "Real-User Validation" panel: per-tester table (invite
label + handle × opens/runs/TR-views × 24h/7d/all-time), `is_internal`
excluded via the `users` join, graceful empty state when nothing's
redeemed yet.

## Task 5 — Verify live

Real browser session (Chrome via automation), against production
(`previewpanel.vercel.app`), commit `6acfca3` (final, after two
self-caught fixes below).

**Target substitution, disclosed:** the prompt named `jamieegabrielle`
for the fresh-proxy test, but her history is legitimately already
claimed by Josh's own real founder identity (Task 0's retro-flag target)
— there was nothing left to claim, by design (correctly *not* touched).
Substituted **`thecolorfulpantry`** for the fresh-claim-flow
verification instead (real unclaimed prospect history; also, discovered
mid-test, an OOF-covered research creator herself — `sync_study_history`
added 3 more rows for her on mint, a nice bonus richer test fixture: 8
graded calls with a genuine mix of strong/weak/no-call/hit/miss).

| Check | Result |
|---|---|
| Mint `TRV2PANTRY2`, enter `trv2pantry2` (lowercase) | Redeemed — confirm screen "@thecolorfulpantry" ✅ |
| Scrolled to y=244.5 before "That's me" | Lands at y=0 ✅ (confirmed twice, cold-open and post-confirm) |
| Claim banner | **First attempt: didn't show — bug found and fixed (see below).** Second attempt: "Your track record is ready — 8 graded calls · View it" ✅ |
| History button | Present at zero previews, badge "13" (unseen), then "· N graded" style once viewed ✅ |
| TR structure/copy/chips/legend/hero averages | All confirmed exactly as specified (Task 3 above) ✅ |
| Accounts screen | Connected `thecolorfulpantry`, no bio-code block ✅ |
| Internal identity pool exclusion | Minted `TRV2INTERNAL` (`--internal`, no pre-link needed); redeemed; `users.is_internal=true` confirmed; one real `/api/fetch-video` submission → resulting `shadow_scores` row: `pool_eligible=false, is_posted_video=false` ✅ |
| Activity events in `pipeline_status.py` | After the walk: `label="TR v2 verify (pantry)", opens=1/1/1, runs=0/0/0, TR views=1/1/1` — correctly reflects one session, one TR view, zero submissions ✅ |

**Bug found and fixed during this verification:** the claim banner
didn't appear on the first `thecolorfulpantry` attempt. Root-caused: the
"seen" `localStorage` flag was being set **before** confirming the
follow-up `/api/track-record` fetch actually returned a usable
`gradedCallCount` — a transient failure or a grading-timing race left
the flag permanently set with the banner never having shown. Fixed:
the flag is now only set once there's a real non-zero count to display.
Re-tested after the fix (fresh redemption) — banner appeared correctly
with the right count. Shipped as its own separate, clearly-labeled
commit (`7b59533`) rather than folded silently into the main change.

**Cleanup** (explicit id lists, captured before any write):
- `thecolorfulpantry`: captured exact claimed ids (`[28, 29, 30, 31, 32,
  33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 51, 88, 107, 108, 109]`,
  21 total including the 3 newly-synced study-history rows) before
  resetting `user_id` to `NULL` by those exact ids. Verified: `0` still
  claimed, `21` total rows intact (kept — durable data, same convention
  as prior dispatches' synthesized rows).
- Internal-identity test: deleted the one real submission chain
  (`pp_synthesis`, `shadow_scores`, `submissions`,
  `beta_submission_events`), its `user_events` rows, redemption, `users`
  row, and invite code `TRV2INTERNAL`.
- Also deleted a false-start redemption (`TRV2VERIFY`, discovered to
  target already-claimed `jamieegabrielle` — nothing was claimed by it,
  so nothing to un-claim) and its `user_events`.
- **Left untouched, as directed:** Josh's founder code `3493GV8F`
  (`is_internal=true`) and his real 18-row claim on `jamieegabrielle`
  (verified still intact: `18` rows, still owned by his `user_id`).

## Task 6 — Docs

`PreviewPanel_Operations_and_Roadmap.md` §1a: extended item 11 in place
(internal-identity semantics + pool exclusion, the real scroll-to-top
root cause, TR v2's structure, telemetry events).
`Recruitment/RECRUITMENT_RUNBOOK.md`: one-liner for `mint --internal`.

## Files changed

**App repo (`~/PreviewPanel`):**
- `backend/server.js` — `is_internal` schema + redeem-endpoint
  propagation; `user_events` table + `POST /api/event`; `logUserEvent`
  + `preview_run` call sites; `clampPercentile` import + application at
  both TR percentile-computation sites.
- `backend/scoring/shadowScore.js` — `isInternal` param, `poolEligible`
  gate.
- `frontend/src/PreviewPanel.jsx` — real scroll-to-top
  (`scrollRestoration`, mount/History-toggle effects); header-collision
  CSS (button-only, no logo change); Track Record v2 structure/copy/
  chips/legend/hero averages; telemetry beacons; claim-banner flag-
  timing fix.
- `validation/beta_admin.py` — `mint --internal`, `list` shows it.
- `validation/sync_study_history.py` — caption capture + backfill,
  percentile clamp.
- `validation/pipeline_status.py` — new.
- `Recruitment/RECRUITMENT_RUNBOOK.md` — copy.

**Research repo (`~/correlation-research`):**
- `PreviewPanel_Operations_and_Roadmap.md` — §1a extended.

**Database:**
- `invite_codes`/`users.is_internal`: Josh's founder identity
  retro-flagged (code + user).
- 3 stray fake `posted_at`-null rows (+ 3 linked `shadow_scores`)
  deleted.
- 13 `jamieegabrielle` `study_history` rows backfilled with captions; 1
  out-of-range percentile clamped.
- `thecolorfulpantry`: 3 new `study_history` rows synthesized (real,
  durable); all test claims released.
- `user_events`: table created; all test-generated rows deleted during
  cleanup.

## Git / deploy state

- Commits: `efd990a` (Tasks 0-4, 6), `7b59533` (claim-banner fix, found
  during Task 5), `6acfca3` (header-collision revision, logo untouched
  per direction), on `origin/main`, pushed.
- Deployed — Render (backend): Y, confirmed live via `/version`
  (`efd990a`) before Task 5 began; `7b59533`/`6acfca3` are frontend-only,
  no backend redeploy needed.
- Deployed — Vercel (frontend): auto-deployed from all three pushes;
  Task 5 verification ran in a real browser session against
  `previewpanel.vercel.app`, screenshots confirmed for the structural/
  copy requirements.
- Research repo: pending commit (this readout's own commit, see below).

## STOP

Per the prompt's own instruction — no further work started after this
readout.
