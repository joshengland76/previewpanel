# Beta Metering Readout — invite gate, allowance, circuit breaker

App repo. **Hard constraints honored:** keep-warm was not touched.
research_api, `/api/validation/ingest`, and the prospect worker flow are
completely exempt from gate/quota/breaker — verified structurally (grep)
and live (Task 6).

## Task 1 — Invite gate

Two new tables (migrated in `initDb()`): `invite_codes` (code PK, label,
max_redemptions default 3, created_at) and `redemptions` (user_id PK,
code FK, redeemed_at) — `user_id` as the PK means one binding per
user_id, ever; a cleared-storage client mints a new user_id (identity-
lite) with no existing row, so recovery is simply re-entering the same
code, which consumes a fresh redemption slot against that code's
`max_redemptions` (by design — a lost device costs a slot, same as
handing the code to a second person would).

`GET /api/invite/status?userId=` / `POST /api/invite/redeem` (new
endpoints in `backend/server.js`) — redeem is idempotent for an already-
bound user_id (returns the existing binding rather than erroring),
validates the code exists and hasn't hit its redemption limit before
inserting.

Enforcement lives in `checkBetaGate(userId)`, called at the top of both
`/api/analyze` and `/api/fetch-video` — an unbound user_id gets a 403
(`"This beta requires an invite code."`) before any upload/preprocessing
work happens; for `/api/analyze` specifically, a rejected request still
unlinks the file multer already wrote to disk.

Frontend: `InviteGateScreen` (`frontend/src/PreviewPanel.jsx`) — a full-
screen overlay (same established pattern as the pre-existing
`NotificationPrimer` modal, at `zIndex: 200` above its `100`) rendered
whenever `inviteStatus.bound` is false, so the large existing return tree
didn't need restructuring. Warm copy: private beta, free during beta,
paid product at launch with founding terms for testers.

## Task 2 — Allowance

`beta_submission_events` (id, user_id, created_at) — a **dedicated**
counter table, written to ONLY by `recordBetaSubmissionEvent()`, called
ONLY from `/api/analyze` and `/api/fetch-video` right before each
responds with a `jobId`. Deliberately NOT derived from the shared
`submissions` table: that table also carries `validation`-sourced rows
for real connected users (worker.py's daily rescan submits with their
own real user_id) that must never count against that user's beta
allowance — a naive "count submissions by user_id" query would have
silently miscounted those.

`checkBetaGate` counts `beta_submission_events` in the last 30 days per
user_id against `BETA_ALLOWANCE` (env, default 15); at the cap, returns
a 403 with a friendly message pointing to the feedback channel, no
hard-coded pricing promises.

Frontend: a small persistent counter ("Beta allowance: X of Y left this
month") in both header blocks (step-1 input screen, step-2 results
screen) in `PreviewPanel.jsx`, gated on `inviteStatus.bound &&
inviteStatus.allowance != null`, computed as
`Math.max(0, allowance - used)` of `allowance`. Refreshed via
`refreshInviteStatus()` right after each successful `/api/analyze` /
`/api/fetch-video` call (i.e. as soon as the server has recorded the
event), not just on page load.

## Task 3 — Circuit breaker

Same `checkBetaGate`, checked before the per-user allowance: counts ALL
`beta_submission_events` today (`created_at >= date_trunc('day', now())`)
against `DAILY_SUBMISSION_CAP` (env, default 100). Over cap: 503 with
`"We're at capacity today — please try again tomorrow."` plus a loud
`console.error("[beta-gate] CIRCUIT BREAKER TRIPPED...")` log line.
Exempt paths (research_api, ingest, prospect) never touch this counter
at all, so a busy beta day can never throttle the research pipeline.

Limit/breaker rejections surface through the app's existing generic
error pipeline (`data.error` → `setStatusMessage`/`setLinkFetchError`) —
no new bespoke UI needed since the backend's rejection copy is already
warm and specific.

## Task 4 — Admin CLI

`validation/beta_admin.py` (Mac-side, reuses the `./_venv/bin/python3` +
`DATABASE_URL`-from-`backend/.env` pattern):
- `mint --label "..." [--max-redemptions N] [--code CUSTOM]` — generates
  an 8-char code from a visually-unambiguous alphabet unless `--code` is
  given.
- `list` — every code with label, redemptions/max_redemptions, and total
  submissions used by everyone who redeemed it.
- `usage <user_id>` — bound code, redeemed_at, 30-day used/allowance/
  remaining, lifetime uses.

Connection explicitly sets `autocommit = True` so mints/writes persist
regardless of process exit path.

## Task 5 — Copy touches

