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
    python3 worker.py --prospect @handle [--max-aged 12] [--max-fresh 4]
                                              # Performance Preview prospect-report pipeline: pull
                                              # a NOT-YET-ENROLLED creator's public posts (no
                                              # `objective` required -- this is ingestion, not
                                              # scoring-to-a-niche), score each through the same
                                              # real live path (judges v2.1 + C_dims w/ captions +
                                              # scorer) via /api/validation/ingest, tagged
                                              # source="prospect_report". See the module-level
                                              # comment above run_prospect_mode() for the full
                                              # contract (pool-eligibility rationale, day30-
                                              # equivalent capture, idempotency, cost).
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
import collect_day30 as day30  # same validation/ directory -- reuses its yt-dlp
                                # current-metrics fetch + wec_rate formula rather
                                # than re-deriving them (single source of truth
                                # for the day30 math; see capture_day30_equivalent).

MAX_VIDEOS_PER_RUN_DEFAULT = 10
TRAILING_DAYS = 30
YTDLP_LIST_TIMEOUT = 60
YTDLP_DOWNLOAD_TIMEOUT = 300
YTDLP_PLAYLIST_END = 20        # how far back to look per profile
INTER_USER_DELAY_S = 3         # politeness delay between different profile scans
DOWNLOAD_DIR = pathlib.Path(__file__).resolve().parent / "_downloads"

# ── Prospect-report pipeline constants ──────────────────────────────────────
# Polish v2, Task 2 -- generate_preview.py now targets exactly 8 Section-A
# rows (not "up to 8"). Raised from 12 -> 14 so a typical 2-video scoring
# failure rate (observed ~1/8 in the Task-4 dress rehearsal) still leaves
# >=8 successfully-scored aged videos to draw from.
PROSPECT_MAX_AGED_DEFAULT = 14
PROSPECT_MAX_FRESH_DEFAULT = 4
PROSPECT_AGED_MIN_DAYS = 30
PROSPECT_AGED_MAX_DAYS = 100
# Deeper lookback than the real-user scan's 20 -- a single profile pull needs
# to surface BOTH a fresh (<30d) and an aged (30-100d) bucket, so it has to
# look back further than a normal connected-user scan (which only cares
# about brand-new posts since the last run).
PROSPECT_YTDLP_PLAYLIST_END = 50
INTER_VIDEO_DELAY_S = 2  # politeness delay between videos within a prospect run (mirrors collect_day30.py's constant)
# Matches the established ~$0.10/video real-live-path cost constant
# (PreviewPanel_Operations_and_Roadmap.md §3d / TESTER_OPS_RUNBOOK.md).
PROSPECT_COST_PER_VIDEO = 0.10

PP_API_BASE = __import__("os").environ.get("PP_API_BASE", "http://localhost:3001")

# Date basis (post-diagnostic decision, T5): posted_at is stored as the
# video's real UTC instant (yt-dlp's per-video `timestamp` Unix epoch, kept
# UTC), and every surface renders the UTC-derived calendar date as-is -- no
# per-viewer timezone conversion. TikTok's app shows that instant in the
# viewer's own device zone, so a late-evening US post can read one day
# earlier in-app than its UTC date; that is timezone framing, not a data
# bug (the instant is correct). We render UTC consistently and declare the
# basis rather than guessing a region. This supersedes the earlier
# US/Eastern best-effort conversion. Capturing the precise `timestamp` (vs
# the flat-playlist's coarser, sometimes-absent date-only `upload_date`) is
# retained purely for reliability -- the DATE it yields is the UTC date.


def get_env(key):
    env_path = pathlib.Path.home() / "PreviewPanel" / "backend" / ".env"
    for line in env_path.read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1]
    return None


def load_canonical_objectives():
    """The 19 canonical app objectives -- tiers_v2_2.json's per_objective keys
    (the same list buildTLPrompt/the app validate against). Read from the app
    repo's own canonical file, no research-repo import (same convention as
    generate_preview.py's corpus_reference_pool.json / call_semantics.json)."""
    tiers_path = pathlib.Path.home() / "PreviewPanel" / "backend" / "scoring" / "tiers_v2_2.json"
    return set(json.loads(tiers_path.read_text())["per_objective"].keys())


def db_connect():
    url = get_env("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not found in backend/.env")
    return psycopg2.connect(url.replace("-pooler", ""))


