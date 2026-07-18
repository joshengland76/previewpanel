# Beta Gate Follow-up Readout — pre-linked codes, auto-connect, history claim

App repo. Extends the beta-metering build (`BETA_METERING_READOUT.md`).
**Hard constraints honored:** keep-warm not touched. research_api,
`/api/validation/ingest`, and the prospect worker flow stay completely
exempt from gate/quota/breaker — unchanged and reverified (grep: still
exactly two `checkBetaGate`/`recordBetaSubmissionEvent` call sites,
`/api/analyze` and `/api/fetch-video`).

## Task 0 — Retire VERIFY01

**Removed the code + its two redemption rows** (the other option, exhausting
via `max_redemptions`, would have left a dead-but-visible key in the
table — full removal is cleaner for a code with no real tester attached).
`DELETE FROM redemptions WHERE code='VERIFY01'` (2 rows) then
`DELETE FROM invite_codes WHERE code='VERIFY01'` (1 row). No live test
keys remained after this step; new test keys minted for this dispatch's
own Task 6 verification were themselves fully cleaned up at the end (see
below).

## Task 1 — Schema + admin CLI

`invite_codes` gains `known_tiktok_handle`, `known_instagram_handle`,
`known_youtube_handle` (nullable, normalized lowercase/no-`@`, migrated
via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, same idempotent pattern as
every other column in this schema). `redemptions` gains `identity_choice`
(`NULL` | `'claimed'` | `'declined'`).

`validation/beta_admin.py`:
- `mint` gains `--handle` / `--instagram` / `--youtube` (pre-link a known
  handle at mint time).
- `list` now shows the pre-linked handle (if any) and a `claim` column:
  `yes` (fired), `declined`, `pending` (pre-linked, not yet redeemed), or
  `—` (ordinary code, nothing to confirm).
- `usage` now prints `identity_choice` for the user's redemption.

## Task 2 — Redemption flow

One endpoint, two calls, for a pre-linked code — `POST /api/invite/redeem`:
1. First call omits `claimIdentity` entirely. If the code is valid and
   pre-linked, nothing is written yet; responds `{needsConfirm:true,
   tiktokHandle, instagramHandle, youtubeHandle}`.
2. Second call repeats the request WITH `claimIdentity` (`true`/`false`)
   — now the redemption is actually inserted, and:
   - `true` ("That's me") — `upsertUserHandles` (shared with
     `/api/user/connect`'s own upsert logic, factored out so both call
     sites use the exact same code path) auto-connects the account, then
     `claimHandleHistory` runs (Task 3), `identity_choice='claimed'`.
   - `false` ("Not me") — redeemed normally, nothing connected or
     claimed, `identity_choice='declined'` (visible in `beta_admin list`).

An **ordinary** (non-pre-linked) code has no handle to confirm, so it
redeems on the FIRST call regardless of `claimIdentity` — byte-identical
to the metering build's original single-step behavior (verified live,
Task 6c).

Frontend `InviteGateScreen`: a `confirmInfo` state switches the screen
from code-entry to the "This invite is set up for @handle — that you?"
confirm step (two real buttons, "That's me" / "Not me", no dark pattern);
`null` for every ordinary code, so the regression path never renders it.

## Task 3 — History claim

`claimHandleHistory(userId, handle)` in `backend/server.js` — reusable
(the future Track Record build calls this same function, not a copy),
safe to re-run:
- Traced the actual linkage before writing anything: `posted_videos.
  user_id` is `NULL` for exactly one reason in this codebase —
  `worker.py`'s `--prospect` mode always passes an empty `userId`
  (`process_one_video`/`post_ingest`), since a not-yet-enrolled creator
  has no connected user yet. Its other caller, `run_scan_mode`, only ever
  iterates connected users already pulled from `users`, so a real user's
  own daily-scan rows always carry their real `user_id` and are never
  touched. That makes `handle = $2 AND user_id IS NULL` a precise, safe
  claim condition on its own — no need to additionally gate on
  `source='prospect_report'`.
- `UPDATE posted_videos SET user_id = $1 WHERE handle = $2 AND user_id IS
  NULL RETURNING id`, then the matching `shadow_scores` rows via
  `posted_video_id = ANY(...) AND user_id IS NULL` — ownership only,
  never `pool_eligible` or any scoring field.
- Never re-claims rows owned by a different `user_id` (reports a
  `skipped` count for those). Re-running for the same user finds nothing
  left to claim (`WHERE user_id IS NULL` matches 0) — verified live,
  Task 6d.
- **Known limitation** (comment in the function + here): identity is a
  localStorage UUID, not a real account. A second device redeeming the
  same pre-linked code gets its own new `user_id` (no cross-device sync)
  and finds the handle's history already claimed — first redemption owns
  it. Real auth resolves this at the paid build.

## Task 4 — Accounts screen

No code changes needed — `upsertUserHandles` writes to the same `users`
row `/api/user/connect` writes to, and the Accounts screen / connect-nudge
logic (`refreshTiktokConnected`, reading `GET /api/user/:userId`) already
render off that same row regardless of which path set it. Verified live
(Task 6a): the auto-connected handle shows up via `GET /api/user/:userId`
exactly like a manual connection, and a submission succeeds immediately
after. `InviteGateScreen`'s `onBound` callback was extended to also call
`refreshTiktokConnected()` (previously it only refreshed invite status),
so the nudge clears the instant the gate closes rather than waiting for
the Accounts modal to open/close once. Removing a handle afterward still
doesn't un-claim history — ownership is a one-way write with no reverse
path in either the manual-connect or auto-connect flow, so this is true
by construction, not a special case that needed guarding.

## Task 5 — Copy

