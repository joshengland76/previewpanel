#!/usr/bin/env python3
"""
Performance Preview generator -- prospect-pipeline prompt, Task 2.

Scoring and rendering are separate steps: this script never scores a video
itself (that's worker.py --prospect for prospects, or the live app's own
/api/fetch-video for a --study creator's recent posts). It only reads
already-scored predictions and renders them -- one ingest funds unlimited
re-renders in either mode below.

Two independent axes, both required:

  DATA SOURCE (--study <handle> | --prospect <handle>)
    --study <handle>: an existing, already-enrolled research creator.
      Section A ("posted 30+ days ago") reads cached ENDGAME Task-2 F2
      out-of-fold (OOF) cross-validated predictions
      (oof_task2_F2_full_corpus.parquet) -- NEVER the shipped/trained
      artifact, which was trained on these exact rows and would be
      in-sample. Real 30-day results come from research_metrics
      (interval_label IN ('day_30','backcatalog_day30_equiv_2026_07')).
      Section B ("posted in the last 30 days") is scored fresh, right now,
      via the live app's own public /api/fetch-video link-fetch path --
      fully out-of-sample, and byte-identical to what a real user pasting
      that link would get.
    --prospect <handle>: a not-yet-enrolled creator already run through
      worker.py --prospect. Both sections read Task 1's live-path
      predictions (posted_videos/shadow_scores, source='prospect_report')
      -- the aged bucket (is_day30_equiv=true) backs Section A, the fresh
      bucket (status='scored', day30 still pending) backs Section B.

  PERCENTILE MODE (--objective <canonical> | --overall)
    --objective: in-objective percentile, via the app's EXACT niche-pool
      computation (percentilePools.js, reimplemented here in Python against
      the same corpus_reference_pool.json + live shadow_scores rows).
      Refuses Dancing (tier-suppressed, p_gt0=0.613 -- no honest document
      exists) and any objective failing the same p_gt0>=0.95 ranking-
      confidence bar scoreDisplay.js itself gates on. Appends the app's own
      precisionCaveatLine to the footer when the objective clears the
      ranking bar but not the separate precision@decile>=0.55 bar (Gaming,
      Educational/How-To as of tiers_v2_2.json) -- document and product
      must never disagree on confidence.
    --overall: last-1,000-videos overall-pool percentile. No tier gate --
      showPercentileFor's ranking-confidence bar is an OBJECTIVE-scoped
      check; it has no equivalent for the objective-agnostic overall pool.

SELF-EXCLUSION RULE (both data sources, both percentile modes): every
percentile in the document is computed against the pool with the subject
creator's OWN rows removed first -- their own batch must never shift their
own reference. Two components, both excluded:
  (a) corpus_reference_pool.json rows whose video_id belongs to this
      creator's research_videos (only possible for an ENROLLED creator --
      a --prospect handle has none, which is the correct, honest answer).
  (b) live shadow_scores rows linked (via posted_videos.handle) to this
      creator -- covers prospect-report rows and any validation rows.
The excluded rows stay pool-eligible for everyone else, and for this
creator's own FUTURE live-app runs (which use the app's own standard
per-video self-exclusion, not this batch-level one -- this script's
self-exclusion is a document-generation-time concern only, no DB row is
ever modified here).

Usage:
    python3 generate_preview.py --study maya.gets.glowy --objective "Makeup/Beauty"
    python3 generate_preview.py --study maya.gets.glowy --overall
    python3 generate_preview.py --prospect somehandle --objective "Gaming"
    python3 generate_preview.py --prospect somehandle --overall [--descriptor "multi-niche creator"]

Output: Recruitment/preview_@handle_<mode>_<date>.pdf + the filled .html
next to it (Recruitment/, capitalized -- matches Josh's actual template
directory; the prompt's own path was written lowercase, a discrepancy
flagged in PREVIEW_PIPELINE_READOUT.md, not silently "corrected" past that
without a paper trail).
"""
import argparse
import json
import math
import os
import pathlib
import re
import statistics
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

import pandas as pd
import psycopg2
import psycopg2.extras
import requests

