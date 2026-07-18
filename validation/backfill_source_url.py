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

Usage: ./_venv/bin/python3 backfill_source_url.py [--dry-run]
"""
import argparse
import sys

from generate_preview import DB


def run(dry_run):
    db = DB()

    determinable = db.query("""
        SELECT s.id, pv.handle, pv.tiktok_video_id
        FROM shadow_scores s
        JOIN posted_videos pv ON pv.id = s.posted_video_id
        WHERE s.source_url IS NULL AND s.posted_video_id IS NOT NULL
          AND pv.handle IS NOT NULL AND pv.tiktok_video_id IS NOT NULL
    """, fetch="all", cursor_factory=None)

    backfilled = 0
    for shadow_id, handle, tiktok_video_id in determinable:
        url = f"https://www.tiktok.com/@{handle.lstrip('@')}/video/{tiktok_video_id}"
        print(f"[backfill_source_url] {'[dry-run] ' if dry_run else ''}shadow_scores.id={shadow_id} -> {url}")
        if not dry_run:
            db.query("UPDATE shadow_scores SET source_url = %s WHERE id = %s", (url, shadow_id))
        backfilled += 1

    undeterminable = db.query("""
        SELECT COUNT(*) FROM shadow_scores
        WHERE source_url IS NULL AND source = 'link_fetch'
    """, fetch="one", cursor_factory=None)[0]

    print(f"[backfill_source_url] backfilled: {backfilled}{' (dry-run, not written)' if dry_run else ''}")
    print(f"[backfill_source_url] undeterminable (source='link_fetch', no URL anywhere in the "
          f"submissions linkage -- file_name is a generic placeholder for these jobs, not the "
          f"video's own id): {undeterminable}")

    db.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report what would change without writing")
    args = ap.parse_args()
    run(args.dry_run)


if __name__ == "__main__":
    main()