`TESTER_WELCOME.md`: `[INVITE CODE]` placeholder + entry instructions
near the top; a new "Cost, and what happens later" section — free during
beta, allowance shown in-app, paid at launch with founding terms for
testers. Reviewed against the existing no-hype voice (same register as
the doc's own "What the score means — and doesn't" section).

## Task 6 — Verify live

All rows run against production (`previewpanel.onrender.com` +
`previewpanel.vercel.app`), commit `6aca2fb`.

| Check | Result |
|---|---|
| Fresh/unbound `user_id` blocked at `/api/fetch-video` | `{"error":"This beta requires an invite code.","reason":"no_invite"}` ✅ |
| `beta_admin.py mint --label "live verification (Task 6)" --max-redemptions 2 --code VERIFY01` | minted, persisted (autocommit) ✅ |
| Redeem VERIFY01 as fresh user_id | `{"ok":true,"code":"VERIFY01","alreadyBound":false}` ✅ |
| Submit as newly-bound user (`/api/fetch-video`, real TikTok URL) | `{"jobId":...}` — accepted ✅ |
| Counter after that submission | `used` went 0 → 1 of 15 ✅ |
| Cleared-storage re-entry: 2nd user_id redeems the SAME code | succeeds (2nd of 2 redemptions) ✅ |
| 3rd user_id tries the same code (now 2/2 used) | `{"error":"This invite code has reached its redemption limit."}` ✅ |
| `beta_admin.py list` / `usage <user_id>` | correctly reflect 2/2 redemptions, 1 submission, 14 remaining ✅ |
| **research_api** (`/api/research/submit`, no `userId` field exists on this route at all) | real TL-judged run, `{"submission_id":7213,"status":"complete",...}` ✅ untouched |
| **`/api/validation/ingest`** with a genuinely never-invited `userId` | `{"postedVideoId":"87","status":"scored","yPred":...}` ✅ untouched, confirmed still `bound:false` afterward |
| **Prospect worker** (`worker.py --prospect thecolorfulpantry`, `PP_API_BASE` pointed at prod) | found a real not-yet-ingested video, ingested + scored it live via `/api/validation/ingest`: `ingested -> status=scored yPred=0.054 avgScore=6.67` ✅ untouched |
| Env-forced `BETA_ALLOWANCE=1` (Render env var + explicit redeploy — env-only changes don't auto-redeploy) | bound user already at used=1 got `{"error":"...beta allowance...","reason":"allowance_reached","used":1,"allowance":1}` ✅ |
| Exempt paths re-checked under `BETA_ALLOWANCE=1` | `/api/validation/ingest` with a fresh unbound user_id still succeeded (`postedVideoId:"89"`) ✅ |
| `BETA_ALLOWANCE` restored, env-forced `DAILY_SUBMISSION_CAP=1` | a fully-bound, zero-usage 2nd user got `{"error":"We're at capacity today — please try again tomorrow.","reason":"daily_cap"}` ✅ |
| Both env vars restored (deleted, falling back to code defaults 15/100) + final redeploy | confirmed via `/api/invite/status` (`allowance:15`) and a real accepted submission (`jobId` returned) ✅ |

**One real hiccup, self-caught and fixed:** the first `BETA_ALLOWANCE`
restoration (DELETE env var, immediately followed by setting
`DAILY_SUBMISSION_CAP=1` and triggering a deploy in the same breath) left
the running process still reporting `allowance:1` even though the
Render-side env var list was already correctly clean — a race between
the DELETE call and the deploy snapshot, not a code bug. Caught by
re-checking `/api/invite/status` right after the "restore" step instead
of assuming success; fixed by triggering one more explicit redeploy,
which picked up the correct (absent) env var and restored `allowance:15`
as expected. No user-facing impact: the breaker test that ran during
this window was validating `DAILY_SUBMISSION_CAP=1` specifically, which
was never in question.

## Task 7 — Docs

`PreviewPanel_Operations_and_Roadmap.md`: §1a gained item 10 (metering
paragraph, mirrors the numbered-pipeline-step convention); §4 Phase D
item 5 gained the paid-tier trigger line (first users ≥5 collected
posted videos — same C3 entry criterion, not a new bar — sell
posted-video tracking against their own receipts).

## Files changed

**App repo (`~/PreviewPanel`):**
- `backend/server.js` — invite_codes/redemptions/beta_submission_events
  migrations; `checkBetaGate`/`recordBetaSubmissionEvent`; `GET
  /api/invite/status`, `POST /api/invite/redeem`; gate+event wiring in
  `/api/analyze` and `/api/fetch-video` only.
- `frontend/src/PreviewPanel.jsx` — `InviteGateScreen`; `inviteStatus`
  state + `refreshInviteStatus`; gating overlay; allowance counter in
  both header blocks; counter refresh after each successful submission.
- `TESTER_WELCOME.md` — invite code placeholder, allowance/pricing copy.
- `validation/beta_admin.py` — new.

**Research repo (`~/correlation-research`):**
- `PreviewPanel_Operations_and_Roadmap.md` — §1a item 10, §4 trigger
  line.

## Git / deploy state

- Commit: `6aca2fb` (Tasks 1-5), `e623255` (this readout), on
  `origin/main`, pushed.
- Research repo: `1379e99` (§1a item 10 + §4 trigger line), pushed.
- Deployed — Render (backend): Y, confirmed live via `/version`
  (`6aca2fb`) before Task 6 began; env vars temporarily forced to
  `BETA_ALLOWANCE=1` then `DAILY_SUBMISSION_CAP=1` for the live
  verification, each requiring an explicit redeploy (env-only changes
  don't auto-redeploy — same gotcha §1c of the Ops doc already
  documents), both fully restored (deleted, back to code defaults
  15/100) and reconfirmed working before finishing.
- Deployed — Vercel (frontend): auto-deployed from the same push
  (`previewpanel.vercel.app` responds 200); the invite-gate/allowance-
  counter UI was not independently exercised in a browser this round —
  all Task 6 verification ran via direct API calls against production,
  which exercises the exact same server-side gate/allowance/breaker
  logic the UI calls into.
- **Test artifacts left in the production DB, deliberately not cleaned
  up** (consistent with this session's own precedent of leaving
  verification rows in place rather than deleting real writes): invite
  code `VERIFY01` (2/2 redeemed), its 2 test `redemptions` rows, and a
  handful of `beta_submission_events` rows against test user_ids. None
  of this affects real testers' own allowances (per-user_id scoped) or
  the daily breaker beyond the single day this verification ran on.

## STOP

Per the prompt's own instruction — no further work started after this
readout.
