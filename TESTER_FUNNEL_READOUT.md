# Tester Funnel Visibility + Pre-Send Code Hygiene — Readout

Made every invite code observable in one funnel, reconciled the code table
with Josh's confirmed dispositions, cleaned the self-test residue off the
five real-creator handles so they can be invited fresh, and wired the funnel
into the 5 AM morning chain. App repo + research repo; DB hygiene is live in
Neon. Doc ticks went to `PreviewPanel_Operations_and_Roadmap.md` §1a (not the
runbook) and `RECRUITMENT_RUNBOOK.md`.

---

## Task 0 — read-only inventory, reconciled against Josh's dispositions

Every code was inventoried before anything destructive ran. Reality matched
Josh's dispositions with **one discrepancy, surfaced and cleared before the
hygiene**: `WSZG6TVV` (triedandtruemoms) had **0 redemptions**, not the
Josh-era self-test the dispatch assumed. Josh said "yes, proceed" — it was
retired as an unredeemed code, which aligns with the re-invite intent.

Confirmed dispositions:

- **KEEP + INTERNAL** — `2YQ6FMCT` (Josh's founder test, unlinked). Retro-flag
  applied: `is_internal=true` on the code **and** on its bound identity
  (`users` `b878ba6e-…`).
- **RELINQUISH + RETIRE** (self-test redemptions on real creators' handles) —
  `9Z2QAE22` jamieegabrielle · `NRCYBF5Q` ballerinafarm · `WSZG6TVV`
  triedandtruemoms · `D5W755G6` .dylansnyder · `6U6XARAM` ellieeengland.
- **KEEP UNTOUCHED** (friend demos, expected unredeemed) — `CJJZYV9W` Ellie ·
  `A3Q2HKEB` Luke · `GYRTPESB` Parker · `RF9WQNFQ` Owen.

## Task 1 — pre-send hygiene (executed, live in Neon)

Safety check first: confirmed **0 claimers outside the five relinquish-code
redeemers** before un-claiming anything. Then, inside one live transaction:

- **Un-claimed** 109 `posted_videos` rows (`user_id` → NULL), **keeping** the
  synthesized `study_history` + `prospect_report` rows themselves so the
  creators' records re-populate the moment they redeem a fresh code.
- **Deleted** the self-test residue: 20 `shadow_scores`, 0 fingerprints,
  35 `user_events`, 0 `beta_submission_events`, 8 `redemptions`, 8 `users`.
- **Retired** the 5 relinquish codes (deleted; remaining count = 0).
- **Flagged internal:** `is_internal=true` on `2YQ6FMCT` + user `b878ba6e-…`.

Verified row totals **unchanged** (nothing real was lost), claimed counts
dropped to zero:

| handle | rows | source breakdown | claimed after |
|---|---|---|---|
| jamieegabrielle | 20 | study_history:13, prospect_report:7 | 0 |
| ballerinafarm | 19 | prospect_report:18, (1 unsourced) | 0 |
| triedandtruemoms | 10 | prospect_report:10 | 0 |
| .dylansnyder | 65 | study_history:65 | 0 |
| ellieeengland | 24 | prospect_report:18, (6 unsourced) | 0 |

### Fresh mint commands (run when ready to re-invite)

Labels below are suggested (edit to taste). The existing un-claimed rows
**re-attach automatically** at redemption via `claimHandleHistory` — no
re-ingest needed; these creators open with a populated Track Record day one.

```bash
cd ~/PreviewPanel/validation

# Study / OOF-covered — mint auto-syncs study_history (sync_study_history.py).
# Existing study_history (+ any prospect) rows re-attach on redeem.
./_venv/bin/python3 beta_admin.py mint --label "Jamie Gabrielle"   --handle jamieegabrielle
./_venv/bin/python3 beta_admin.py mint --label "Dylan Snyder"      --handle .dylansnyder

# Prospect (no OOF coverage) — no study-sync fires; the already-ingested
# prospect_report rows re-attach on redeem. Only re-run worker.py --prospect
# if you want to freshen with posts made since the original ingest.
./_venv/bin/python3 beta_admin.py mint --label "Ballerina Farm"     --handle ballerinafarm
./_venv/bin/python3 beta_admin.py mint --label "Tried and True Moms" --handle triedandtruemoms
./_venv/bin/python3 beta_admin.py mint --label "Ellie England"       --handle ellieeengland
```

## Task 2 — `validation/pipeline_status.py` rebuilt as a per-code funnel

Was: a table of redeemed non-internal testers only. Now: **one row per invite
code**, including codes sent but not yet redeemed (shown "— awaiting"), so a
still-dark tester is visible instead of invisible. Per row: code · label ·
handle · first `redeemed_at` · redemptions used · opens / runs / TR-views at
**24h / 7d / all** · last-seen · `[internal]` marker. Internal identities are
**included** and carry a `pool_elig=false N/total` sanity column. Graceful
empty states throughout; the existing posted-video / day-30 block is retained
below the funnel. Live output:

```
=== TESTER FUNNEL — one row per invite code ===
(telemetry epoch: 2026-07-18 22:42 UTC — activity before this is invisible)
code       label                handle    redeemed    used opens 24h/7d/all  runs      TR 24h/7d/all last-seen   tag
A3Q2HKEB   Luke                 —         — awaiting  0    0/0/0             0/0/0     0/0/0         —
CJJZYV9W   Ellie                —         — awaiting  0    0/0/0             0/0/0     0/0/0         —
GYRTPESB   Parker               —         — awaiting  0    0/0/0             0/0/0     0/0/0         —
RF9WQNFQ   Owen                 —         — awaiting  0    0/0/0             0/0/0     0/0/0         —
2YQ6FMCT   Josh founder         —         2026-07-18  1    2/7/9             1/2/5     0/2/2         2026-07-26  [internal] pool_elig=false 20/41

=== POSTED-VIDEO / DAY-30 COLLECTION (model-validation feed) ===
status            rows   day30 collected  graded
day30_collected   152    152              124
scored            68     0                0
failed            17     0                0
downloaded        7      0                0
```

## Task 3 — morning wiring

`correlation-research/run_morning.py` now runs the app-side
`validation/pipeline_status.py` as **step 8**, under a "TESTER FUNNEL" banner,
so the funnel lands in the 5 AM report. It runs on the validation venv
(`PP_VALIDATION_VENV_PYTHON`) with the app repo as cwd, and is **fail-soft**:
`"tester-funnel"` is in `NON_FATAL_STEPS`, so a failure logs and continues —
it can never block or fail the morning chain. (The existing research-side
`pipeline_status.py` overnight-health step is unchanged.)

## Task 4 — post-redemption attach timing

Confirmed: `claimHandleHistory(userId, handle)` runs on **every**
`/api/track-record` load (`server.js` ~4307), not only at redemption — an
idempotent safety net that claims any unclaimed `posted_videos` rows matching
the tester's connected handle. A freshen-timing note was added to
`RECRUITMENT_RUNBOOK.md`: freshly-ingested rows attach to a connected tester
on their **next Track Record load**, automatically — no separate re-link step,
no need to time the ingest to their session.

## Task 5 — event-log sanity

- **Telemetry epoch** (earliest `user_events` row): **2026-07-18 22:42 UTC** —
  activity before this is invisible (the table didn't exist yet).
- **Josh's `2YQ6FMCT` usage** produced real telemetry: opens 2/7/9 and runs
  1/2/5 confirm `session_open` **and** `preview_run` events landed.

## Task 6 — live verification

Ran the upgraded script live (excerpt above). Inserted **one throwaway
`session_open`** for the internal user and re-ran: the 24h opens column ticked
**2 → 3** (2/7/9 → 3/8/10), confirming the funnel catches new activity in the
24h window. Then **deleted** the throwaway (id 135) and verified back to
baseline (0 throwaway rows, 24h opens = 2).

---

## ⚠ Open finding for Josh's decision — pre-flag pool rows (NOT changed)

The internal sanity column reads `2YQ6FMCT` **pool_elig=false 20/41**. That
means **21 of Josh's 41 founder-test `shadow_scores` rows are still
`pool_eligible=true`** — they entered the comparison pool **before**
`is_internal` was set, and the flag only forces `pool_eligible=false` on rows
written *from then on* (it's a write-time gate, not a retroactive sweep). So
21 founder test runs are currently polluting the live comparison pool.

I did **not** touch the pool. On your go-ahead I'll retire those 21 rows
(`pool_eligible=false` for user `b878ba6e-…`), which removes them from the
pools cleanly — same mechanism the internal flag uses going forward. Say the
word and I'll run it.

---

## Git / deploy state

- **App repo (`~/PreviewPanel`):** `validation/pipeline_status.py`,
  `Recruitment/RECRUITMENT_RUNBOOK.md`, and this readout.
- **Research repo (`~/correlation-research`):** `run_morning.py`,
  `PreviewPanel_Operations_and_Roadmap.md`.
- **No app runtime code changed** → no Render/Vercel deploy required. The DB
  hygiene is already live in Neon (executed this dispatch). `run_morning.py`
  runs locally on this Mac's schedule; the next 5 AM chain picks up step 8
  automatically.
- Pre-existing uncommitted files not part of this dispatch
  (`Summary documents/README_SUMMARY_DOCS.md`, `TESTER_OUTREACH.md`) were left
  untouched.