`TESTER_WELCOME.md`: added a conditional sentence right after the invite
code line — "Your invite is pre-linked to @[HANDLE], so your history and
track record start populated the moment you're in" — marked
`(Include only if this tester's code was minted with --handle:)` since
this is a hand-sent template, not server-rendered. Confirm-screen copy
(`InviteGateScreen`) matches the house voice: warm, explains the "why"
(auto-connect + pulled-in track record), no hype, two equally-weighted
real buttons. `RECRUITMENT_RUNBOOK.md` gained a "Step 3" after the
`--prospect` ingest+render steps: mint the tester's code with
`beta_admin.py mint --label "Name" --handle theirhandle`.

## Task 6 — Verify live

All rows run against production (`previewpanel.onrender.com`), commit
`2a408e7`.

| Check | Result |
|---|---|
| **Regression (unlinked code):** mint `VERIFY2ORD` (no handle), redeem with no `claimIdentity` | redeemed on the FIRST call — `{"ok":true,...,"claimed":false,"claim":null}` — byte-identical to the metering build ✅ |
| **Pre-linked, "that's me":** mint `VERIFY2YES` (`--handle thecolorfulpantry`); first redeem call | `{"needsConfirm":true,"tiktokHandle":"thecolorfulpantry",...}` — nothing written yet ✅ |
| Confirm call with `claimIdentity:true` | `{"ok":true,"claimed":true,"claim":{"claimedPostedVideos":18,"claimedShadowScores":15,"skipped":0}}` ✅ |
| Account auto-connected | `GET /api/user/:userId` → `tiktok_handle:"thecolorfulpantry"` ✅ |
| Submission after auto-connect | real `/api/fetch-video` call → `{"jobId":...}` accepted ✅ |
| Idempotency re-check (Task 6d) | direct re-run of the same guarded `UPDATE ... WHERE user_id IS NULL` matched 0 rows for both tables — nothing left to claim ✅ |
| **Pre-linked, "not me":** mint `VERIFY2NO` (`--handle thecolorfulpantry`); confirm call with `claimIdentity:false` | redeemed, `claimed:false` ✅; `GET /api/user/:userId` → `{"error":"Not connected"}` (nudge would show) ✅ |
| `beta_admin.py list` reflects all three | `VERIFY2ORD` claim=`—`, `VERIFY2YES` claim=`yes`, `VERIFY2NO` claim=`declined` ✅ |
| Exempt paths | unaffected by construction — this dispatch added no new call sites to `checkBetaGate`/`recordBetaSubmissionEvent` (grep-reconfirmed: still exactly 2) |

**Cleanup** (standing convention, by id):
- Reset `thecolorfulpantry`'s prospect history to its pre-test state:
  18 `posted_videos` rows and 15 `shadow_scores` rows, all `user_id`
  reset `NULL` (matches the exact pre-test snapshot taken before Task 6
  began). Verified after: `0` rows still claimed, `18` total rows
  unchanged (no data loss).
- Deleted all 3 test redemptions (`verify2-yes-...`, `verify2-no-...`,
  `verify2-ord-...`), all 3 test invite codes (`VERIFY2YES`, `VERIFY2NO`,
  `VERIFY2ORD`), and the 1 auto-connected `users` row.
- Deleted the one real submission this test created (the live
  `/api/fetch-video` call under Task 6a): `submissions` id 7215,
  `pp_synthesis` id 1 (FK dependency, deleted first), `shadow_scores` id
  729, `beta_submission_events` id 3 — a stricter cleanup than the prior
  metering-build readout, per this prompt's own explicit "delete
  verification ... submissions" instruction.
- Final verification query: `0` remaining redemptions/invite_codes/users
  rows for the test ids, `0` remaining submissions, `18`/`0` posted_videos
  total/still-claimed for `thecolorfulpantry`. No live test keys remain
  (Task 0's removal + this pass together).

## Task 7 — Docs

`PreviewPanel_Operations_and_Roadmap.md` §1a item 10 extended in place
with the pre-linked-code paragraph (auto-connect, claim function + its
reuse by Track Record, the multi-device limitation).

## Files changed

**App repo (`~/PreviewPanel`):**
- `backend/server.js` — `invite_codes`/`redemptions` schema additions;
  `upsertUserHandles` (factored out of `/api/user/connect`);
  `claimHandleHistory`; `/api/invite/redeem` two-step confirm flow.
- `frontend/src/PreviewPanel.jsx` — `InviteGateScreen` confirm step;
  `onBound` also refreshes TikTok-connected status.
- `validation/beta_admin.py` — `mint --handle/--instagram/--youtube`;
  `list`/`usage` surface pre-linked handles + claim status.
- `TESTER_WELCOME.md`, `Recruitment/RECRUITMENT_RUNBOOK.md` — copy.

**Research repo (`~/correlation-research`):**
- `PreviewPanel_Operations_and_Roadmap.md` — §1a item 10 extended.

**Database:**
- `VERIFY01` (prior session's live test key) + its 2 redemptions: deleted.
- This dispatch's own test artifacts (3 codes, 3 redemptions, 1 users
  row, 1 submission chain): minted/created, verified, then fully deleted.
- `thecolorfulpantry`'s 18 `posted_videos` / 15 `shadow_scores` rows:
  claimed then reset back to their pre-test `user_id IS NULL` state.

## Git / deploy state

- Commit: `2a408e7` (Tasks 0-5), `4e513ee` (this readout), on
  `origin/main`, pushed.
- Deployed — Render (backend): Y, confirmed live via `/version`
  (`2a408e7`) before Task 6 began.
- Deployed — Vercel (frontend): auto-deployed from the same push;
  Task 6 verification ran via direct API calls against production
  (same server-side logic the UI calls into), not a browser session.
- Research repo: `dd436c7`, pushed.

## STOP

Per the prompt's own instruction — no further work started after this
readout.
