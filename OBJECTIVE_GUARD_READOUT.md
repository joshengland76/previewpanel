# Objective Guard Readout

Second-chance selector on Convene. App repo, frontend only.

## 1. Intercept

`handleSubmit` in `PreviewPanel.jsx` is the single shared handler for both
"Convene the Panel" and the link-fetch path (a prior polish round already removed
the link box's own "Go" button, so there's no second handler to guard). It now
runs its existing validation, then checks the objective:

- Empty (`!objective.trim()`) → opens `ObjectiveGuardModal` instead of submitting.
- Non-empty, including any custom-typed value → unchanged flow, no modal.

The modal (`frontend/src/components/ObjectiveGuardModal.jsx`) shows the title,
honest one-line copy, a search-filterable list of the canonical
`OBJECTIVE_OPTIONS` (pre-focused search input), and two actions:

- **"Score with this category"** (disabled until a row is tapped) → commits the
  pick to `objective` state and continues the submission with that value.
- **"Continue without a score"** → continues exactly as today's no-objective path
  (`objective` stays "").
- Backdrop/close → closes the modal, nothing submitted, form untouched.

Deliberately **not** included: the main selector's free-type "Use: xyz" escape
hatch. A custom-typed objective doesn't clear `tiers_v2_2.json`'s
`showPercentile` gate either (see §3), so it can't actually deliver on this
modal's "Score with this category" promise — only a canonical category can.

Submission is a moment-of-action check — it fires every time the button is
tapped with an empty objective, not a one-time nudge.

## 2. Label

"OBJECTIVE (optional)" → "OBJECTIVE (needed for your score)"; placeholder
"Select a content category (optional)" → "Select a content category". No other
form changes.

## 3. Report-only: custom objective vs. no objective in the score display

Traced `scoreDisplay.js` + `scoreDisplayCopy.js`. For a **custom-typed**
objective (accepted by the form, but not a key in `tiers_v2_2.json`):

- `tierForObjective` → `null` (no matching key), `showPercentileFor` → `false`
  (`p_gt0` is `undefined`, fails the `>= 0.95` check) — **the exact same abstain
  gate a blank objective hits.**
- Practical effect: no gauge/percentile circle, no niche/personal stat pills,
  `PerformanceRadar`'s Objective Fit axis muted the same way
  (`skipObjectiveFit={!OBJECTIVE_OPTIONS.includes(objective)}` is `true` for
  both custom and empty).
- The **only** difference is the abstain honest-line copy, which is
  intentionally three-way per the code comment in `scoreDisplayCopy.js`:
  - Canonical objective, tier exists but hasn't cleared the bar yet: *"Reliable
    scoring for this objective is still in progress."*
  - Custom-typed, not in `tiers_v2_2.json`: *"This objective has been logged
    for a future scoring model build. No reliable score is currently
    available."*
  - Blank: *"No objective selected, so no reliable scoring is available."*

Net: a custom-typed objective is honestly labeled differently, but gets no more
scoring than no objective at all today. Worth deciding separately whether that
path needs its own nudge — out of scope here since the guard already routes
around it (canonical-only picker).

## 4. A bug the live verification caught

First live run stored `objective: "[object Object]"` in `submissions` — a real
regression. `NotificationPrimer`'s `onSkip={startAnalysis}` binds the function
directly to `onClick`, so React passes the click's `SyntheticEvent` as
`startAnalysis`'s first argument. Once `startAnalysis`/`doStartAnalysis` grew an
`objectiveOverride` parameter (needed so the modal's "Score with this category"
button can submit the freshly-picked value without waiting on a state-update
tick), that event object silently became the override and got
FormData-stringified.

Fixed two ways:
- `onSkip={() => startAnalysis()}` — no argument leaks through.
- `doStartAnalysis`/`handleLinkFetch` now guard with
  `typeof objectiveOverride === "string" ? objectiveOverride : objective`
  instead of a bare `??`, so any future direct-binding mistake degrades to the
  correct state value instead of corrupting the field.

Re-verified after the fix — confirmed correct in both the DB row and the
judges' own prompts (e.g. *"The video fails to deliver on the Travel
objective..."*).

## 5. Live verification (mobile width, 390×844)

Ran against local backend + real TwelveLabs/Neon (no mocks), using the
existing tiny `backend/uploads/warmup.mp4` keep-warm clip:

- **(a) No objective → Convene → modal → pick → run completes.** Verified twice
  (once pre-fix, catching §4's bug; once post-fix). Objective correctly landed
  in the DB row, the judges' prompts, the results-screen tag
  (`🎯 Funny Videos/Comedy`), and the radar's Objective Fit axis rendered
  un-muted. Full percentile display (gauge, niche/personal stats) could **not**
  be exercised — see note below.
- **(b) "Continue without a score" → run completes.** DB row confirms
  `objective: null`, matching today's no-objective path exactly.
- **(c) Backdrop cancel.** Modal closes, objective field untouched, no request
  fired, form intact.
- **(d) Canonical objective pre-selected → Convene.** No modal — straight to
  the existing notification primer, unchanged flow.
- **(e) Link-fetch path.** Same modal, same gating. Verified the picked
  objective reached `/api/fetch-video` (backend log shows the probe attempt
  against the pasted URL); the fetch itself failed only because this sandbox
  has no `yt_dlp` installed, unrelated to the guard.

**Note on full score display:** this local `.env` has no `DISPLAY_SCORE` flag
set, and (separately, pre-existing) the shadow-scoring pipeline
(`recordShadowScore`) never logged a completion or failure line in any of the
five runs — `job.scoreDisplay` never resolves locally regardless of the flag.
I temporarily set `DISPLAY_SCORE=true` to check, confirmed the gap is
unrelated to this change (reverted it after), and left it reverted. Every run
instead exercised `VerdictHero`'s existing graceful fallback (the legacy 0–10
gauge), which is the correct degrade path when `scoreDisplay` is absent either
way.

**Side effect to flag:** the five live runs each wrote a real row to the
`submissions` table on the production Neon DB (job ids `job_1784176857825_c3pfwe`,
`job_1784177009230_0s8fzk`, `job_1784177176044_hyqc3g`, `job_1784177635934_whfc78`,
`job_1784177675584_83m5cx`, all `file_name: warmup.mp4`) and will show up in
History. Left them in place — deleting DB rows wasn't authorized as part of
this task. Say the word if you want them cleaned up.

## Files touched

- `frontend/src/PreviewPanel.jsx` — guard state/wiring, label/placeholder,
  `proceedSubmit`/override threading, the `onSkip` bug fix.
- `frontend/src/components/ObjectiveGuardModal.jsx` — new.
