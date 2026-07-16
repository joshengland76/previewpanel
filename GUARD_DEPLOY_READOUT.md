# Guard Deploy Readout

Guard deploy + post-guard cleanup + dev-env notes. App repo + Neon.

## 0. Reconcile + ship

State found: `frontend/src/PreviewPanel.jsx` had the uncommitted objective-guard
source edit, `ObjectiveGuardModal.jsx` and `OBJECTIVE_GUARD_READOUT.md` were
untracked, and `frontend/dist/` (deliberately git-tracked in this repo,
confirmed via history — Vercel builds its own copy per `vercel.json`, so the
committed `dist/` is a parallel convention, not the deploy mechanism itself)
was stale from earlier build checks. No local-only commits existed — `main`
was exactly at `origin/main`.

Rebuilt `frontend/dist/` fresh (`npm run build`) against current source before
committing — confirmed every resulting diff (index.html's hashed script tag,
`methodology.html`, `sw.js`'s Web Push handler) was pure staleness catch-up
already present in source, not scope creep from this change. Committed as
`03f267c`, pushed to `origin/main`. No backend files touched, so no Render
action needed.

Verified live, not just via push success: fetched `previewpanel.vercel.app`'s
served bundle and confirmed it already contained `ObjectiveGuardModal`'s exact
copy ("Pick a category to get your score") — the new deploy was live within
the verification window, no dashboard-only assumption.

## 1. Production verification (mobile width, 390×844)

Against `previewpanel.vercel.app` + real Render/Neon, using the same tiny
`backend/uploads/warmup.mp4` test clip:

- **(a) Empty objective → Convene → modal → pick "Food & Drinks/Cooking" →
  run completes.** Objective recorded end-to-end: DB row `job_1784178858150_7dhi64`
  / submission id `7164`, objective `"Food & Drinks/Cooking"`. This run also
  rendered the **full percentile score display** ("0 percentile" /
  "Beats 0% of the last 1000 videos we've scored") — production has
  `DISPLAY_SCORE` + `SHADOW_SCORING` both on, unlike local (see §1c note in
  the ops doc).
- **(b) Canonical objective ("Pets/Animals") pre-selected → Convene.** No
  modal — straight to analysis, unchanged flow. Created `job_1784179048262_ykraik`
  / submission id `7165`. This one fingerprint-matched the (a) run (same test
  file, `group_k: 2`, `pool_eligible: false`) — never touched any percentile
  pool.
- **(c) Backdrop cancel.** Modal closed, no request fired. Confirmed zero new
  `submissions` rows created after this check.

Rows created by this task: **2** — `job_1784178858150_7dhi64` (submission
7164) and `job_1784179048262_ykraik` (submission 7165). Both cleaned up in §2.

## 2. Cleanup

**The 5 original local-verification rows** (`c3pfwe`→7158, `0s8fzk`→7159,
`hyqc3g`→7160, `whfc78`→7161, `83m5cx`→7162): checked `shadow_scores`,
`preview_fingerprints`, `posted_videos` for any of these 5 submission ids
first — **zero rows found**, as expected (`SHADOW_SCORING` is off locally, so
`runShadowScoringForJob` never ran for these — see §4). No orphans to clean.

**The 2 production rows from Task 1** (7164, 7165) ran through the real
pipeline and did have downstream rows:

| Table | Rows deleted |
|---|---|
| `shadow_scores` | id 625 (submission 7164), id 626 (submission 7165) |
| `preview_fingerprints` | id 77 (submission 7164), id 78 (submission 7165) |
| `posted_videos` | none found |
| `pp_synthesis` | ids 184–188, 190, 191 (all 7 submission ids — this table wasn't in the original three named, but has its own FK to `submissions` that blocked the first delete attempt; caught and included) |
| `submissions` | all 7: ids 7158–7162, 7164, 7165 |

All deletes ran inside one transaction, gated on `job_id = ANY(...)` (not an
id range — `submission_id 7163` belongs to a real, unrelated user submission
sitting between mine and was correctly left untouched). Verified zero
remaining rows across all four tables post-commit.

**Pools confirmed byte-identical**, not just "should be fine" — computed the
actual pool composition before and after from live DB data (same logic as
`percentilePools.js`'s `buildPools`):

| Pool | Before (top of window) | After |
|---|---|---|
| Overall (window 1000) | `shadow:625` (mine), `shadow:621`, `shadow:620`, ... | `shadow:621`, `shadow:620`, `shadow:619`, ... — size still 1000 |
| "Food & Drinks/Cooking" niche (window 100) | `shadow:625` (mine), `shadow:613`, `shadow:612`, ... | `shadow:613`, `shadow:612`, `shadow:605`, ... — size still 100 |

Both windows were already at cap with real data — my rows occupied the front
(newest-first ordering) and, once deleted, the exact same real rows that
preceded them slid back into place. Sizes unchanged (already capped); the
`shadow:625`/`shadow:626` keys are absent from both pools now.

**History count restored (with one caveat).** "History (N)" is entirely
client-side (`localStorage['pp_history_v1']`, capped at 10 most-recent
entries, unrelated to any DB table). Checked both origins this session
touched:

- `previewpanel.vercel.app` (production): only 1 of my 2 test rows had
  actually reached the frontend's own "job finished" state before I
  navigated away (job `7dhi64`); removed it. Count: 10 → 9.
- `localhost:5173` (local): only 1 of my 5 local test rows had reached that
  state (`hyqc3g`, "Funny Videos/Comedy"); removed it, leaving the other 8
  entries (unrelated, pre-existing dev-test residue predating this session —
  `test_upload.mp4`, `local_race_test*.mp4`, etc. — untouched, out of scope).

Caveat: the rolling 10-item cap means adding my 1 polluting entry on each
origin already evicted whatever real entry was previously in slot 10 — that
eviction isn't reversible from localStorage alone (the array itself has no
memory of what fell off). Removing my entry restores accurate *content*, not
necessarily the exact prior *count* if a real entry was already pushed out
before I removed mine. Flagging this rather than silently calling it fully
restored.

## 3. Ops doc

Added to `TESTER_OPS_RUNBOOK.md` (existing ops doc — already had the flag
table and the "keep-warm has no flag, never touch it" line, confirming it as
the right target):

- **Local dev environment: known limitations** — `DISPLAY_SCORE`,
  `SHADOW_SCORING`, and `yt_dlp` gaps, with the corrected mechanism for why
  `recordShadowScore` is silent (see §4) rather than the looser framing this
  prompt used.
- **Standing conventions** — verification-row cleanup pre-authorized as a
  session's own final step (always listed by id, delete-or-flag per what the
  table supports), and every readout ending with a git/deploy state line that
  never conflates "verified locally" with "live in production."

## 4. Report-only: why `recordShadowScore` is silent locally (15-min box, answered in ~6)

Not a broken backpressure guard — the silence happens *before* the
instrumented code. `runShadowScoringForJob` (the function that calls
`recordShadowScore`) opens with `if (process.env.SHADOW_SCORING !== "true" &&
job?.source !== "validation") return;` — a bare, unlogged early return, sitting
above the try/catch that contains both the `[shadow_score] id=...` success
line and the `[shadow_score] FAILED` failure line. `SHADOW_SCORING` (not
`DISPLAY_SCORE`, which I'd conflated with it in the original readout) is
unset locally, so every local run returns here immediately, never reaching
`recordShadowScore` at all — there is nothing for the try/catch to log because
the function it wraps never executes. The design is intentional (a rollout
flag, same pattern as `runSynthesisForJob`'s own fire-and-forget gate); the
gap is that the gate itself has no log line marking "skipped due to flag,"
so a session watching only the logs has no signal to distinguish "flag off"
from "actually silent" without reading the source, as this investigation had
to. Confirmed in production where `SHADOW_SCORING=true`: real `shadow_scores`
rows appeared for both §1 test runs.

## Git / deploy state

- Commit: `1b6113f` (this readout + ops-doc additions), on top of `03f267c`
  (objective guard). Both on `origin/main`.
- Pushed: Y — both commits pushed to `origin/main`.
- Deployed — Vercel (frontend): Y for `03f267c` (verified live via
  served-bundle content check in §0 before `1b6113f` existed); `1b6113f` is
  docs-only (this file + `TESTER_OPS_RUNBOOK.md`), no frontend code changed,
  nothing new to verify live for it.
- Deployed — Render (backend): N/A, no backend files changed this session.
