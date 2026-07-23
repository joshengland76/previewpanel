# Track Record v5.1 — Readout

A badge model, a milestone-modal ladder, and a welcome-modal variant on top of
the v5 two-era Track Record — plus fixture-harness extensions so every new state
was phone-reviewable before sign-off. App repo (server.js + PreviewPanel.jsx +
call_semantics untouched; `studyCopy` unchanged this round). Docs. Exempt paths
and keep-warm untouched. `record_config` NOT implemented.

## 1. Badge model

**One principle:** neutral = inventory (persistent, never clears on view); red =
unseen attention (always clears on view); claim numbers live in heroes only.

- **Outer History button:** neutral preview count INLINE in the label
  ("History (N)", from localStorage, hidden at N=0 → just "History"), PLUS a RED
  corner badge = count of UNSEEN graded rows. The legacy shape-shifting neutral
  graded-count badge was removed entirely.
- **Segmented control:** "Previews (N)" (localStorage) / "Track Record (M)" where
  M = TOTAL graded across BOTH eras (BLIND + JOINED); neutral, persistent, no
  number until M ≥ 1. Red unseen dot on the TR segment.
- **Unseen (red) = graded_at newer than a SERVER-SIDE per-user last-seen stamp**
  (`track_record_last_seen`), stamped via `POST /api/track-record/seen` when the
  TR segment is opened (segment click or smart-default landing). Neutral counts
  are never touched by viewing.
- **Suppression:** the red badge is suppressed until there are **≥ 6 graded
  videos** — we don't call attention to results below the point where calls start.
  Server-side (`unseenGradedCount = 0` when `totalGradedCount < 6`), so every red
  badge respects it; the neutral M count still shows.
- Day-one pre-linked user (blind n=14, never opened): red 14 outside + "Track
  Record (14)" + red 14 inside. After one open: no red anywhere, neutral 14
  persists.

## 2. Milestone modals

One-time, server-persisted flags (`milestone_{6,9,12,40}_shown`), fired on
session open when the **hero-owning era's graded window** (the window governing
the displayed calls) crosses a tier. Pure `computeMilestone(heroWindowN,
welcomeSeen, flags)` is the single decision, shared by the endpoint and fixtures.

| tier | title | gist |
|---|---|---|
| 6 (k=2) | Your track record is live. | still a small sample; top 2 / bottom 2 |
| 9 (k=3) | Your record just got sharper. | top 3 / bottom 3; more videos → more accurate |
| 12 (k=4) | Your track record is maturing | 12 videos; top & bottom 4 |
| 40 | Full-strength track record | the 40-video window cap = the study's measured slice; kept at your 40 most recent |

All buttons: **"See how our predictions are doing"** (+ quiet "Later").

- **Welcome outranks** on a first visit (the endpoint returns `milestoneModal`
  only once the welcome is already seen).
- **One per session:** the HIGHEST uncrossed qualifying tier surfaces.
- **Backfill guard:** a first-visit record that already qualifies (pre-linked
  claim) has every applicable tier marked shown WITHOUT a modal. Verified live:
  ballerinafarm (blind n=14) → `milestoneModal=null`, flags `(6,9,12)` set,
  `welcomed=false` → **zero milestone modals** on day one (welcome covers it).

## 3. Welcome modal variant + trigger fix

**Every redeemer** now sees the welcome modal. **Trace of why it didn't before:**
`welcomeNeeded` required `isPreLinked && claimedPostedVideos > 0`, and the
reactive fallback required `trackRecordHasContent` (false at `no_handle`) — so a
plain code redeemer got neither. Fix: `welcomeNeeded = true` for every fresh
redeem (+ a users-row upsert so `track_record_welcomed`/milestone/last-seen
flags persist for plain redeemers), and the trigger no longer gates on content;
`/api/track-record` returns `welcomeSeen` even at `no_handle`.

The **no-prepop variant** (no blind data, `blindGradedCount === 0`): same title +
body through the 2-in-3 sentence, DROPS "we brought receipts", a single primary
"Run a video" button, and a footer "Your track record will build under History as
you preview and post." The pre-linked (prepop) variant is unchanged. Verified
live: a fresh unlinked code redeem → `blindGraded=0`, `welcomeSeen=false` →
no-prepop variant.

## 4. Fixture harness (phone-reviewable) — what the REAL logic computed

`?fixture=<name>` (endpoint) / `?trdemo=<name>` (frontend, mock badge header +
real modal component). All computed by real logic; fixtures supply only
predictions/outcomes/state.

| fixture | shows |
|---|---|
| badge-fresh | total 14, unseen **14** → red 14 (History) + "Track Record (14)" + red 14 |
| badge-seen | total 14, unseen **0** → neutral 14 persists, red cleared |
| badge-mixed | previews **24**, total 14, unseen **3** → "History (24)" + red 3, "Previews (24)", "Track Record (14)" + red 3 |
| badge-sub6 | 4 graded → "Track Record (4)" neutral, unseen suppressed to **0** (no red below 6) |
| milestone-6 / 9 / 12 / 40 | the tier modal (computed by `computeMilestone`), over the tab |
| welcome-noprepop | `blindGraded=0`, `welcomeSeen=false` → no-prepop welcome |

**Josh reviewed all states on his phone and signed off.**

## 5. Verification

- **Unit** (`backend/test_track_record_v5.mjs`, all green): all v5 tests plus the
  milestone ladder (6/9/12/40), backfill guard (first-visit n=14 → [6,9,12];
  n=40 → all four), one-per-session (highest uncrossed), welcome-unseen outranks,
  badge neutral-persistence / red-clears / zero-hiding, sub-6 red suppression,
  welcome-noprepop selection. Loads the REAL functions from server.js.
- **Live fixtures:** all 9 rendered on the deployed frontend.
- **Live proxy pass** (with cleanup): ballerinafarm redeem → day-one red 14 +
  "Track Record (14)", `milestoneModal=null` with all milestone flags backfilled,
  welcome-with-receipts (prepop); a fresh unlinked code → no-prepop welcome, no
  milestone. Rows released, users/redemptions/temp code deleted.
- `node -c server.js` OK; `npm run build` OK.

## 6. Git / deploy state

App repo on `origin/main`: v5.1 across `2944a7d` (badge model + milestone/welcome
+ fixtures), `0c11807` (milestone copy + milestone-40 + button + red suppression),
plus this commit (docs + readout). New user columns
(`track_record_last_seen`, `milestone_{6,9,12,40}_shown`) added idempotently on
startup. Backend live on Render, frontend on Vercel. Docs: Ops §1 item 11 gained
a **(Track Record v5.1)** block. Exempt paths and keep-warm untouched.
