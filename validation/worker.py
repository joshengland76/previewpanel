#!/usr/bin/env python3
"""
Phase C, Task 4 -- Mac-side validation worker. For each user with a
connected tiktok_handle: scans recent public posts (yt-dlp, minimal
reimplementation of the pattern used elsewhere in this project -- NO
research-repo imports), inserts newly-discovered tiktok_video_ids into
posted_videos (status='discovered'), downloads + fingerprints each with the
SAME vendored fingerprint.py used at submission time, matches against that
user's preview_fingerprints from the trailing 30 days, then POSTs into
/api/validation/ingest (source="validation") to run full scoring and advance
the status chain.

Reads DATABASE_URL directly (app DB only -- posted_videos/users/
preview_fingerprints/submissions; NEVER touches research_videos or any other
research-repo table). No imports from the research repo.

Idempotent: posted_videos.tiktok_video_id is UNIQUE, so re-running never
double-processes a video already discovered.

Usage:
    python3 worker.py                       # normal scan, all connected users
    python3 worker.py --max-videos 5         # override the per-run cap
    python3 worker.py --file clip.mp4 --handle someuser --tiktok-video-id 123 [--user-id UUID]
                                              # test mode: skip discovery/download,
                                              # fingerprint+match+ingest one local file directly
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
import requests

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import fingerprint as fp

MAX_VIDEOS_PER_RUN_DEFAULT = 10
TRAILING_DAYS = 30
YTDLP_LIST_TIMEOUT = 60
YTDLP_DOWNLOAD_TIMEOUT = 300
YTDLP_PLAYLIST_END = 20        # how far back to look per profile
INTER_USER_DELAY_S = 3         # politeness delay between different profile scans
DOWNLOAD_DIR = pathlib.Path(__file__).resolve().parent / "_downloads"

PP_API_BASE = __import__("os").environ.get("PP_API_BASE", "http://localhost:3001")


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


# ── yt-dlp interactions (minimal reimplementation, no research-repo import) ──
def _is_likely_carousel(video_json: dict) -> bool:
    """TikTok photo-carousel posts have no downloadable video stream --
    duration missing/0 is the reliable signal yt-dlp's flat-playlist gives us
    without a full per-video fetch."""
    duration = video_json.get("duration")
    return duration in (None, 0)


def list_recent_videos(handle: str):
    profile_url = f"https://www.tiktok.com/@{handle}"
    cmd = [
        "yt-dlp", "--flat-playlist", "--dump-json", "--no-warnings",
        "--playlist-end", str(YTDLP_PLAYLIST_END), profile_url,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=YTDLP_LIST_TIMEOUT)
    except subprocess.TimeoutExpired:
        print(f"[worker] yt-dlp list timed out for @{handle}", file=sys.stderr)
        return []
    if result.returncode != 0 and not result.stdout.strip():
        print(f"[worker] yt-dlp list failed for @{handle}: {result.stderr[:200]}", file=sys.stderr)
        return []

    videos = []
    for line in result.stdout.strip().split("\n"):
        if not line:
            continue
        try:
            v = json.loads(line)
        except json.JSONDecodeError:
            continue
        if _is_likely_carousel(v):
            continue
        upload_date = v.get("upload_date")  # "YYYYMMDD" or None (flat-playlist often omits it)
        posted_at = None
        if upload_date:
            try:
                posted_at = datetime.strptime(upload_date, "%Y%m%d").replace(tzinfo=timezone.utc)
            except ValueError:
                pass
        videos.append({"video_id": v.get("id"), "url": v.get("url") or v.get("webpage_url"), "posted_at": posted_at})
    return videos


def download_video(video_url: str, out_path: pathlib.Path) -> bool:
    cmd = ["yt-dlp", "--no-warnings", "-f", "mp4/best", "-o", str(out_path), video_url]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=YTDLP_DOWNLOAD_TIMEOUT)
    except subprocess.TimeoutExpired:
        print(f"[worker] download timed out: {video_url}", file=sys.stderr)
        return False
    if result.returncode != 0 or not out_path.exists():
        print(f"[worker] download failed for {video_url}: {result.stderr[:200]}", file=sys.stderr)
        return False
    return True


# ── Matching ──────────────────────────────────────────────────────────────
def best_match(fp_json: dict, candidate_rows):
    """candidate_rows: list of (submission_id, fp_json dict) from
    preview_fingerprints, trailing 30 days for this user. Returns the best
    match_score() result plus its submission_id, or None if no candidates.
    'Best' = lowest tier (1 beats 2 beats 3), then highest frame_overlap as
    tiebreak within a tier."""
    best = None
    for submission_id, cand_fp in candidate_rows:
        score = fp.match_score(fp_json, cand_fp)
        score["submission_id"] = submission_id
        if best is None or (score["tier"], -score["frame_overlap"]) < (best["tier"], -best["frame_overlap"]):
            best = score
    return best


def fetch_candidate_fingerprints(conn, user_id):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """SELECT submission_id, fp_json FROM preview_fingerprints
           WHERE user_id = %s AND created_at > now() - interval '%s days'
             AND fp_json IS NOT NULL""",
        (user_id, TRAILING_DAYS),
    )
    rows = [(r["submission_id"], r["fp_json"]) for r in cur.fetchall()]
    cur.close()
    return rows


# ── Ingestion POST ────────────────────────────────────────────────────────
def post_ingest(video_path, tiktok_video_id, user_id, handle, posted_at, match):
    research_key = get_env("RESEARCH_API_KEY")
    data = {
        "tiktokVideoId": tiktok_video_id,
        "userId": user_id or "",
        "handle": handle or "",
    }
    if posted_at:
        data["postedAt"] = posted_at.isoformat()
    if match:
        data["matchTier"] = str(match["tier"])
        data["matchOverlap"] = str(match["frame_overlap"])
        data["audioMatch"] = "true" if match["audio_match"] else "false"
        data["durationDelta"] = str(match["duration_delta_s"])
        data["possiblyRelated"] = "true" if match.get("possibly_related") else "false"
        if match.get("submission_id") is not None and match["tier"] in (1, 2):
            data["matchedSubmissionId"] = str(match["submission_id"])
    with open(video_path, "rb") as f:
        resp = requests.post(
            f"{PP_API_BASE}/api/validation/ingest",
            headers={"Authorization": f"Bearer {research_key}"},
            data=data,
            files={"video": f},
            timeout=8 * 60,
        )
    return resp


def process_one_video(conn, user_id, handle, tiktok_video_id, posted_at, local_path):
    fp_json = fp.fingerprint_video(pathlib.Path(local_path))
    candidates = fetch_candidate_fingerprints(conn, user_id) if user_id else []
    match = best_match(fp_json, candidates) if candidates else None

    if match:
        print(f"[worker] {tiktok_video_id}: matched submission_id={match['submission_id']} "
              f"tier={match['tier']} overlap={match['frame_overlap']:.3f} "
              f"audio_match={match['audio_match']} possibly_related={match['possibly_related']}")
    else:
        print(f"[worker] {tiktok_video_id}: no candidate previews in trailing {TRAILING_DAYS}d window")

    resp = post_ingest(local_path, tiktok_video_id, user_id, handle, posted_at, match)
    if resp.status_code == 200:
        body = resp.json()
        print(f"[worker] {tiktok_video_id}: ingested -> status={body.get('status')} "
              f"yPred={body.get('yPred')} avgScore={body.get('avgScore')}")
    else:
        print(f"[worker] {tiktok_video_id}: ingest FAILED ({resp.status_code}): {resp.text[:300]}", file=sys.stderr)
    return resp.status_code == 200


def run_file_mode(args):
    conn = db_connect()
    if args.posted_at:
        posted_at = datetime.fromisoformat(args.posted_at)
        if posted_at.tzinfo is None:
            posted_at = posted_at.replace(tzinfo=timezone.utc)
    else:
        posted_at = datetime.now(timezone.utc)
    ok = process_one_video(conn, args.user_id, args.handle, args.tiktok_video_id, posted_at, args.file)
    conn.close()
    sys.exit(0 if ok else 1)


def run_scan_mode(args):
    max_videos = args.max_videos or MAX_VIDEOS_PER_RUN_DEFAULT
    DOWNLOAD_DIR.mkdir(exist_ok=True)
    conn = db_connect()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT user_id, tiktok_handle FROM users WHERE tiktok_handle IS NOT NULL")
    users = cur.fetchall()
    cur.close()
    print(f"[worker] scanning {len(users)} connected tiktok handle(s), max {max_videos} new video(s) this run")

    processed = 0
    for u in users:
        if processed >= max_videos:
            break
        user_id, handle = u["user_id"], u["tiktok_handle"]
        videos = list_recent_videos(handle)
        for v in videos:
            if processed >= max_videos:
                break
            if not v["video_id"]:
                continue
            tiktok_video_id = v["video_id"]

            cur = conn.cursor()
            cur.execute("SELECT id, status FROM posted_videos WHERE tiktok_video_id = %s", (tiktok_video_id,))
            existing = cur.fetchone()
            if existing:
                cur.close()
                continue  # idempotent -- already discovered in a prior run

            cur.execute(
                """INSERT INTO posted_videos (user_id, tiktok_video_id, handle, posted_at, status)
                   VALUES (%s,%s,%s,%s,'discovered')""",
                (user_id, tiktok_video_id, handle, v["posted_at"]),
            )
            conn.commit()
            cur.close()
            print(f"[worker] discovered new post: @{handle} / {tiktok_video_id}")

            local_path = DOWNLOAD_DIR / f"{tiktok_video_id}.mp4"
            if not download_video(v["url"], local_path):
                cur = conn.cursor()
                cur.execute("UPDATE posted_videos SET status = 'failed' WHERE tiktok_video_id = %s", (tiktok_video_id,))
                conn.commit()
                cur.close()
                continue

            cur = conn.cursor()
            cur.execute("UPDATE posted_videos SET status = 'downloaded' WHERE tiktok_video_id = %s", (tiktok_video_id,))
            conn.commit()
            cur.close()

            try:
                process_one_video(conn, user_id, handle, tiktok_video_id, v["posted_at"], local_path)
            finally:
                local_path.unlink(missing_ok=True)  # never accumulate downloaded videos on disk

            processed += 1
        time.sleep(INTER_USER_DELAY_S)  # politeness delay between profile scans

    conn.close()
    print(f"[worker] done -- {processed} new video(s) processed this run")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-videos", type=int, default=None)
    parser.add_argument("--file", type=str, default=None, help="test mode: skip discovery/download, ingest one local file")
    parser.add_argument("--handle", type=str, default=None)
    parser.add_argument("--tiktok-video-id", type=str, default=None)
    parser.add_argument("--user-id", type=str, default=None)
    parser.add_argument("--posted-at", type=str, default=None,
                         help="ISO date/datetime to backdate posted_at in --file test mode "
                              "(e.g. for day-30 verification without waiting 30 days); defaults to now")
    args = parser.parse_args()

    if args.file:
        if not args.tiktok_video_id:
            parser.error("--file requires --tiktok-video-id")
        run_file_mode(args)
    else:
        run_scan_mode(args)


if __name__ == "__main__":
    main()
