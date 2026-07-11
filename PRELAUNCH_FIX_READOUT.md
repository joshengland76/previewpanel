# Pre-Launch Fix Readout — scoreDisplay Race, Durable Recovery, Ship

**Status: backend + instrumentation confirmed correct against real
production traffic; frontend fix shipped and verified locally against
two real multi-second race losses, but not yet re-confirmed by Josh
against a fresh production submission.** The shadow-scoring/score-display
race condition found during the launch-readiness pass (see
`LAUNCH_READINESS_READOUT.md`) went through **three** frontend rounds
before the visible flip was actually gone — see "UX revision" and "Round
3" below. Given the first two rounds each looked correct in my own
verification and still turned out to have a real bug in production,
**one more real-world check from Josh (ideally Mac incognito, matching
his exact repro) is the recommended last step before calling this
closed.**

**Hard constraints honored**: app repo only; the keep-warm path was not
touched (a pre-existing, unrelated warmup-ping error surfaced in local
logs during this work — `max_tokens` parameter rejected by TwelveLabs for
the warmup ping — noted here for visibility but explicitly not
investigated or touched, per the constraint and because it's out of this
prompt's scope).

---

## Task 1 — durable scoreDisplay recovery (backend)

`/api/status` now falls back to a DB lookup when `job.scoreDisplay` is
null on a terminal (`done`/`partial`) job: queries `shadow_scores` by
`job.submissionId` (one indexed query), and if a row exists, rebuilds the
exact payload via the same `getScoreDisplay()` function the original
in-process computation uses — not an approximation, byte-identical logic.
Caches the result onto the job so subsequent polls hit the fast (in-memory)
path. A genuine no-op when the in-memory value is already set, or when
shadow-scoring is still genuinely in flight (no `shadow_scores` row yet)
— the null response in that case is still correct, nothing to recover.

Factored the two `getScoreDisplay()` fetcher closures (previously
duplicated) into a shared `SCORE_DISPLAY_FETCHERS` constant, used by both
the original call site (`runShadowScoringForJob`) and the new fallback.

Confirmed working on real production traffic (see "Production
verification" below): one submission's `scoreDisplay` was explicitly
recovered via this exact path, logged as `[race] scoreDisplay recovered
via DB fallback in /api/status`.

## Task 2 — one wait screen, not a flip (frontend) — revised after Josh's feedback

**Original approach** (first shipped): mirror `waitingForSynth` with a
`waitingForScore` gate — reveal results as soon as judges + synthesis are
done (bare judge score if `scoreDisplay` hadn't arrived yet), keep polling
up to 90s more in the background, and upgrade the score in place if it
landed late.

**This was correct on the backend but wrong for the user.** Watching it
live on a real production submission, Josh found it confusing: the page
would say "Analysis complete!" with a bare `X/10` score, sit there for
~10 seconds looking finished, then suddenly change to a percentile —
*"we shouldn't have seen the judges scores at all."* A value that changes
after the page already looks done reads as a bug even when it isn't one.

**Revised to**: chain the scoreDisplay wait onto the *same* "Assembling
your panel results…" screen that already covers the judges+synthesis
wait, rather than revealing early and upgrading in place. The user now
sees exactly one thing: the wait screen, then the complete, final view —
never an intermediate value that changes out from under them. Mechanics:

- `waitingForScore` now gates on `synthResolved` (judges+synthesis phase
  over) instead of `mainResultsReady`, and `mainResultsReady` requires
  *both* `!waitingForSynth` and `!waitingForScore`.
- Same status message (`"Assembling your panel results…"`) covers both
  phases — no new copy needed.
- Same caps as before (14 ticks / ~42s for synthesis, 30 ticks / ~90s for
  score, chained rather than concurrent) — worst case a bit longer to
  first paint, but per the app's own existing copy ("Analysis usually
  takes 2–4 minutes") that's within the expectation already set.
- On cap-out (score genuinely never arrives), the same honest bare-score
  degrade shows — this part of the design is unchanged from the original
  spec, only *when* it's allowed to show changed.
- Since polling now always stops exactly when the final view is first
  shown, the "patch scoreDisplay into history after the fact" mechanism
  from the original approach became dead code (no further poll ticks
  ever occur after reveal) and was removed, along with its
  `scoreDisplayPatchedRef` and `patchHistoryEntryScoreDisplay`. History
  entries still include `scoreDisplay` (now always whatever was in the
  final reveal, arrived or capped), and `restoreFromHistory` still reads
  it back correctly.

Verified locally (real submission, local backend + Neon, `SHADOW_DELAY_MS`
forcing a genuine race-loss of `-1572ms`): browser went straight from
"Assembling your panel results…" to the final percentile view (62nd
percentile) with **zero intermediate bare-score flash**. Cleaned up the
test submission from the shared DB afterward.

## Task 3 — race instrumentation

Every submission logs one line once both synthesis and shadow-scoring have
resolved: `[jobId] [race] shadow-vs-synthesis margin=<ms>ms (negative =
shadow lost)`. Margin = `synthesisReadyAt - shadowReadyAt`; positive means
shadow-scoring finished first (no race lost), negative means it finished
after synthesis (the exact failure mode this fix addresses — now handled
by extending the wait screen rather than a visible flip). Logged exactly
once per job regardless of which side finishes second.
`TESTER_OPS_RUNBOOK.md`'s healthy-week-one section has a "watch this"
note pointing at this log line.

## Task 4 — verify, then ship

### 4a — local verification

Added a test-only `SHADOW_DELAY_MS` env hook (no-op unless explicitly
set) to `runShadowScoringForJob`, and (for the original design) a
temporary `NODE_ENV`-guarded debug route to null a completed job's
in-memory `scoreDisplay` on demand — used only for that verification
pass, removed before its deploy commit. `SHADOW_DELAY_MS` has no
hardcoded default, so it's already a no-op in any environment that
doesn't explicitly set it (i.e., production).

Also discovered along the way: `SHADOW_SCORING`/`DISPLAY_SCORE`/
`EXTRACT_CDIMS` aren't set in local `.env` at all by default, so
shadow-scoring silently never runs locally unless explicitly enabled —
needed for any of this local verification to mean anything.

Verified, across the original design and the revision:
- **Extended-poll recovery (original design)**: `SHADOW_DELAY_MS=35000`
  forced margin **-10901ms**; confirmed the (then-intended) upgrade-in-place
  behavior worked mechanically, and confirmed history patch + restore.
- **DB fallback**: nulled a completed job's in-memory `scoreDisplay` via
  the temporary debug route, hit `/api/status` again — identical payload
  recovered, logged correctly.
- **Merged-wait revision**: `SHADOW_DELAY_MS` (whatever was left of a
  20s injection by the time synthesis finished) forced a genuine race-loss
  (**-1572ms**); confirmed the browser now shows the wait screen straight
  through to the final view with no intermediate flash.
- Control run with a short delay confirmed the fix doesn't change
  behavior when there's no race to recover from (shadow wins, view shows
  correctly on first paint either way).

All local test submissions (real TwelveLabs/Claude API calls against the
shared Neon DB) were cleaned up afterward — pure mechanical QA, not real
usage.

### 4b — push + deploy

Pushed and deployed across several commits as the fix and then the UX
revision landed: `121b3ab` (original fix), `1a17625` (dist rebuild),
`165bc49` / `3c5dda1` (readout corrections), and the merged-wait revision
(this pass). Render (backend) redeploys automatically within ~2 minutes
of push, confirmed each time via `/version` + `/health`. The Vercel
frontend deploy runs asynchronously and can lag noticeably longer than
Render's — confirmed (the hard way, see incident below) to complete
correctly, just not immediately.

### 4c — production verification

**Backend**: confirmed correct against real traffic multiple times,
including one explicit DB-fallback recovery
(`job_1783738883201_om8abl`, 41st percentile) and several race-margin
log lines, all negative (shadow lost every time observed in production
so far) — direct evidence this is a real, recurring condition worth
having fixed, not a rare edge case.

**Frontend — incident**: Josh's first two test submissions ran against a
stale Vercel deploy (the fix hadn't finished rolling out). I initially
misdiagnosed this as Vercel's auto-deploy being disconnected entirely,
based on the bundle still looking stale after ~15 minutes of checking —
wrong; it was just slower than the window I checked. Josh confirmed via
the Vercel dashboard that it *had* deployed, a few minutes before he
looked. My own follow-up check used a raw MD5/byte-diff against the live
bundle, which showed differences and looked like continued confirmation
of the stale-deploy theory — also wrong: the diff was in React's own
internal library code (minified output isn't fully deterministic across
separate build invocations for reasons unrelated to source changes).
Redone properly by grepping the live bundle for the actual compiled logic
pattern (the `<30` `scoreWaitRef` cap) rather than comparing bytes —
confirmed the fix was genuinely live. Lesson: verify frontend deploys by
matching a distinctive logic/numeric pattern in the live bundle, not by
hashing or diffing the whole minified file.

**Frontend — the actual bug this incident masked**: once confirmed live,
Josh ran another real submission and watched the *original* design's
upgrade-in-place behavior directly — "goes to the judge results for about
10 seconds before suddenly flipping to the percentile display" — correct
on the backend, confusing in the browser. That's what drove the Task 2
revision above.

### Round 3 — the merged-wait revision still flashed in production

The Task 2 revision (chaining `waitingForScore` onto the same "Assembling…"
screen) passed my local verification and was confirmed deployed via the
logic-pattern-grep method — but Josh reported it **still** happening:
*"an inappropriate glimpse of the scorecard card before the awaiting your
panel results window, then showing judge scores briefly, then showing
percentile about ten seconds later... consistently on Mac incognito."*
Not on phone, which was the clue that this was a real logic gap rather
than a stale deploy — confirmed via Josh's own DevTools Network tab
showing the exact bundle hash I'd already verified contained the Round 2
fix.

Root cause: `isFinished`/`isProcessing` — which gate *every*
results-vs-processing render decision in the JSX — are derived from the
`jobStatus` React state, completely separate from the `mainResultsReady`
computation the Round 2 fix added. `setJobStatus(data.status)` was still
being called unconditionally on every poll tick, flipping `isFinished`
true (revealing the bare-judge-score view) the instant the backend said
"done" — regardless of whether `scoreDisplay` had arrived. Round 2 had
only ever gated the status *message text*, the poll-interval clearing,
and the history-save timing — never the actual render gate. My original
local test happened to pass because its race margin (-1572ms) was small
enough to resolve within the same poll tick, masking the bug; Josh's
real margins (10–27s) span many poll ticks and exposed it every time.

**Fix**: withhold the terminal `done`/`partial` value from `jobStatus`
until `mainResultsReady` is true; non-terminal statuses still update
immediately so judge-by-judge progress keeps working during the wait.
Also fixed a related gap while in there: `doStartAnalysis()`/`reset()`
never reset `scoreDisplay`, so a stale score from a previous submission
in the same session could leak into a new one's initial render. And
updated `WaitingBanner`'s status text — it was ignoring `statusMessage`
entirely and would repeat "3 of 3 judges have reached their verdict" for
the whole combined wait (once judges finish, that's now the same
`doneCount === totalCount` branch, so it correctly reads "Assembling your
panel results…" instead) — not the flip bug itself, but the message
Josh actually asked for.

**Verified locally**: `SHADOW_DELAY_MS` forcing two separate real race
losses (**-24990ms**, **-25632ms** — an order of magnitude larger than
the original -1572ms test, deliberately, to make sure this reproduces the
multi-poll-tick failure mode Josh saw). A `MutationObserver`-based render
log (not just periodic screenshots, which could miss a single-frame
flash) captured every DOM mutation across both full submissions: **zero**
states where the "Analysis complete" bare-score view rendered before
`scoreDisplay` was ready, across 105 and 117 captured mutations
respectively. "Assembling your panel results…" was confirmed visible for
the correct ~45s window before the atomic switch to the final view.
Cleaned up both test submissions from the DB afterward.

Pushed as `65c07c3`. Backend `/version` unchanged (`121b3ab` — this was a
frontend-only commit, no backend redeploy needed). Did **not** re-run an
automated production submission for this round: the Vercel frontend is
HTTPS, and every local method for injecting a test video file into an
HTTPS page's upload input hit either mixed-content blocking (fetching
from a local HTTP file server) or an impractically large payload
(base64-embedding the video directly). Given two prior "confirmed fixed"
conclusions from me already turned out wrong, I'm not willing to call
this closed on local verification alone a third time — see "What's left."

### Round 3 — production re-verification attempt

Tried to re-confirm Round 3 against a real production submission via
browser automation (matching Josh's Mac-incognito repro). Hit three
independent dead ends injecting a test video into the HTTPS production
upload form: fetching from a local HTTP file server is blocked by
mixed-content policy; base64-embedding the video directly is technically
possible but token-prohibitive at any file size that's actually a video
(a 60KB base64 chunk alone costs ~57k tokens to read back); and
generating a synthetic clip in-page via `canvas.captureStream()` +
`MediaRecorder` was blocked by the browser tool's own security filter
(flagged as suspicious regardless of content). Did not find a way around
these within reasonable effort, so this is a real gap, not a skipped
step.

Fell back to submitting a real video directly to the production backend
via `curl` (`job_1783748178959_c6zgit`, bypassing the browser entirely)
and polling `/api/status` to completion, then pulling the Render logs
for that job via the Render API (`RENDER_API_KEY` in `backend/.env`,
service `srv-d7n73lhj2pic738mfthg`). Confirmed: judges → synthesis →
shadow-scoring all completed correctly, race margin logged as
**+8971ms** (shadow *won* this time — synthesis was the slower side),
`scoreDisplay` present and correctly shaped (ABSTAIN payload) the moment
`status` flipped to `done`, no errors. Also confirmed the live bundle's
`Last-Modified` header (05:34:05 UTC) postdates both Round 3 commits
(05:29:14 and 05:32:27 UTC), so the deployed frontend is the Round 3
code.

**What this does and doesn't prove**: it's a real, clean production
run through the whole Round 3 code path with no errors — good evidence
the system is healthy. But because shadow won this particular race, it
never exercised the specific frontend render-timing bug (which only
shows when `jobStatus` flips to `done` *before* `scoreDisplay` arrives) —
curl polling only sees the API's JSON, not what the React app does with
it, so it can't confirm the browser-side fix either way. The exhaustive
local test (two real forced race losses, MutationObserver-verified zero
flash) is still the strongest evidence for the actual fix; this
production run adds confirmation that the healthy path also works
end-to-end for real, on the currently-deployed code. Test submission
(`submissions.id = 6627`) cleaned up from the DB afterward.

**Bottom line unchanged**: a real device check from Josh — ideally one
that lands on a shadow-loses race like his original repro — is still
the recommended final confirmation. I was not able to force or fully
substitute for that with the tools available in this environment.

## Task 5 — doc ticks

`Summary documents/PreviewPanel_Operations_and_Roadmap.md` §1c's deploy
notes now document that `render.yaml` is documentation-only (the live
service is dashboard/API-configured, never created as a Render Blueprint)
— edits to the file alone change nothing real; apply via the Render
dashboard/API and update the file alongside as the historical record.
Confirmed the C2 roadmap tick (both the header and §4) already reads
correctly from the prior prompt's fix — no further change needed there.

---

## What's left

Round 3 is pushed and deployed (`65c07c3`). **Recommended before calling
this closed**: one more real submission from Josh, specifically on Mac
incognito (his exact repro conditions for both prior false-clears) —
watching for the same three things he described (scorecard sneak-peek,
bare judge score, the flip) all staying gone. If that holds, then — per
the original prompt — Josh edits `TESTER_WELCOME.md` (including supplying
a real feedback channel — none exists anywhere in the repo/docs yet),
does one real phone pass, and sends invites. No further CC work gates the
launch beyond that final confirmation.