# ── Hotfix v2, Task 1: Neon reconnect guard ─────────────────────────────────
# Local helper, no research-repo imports -- identical in spirit to
# generate_preview.py's own DB class (each script stays self-contained).
# Scoped to run_prospect_mode's long loop: --prospect processes one video at
# a time (download, judge, ingest -- several minutes of network work each),
# holding a connection across that whole span the same way generate_preview.py
# does, and equally exposed to Neon idle-closing it ("SSL connection has been
# closed unexpectedly"). Every query run_prospect_mode's own loop and its
# helpers (capture_day30_equivalent, report_concentration_watch_stat) make
# goes through DB.query(), which reopens and retries once on
# psycopg2.OperationalError.
class DB:
    def __init__(self):
        self.conn = db_connect()

    def _reopen(self):
        try:
            self.conn.close()
        except Exception:
            pass
        self.conn = db_connect()

    def query(self, sql, params=None, fetch=None, cursor_factory=None, commit=False):
        """fetch: None, 'one', or 'all'. commit=True for INSERT/UPDATE.
        Retries the whole cursor/execute/fetch/commit sequence once on a
        dropped connection."""
        for attempt in (1, 2):
            try:
                cur = self.conn.cursor(cursor_factory=cursor_factory)
                cur.execute(sql, params)
                result = cur.fetchall() if fetch == "all" else cur.fetchone() if fetch == "one" else None
                if commit:
                    self.conn.commit()
                cur.close()
                return result
            except psycopg2.OperationalError as e:
                if attempt == 2:
                    raise
                print(f"[worker] DB connection lost ({e}) -- reconnecting and retrying once", file=sys.stderr)
                self._reopen()

    def close(self):
        self.conn.close()


# ── yt-dlp interactions (minimal reimplementation, no research-repo import) ──
def _is_likely_carousel(video_json: dict) -> bool:
    """TikTok photo-carousel posts have no downloadable video stream --
    duration missing/0 is the reliable signal yt-dlp's flat-playlist gives us
    without a full per-video fetch."""
    duration = video_json.get("duration")
    return duration in (None, 0)


def list_recent_videos(handle: str, playlist_end: int = YTDLP_PLAYLIST_END):
    profile_url = f"https://www.tiktok.com/@{handle}"
    cmd = [
        "yt-dlp", "--flat-playlist", "--dump-json", "--no-warnings",
        "--playlist-end", str(playlist_end), profile_url,
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


def fetch_video_meta(video_url: str) -> tuple[str | None, datetime | None]:
    """Chips v2, Task 3b -- list_recent_videos()'s --flat-playlist entries
    don't reliably carry `description`; a real per-video --dump-json probe
    does (same info-dict field the app's own link-fetch path reads, and the
    same field parser.py reads for the research corpus). Best-effort: a
    failure here just means this video's caption-dependent chips stay muted
    and posted_at falls back to list_recent_videos()'s coarser date-only
    value -- never blocks discovery/download/ingest.

    Date basis: this same probe's `timestamp` field (Unix epoch, precise to
    the second) replaces the flat-playlist's date-only `upload_date` as the
    posted_at source -- kept in UTC (see the date-basis note above).
    Returns (caption, posted_at_precise); either can be None on a probe
    failure or missing field, same best-effort contract as before."""
    cmd = ["yt-dlp", "--dump-json", "--no-warnings", "--skip-download", video_url]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=YTDLP_LIST_TIMEOUT)
    except subprocess.TimeoutExpired:
        print(f"[worker] video-meta probe timed out: {video_url}", file=sys.stderr)
        return None, None
    if result.returncode != 0 or not result.stdout.strip():
        print(f"[worker] video-meta probe failed for {video_url}: {result.stderr[:200]}", file=sys.stderr)
        return None, None
    try:
        meta = json.loads(result.stdout.strip().split("\n")[0])
    except json.JSONDecodeError:
        return None, None
    caption = meta.get("description") or None
    posted_at_precise = None
    ts = meta.get("timestamp")
    if ts is not None:
        try:
            posted_at_precise = datetime.fromtimestamp(int(ts), tz=timezone.utc)
        except (ValueError, OSError):
            pass
    return caption, posted_at_precise


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
def post_ingest(video_path, tiktok_video_id, user_id, handle, posted_at, match, caption=None, source=None, objective=None):
    research_key = get_env("RESEARCH_API_KEY")
    data = {
        "tiktokVideoId": tiktok_video_id,
        "userId": user_id or "",
        "handle": handle or "",
    }
    if source:
        data["source"] = source
    # Validated-config prospect ingest -- when an --objective is supplied,
    # pass it through so the ingest endpoint seeds buildTLPrompt's category
    # lens + objective_fit field, matching the app's own scoring config and
    # the corpus's training config (every corpus row was judged WITH an
    # objective -- see OBJECTIVE_CONDITIONING_DIAGNOSTIC.md). Omitting it
    # leaves the judges objective-blind (null config), which the diagnostic
    # showed scores structurally higher and off-distribution.
    if objective:
        data["objective"] = objective
    if caption:
        data["caption"] = caption
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


