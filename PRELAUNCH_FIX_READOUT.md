# Pre-Launch Fix Readout — scoreDisplay Race, Durable Recovery, Ship

**Status: CODE COMPLETE, BACKEND + FRONTEND BOTH CONFIRMED LIVE.
Production re-test with the current frontend still pending.** The
shadow-scoring/score-display race condition found during the
launch-readiness pass (see `LAUNCH_READINESS_READOUT.md`) is fixed two
ways — durable server-side recovery and extended client-side polling —
instrumented and verified locally (both failure directions forced), and
confirmed live in both halves of production (see below). Josh's first two
real test submissions ran against a stale frontend deploy (the fix hadn't
finished rolling out to Vercel yet) — see the incident note for the full
timeline and how it was resolved.

## Incident: frontend deploy lagged behind the backend, then landed late

Pushed the fix (commit `121b3ab`) at ~01:33 UTC. Render (backend)
redeployed automatically within ~2 minutes, confirmed live and correct.
The Vercel-served frontend was still serving the pre-fix bundle when Josh
tested it over an hour later, and *stayed* on that stale bundle through
several checks over the following ~15 minutes (including after an
additional `dist/` rebuild + push, commit `1a17625`) — long enough that I
concluded Vercel's auto-deploy wasn't connected to this repo at all, and
reported that to Josh as a likely blocker needing his access to Vercel's
dashboard.

**That conclusion was wrong** — the deploy was just slower than the
window I checked, not stuck. Josh checked the Vercel dashboard and found
it had deployed ~6 minutes before he looked. My own re-check at that point
used a **raw MD5/byte-diff** between the live bundle and a fresh local
build, which showed real differences and looked like confirmation the fix
was still missing — but the diff was in *React's own internal library
code*, never touched by this fix. Minified output isn't fully
deterministic across separate build invocations (variable-naming/ordering
can differ for identical source), so a raw byte/hash diff is **not** a
reliable way to confirm whether specific application logic shipped.
Redid it properly — searched for the actual compiled logic pattern rather
than comparing bytes wholesale — and confirmed conclusively:

```
live bundle: ...Di.current++;const uo=ct&&we&&Di.current<30;
             if((ct&&!uo||ve)&&clearInterval(or.current),ct){...
```

That `<30` (the new `scoreWaitRef` tick cap) alongside the pre-existing
`<14` (`synthWaitRef`) is the exact new extended-polling logic, live on
`previewpanel.vercel.app` right now. **Both halves of the fix are
confirmed deployed.** Lesson for next time: verify frontend deploys by
grepping the live bundle for a distinctive *logic/numeric pattern* from
the new code, not by hashing/diffing the whole minified file.

**What I need from Josh**: check the Vercel dashboard for this project —
confirm GitHub auto-deploy is connected and pointed at `main` /
`frontend/`, look at the most recent deploy's status/logs, and either fix
the connection or manually trigger a deploy from commit `1a17625`. Once
that's done, the two frontend-side verifications below (in-place upgrade,
history patch/restore) need re-confirming on the actual live site — they
were only proven locally, against `localhost`, not on
`previewpanel.vercel.app`.

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

## Task 2 — extended polling (frontend)

Mirrors the existing `waitingForSynth` pattern with a new `waitingForScore`
gate: once judges + synthesis are done, the results view renders
immediately regardless of whether `scoreDisplay` has arrived (bare judge
score if not) — but the poll interval stays alive up to 90s longer if
`scoreDisplay` is still null, so it can upgrade in place the moment it
lands. Does not block or delay the "Analysis complete!" transition, only
extends how long polling continues quietly in the background afterward.

Also fixed a related gap found while implementing this: `localStorage`
history entries never carried `scoreDisplay` at all, so a restored history
view always showed the bare judge score regardless of what had been
available. Entries now include `scoreDisplay` at initial save, get patched
with it if it arrives after that save (a `jobId`-keyed patch,
`patchHistoryEntryScoreDisplay`), and `restoreFromHistory` now reads it
back — a restored view carries the full percentile/ABSTAIN state, not
just the bare score.

## Task 3 — race instrumentation

Every submission logs one line once both synthesis and shadow-scoring have
resolved: `[jobId] [race] shadow-vs-synthesis margin=<ms>ms (negative =
shadow lost)`. Margin = `synthesisReadyAt - shadowReadyAt`; positive means
shadow-scoring finished first (no race lost), negative means it finished
after synthesis (the exact failure mode this whole fix addresses). Logged
exactly once per job regardless of which side finishes second.
`TESTER_OPS_RUNBOOK.md`'s healthy-week-one section now has a "watch this"
note pointing at this log line.

## Task 4 — verify, then ship

### 4a — local verification

Added a test-only `SHADOW_DELAY_MS` env hook (no-op unless explicitly
set) to `runShadowScoringForJob`, and a temporary, `NODE_ENV`-guarded debug
route (`POST /api/_test/clear-score-display/:jobId`) to null a completed
job's in-memory `scoreDisplay` on demand — both used only for this
verification pass; the debug route was removed entirely before the deploy
commit, and `SHADOW_DELAY_MS` has no hardcoded default so it's already a
no-op in any environment that doesn't explicitly set it (i.e., production).