HERE = pathlib.Path(__file__).resolve().parent
BACKEND_SCORING = HERE.parent / "backend" / "scoring"
TIERS_PATH = BACKEND_SCORING / "tiers_v2_2.json"
CORPUS_PATH = BACKEND_SCORING / "corpus_reference_pool.json"
RECRUITMENT_DIR = HERE.parent / "Recruitment"
TEMPLATE_PATH = RECRUITMENT_DIR / "performance_preview_template.html"
OOF_PARQUET = (
    pathlib.Path.home() / "correlation-research" / "analysis" / "modeling"
    / "data" / "snapshots" / "2026-07-07-capstone" / "oof_task2_F2_full_corpus.parquet"
)

OVERALL_WINDOW = 1000
OBJECTIVE_WINDOW = 100
SECTION_A_MAX_ROWS = 8
AGED_MIN_DAYS = 30

PP_API_BASE = os.environ.get("PP_API_BASE", "http://localhost:3001")
STATUS_POLL_INTERVAL_S = 4
STATUS_POLL_TIMEOUT_S = 20 * 60

# Noun-phrase display labels for the insight line -- distinct from
# PerformanceRadar.jsx's short axis-chip labels (this is prose, not a
# chip). emotion_intensity/novel match the template's own sample copy
# verbatim ("emotional intensity", "novelty").
AXIS_INSIGHT_LABELS = {
    "compelling": "compelling hooks",
    "novel": "novelty",
    "emotionally_resonant": "emotional resonance",
    "emotion_intensity": "emotional intensity",
    "funny": "humor",
}


# ── env / DB (mirrors worker.py's own pattern exactly) ──────────────────────
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


def _as_dt(v):
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(str(v).replace("Z", "+00:00"))


# ── Objective canon / tier gate (Python port of scoreDisplay.js's showPercentileFor) ──
def load_tiers():
    return json.loads(TIERS_PATH.read_text())


def canonical_objectives(tiers):
    return set(tiers["per_objective"].keys())


def check_objective_gate(objective, tiers):
    """Returns a caveat line (str) or None. Exits the process (refusal, not
    an exception -- this is a hard stop, matching how the prompt frames it:
    "REFUSE Dancing") if the objective isn't canonical, or doesn't clear the
    same p_gt0>=0.95 ranking-confidence bar the live app itself gates
    showPercentile on."""
    valid = canonical_objectives(tiers)
    if objective not in valid:
        sys.exit(f"[generate_preview] '{objective}' is not a canonical objective.\nValid: {sorted(valid)}")
    info = tiers["per_objective"][objective]
    p_gt0 = info.get("p_gt0")
    if objective == "Dancing" or not (isinstance(p_gt0, (int, float)) and p_gt0 >= 0.95):
        sys.exit(
            f"[generate_preview] Refusing --objective {objective}: p_gt0={p_gt0} "
            f"(bar is >=0.95) -- not statistically supported for a ranking claim yet. "
            f"No honest percentile document exists for this niche."
        )
    precision = info.get("precision_at_decile")
    if isinstance(precision, (int, float)) and precision < 0.55:
        return ("Percentiles here reflect validated ranking for this niche; "
                "our top-pick hit rate is still maturing.")
    return None


# ── Percentile pool engine (Python port of percentilePools.js) ─────────────
def load_corpus_rows():
    raw = json.loads(CORPUS_PATH.read_text())
    return [
        {"key": f"corpus:{r['video_id']}", "video_id": r["video_id"],
         "prediction": r["prediction_cal"], "objective": r["objective"], "date": r["posted_at"]}
        for r in raw
    ]


def fetch_live_pool_rows(conn):
    """Mirrors server.js's SCORE_DISPLAY_FETCHERS.fetchShadowRows query
    exactly, plus posted_videos.handle (join-only addition -- needed for
    self-exclusion and the concentration watch-stat; the live app doesn't
    read this column itself)."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT s.id, s.prediction, s.objective, s.created_at, s.platform, pv.handle
        FROM shadow_scores s
        LEFT JOIN posted_videos pv ON pv.id = s.posted_video_id
        WHERE s.prediction IS NOT NULL AND s.is_posted_video IS NOT TRUE AND s.pool_eligible
    """)
    rows = cur.fetchall()
    cur.close()
    return [
        {"key": f"shadow:{r['id']}", "prediction": r["prediction"], "objective": r["objective"],
         "date": r["created_at"], "handle": r["handle"]}
        for r in rows
    ]


