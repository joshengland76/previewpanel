# Beta UX Polish v2 Readout — demo release, code UX, bio-code hide, Track Record reachability

App repo. **Hard constraints honored:** keep-warm not touched. Exempt
paths (research_api, `/api/validation/ingest`, prospect worker) stay
completely exempt — unaffected by this dispatch (grep-reconfirmed: still
exactly 2 `checkBetaGate`/`recordBetaSubmissionEvent` call sites,
`/api/analyze` and `/api/fetch-video`).

## Task 0 — Release Josh's demo claim

Found: invite code `WWGKCQDS` ("Josh demo"), pre-linked to
`jamieegabrielle`, redeemed by `user_id=daf0a490-b40a-4cf4-b8d5-592284b4e695`
— 18 `posted_videos` rows claimed (5 `prospect_report` + 13
`study_history`). Explicit ids captured before any write:
`[44, 45, 46, 47, 48, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105]`.

- Un-claimed (reset `user_id` to `NULL`) by explicit id: 18 rows.
- Deleted: 1 redemption, 1 `users` row, `invite_codes` code `WWGKCQDS`.
- **Verified:** `0` rows still claimed for `jamieegabrielle`; all 13
  `study_history` rows still present AND still graded (kept, per the
  same "durable deliverable" convention established for study-history
  rows — only ownership resets, never the grade).

## Task 1 — Invite code UX

- **Case-insensitive end to end:** `beta_admin.py mint` canonicalizes
  `--code`/generated codes to uppercase (`.strip().upper()`); the redeem
  endpoint uppercases+trims the input before the `WHERE code = $1`
  comparison. Verified live: entering `uxv2jamie` (lowercase) against a
  code minted as `UXV2JAMIE` redeemed correctly first try.
- **Scroll-to-top:** the invite-gate overlay is `position: fixed` and
  never locked background scroll, so a page scrolled down before the
  gate closes stayed scrolled down underneath it. `onBound` now calls
  `window.scrollTo(0, 0)` explicitly — covers both the ordinary redeem
  path and the pre-linked confirm path (both call the same `onBound`).
  Verified live: scrolled to `y=244.5` before confirming, landed at
  `y=0` after.

## Task 2 — Hide the bio-code block

