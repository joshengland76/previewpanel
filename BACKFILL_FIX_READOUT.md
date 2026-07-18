# Backfill Fix Readout — backfill_source_url.py persistence loose end

App repo. **Zero scoring spend** — metadata repair only, no judging or
extraction calls. Keep-warm not touched.

## Task 1 — Root-cause + fix

**Confirmed:** autocommit off, no `conn.commit()` — a plain missing-commit
bug, not a rolled-back-transaction-due-to-an-error or anything more
exotic. `backfill_source_url.py` reused `generate_preview.DB`, whose
`db_connect()` never sets `autocommit` and whose `.query()` method never
calls `.commit()` (verified empirically this session, again, to be sure:
an `INSERT` followed by `conn.close()` with no commit is invisible from a
fresh connection). The script's own `db.close()` at the end silently
rolled back every `UPDATE` from its original run. The reported
"backfilled: 15" was real in the narrow sense that each `UPDATE`'s own
rowcount was genuinely 15 within that (never-committed) transaction —
the bug was that nothing told Postgres to keep it.

**Confirmed independently before touching anything:** of the 16
`shadow_scores` rows currently showing a non-null `source_url`, all 16
carry values consistent with live writes (`/api/fetch-video`'s
`job.sourceUrl` / `/api/validation/ingest`'s `sourceUrl` param at scoring
time — Transport hotfix's own mechanism), not the backfill script's
output. None trace back to that original run.

**Fix**, `backfill_source_url.py`:
1. Explicit `db.conn.commit()` right after the write loop (before
   `db.close()`).
2. A post-write verification block that opens a **genuinely separate**
   connection (`generate_preview.db_connect()`, not a re-read inside the
   same transaction — which would have "confirmed" the original bug just
   as convincingly) and re-counts how many of the exact ids just written
   now show a non-null `source_url`. Exits non-zero with a loud stderr
   message if the count doesn't match — the script can no longer report
   a backfill count it didn't actually achieve.

## Task 2 — Re-run against production

`--dry-run` first, then the real run. Results (fresh-connection-verified
both times: once inside the script's own post-write check, once more
independently for this readout):

- **Backfilled: 33**, ids `[731, 67, 692, 693, 694, 695, 696, 697, 698,
  699, 700, 701, 702, 703, 704, 707, 708, 709, 710, 711, 712, 713, 714,
  715, 716, 717, 718, 719, 720, 721, 722, 725, 727]` — spanning
  `oliviabethg`, `diaryofhers`, and a handful of this session's own
  earlier structural-verification rows (`beta_verify_test_handle*`, left
  in place per established precedent, now also correctly carrying their
  `source_url`). More than the original run's claimed 15 because
  additional prospect/validation ingest has landed since (including this
  session's own dispatches) — expected, not a discrepancy.
- **Undeterminable: 51** — `source='link_fetch'` rows with no URL
  anywhere in the `submissions` linkage. **Confirmed still exactly 51**,
  matching the prompt's own expectation and the original run's report
  (this number was never affected by the commit bug — it's a `COUNT(*)`
  read, not a write).
- **Already correct: 16**, ids `[677, 678, 681, 682, 683, 684, 685, 686,
  687, 688, 689, 690, 691, 723, 728, 730]` — all live-written (Transport
  hotfix's `sourceUrl` threading), unrelated to any backfill run, ever.
- **Verification, final:** `33 + 16 = 49` total rows with `source_url`
  now (independently re-queried); `0` remaining determinable-but-missing;
  `51` undeterminable, unchanged.

## Task 3 — Verify the fix does what it exists for

Picked one backfilled row (`shadow_scores.id=692`, `oliviabethg`'s video
`7651464590731037966`) and ran the exact query shape
`generate_preview.py`'s own `_reused_row_for_url` uses (per-video
Section-B reuse, Hotfix v2) — `WHERE s.source_url = %s AND s.created_at
> now() - interval '%s hours'` — widening the hours window only because
this is a historical row and the check is about matchability, not
recency:

```
SELECT s.id, s.prediction, s.source_url, s.created_at FROM shadow_scores s
WHERE s.source_url = 'https://www.tiktok.com/@oliviabethg/video/7651464590731037966'
  AND s.created_at > now() - interval '100000 hours'
```

**Result:** returns the row (`id=692`, `prediction=0.2643...`). Before
this fix, `source_url` was `NULL` for this row — the identical query
would have matched nothing, and a `--study` render requesting this exact
video within its reuse window would have silently re-fetched and
re-scored it live, the exact `$0.10`-per-video waste this whole mechanism
(and the original Enhancements dispatch) exists to prevent. No
re-scoring was run — this was a read-only confirmation.

## Task 4 — Guard-rail check (report-only)

Every `validation/*.py` script with an `INSERT`/`UPDATE`:

| Script | Commit pattern | Verdict |
|---|---|---|
| `backfill_source_url.py` | **Was** the bug (`generate_preview.DB`, no commit) — fixed this dispatch | fixed |
| `beta_admin.py` | own `db_connect()`, `conn.autocommit = True` | safe |
| `collect_day30.py` | own `db_connect()`, explicit `conn.commit()` at all 3 write sites | safe |
| `sync_study_history.py` | uses `generate_preview.DB`, but already calls `db.conn.commit()` per row (added during the Track Record dispatch, after discovering this exact class of bug) | safe |
| `worker.py` | own `DB` class, `query(..., commit=True)` used at every write site | safe |

**No other script currently exhibits the actual bug** (an uncommitted
write silently rolled back). `generate_preview.py` itself never writes to
the DB at all — the non-committing `DB` class is harmless there and only
became a real bug because `backfill_source_url.py` was the one script
that reused it for writes without adding its own commit.

**Lower-severity form of the same pattern, worth naming (not fixed this
session):** `worker.py` and `collect_day30.py` both commit correctly but
neither does a fresh-connection post-write re-read the way
`backfill_source_url.py` now does — they trust their own `commit()` call
unconditionally. Given both explicitly and correctly commit, this is a
much lower risk than the bug just fixed, not a live issue. `beta_admin.py`
similarly has no re-read, but its writes are single-row admin actions
immediately checkable by the operator via `list`/`usage` — lowest
priority of the three. Listed for awareness per the prompt's own
report-only scope; nothing beyond `backfill_source_url.py` touched this
session.

## Cleanup convention

N/A — no test rows were created this dispatch. Every row touched (the 33
backfilled + the 16 already-correct + the 51 undeterminable) is real
production data; no fixture or throwaway `user_id` was involved.

## Files changed

**App repo (`~/PreviewPanel`):**
- `validation/backfill_source_url.py` — explicit commit + fresh-connection
  post-write verification.

**Research repo (`~/correlation-research`):**
- `PreviewPanel_Operations_and_Roadmap.md` — corrected the §1e
  Enhancements paragraph's "recovered 15 historical rows" claim (it never
  persisted); notes the real count (33, fresh-connection-verified) and
  points to this readout.

**Database:**
- 33 `shadow_scores` rows backfilled with `source_url`, verified
  persisted from two independent fresh connections.

## Git / deploy state

- No backend/frontend code changed — this is a Mac-side validation
  script only, no deploy needed (consistent with this session's own
  precedent for Python-only fixes).
- Commit: `35ff01e`, on `origin/main`, pushed.
- Research repo: `55f42dd`, pushed.

## STOP

Per the prompt's own instruction — no further work started after this
readout. The Task 4 lower-severity candidates (`worker.py`,
`collect_day30.py`'s missing post-write re-read) are flagged for
awareness, not picked up as new work here.