Ran the local backend + frontend dev servers against the same production
Neon DB, with `SHADOW_SCORING`/`DISPLAY_SCORE`/`EXTRACT_CDIMS` explicitly
enabled (not set in local `.env` by default — a discovery in itself, since
without them shadow-scoring silently never runs at all locally). Real
video submissions via browser automation, `DataTransfer`-injected upload
(the same file-picker limitation from the launch-readiness pass applies
here, but plain HTTP `localhost` isn't subject to the HTTPS mixed-content
block that stopped the equivalent trick on production, so this environment
didn't need Josh's help):

- **Extended-poll recovery**: with `SHADOW_DELAY_MS=35000`, forced a real
  margin of **-10901ms** (shadow lost). Confirmed in the browser: "Analysis
  complete!" rendered immediately with the bare judge-score fallback, then
  ~4s later the view upgraded in place to the correct ABSTAIN display
  (neutral ring, "Reliable scoring for this niche is still in progress.")
  with no reload, no user action.
- **History patch + restore**: confirmed via direct `localStorage`
  inspection that the history entry was patched with the late-arriving
  `scoreDisplay`, and confirmed via the History panel that restoring that
  entry correctly re-rendered the ABSTAIN view (not the bare fallback).
- **DB fallback**: used the temporary debug route to null a completed
  job's in-memory `scoreDisplay`, then hit `/api/status` directly — the
  identical payload came back, and the server logged `[race] scoreDisplay
  recovered via DB fallback in /api/status`.
- A control run (`SHADOW_DELAY_MS=15000`, shorter delay) showed the
  opposite, also-correct case: margin **+5472ms** (shadow won), percentile
  visible immediately, no upgrade needed — confirming the fix doesn't
  change behavior when there's no race to recover from.

All three local test submissions (real TwelveLabs/Claude API calls against
the shared Neon DB) were cleaned up afterward (`submissions`,
`shadow_scores`, `pp_synthesis` rows deleted) since they were pure
mechanical QA of the fix itself, not real usage.

### 4b — push + deploy

Two commits were local-only on `main` and are now pushed and live:
`6bb4fbb` (the launch-readiness pass itself — new-user journey
verification, edge states, `TESTER_OPS_RUNBOOK.md`, `TESTER_WELCOME.md`,
`Summary documents/` fixes) and `121b3ab` (this fix). The four C2 commits
from the prior prompt were already pushed earlier in that session.
Deployed via Render (`dep-d98pqv4vikkc73d9ru8g`), confirmed live at
`/version` (`shortSha: 121b3ab`) and `/health`.

### 4c — production verification (backend confirmed; frontend re-test pending)

Two real submissions on `previewpanel.vercel.app` (Josh, manually — the
same browser-automation upload limitation from the launch-readiness pass
applies to production's HTTPS origin):

| Job | Objective | Margin | Backend recovery | Backend's final scoreDisplay |
|---|---|---|---|---|
| `job_1783738852327_i9u9nd` (computer) | Food & Drinks/Cooking | −27193ms | normal (in-memory resolved before any poll needed the DB fallback) | 66th percentile |
| `job_1783738883201_om8abl` (phone) | Makeup/Beauty | −10798ms | **DB fallback** (`[race] scoreDisplay recovered via DB fallback in /api/status` logged) | 41st percentile |

Both submissions lost the race in real production traffic (negative
margin both times) — direct confirmation this isn't a rare or local-only
phenomenon. I directly confirmed both jobs' current `/api/status`
payloads are correct: `showPercentile: true`, correct niche percentiles,
correct headline copy. **This proves the backend fix is genuinely correct
against real traffic.**

**It does not prove the fix reached either user**, and per Josh's own
report, it didn't: the computer session never updated from the bare judge
score to a percentile at all (matches old, pre-fix frontend behavior
exactly — stop polling once synthesis resolves, regardless of
scoreDisplay). The phone session eventually showed the correct 41st
percentile, but via a confusing sequence (a brief scorecard flash, then
the "assembling" screen reappearing, then the bare judge score, then the
percentile) that doesn't match either the old code's expected behavior or
the new fix's expected behavior cleanly — possibly a mobile-Safari
tab-suspend/resume artifact layered on top of the stale-frontend issue,
not fully diagnosed. Both observations are consistent with the frontend
deploy gap above: **neither browser session was running the fixed code**,
so nothing about the frontend-side behavior (extended polling, in-place
upgrade, history patch) has actually been confirmed on production yet —
only in the local environment (see 4a) and, separately, in the backend's
own logs and API responses (this section).

**Re-test needed once the frontend deploy is confirmed fixed** (see
incident note above): repeat two real submissions and confirm the
in-place upgrade actually renders correctly in the browser this time, not
just correctly in the API response.

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

**Blocking, needs Josh**: the Vercel frontend deploy gap above. Nothing
else in this fix can be called done until the actual live site is
confirmed running current `src/` and the two production submissions are
re-run to confirm the in-browser behavior (not just the API responses).

Once that's resolved: Josh edits `TESTER_WELCOME.md` (including supplying
a real feedback channel — none exists anywhere in the repo/docs yet),
does one real phone pass, and sends invites, per the original prompt.
