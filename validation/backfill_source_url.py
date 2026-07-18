#!/usr/bin/env python3
"""
backfill_source_url.py — Enhancements, Task 3: one-time (re-runnable,
idempotent) pass over historical Section-B-origin shadow_scores rows
missing source_url, reconstructing it wherever the linkage actually
determines it -- never guessed. Prevents the surprise re-spend
jamieegabrielle hit (Transport hotfix, Task 6): her Section-B rows
predated the source_url column, so per-video reuse silently found zero
matches and re-fetched all of them.

Two provenances, two outcomes:
  - source IN ('prospect_report', 'validation'): linked via
    shadow_scores.posted_video_id -> posted_videos.{handle,
    tiktok_video_id}, both of which are always populated for these jobs
    (posted-video framing is TikTok-only throughout this pipeline) --
    the canonical URL is fully DETERMINABLE:
    https://www.tiktok.com/@{handle}/video/{tiktok_video_id}.
  - source = 'link_fetch': linked via shadow_scores.submission_id ->
    submissions, but submissions.file_name for a link-fetch job is a
    GENERIC placeholder ("<platform>_link_fetch.mp4"), not the video's
    own id or URL -- there is no column anywhere in that linkage that
    carries the real URL. UNDETERMINABLE by construction; reported, not
    guessed at (e.g. never reconstructed via timing/ordering heuristics
    against a creator's candidate list -- that's a manual, case-by-case
    forensic technique, not a safe bulk rule for every historical row).

Loose-end fix (2026-07-19): the first run of this script (Enhancements,
Task 3) reported "backfilled: 15" but the writes never persisted --
generate_preview.DB never sets autocommit and never calls conn.commit(),
so db.close() silently rolled back every UPDATE. The reported count came
from each UPDATE's own rowcount within the (never-committed) transaction,
which is real and correct in isolation -- the bug was that nothing
committed it before the connection closed. Fixed here two ways: (a) an
explicit conn.commit() after the write loop, and (b) a post-write
verification query, run from a FRESH connection (not just re-reading
inside the same possibly-uncommitted transaction, which would have
"confirmed" the original bug just as convincingly), that re-counts how
many of the just-backfilled ids actually now show a non-null source_url
-- so this script can never again report success it didn't achieve.

Usage: ./_venv/bin/python3 backfill_source_url.py [--dry-run]
"""
import argparse
import sys

from generate_preview import DB, db_connect


def run(dry_run):
    db = DB()

    determinable = db.query("""
        SELECT s.id, pv.handle, pv.tiktok_video_id
        FROM shadow_scores s
        JOIN posted_videos pv ON pv.id = s.posted_video_id
        WHERE s.source_url IS NULL AND s.posted_video_id IS NOT NULL
          AND pv.handle IS NOT NULL AND pv.tiktok_video_id IS NOT NULL
    """, fetch="all", cursor_factory=None)

    backfilled_ids = []
    for shadow_id, handle, tiktok_video_id in determinable:
        url = f"https://www.tiktok.com/@{handle.lstrip('@')}/video/{tiktok_video_id}"
        print(f"[backfill_source_url] {'[dry-run] ' if dry_run else ''}shadow_scores.id={shadow_id} -> {url}")
        if not dry_run:
            db.query("UPDATE shadow_scores SET source_url = %s WHERE id = %s", (url, shadow_id))
        backfilled_ids.append(shadow_id)

    undeterminable = db.query("""
        SELECT COUNT(*) FROM shadow_scores
        WHERE source_url IS NULL AND source = 'link_fetch'
    """, fetch="one", cursor_factory=None)[0]

    if not dry_run:
        db.conn.commit()
    db.close()

    print(f"[backfill_source_url] backfilled: {len(backfilled_ids)}{' (dry-run, not written)' if dry_run else ''}"
          f"{' ids=' + str(backfilled_ids) if backfilled_ids else ''}")
    print(f"[backfill_source_url] undeterminable (source='link_fetch', no URL anywhere in the "
          f"submissions linkage -- file_name is a generic placeholder for these jobs, not the "
          f"video's own id): {undeterminable}")

    if dry_run or not backfilled_ids:
        return

    # Post-write verification, Loose-end fix -- a FRESH connection (not
    # this script's own, which just committed, but a genuinely separate
    # one) re-reads exactly the ids this run wrote, so "backfilled: N"
    # can never again mean anything other than "N rows persisted."
    verify_conn = db_connect()
    verify_cur = verify_conn.cursor()
    verify_cur.execute(
        "SELECT COUNT(*) FROM shadow_scores WHERE id = ANY(%s) AND source_url IS NOT NULL",
        (backfilled_ids,),
    )
    persisted = verify_cur.fetchone()[0]
    verify_cur.close()
    verify_conn.close()

    if persisted == len(backfilled_ids):
        print(f"[backfill_source_url] VERIFIED: all {persisted} of {len(backfilled_ids)} "
              f"backfilled row(s) confirmed persisted on a fresh connection.")
    else:
        print(f"[backfill_source_url] VERIFICATION FAILED: only {persisted} of "
              f"{len(backfilled_ids)} backfilled row(s) actually persisted -- "
              f"the write did not commit. Do not trust the 'backfilled' count above.",
              file=sys.stderr)
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report what would change without writing")
    args = ap.parse_args()
    run(args.dry_run)


if __name__ == "__main__":
    main()