def process_one_video(conn, user_id, handle, tiktok_video_id, posted_at, local_path, caption=None, source=None, objective=None):
    fp_json = fp.fingerprint_video(pathlib.Path(local_path))
    # Prospects have no prior app history to match against (user_id is
    # always None for them, same as any unconnected caller) -- candidates
    # stays [] and match stays None, exactly the existing "no user_id"
    # behavior already handled below, not a new code path.
    candidates = fetch_candidate_fingerprints(conn, user_id) if user_id else []
    match = best_match(fp_json, candidates) if candidates else None

    if match:
        print(f"[worker] {tiktok_video_id}: matched submission_id={match['submission_id']} "
              f"tier={match['tier']} overlap={match['frame_overlap']:.3f} "
              f"audio_match={match['audio_match']} possibly_related={match['possibly_related']}")
    else:
        print(f"[worker] {tiktok_video_id}: no candidate previews in trailing {TRAILING_DAYS}d window")

    resp = post_ingest(local_path, tiktok_video_id, user_id, handle, posted_at, match, caption=caption, source=source, objective=objective)
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

            caption, posted_at_precise = fetch_video_meta(v["url"])
            posted_at = posted_at_precise or v["posted_at"]

            try:
                process_one_video(conn, user_id, handle, tiktok_video_id, posted_at, local_path, caption=caption)
            finally:
                local_path.unlink(missing_ok=True)  # never accumulate downloaded videos on disk

            processed += 1
        time.sleep(INTER_USER_DELAY_S)  # politeness delay between profile scans

    conn.close()
    print(f"[worker] done -- {processed} new video(s) processed this run")


# ── Prospect-report pipeline ──────────────────────────────────────────────
def select_prospect_videos(videos, max_aged, max_fresh):
    """Bucket a profile's recent videos into aged (30-100 days, license for
    an immediate day30-equivalent capture -- phase5c age-stability study,
    R^2=0.004 drift day30-90) and fresh (<30 days, real day-30 collection
    later via collect_day30.py unchanged). Videos older than 100 days, or
    with no parseable posted_at at all, are excluded from both buckets --
    silently, since "most recent within the window" is the selection rule,
    not "as many as exist". Each bucket keeps its most-recent-first order,
    capped at its own max."""
    now = datetime.now(timezone.utc)
    aged, fresh = [], []
    for v in videos:
        if not v["posted_at"]:
            continue
        age_days = (now - v["posted_at"]).days
        v["age_days"] = age_days
        if PROSPECT_AGED_MIN_DAYS <= age_days <= PROSPECT_AGED_MAX_DAYS:
            aged.append(v)
        elif age_days < PROSPECT_AGED_MIN_DAYS:
            fresh.append(v)
    aged.sort(key=lambda v: v["posted_at"], reverse=True)
    fresh.sort(key=lambda v: v["posted_at"], reverse=True)
    return aged[:max_aged], fresh[:max_fresh]