Removed the verification-code display + "future update" copy from the
Accounts screen (`AccountSettings.jsx`) entirely. The backend column/
generator (`users.bio_code`, `generateBioCode()`) stay in place with a
comment: dormant, pre-linked invites made bio verification redundant for
beta (an invite already ties a real handle to a `user_id` at redemption
— there's no unverified-handle gap left to close), revisit if/when the
auth/paid build needs to verify a handle with no pre-linked code behind
it. Grepped for other bio-verification copy: only a now-stale top-of-file
comment in `AccountSettings.jsx` referencing the removed display, updated
to match; no other active copy anywhere referenced it (`TESTER_WELCOME.md`
never did — confirmed, satisfying Task 5's sanity check too). Verified
live: Accounts modal shows the connected handle, no bio-code block below
the Update button.

## Task 3 — Track Record reachability

**Root finding confirmed:** the History button was rendered only when
`history.length > 0` — every pre-linked invitee starts at exactly zero
local previews, so the button (and therefore Track Record) was
completely unreachable for the entire population this feature is
supposed to serve on day one.

**(a) Always-on entry point.** Removed the conditional. At zero
previews, label drops the misleading `(0)` and instead shows: the
unseen-graded count as a red badge when there's something new, else the
plain graded-call count (`· N graded`) once already seen. Regression:
identities WITH local previews are completely unaffected (`📋 History
(N)`, unchanged).

**(b) Smart default segment.** Opening History (the moment it goes
from closed to open, not on close) now checks: zero local previews AND
Track Record has real content (`state` is not `no_handle`/`no_posts_yet`)
→ land on Track Record; otherwise → Previews, exactly as before.

**(c) Claim banner.** A "that's me" claim that attaches ≥1 row shows a
dismissible banner on the submit screen: "Your track record is ready —
N graded calls · View it" (N = `gradedCallCount`, hit|miss only, matching
the same number used everywhere else in Track Record — deliberately NOT
the raw claimed-row count, which would include `no_call` rows a tester
never asked about). Clicking it or "View it" opens History directly on
the Track Record segment. Dismissal (and viewing) both set a
`localStorage` flag the moment the banner is shown, before any dismiss
click — "shown once" and "dismissed" are the same permanent state, so it
truly never returns either way, exactly as specified.

**(d) Empty-Previews cross-link.** When Previews is empty but Track
Record has content, the empty-state message is replaced (not
supplemented) by "No previews yet — your Track Record is here →",
clickable, switching segments in place.

**(e) Boundary comment.** One comment at the History surface (where the
segmented control renders): Previews = this identity's own app preview
runs only (client-side, `localStorage`); posted-video history
(prospect/study-history/real day-30 outcomes) lives entirely in Track
Record, never mixed into Previews even when both are non-empty for the
same user.

**Self-caught polish (found during live verification, not a listed
requirement):** landing directly on Track Record via the smart default
(3b) didn't optimistically clear the unseen badge the way clicking the
inner segmented tab already did — a half-second staleness, not a
correctness bug (it self-corrected on the next full summary refresh
regardless). Fixed for consistency: the smart-default path now clears
the badge the identical way. Committed as a separate, clearly-labeled
follow-up commit (`d1d9ba9`) rather than folded silently into the main
change.

## Task 4 — Verify live

Real browser session (Chrome via automation), mobile width (390×844),
fresh identity (`localStorage.clear()` — private-profile equivalent),
against production (`previewpanel.vercel.app`), commit `96ce54d`
(+ `d1d9ba9` for the self-caught polish, frontend-only, no Render
redeploy needed).

| Check | Result |
|---|---|
| Mint `UXV2JAMIE` (`--handle jamieegabrielle`), enter `uxv2jamie` (lowercase) | Redeemed — confirm screen shows "@jamieegabrielle" ✅ |
| Scrolled to `y=244.5` before "That's me" | Lands at `y=0` after ✅ |
| History button at zero previews | Present, badge "13" (unseen-graded, all 13 rows never seen before) ✅ |
| Claim banner | "Your track record is ready — 9 graded calls · View it" ✅ (matches server: 9 hit, 0 miss, 4 no_call = gradedCallCount 9) |
| History button click (smart default) | Opens directly on Track Record segment, populated: "Called it: 9 of 9", ON THE RECORD (5 pending rows w/ real captions + percentile pills + check-in dates), GRADED (13 rows: 9 ✓ hits, 4 italic "no call", correct percentiles/times-typical) ✅ |
| Banner "View it" also opens Track Record directly | ✅ (same code path) |
| Accounts screen | Shows connected `jamieegabrielle`, no bio-code block ✅ |
| Previews empty-state cross-link | "No previews yet — your Track Record is here →", clicking switches segments ✅ |
| Dismiss banner (×) | Banner gone ✅ |
| Reload | Banner does NOT return; History button still present, now "History · 9 graded" (unseen count correctly 0 after having viewed it) ✅ |
| Regression: identity WITH 1 local preview (injected via `pp_history_v1`) | "History (1)" — unchanged from pre-existing behavior; opening defaults to Previews, showing the injected entry ✅ |

**Observation, not a defect:** study-history rows show "Posted video" as
their caption (generic fallback) rather than a real snippet —
`sync_study_history.py` never captured `research_videos.caption` into
`posted_videos.caption` (out of that dispatch's own listed scope: id,
posted_at, y_pred, avg_score, outcome, is_day30_equiv). Prospect-sourced
pending rows show real captions correctly, since those come from
`worker.py --prospect`'s own ingest, which does capture captions.
Flagged for awareness; not fixed here (outside this prompt's scope).

**Cleanup** (hardened convention — explicit id list, captured before any
write): `user_id=1f6b2f02-94a5-4506-9c57-b5a6da748c0e` claimed the exact
same 18 ids as Task 0's Josh-demo case (expected — same handle, same
current unclaimed pool). Un-claimed by those exact ids; deleted the test
redemption, `users` row, and `invite_codes` code `UXV2JAMIE`. Verified:
`0` still claimed, `13` `study_history` rows intact and still graded,
`0` remaining test codes/users rows.

## Task 5 — Docs

`PreviewPanel_Operations_and_Roadmap.md` §1a: two-liner appended to item
11 (always-on entry point + smart default + banner; bio-code hidden/
dormant). `TESTER_WELCOME.md`: sanity-checked — never referenced the
bio code in the first place (confirmed via grep, no edit needed).

## Cleanup convention

Explicit id lists, captured before any write, per the hardened
convention (`PreviewPanel_Operations_and_Roadmap.md`'s cleanup-convention
bullet). Both Task 0 (real prior usage, not a test artifact — released,
not deleted) and Task 4 (this dispatch's own test) are listed above with
their exact ids.

## Files changed

**App repo (`~/PreviewPanel`):**
- `backend/server.js` — redeem endpoint uppercases+trims the code input;
  `generateBioCode()` comment updated (dormant, why).
- `frontend/src/PreviewPanel.jsx` — always-on History button + populated-
  state signal; smart-default segment; claim banner; Previews empty-state
  cross-link; boundary comment; scroll-to-top on gate close.
- `frontend/src/components/AccountSettings.jsx` — bio-code block removed;
  stale top-of-file comment updated.
- `validation/beta_admin.py` — `mint` canonicalizes codes to uppercase.

**Research repo (`~/correlation-research`):**
- `PreviewPanel_Operations_and_Roadmap.md` — §1a two-liner.

**Database:**
- Task 0: 18 `posted_videos` rows released (Josh's real demo usage,
  un-claimed, not deleted — the rows themselves are real, durable
  `study_history` data).
- Task 4: 18 rows claimed then released again (this dispatch's own test,
  same handle/pool); 1 test code, 1 redemption, 1 `users` row created
  then fully deleted.

## Git / deploy state

- Commits: `96ce54d` (Tasks 0–3, 5), `d1d9ba9` (self-caught badge-clear
  polish), `d8a1951` (this readout), on `origin/main`, pushed.
- Deployed — Render (backend): Y, confirmed live via `/version`
  (`96ce54d`) before live verification began.
- Deployed — Vercel (frontend): auto-deployed from both pushes; all of
  Task 4's verification ran in a real browser session against
  `previewpanel.vercel.app` (not just API calls) at mobile width.
- Research repo: `36d0c42`, pushed.

## STOP

Per the prompt's own instruction — no further work started after this
readout. The study-history caption gap (shows "Posted video" instead of
a real snippet) is flagged for awareness, not picked up as new work here.
