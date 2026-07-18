#!/usr/bin/env python3
"""
sync_study_history.py — Track Record, Task 3b: synthesizes owned
posted_videos rows for an ENROLLED research creator's aged (30+ day),
OOF-covered videos, using their REAL day-30 (or day30-equivalent) outcome
already captured in research_metrics.

These rows are Track Record DISPLAY DATA ONLY: no shadow_scores rows are
ever written for them (they never participate in the live app's
percentile pools -- server.js's fetchShadowRows only reads shadow_scores,
and this script never touches that table), and they are never re-scored.

y_pred is read from the SAME frozen OOF snapshot generate_preview.py
--study Section A reads (oof_task2_F2_full_corpus.parquet) -- consistency
by construction: the number Track Record shows for one of these videos is
the SAME number a --study PDF would show for it.

call_type's percentile is computed HERE, at SYNC time, using
generate_preview.py's own Python pool port (build_pools/midrank_percentile,
self-excluding this creator -- same convention --study's own Section A
scoring uses). This is an honest, documented limitation: it's the pool as
it exists right now, not as it existed whenever these videos were
actually posted -- there's no way to reconstruct a historical pool
snapshot weeks or months later. The live app's own grading path
(gradeTrackRecordForUser in server.js) has the exact same limitation for
organic rows, computed at first-grading time instead of sync time; both
freeze immediately and never recompute afterward. gradeTrackRecordForUser
reads whatever this script writes here as-is -- it does not overwrite
call_type/overall_percentile_at_grading for a row that already has them.

Idempotent on tiktok_video_id: a video already present in posted_videos
from ANY source (prospect_report, validation, a prior sync run) is
skipped, never duplicated or overwritten.

Usage: ./_venv/bin/python3 sync_study_history.py <handle>
"""
import sys

import psycopg2.extras

from generate_preview import (
    DB, AGED_MIN_DAYS, load_corpus_rows, fetch_live_pool_rows, build_pools,
    midrank_percentile, creator_research_video_ids, load_oof_predictions,
)

CALL_STRONG_PCTILE = 70
CALL_WEAK_PCTILE = 30


def call_type_for(percentile):
    if percentile is None:
        return None
    if percentile >= CALL_STRONG_PCTILE:
        return "strong"
    if percentile <= CALL_WEAK_PCTILE:
        return "weak"
    return "none"


def run(handle):
    db = DB()
    creator_row = db.query("SELECT id FROM research_creators WHERE lower(handle) = lower(%s)", (handle,), fetch="one")
    if not creator_row:
        print(f"[sync_study_history] @{handle}: not a research creator -- nothing to sync "
              f"(their record will build from prospect ingest or live use instead)")
        db.close()
        return 0
    creator_id = creator_row[0]

    oof_preds = load_oof_predictions()

    rows = db.query("""
        SELECT v.id, v.external_video_id, v.posted_at, m.interval_label, m.weighted_engagement_rate
        FROM research_videos v
        LEFT JOIN research_metrics m
          ON m.video_id = v.id AND m.interval_label IN ('day_30', 'backcatalog_day30_equiv_2026_07')
        WHERE v.creator_id = %s AND v.posted_at IS NOT NULL
          AND v.posted_at <= now() - interval '%s days'
        ORDER BY v.posted_at DESC
    """, (creator_id, AGED_MIN_DAYS), fetch="all", cursor_factory=psycopg2.extras.RealDictCursor)

    covered = [r for r in rows if r["id"] in oof_preds and r["weighted_engagement_rate"] is not None and r["external_video_id"]]
    if not covered:
        print(f"[sync_study_history] @{handle}: {len(rows)} aged video(s), none OOF-covered with a "
              f"resolved outcome -- nothing to sync (their record will build from prospect ingest or live use instead)")
        db.close()
        return 0

    exclude_video_ids = creator_research_video_ids(db, handle)
    corpus_rows = load_corpus_rows()
    shadow_rows = fetch_live_pool_rows(db)
    pools = build_pools(corpus_rows, shadow_rows, exclude_video_ids=exclude_video_ids, exclude_handle=handle)

    synced, skipped = 0, 0
    for r in covered:
        tiktok_video_id = r["external_video_id"]
        existing = db.query("SELECT id FROM posted_videos WHERE tiktok_video_id = %s", (tiktok_video_id,), fetch="one")
        if existing:
            skipped += 1
            continue

        y_pred = oof_preds[r["id"]]
        avg_row = db.query(
            "SELECT avg_score FROM research_pp_runs_pegasus15 WHERE video_id = %s ORDER BY created_at DESC LIMIT 1",
            (r["id"],), fetch="one",
        )
        avg_score = float(avg_row[0]) if avg_row and avg_row[0] is not None else None
        is_day30_equiv = r["interval_label"] == "backcatalog_day30_equiv_2026_07"
        percentile = midrank_percentile(y_pred, pools["overall"])
        call_type = call_type_for(percentile)

        db.query("""
            INSERT INTO posted_videos
              (tiktok_video_id, handle, posted_at, status, y_pred, avg_score, day30_wec_rate,
               is_day30_equiv, source, overall_percentile_at_grading, call_type, collected_at)
            VALUES (%s, %s, %s, 'day30_collected', %s, %s, %s, %s, 'study_history', %s, %s, now())
        """, (tiktok_video_id, handle, r["posted_at"], y_pred, avg_score,
              float(r["weighted_engagement_rate"]), is_day30_equiv, percentile, call_type))
        # DB (generate_preview.py) never sets autocommit and never calls
        # commit() itself -- without an explicit commit here, psycopg2 rolls
        # back any uncommitted write on conn.close(), which would make this
        # script's inserts silently vanish. Committed per-row (not once at
        # the end) so a mid-run crash doesn't lose already-synced videos.
        db.conn.commit()
        synced += 1

    print(f"[sync_study_history] @{handle}: synthesized {synced} study-history row(s), "
          f"skipped {skipped} (already present from another source)")
    db.close()
    return synced


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Usage: sync_study_history.py <handle>")
    run(sys.argv[1])