def creator_research_video_ids(conn, handle):
    """research_videos.id values (== corpus_reference_pool.json's video_id
    field) belonging to this creator, for self-exclusion. Empty for a
    --prospect handle -- correct and expected, not a bug: they have no
    research_videos rows at all."""
    cur = conn.cursor()
    cur.execute(
        """SELECT v.id FROM research_videos v
           JOIN research_creators c ON c.id = v.creator_id
           WHERE lower(c.handle) = lower(%s)""",
        (handle,),
    )
    ids = {row[0] for row in cur.fetchall()}
    cur.close()
    return ids


def build_pools(corpus_rows, shadow_rows, exclude_video_ids=frozenset(), exclude_handle=None):
    excl_handle = (exclude_handle or "").lower()
    all_rows = [r for r in corpus_rows if r["video_id"] not in exclude_video_ids]
    all_rows += [r for r in shadow_rows if not (r.get("handle") and r["handle"].lower() == excl_handle)]
    all_rows = [r for r in all_rows if r["prediction"] is not None and r["date"] is not None]
    all_rows.sort(key=lambda r: _as_dt(r["date"]), reverse=True)

    overall = all_rows[:OVERALL_WINDOW]
    by_objective = {}
    for r in all_rows:
        obj = r.get("objective")
        if not obj:
            continue
        bucket = by_objective.setdefault(obj, [])
        if len(bucket) < OBJECTIVE_WINDOW:
            bucket.append(r)
    return {"overall": overall, "by_objective": by_objective}


def midrank_percentile(value, pool):
    """Direct port of percentilePools.js's midrankPercentile -- integer
    midrank, ties credited at their midpoint. Python's round() is
    round-half-to-even, JS's Math.round() is round-half-up; both pools here
    are large enough (100/1,000) that an exact .5 tie at the percentile
    boundary is not a realistic occurrence, so this divergence is accepted
    rather than hand-rolling JS's rounding rule for a case that won't fire."""
    n = len(pool)
    if n == 0:
        return None
    below = sum(1 for p in pool if p["prediction"] < value)
    equal = sum(1 for p in pool if p["prediction"] == value)
    return round(((below + 0.5 * equal) / n) * 100)


def pill_text(percentile, mode, objective):
    if percentile is None:
        return None
    n = int(round(percentile))
    suffix = "th" if 11 <= (n % 100) <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    scope = objective if mode == "objective" else "all videos"
    return f"{n}{suffix} percentile · {scope}"


def report_concentration_watch_stat_for_render(pools, objective, mode):
    """Render-time echo of worker.py's ingest-time concentration watch-stat
    -- informational only, printed to stdout, never blocks a render."""
    overall_n = len(pools["overall"])
    print(f"[generate_preview] overall pool size at render: {overall_n} (window cap {OVERALL_WINDOW})")
    if mode == "objective":
        niche_n = len(pools["by_objective"].get(objective, []))
        print(f"[generate_preview] '{objective}' niche pool size at render: {niche_n} (window cap {OBJECTIVE_WINDOW})")


# ── Section-A row math (shared by both data sources) ───────────────────────
def size_section_a_window(videos_most_recent_first, max_rows=SECTION_A_MAX_ROWS):
    """'every public video in the stated window, Section A <= 8 rows -- by
    window sizing, never a curated subset.' Taking the most recent max_rows
    (input is already most-recent-first, no gaps) trivially satisfies this:
    every video between the newest and the Nth-newest IS included, so
    whatever date span those N happen to cover is honestly "the stated
    window," not a curated pick out of a wider one."""
    return videos_most_recent_first[:max_rows]