def capture_day30_equivalent(db, posted_video_id, handle, tiktok_video_id, age_days):
    """Phase5c license: an already-30-100-day-old video's CURRENT public
    counters are a valid day-30 equivalent, no need to wait a real 30 days.
    Writes the exact same day30_* fields collect_day30.py's write_day30_row
    writes for a genuine 30-days-later collection (same source-of-truth
    functions, imported as day30.*), but immediately and tagged
    is_day30_equiv=true so the two provenances stay distinguishable.
    Non-fatal on failure -- the row just stays at status='scored' and
    collect_day30.py will naturally pick it up as a normal (non-equivalent)
    row once/if it ages into that script's own eligibility window."""
    url = day30.build_video_url(handle, tiktok_video_id)
    metadata, error = day30.fetch_current_metrics(url)
    if metadata is None:
        print(f"[worker] prospect {tiktok_video_id}: day30-equivalent capture failed "
              f"({(error or '')[:120]}) -- left at status='scored'")
        return
    views = metadata.get("view_count")
    likes = metadata.get("like_count")
    comments = metadata.get("comment_count")
    shares = metadata.get("repost_count")
    saves = metadata.get("save_count")
    wec_rate = day30.compute_wec_rate(views, likes, shares, saves)
    # Hotfix v2, Task 1: this UPDATE runs immediately after the fetch_current_metrics
    # HTTP call above -- the same "query right after slow network work" shape as the
    # confirmed crash site in generate_preview.py. db.query() reopens/retries once.
    db.query(
        """UPDATE posted_videos SET
             day30_views=%s, day30_likes=%s, day30_comments=%s, day30_shares=%s, day30_saves=%s,
             day30_wec_rate=%s, collected_at=now(), video_age_days_at_collection=%s,
             status='day30_collected', is_day30_equiv=true
           WHERE id=%s""",
        (views, likes, comments, shares, saves, wec_rate, age_days, posted_video_id),
        commit=True,
    )
    print(f"[worker] prospect {tiktok_video_id}: day30-equivalent captured -- "
          f"views={views} likes={likes} shares={shares} saves={saves} "
          f"wec_rate={wec_rate} age_days={age_days}")


def report_concentration_watch_stat(db):
    """Post-ingest watch-stat, not a gate. Reports the max single-creator
    share of the LIVE portion of the overall percentile pool (last 1,000
    pool-eligible, non-posted-video shadow_scores rows -- mirrors
    percentilePools.js's OVERALL_WINDOW). The frozen corpus-seed JSON union
    is deliberately excluded here: it has no creator/handle linkage and is
    static, so it can't be shifted by this ingest and isn't part of what
    this stat is watching for. Niche-pool concentration is NOT computed --
    prospects have no objective at ingest time (this mode's whole point),
    so there is no niche pool yet; recompute once one is assigned at
    render time."""
    # Hotfix v2, Task 1: runs at the very end of the whole prospect batch,
    # after every video's own multi-minute processing -- the longest
    # possible idle gap in the script, so the most exposed query site of all.
    top = db.query(
        """WITH window_rows AS (
             SELECT id, posted_video_id FROM shadow_scores
             WHERE prediction IS NOT NULL AND is_posted_video IS NOT TRUE AND pool_eligible
             ORDER BY created_at DESC LIMIT 1000
           )
           SELECT pv.handle, COUNT(*) AS n
           FROM window_rows w JOIN posted_videos pv ON pv.id = w.posted_video_id
           WHERE pv.handle IS NOT NULL
           GROUP BY pv.handle ORDER BY n DESC LIMIT 1""",
        fetch="one", cursor_factory=psycopg2.extras.RealDictCursor,
    )
    total_row = db.query(
        """SELECT LEAST(COUNT(*), 1000) AS n FROM shadow_scores
           WHERE prediction IS NOT NULL AND is_posted_video IS NOT TRUE AND pool_eligible""",
        fetch="one", cursor_factory=psycopg2.extras.RealDictCursor,
    )
    total = total_row["n"]
    if not top or not total:
        print("[worker] concentration watch-stat: no handle-linked pool rows yet")
        return
    share = top["n"] / total
    print(f"[worker] concentration watch-stat -- overall window: @{top['handle']} holds "
          f"{top['n']}/{total} ({share:.1%}) of the last-1000 live pool. "
          f"Niche-pool share: N/A (no objective at ingest).")


