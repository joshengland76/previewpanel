#!/usr/bin/env python3
"""
Phase C, Prompt 2, Task 1 -- day-30 outcome collector. Reimplements (NO
research-repo imports) the research pipeline's own day30_metrics.py
discovery pattern: a video becomes eligible the moment it turns 30 days old
and stays eligible for a further 7 days (day 30-37 total) in case the
collector doesn't run every single day -- but within that window, whichever
attempt happens FIRST is the one that counts, so eligible rows are always
processed oldest-posted_at-first ("prefer the earliest attempt >= day 30").
Once collected (or permanently failed), a row leaves the eligible set for
good; there is no repeat/refresh collection.

Eligible: posted_videos.status IN ('scored','matched'), posted_at + 30d
in [now-7d, now], day30_fetch_attempts < 3.

wec_rate = (likes + 3*shares + 5*saves) / views, with a zero/NULL-views
guard (None, not 0.0 -- a deleted/private video's zeroed-out counters must
never look like a real, measured zero engagement rate).

Failure handling: every fetch attempt (success or failure) increments
day30_fetch_attempts and records day30_fetch_last_attempt_at /
day30_fetch_last_error. A transient error (network blip, rate limit) just
increments the counter, retried next run, up to MAX_FETCH_ATTEMPTS. A
DELETION/PRIVACY signal (matched from yt-dlp's own error text) is treated as
a real, permanent outcome, not a fetch failure to retry -- status becomes
'failed' immediately with the reason string preserved (a creator deleting
their post at day 30-37 is itself a meaningful data point, not noise to
discard).

Idempotent: once a row's status is 'day30_collected' or 'failed' it no
longer matches the discovery query, so re-running never double-collects or
re-flags an already-decided row.

Usage:
    python3 collect_day30.py                # normal run
    python3 collect_day30.py --dry-run       # discover + fetch, no writes
    python3 collect_day30.py --limit 5       # cap videos processed this run
"""
import argparse
import json
import pathlib
import subprocess
import sys
import time
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

YTDLP_TIMEOUT_S = 60
MAX_FETCH_ATTEMPTS = 3
WINDOW_DAYS = 7  # day 30 (eligible) through day 30+7=37 (last chance)
INTER_VIDEO_DELAY_S = 2  # politeness delay between yt-dlp calls

# Substring match against yt-dlp's own error text -- same class of signal
# day30_metrics.py's day30_fetch_last_error stores, acted on here rather
# than left for a human to notice later.
UNAVAILABLE_MARKERS = ("private", "unavailable", "removed", "deleted", "not available", "404", "does not exist")


def get_env(key):
    env_path = pathlib.Path.home() / "PreviewPanel" / "backend" / ".env"
    for line in env_path.read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1]
    return None


def db_connect():
    url = get_env("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not found in backend/.env")
    return psycopg2.connect(url.replace("-pooler", ""))


DISCOVERY_SQL_BASE = """
    SELECT id, user_id, tiktok_video_id, handle, posted_at, day30_fetch_attempts
    FROM posted_videos
    WHERE status IN ('scored', 'matched')
      AND posted_at IS NOT NULL
      AND posted_at + INTERVAL '30 days' <= now()
      AND posted_at + INTERVAL '30 days' >= now() - (%s * INTERVAL '1 day')
      AND COALESCE(day30_fetch_attempts, 0) < %s
      {test_row_clause}
    ORDER BY posted_at ASC
"""


def discover_eligible(conn, include_test_rows=False):
    clause = "" if include_test_rows else "AND COALESCE(test_row, false) IS NOT TRUE"
    sql = DISCOVERY_SQL_BASE.format(test_row_clause=clause)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(sql, (WINDOW_DAYS, MAX_FETCH_ATTEMPTS))
    rows = cur.fetchall()
    cur.close()
    return rows


def build_video_url(handle, tiktok_video_id):
    return f"https://www.tiktok.com/@{handle}/video/{tiktok_video_id}"


def fetch_current_metrics(url):
    try:
        result = subprocess.run(
            ["yt-dlp", "--skip-download", "--dump-single-json", "--no-warnings", url],
            capture_output=True, text=True, timeout=YTDLP_TIMEOUT_S,
        )
        if result.returncode != 0:
            err = result.stderr.strip()[:500]
            return None, f"yt-dlp failed: {err}"
        return json.loads(result.stdout), None
    except subprocess.TimeoutExpired:
        return None, f"yt-dlp timed out after {YTDLP_TIMEOUT_S}s"
    except json.JSONDecodeError as e:
        return None, f"yt-dlp output not valid JSON: {e}"
    except Exception as e:
        return None, f"Unexpected error: {e}"