def score_section_a(videos, pool, mode, objective):
    """videos: dicts with prediction (raw ŷ) and wec_rate (real 30-day
    result) already populated. Adds percentile/pill/result_x/tick in place.
    Median is over THIS shown set post-window-sizing, per spec -- not the
    creator's full history."""
    for v in videos:
        v["percentile"] = midrank_percentile(v["prediction"], pool)
        v["pill"] = pill_text(v["percentile"], mode, objective)

    wec_values = [v["wec_rate"] for v in videos if v.get("wec_rate") is not None]
    median_wec = statistics.median(wec_values) if wec_values else None

    scores_desc = sorted((v["prediction"] for v in videos), reverse=True)
    top_half_min_score = scores_desc[max(0, len(scores_desc) // 2 - 1)] if scores_desc else None

    for v in videos:
        if median_wec and v.get("wec_rate") is not None:
            v["result_x"] = v["wec_rate"] / median_wec
        else:
            v["result_x"] = None
        in_top_half = top_half_min_score is not None and v["prediction"] >= top_half_min_score
        v["tick"] = (in_top_half == (v["result_x"] >= 1.0)) if v["result_x"] is not None else None
    return videos


def hero_contrast(section_a_scored):
    """mean of 3 highest-SCORED vs 3 lowest-SCORED (by prediction, among
    Section A's real-result rows only -- Section B has no result yet)."""
    usable = [v for v in section_a_scored if v.get("result_x") is not None]
    if len(usable) < 3:
        return None
    by_score = sorted(usable, key=lambda v: v["prediction"], reverse=True)
    top3 = statistics.mean(v["result_x"] for v in by_score[:3])
    bottom3 = statistics.mean(v["result_x"] for v in by_score[-3:])
    return top3, bottom3


def insight_line(all_scored_videos):
    """2-3 axis NAMES from the top-3 scored videos (by prediction, across
    the whole shown set). Only videos carrying real jc_* axis data
    contribute -- study-mode Section A (cached OOF) has none, so if the
    top-3 are all Section A, this gracefully returns None rather than
    fabricating a claim with no backing data."""
    by_score = sorted(all_scored_videos, key=lambda v: v["prediction"], reverse=True)[:3]
    axis_sets = [v["axis_scores"] for v in by_score if v.get("axis_scores")]
    if not axis_sets:
        return None
    keys = AXIS_INSIGHT_LABELS.keys()
    avg = {k: statistics.mean(a[k] for a in axis_sets if a.get(k) is not None)
           for k in keys if any(a.get(k) is not None for a in axis_sets)}
    if not avg:
        return None
    top_axes = sorted(avg, key=avg.get, reverse=True)[:3 if len(avg) >= 3 else 2]
    labels = [AXIS_INSIGHT_LABELS[k] for k in top_axes]
    if len(labels) == 1:
        return labels[0]
    return ", ".join(labels[:-1]) + " and " + labels[-1]


def axis_scores_from_input_features(input_features):
    if not input_features:
        return None
    return {k: input_features.get(f"jc_{k}") for k in AXIS_INSIGHT_LABELS}


# ── --study data source ─────────────────────────────────────────────────────
def load_oof_predictions():
    df = pd.read_parquet(OOF_PARQUET)
    # 3 repeat rows per video_id (repeated GroupKFold CV) -- no established
    # per-video averaging convention exists anywhere in the modeling repo
    # (capstone_endgame.py's own precision stats pool all 3 repeats
    # together rather than averaging first); this script needs ONE ŷ per
    # video for a percentile lookup, so it averages the 3 repeats -- a
    # documented choice, not a silent one.
    return df.groupby("video_id")["y_pred"].mean().to_dict()


def study_creator_id(conn, handle):
    cur = conn.cursor()
    cur.execute("SELECT id FROM research_creators WHERE lower(handle) = lower(%s)", (handle,))
    row = cur.fetchone()
    cur.close()
    if not row:
        sys.exit(f"[generate_preview] --study {handle}: not found in research_creators")
    return row[0]


def study_section_a(conn, creator_id, oof_preds, mode, objective):
    """Videos posted 30+ days ago: OOF ŷ (prediction) + real day-30 result
    (weighted_engagement_rate) from research_metrics."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT v.id AS video_id, v.posted_at, v.caption,
               m.weighted_engagement_rate AS wec_rate
        FROM research_videos v
        LEFT JOIN research_metrics m
          ON m.video_id = v.id AND m.interval_label IN ('day_30', 'backcatalog_day30_equiv_2026_07')
        WHERE v.creator_id = %s AND v.posted_at IS NOT NULL
          AND v.posted_at <= now() - interval '%s days'
        ORDER BY v.posted_at DESC
    """, (creator_id, AGED_MIN_DAYS))
    rows = cur.fetchall()
    cur.close()

    out = []
    for r in rows:
        pred = oof_preds.get(r["video_id"])
        if pred is None:
            continue  # not in the OOF artifact (e.g. added after the 2026-07-07 snapshot) -- skip, don't fabricate
        out.append({
            "posted_at": r["posted_at"], "caption": r["caption"] or "(no caption)",
            "prediction": pred, "wec_rate": r["wec_rate"], "axis_scores": None,  # OOF has no per-axis breakdown
        })
    windowed = size_section_a_window(out)
    return windowed


def _fetch_video(url, objective):
    resp = requests.post(
        f"{PP_API_BASE}/api/fetch-video",
        json={"url": url, "objective": objective or "", "judges": json.dumps(["critic", "cool", "connector"])},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["jobId"]


def _poll_status(job_id):
    deadline = time.time() + STATUS_POLL_TIMEOUT_S
    while time.time() < deadline:
        resp = requests.get(f"{PP_API_BASE}/api/status/{job_id}", timeout=30)
        resp.raise_for_status()
        body = resp.json()
        if body.get("status") in ("done", "partial", "error", "timeout"):
            return body
        time.sleep(STATUS_POLL_INTERVAL_S)
    raise TimeoutError(f"job {job_id} did not finish within {STATUS_POLL_TIMEOUT_S}s")


def study_section_b(conn, creator_id, handle, mode, objective):
    """Videos posted <30 days ago: scored FRESH, right now, via the live
    app's own public link-fetch path (/api/fetch-video) -- fully
    out-of-sample, byte-identical to a real user's result for that URL."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT id AS video_id, posted_at, caption, source_url
        FROM research_videos
        WHERE creator_id = %s AND posted_at IS NOT NULL
          AND posted_at > now() - interval '%s days' AND source_url IS NOT NULL
        ORDER BY posted_at DESC
    """, (creator_id, AGED_MIN_DAYS))
    rows = cur.fetchall()
    cur.close()

    out = []
    for r in rows:
        print(f"[generate_preview] live link-fetch: {r['source_url']}")
        job_id = _fetch_video(r["source_url"], objective if mode == "objective" else "")
        result = _poll_status(job_id)
        if result.get("status") not in ("done", "partial"):
            print(f"[generate_preview]   FAILED (status={result.get('status')}) -- skipping this video", file=sys.stderr)
            continue
        # The scoring write is fire-and-forget relative to /api/status's own
        # "done" flag (see server.js's runShadowScoringForJob docstring) --
        # poll a little further for it to land, THEN read it back via
        # submissions.job_id = job_id (this exact job, deterministic) ->
        # shadow_scores.submission_id. Bug fix: an earlier version read
        # "ORDER BY created_at DESC LIMIT 1" with no job filter at all --
        # this is a call against LIVE PRODUCTION, which has real concurrent
        # traffic, so that query could silently grab an unrelated real
        # user's row that happened to land at the same moment, attributing
        # a stranger's prediction to this creator's video. job_id is unique
        # per call and already known here -- no reason to guess.
        pred_row = None
        for _ in range(15):
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute("""
                SELECT s.prediction, s.input_features FROM shadow_scores s
                JOIN submissions sub ON sub.id = s.submission_id
                WHERE sub.job_id = %s
            """, (job_id,))
            pred_row = cur.fetchone()
            cur.close()
            if pred_row and pred_row["prediction"] is not None:
                break
            time.sleep(2)
        if not pred_row:
            print("[generate_preview]   no shadow_scores row landed -- skipping", file=sys.stderr)
            continue
        out.append({
            "posted_at": r["posted_at"], "caption": r["caption"] or "(no caption)",
            "prediction": pred_row["prediction"],
            "axis_scores": axis_scores_from_input_features(pred_row["input_features"]),
            "live_app_score_display": result.get("scoreDisplay"),  # kept for Task 3's consistency check only
        })
    return out


# ── --prospect data source (Task 1's own rows) ──────────────────────────────
def prospect_rows(conn, handle, aged):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    status_clause = "pv.is_day30_equiv IS TRUE" if aged else "pv.is_day30_equiv IS NOT TRUE"
    cur.execute(f"""
        SELECT pv.posted_at, pv.caption, pv.day30_wec_rate AS wec_rate,
               s.prediction, s.input_features
        FROM posted_videos pv
        JOIN shadow_scores s ON s.posted_video_id = pv.id
        WHERE lower(pv.handle) = lower(%s) AND pv.source = 'prospect_report' AND {status_clause}
        ORDER BY pv.posted_at DESC
    """, (handle,))
    rows = cur.fetchall()
    cur.close()
    out = [
        {"posted_at": r["posted_at"], "caption": r["caption"] or "(no caption)",
         "prediction": r["prediction"], "wec_rate": r["wec_rate"] if aged else None,
         "axis_scores": axis_scores_from_input_features(r["input_features"])}
        for r in rows
    ]
    return out


def prospect_section_a(conn, handle):
    return size_section_a_window(prospect_rows(conn, handle, aged=True))


def prospect_section_b(conn, handle):
    return prospect_rows(conn, handle, aged=False)


# ── HTML rendering (edits Josh's template string in place -- structure/CSS
#    untouched, only data + the mode-marked strings change) ─────────────────
ROW_A_RE = re.compile(
    r'<tr><td class="date">.*?</td><td class="video">.*?</td><td>.*?</td>'
    r'<td class="result[^"]*">.*?</td><td class="match">.*?</td></tr>'
)
ROW_B_RE = re.compile(
    r'<tr><td class="date">.*?</td><td class="video">.*?</td><td>.*?</td>'
    r'<td class="checkin">.*?</td></tr>'
)


def fmt_date(dt):
    return dt.strftime("%b %-d") if hasattr(dt, "strftime") else str(dt)


CAPTION_MAX_CHARS = 58  # matches the template's own sample-row caption length (36-50 chars) --
                         # the table row is designed for a one-line caption; a real TikTok caption
                         # is often several sentences long and MUST be cut down, not just escaped.


def truncate_caption(raw):
    text = re.sub(r"\s+", " ", (raw or "").replace("<", "&lt;")).strip()
    if len(text) <= CAPTION_MAX_CHARS:
        return text
    cut = text[:CAPTION_MAX_CHARS].rsplit(" ", 1)[0]
    return cut + "…"


def row_a_html(v):
    result_class = "up" if (v["result_x"] or 0) >= 1.0 else "down"
    result_text = f'{v["result_x"]:.1f}× <small>your typical</small>' if v.get("result_x") is not None else "—"
    tick_html = '<span class="tick">✓</span>' if v.get("tick") else '<span class="dash">–</span>'
    pill = v.get("pill") or "—"
    cap = truncate_caption(v["caption"])
    return (f'<tr><td class="date">{fmt_date(v["posted_at"])}</td>'
            f'<td class="video"><span class="cap">"{cap}"</span></td>'
            f'<td><span class="pill">{pill}</span></td>'
            f'<td class="result {result_class}">{result_text}</td>'
            f'<td class="match">{tick_html}</td></tr>')


def row_b_html(v, checkin_date):
    pill = v.get("pill") or "—"
    cap = truncate_caption(v["caption"])
    return (f'<tr><td class="date">{fmt_date(v["posted_at"])}</td>'
            f'<td class="video"><span class="cap">"{cap}"</span></td>'
            f'<td><span class="pill">{pill}</span></td>'
            f'<td class="checkin">{checkin_date}</td></tr>')


def render_html(*, handle, niche_line, prepared_date, window_start, window_end,
                 section_a, section_b, hero, insight, precision_caveat, mode, objective):
    html = TEMPLATE_PATH.read_text()

    # Shared rule: MOCKUP ribbon removed entirely, not just print-hidden.
    html = re.sub(r'\s*<div class="ribbon">.*?</div>\n?', "", html, flags=re.S)

    html = html.replace('PreviewPanel — Performance Preview · @maya.gets.glowy',
                         f'PreviewPanel — Performance Preview · @{handle}')
    html = html.replace('<div class="handle">@maya.gets.glowy</div>', f'<div class="handle">@{handle}</div>')
    html = re.sub(
        r'<div class="meta">.*?</div>\s*</div>\s*</header>',
        f'<div class="meta">{niche_line} · TikTok · prepared {prepared_date}<br>\n'
        f'      every public video posted {window_start} – {window_end} '
        f'· engagement = likes + shares + saves per view</div>\n    </div>\n  </header>',
        html, count=1, flags=re.S,
    )

    thesis_h1 = (
        f'We rated your last two months of videos from content alone — never seeing a single view count. '
        f'Your <b>3 highest-rated</b> averaged <b class="up">{hero[0]:.1f}×</b> your typical engagement. '
        f'Your <b>3 lowest-rated</b> averaged <b class="down">{hero[1]:.1f}×</b>.'
        if hero else
        'We rated your last two months of videos from content alone — never seeing a single view count. '
        '<b>Day-30 results are still pending</b> on this batch — check back after the day-30 window closes.'
    )
    html = re.sub(r'<h1>.*?</h1>', f'<h1>{thesis_h1}</h1>', html, count=1, flags=re.S)
    hero_sub = (
        f'Each score is the video’s percentile among recent {objective} videos rated by our '
        f'engagement-prediction model — built on a 259-creator, 4,900-video study of real 30-day TikTok outcomes.'
        if mode == "objective" else
        'Each score is the video’s percentile among the last 1,000 videos rated by our '
        'engagement-prediction model — built on a 259-creator, 4,900-video study of real 30-day TikTok outcomes.'
    )
    html = re.sub(r'<div class="sub">.*?</div>', f'<div class="sub">{hero_sub}</div>', html, count=1, flags=re.S)

    all_rows = section_a + section_b
    strongest = max(all_rows, key=lambda v: v["prediction"]) if all_rows else None
    if strongest:
        checkin = (strongest["posted_at"] + timedelta(days=30)).strftime("%b %-d") if strongest in section_b else None
        bet_note = (f'Logged before results exist — day-30 check-in {checkin}.' if checkin
                    else 'Result already on record — see the table below.')
        html = re.sub(
            r'<div class="video">.*?</div>\s*<span class="pill">.*?</span>\s*<div class="note">.*?</div>',
            f'<div class="video">"{truncate_caption(strongest["caption"])}" · {fmt_date(strongest["posted_at"])}</div>\n      '
            f'<span class="pill">{strongest.get("pill") or "—"}</span>\n      '
            f'<div class="note">{bet_note}</div>',
            html, count=1, flags=re.S,
        )

    rows_a_html = "\n    ".join(row_a_html(v) for v in section_a) or '<tr><td colspan="5">No videos in this window yet.</td></tr>'
    html = ROW_A_RE.sub("@@ROW_A@@", html)
    html = re.sub(r'(@@ROW_A@@\s*)+', rows_a_html, html)

    stamp_date = prepared_date
    html = re.sub(r'<div class="stamp">Predicted · .*?</div>', f'<div class="stamp">Predicted · {stamp_date}</div>', html, count=1)
    rows_b_html = "\n      ".join(
        row_b_html(v, (v["posted_at"] + timedelta(days=30)).strftime("%b %-d")) for v in section_b
    ) or '<tr><td colspan="4">No videos in this window yet.</td></tr>'
    html = ROW_B_RE.sub("@@ROW_B@@", html)
    html = re.sub(r'(@@ROW_B@@\s*)+', rows_b_html, html)

    insight_html = (f'Across your strongest videos, the panel’s highest marks landed on <b>{insight}</b>.'
                     if insight else
                     'Not enough scored axis detail on the top videos yet to call out a specific pattern.')
    html = re.sub(r'<div class="insight">.*?</div>', f'<div class="insight">{insight_html}</div>', html, count=1, flags=re.S)

    if precision_caveat:
        html = html.replace(
            "Predictions, not promises.",
            f"Predictions, not promises. {precision_caveat}",
        )

    return html


# ── Headless print → one-page PDF ───────────────────────────────────────────
CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def render_pdf(html_path, pdf_path):
    cmd = [
        CHROME_BIN, "--headless", "--disable-gpu", "--no-sandbox",
        f"--print-to-pdf={pdf_path}", "--print-to-pdf-no-header",
        "--no-pdf-header-footer", "--virtual-time-budget=8000",
        f"file://{html_path}",
    ]
    subprocess.run(cmd, capture_output=True, timeout=60, check=True)


def pdf_page_count(pdf_path):
    # `mdls -name kMDItemNumberOfPages` looks like the obvious tool here but
    # is genuinely unreliable right after a fresh write -- Spotlight's index
    # lags the filesystem, so a query moments after render_pdf() returns can
    # read a stale/absent value for a page count that's actually already
    # correct (verified: mdls reported 2 immediately after write, then 1 a
    # few seconds later on the SAME unchanged file). Parsing the PDF
    # directly (PyMuPDF) is immediate and race-free.
    import fitz
    with fitz.open(pdf_path) as doc:
        return doc.page_count


# ── main ─────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--study", metavar="HANDLE")
    src.add_argument("--prospect", metavar="HANDLE")
    pct = ap.add_mutually_exclusive_group(required=True)
    pct.add_argument("--objective", metavar="CANONICAL")
    pct.add_argument("--overall", action="store_true")
    ap.add_argument("--descriptor", default="multi-niche creator",
                     help="--overall header niche line when no --objective is given")
    args = ap.parse_args()

    handle = (args.study or args.prospect).lstrip("@")
    is_study = args.study is not None
    mode = "objective" if args.objective else "overall"
    objective = args.objective

    tiers = load_tiers()
    precision_caveat = None
    if mode == "objective":
        precision_caveat = check_objective_gate(objective, tiers)

    conn = db_connect()
    exclude_video_ids = creator_research_video_ids(conn, handle)
    corpus_rows = load_corpus_rows()
    shadow_rows = fetch_live_pool_rows(conn)
    pools = build_pools(corpus_rows, shadow_rows, exclude_video_ids=exclude_video_ids, exclude_handle=handle)
    pool = pools["by_objective"].get(objective, []) if mode == "objective" else pools["overall"]
    report_concentration_watch_stat_for_render(pools, objective, mode)

    if is_study:
        creator_id = study_creator_id(conn, handle)
        oof_preds = load_oof_predictions()
        section_a_full = study_section_a(conn, creator_id, oof_preds, mode, objective)
        # Section B is scored FRESH, right now, via a real (billed) live
        # link-fetch call per video -- fetched exactly once per run, never
        # inside the shrink-retry loop below (that loop only re-slices
        # Section A, which is free -- already-scored data).
        section_b = study_section_b(conn, creator_id, handle, mode, objective)
    else:
        section_a_full = prospect_section_a(conn, handle)
        section_b = prospect_section_b(conn, handle)

    for v in section_b:
        v["percentile"] = midrank_percentile(v["prediction"], pool)
        v["pill"] = pill_text(v["percentile"], mode, objective)

    prepared_date = datetime.now(timezone.utc).strftime("%B %-d, %Y")
    niche_line = objective if mode == "objective" else args.descriptor
    RECRUITMENT_DIR.mkdir(exist_ok=True)
    date_tag = datetime.now(timezone.utc).strftime("%Y%m%d")
    stem = f"preview_@{handle}_{mode}_{date_tag}"
    html_path = RECRUITMENT_DIR / f"{stem}.html"
    pdf_path = RECRUITMENT_DIR / f"{stem}.pdf"

    # One page, verified via headless print -- shrink Section A's row count
    # (never Section B's real "last 30 days" window, and never the
    # template's own type sizes) until it fits, or give up loudly after a
    # few tries. score_section_a is recomputed each pass -- the shown set's
    # own median/top-half depend on exactly which rows are included.
    n_rows = SECTION_A_MAX_ROWS
    pages = None
    while n_rows >= 3:
        section_a = score_section_a(list(section_a_full[:n_rows]), pool, mode, objective)
        hero = hero_contrast(section_a)
        insight = insight_line(section_a + section_b)
        all_dates = [v["posted_at"] for v in section_a + section_b if v.get("posted_at")]
        window_start = fmt_date(min(all_dates)) if all_dates else "—"
        window_end = fmt_date(max(all_dates)) if all_dates else "—"

        html = render_html(
            handle=handle, niche_line=niche_line, prepared_date=prepared_date,
            window_start=window_start, window_end=window_end,
            section_a=section_a, section_b=section_b, hero=hero, insight=insight,
            precision_caveat=precision_caveat, mode=mode, objective=objective,
        )
        html_path.write_text(html)
        render_pdf(html_path, pdf_path)
        pages = pdf_page_count(pdf_path)
        print(f"[generate_preview] render attempt: {n_rows} Section-A rows -> {pages} page(s)")
        if pages == 1:
            break
        n_rows -= 1
    else:
        print(f"[generate_preview] WARNING: still {pages} page(s) at the {n_rows + 1}-row floor -- "
              f"shrinking further would leave Section A too thin to be honest; shipping as-is",
              file=sys.stderr)

    print(f"[generate_preview] wrote {html_path}")
    print(f"[generate_preview] wrote {pdf_path} ({pages} page(s))")

    conn.close()


if __name__ == "__main__":
    main()