def run_prospect_mode(args):
    handle = args.prospect.lstrip("@")
    max_aged = args.max_aged if args.max_aged is not None else PROSPECT_MAX_AGED_DEFAULT
    max_fresh = args.max_fresh if args.max_fresh is not None else PROSPECT_MAX_FRESH_DEFAULT
    DOWNLOAD_DIR.mkdir(exist_ok=True)
    db = DB()

    objective = args.objective  # validated-config ingest (None -> objective-blind judges)
    cfg = f"objective='{objective}'" if objective else "null-config (objective-blind)"
    print(f"[worker] prospect mode: @{handle} (max_aged={max_aged}, max_fresh={max_fresh}) -- {cfg}")
    videos = list_recent_videos(handle, playlist_end=PROSPECT_YTDLP_PLAYLIST_END)
    aged, fresh = select_prospect_videos(videos, max_aged, max_fresh)
    print(f"[worker] found {len(aged)} aged (30-100d) + {len(fresh)} fresh (<30d) candidate video(s)")

    scored_count = 0
    for bucket_name, bucket in (("aged", aged), ("fresh", fresh)):
        for v in bucket:
            tiktok_video_id = v["video_id"]
            if not tiktok_video_id:
                continue

            # Idempotent on tiktok_video_id, same pre-check run_scan_mode uses
            # (the ingest route's own ON CONFLICT is a second backstop).
            # Hotfix v2, Task 1: this read runs right after the PREVIOUS
            # video's full processing cycle (loop-carried exposure to the
            # same idle-close risk), so it goes through db.query() too.
            existing = db.query("SELECT id, status FROM posted_videos WHERE tiktok_video_id = %s",
                                 (tiktok_video_id,), fetch="one")
            if existing:
                print(f"[worker] prospect {tiktok_video_id}: already ingested (status={existing[1]}) -- skipping")
                continue

            local_path = DOWNLOAD_DIR / f"{tiktok_video_id}.mp4"
            if not download_video(v["url"], local_path):
                continue
            caption, posted_at_precise = fetch_video_meta(v["url"])
            posted_at = posted_at_precise or v["posted_at"]

            try:
                # process_one_video's own conn param is unused on this call
                # path (user_id is always None for a prospect, so its only
                # conn-consuming branch -- fetch_candidate_fingerprints --
                # short-circuits) -- pass db.conn (always the CURRENT live
                # connection, even if a reconnect happened earlier this
                # iteration) rather than widening process_one_video's own
                # signature for a param it wouldn't use here.
                ok = process_one_video(db.conn, None, handle, tiktok_video_id, posted_at, local_path,
                                        caption=caption, source="prospect_report", objective=objective)
            finally:
                local_path.unlink(missing_ok=True)  # never accumulate downloaded videos on disk
            if not ok:
                continue
            scored_count += 1

            if bucket_name == "aged":
                # Hotfix v2, Task 1 -- THIS is the direct analogue of
                # generate_preview.py's confirmed crash site: a DB read
                # immediately after process_one_video's multi-minute
                # download+judge+ingest cycle above.
                row = db.query("SELECT id FROM posted_videos WHERE tiktok_video_id = %s",
                                (tiktok_video_id,), fetch="one")
                if row:
                    capture_day30_equivalent(db, row[0], handle, tiktok_video_id, v["age_days"])

            time.sleep(INTER_VIDEO_DELAY_S)

    cost = scored_count * PROSPECT_COST_PER_VIDEO
    print(f"[worker] prospect ingest done -- {scored_count} video(s) scored, "
          f"~${cost:.2f} estimated cost ({scored_count} x ${PROSPECT_COST_PER_VIDEO:.2f}/video)")

    report_concentration_watch_stat(db)
    db.close()


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
    parser.add_argument("--prospect", type=str, default=None,
                         help="Performance Preview prospect-report mode: @handle of a not-yet-enrolled creator")
    parser.add_argument("--max-aged", type=int, default=None, help="--prospect: cap on videos aged 30-100 days (default 14)")
    parser.add_argument("--max-fresh", type=int, default=None, help="--prospect: cap on videos aged <30 days (default 4)")
    parser.add_argument("--objective", type=str, default=None,
                         help="--prospect: score under this canonical objective (validated config -- seeds the "
                              "judges' category lens + objective_fit, matching the app and the corpus). Omit for "
                              "the objective-blind null config. Must be one of the 19 canonical objectives.")
    args = parser.parse_args()

    if args.objective:
        if not args.prospect:
            parser.error("--objective is only valid with --prospect (validated-config prospect ingest)")
        canonical = load_canonical_objectives()
        if args.objective not in canonical:
            parser.error(f"--objective '{args.objective}' is not canonical. Must be one of:\n  "
                         + "\n  ".join(sorted(canonical)))

    if args.prospect:
        run_prospect_mode(args)
    elif args.file:
        if not args.tiktok_video_id:
            parser.error("--file requires --tiktok-video-id")
        run_file_mode(args)
    else:
        run_scan_mode(args)


if __name__ == "__main__":
    main()