def compute_wec_rate(views, likes, shares, saves):
    views = views or 0
    likes = likes or 0
    shares = shares or 0
    saves = saves or 0
    if views <= 0:
        return None
    return (likes + 3 * shares + 5 * saves) / views


def is_permanent_unavailable(error_msg):
    if not error_msg:
        return False
    low = error_msg.lower()
    return any(m in low for m in UNAVAILABLE_MARKERS)


def record_attempt(conn, video_id, error):
    cur = conn.cursor()
    cur.execute(
        """UPDATE posted_videos
           SET day30_fetch_attempts = COALESCE(day30_fetch_attempts, 0) + 1,
               day30_fetch_last_error = %s,
               day30_fetch_last_attempt_at = now()
           WHERE id = %s""",
        (error, video_id),
    )
    conn.commit()
    cur.close()


def mark_failed(conn, video_id, reason):
    cur = conn.cursor()
    cur.execute(
        """UPDATE posted_videos SET status = 'failed', day30_fetch_last_error = %s,
               day30_fetch_last_attempt_at = now() WHERE id = %s""",
        (reason, video_id),
    )
    conn.commit()
    cur.close()


def write_day30_row(conn, row, metadata, dry_run):
    views = metadata.get("view_count")
    likes = metadata.get("like_count")
    comments = metadata.get("comment_count")
    shares = metadata.get("repost_count")
    saves = metadata.get("save_count")
    wec_rate = compute_wec_rate(views, likes, shares, saves)

    posted_at = row["posted_at"]
    age_days = (datetime.now(timezone.utc) - posted_at).days if posted_at else None

    print(f"  -> {row['handle']}/{row['tiktok_video_id']}: views={views} likes={likes} "
          f"shares={shares} saves={saves} wec_rate={wec_rate} age_days={age_days}")

    if dry_run:
        print("    [dry-run] would write this day30 row")
        return True

    cur = conn.cursor()
    cur.execute(
        """UPDATE posted_videos SET
             day30_views=%s, day30_likes=%s, day30_comments=%s, day30_shares=%s, day30_saves=%s,
             day30_wec_rate=%s, collected_at=now(), video_age_days_at_collection=%s,
             status='day30_collected'
           WHERE id=%s""",
        (views, likes, comments, shares, saves, wec_rate, age_days, row["id"]),
    )
    conn.commit()
    cur.close()
    return True


def run(dry_run, limit, include_test_rows=False):
    conn = db_connect()
    eligible = discover_eligible(conn, include_test_rows=include_test_rows)
    if limit:
        eligible = eligible[:limit]
    print(f"Day-30 collector: {len(eligible)} eligible posted video(s) (window: day 30-{30 + WINDOW_DAYS})")

    succeeded = failed = skipped = 0
    for row in eligible:
        print(f"Processing {row['handle']}/{row['tiktok_video_id']} (posted {row['posted_at']})")
        url = build_video_url(row["handle"], row["tiktok_video_id"])
        metadata, error = fetch_current_metrics(url)

        if metadata is None:
            if is_permanent_unavailable(error):
                print(f"  Video unavailable ({(error or '')[:120]}) -- marking failed (deletion is itself an outcome)")
                if not dry_run:
                    mark_failed(conn, row["id"], error)
                failed += 1
            else:
                attempt_n = (row["day30_fetch_attempts"] or 0) + 1
                print(f"  Fetch failed ({(error or '')[:120]}) -- will retry (attempt {attempt_n}/{MAX_FETCH_ATTEMPTS})")
                if not dry_run:
                    record_attempt(conn, row["id"], error)
                skipped += 1
            time.sleep(INTER_VIDEO_DELAY_S)
            continue

        ok = write_day30_row(conn, row, metadata, dry_run)
        if ok:
            succeeded += 1
            if not dry_run:
                record_attempt(conn, row["id"], None)
        else:
            failed += 1
        time.sleep(INTER_VIDEO_DELAY_S)

    print(f"\nDone. {succeeded} collected, {failed} failed/unavailable, {skipped} transient-skip (will retry next run).")
    conn.close()
    return 0 if failed == 0 else 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="discover + fetch but don't write to Neon")
    parser.add_argument("--limit", type=int, default=None, help="cap the number of videos processed this run")
    parser.add_argument("--include-test-rows", action="store_true", help="also process rows tagged test_row=true (Task 3 verification only)")
    args = parser.parse_args()
    sys.exit(run(args.dry_run, args.limit, include_test_rows=args.include_test_rows))


if __name__ == "__main__":
    main()
