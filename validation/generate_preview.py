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


# ── Hotfix v2, Task 1: Neon reconnect guard ─────────────────────────────────
# Local helper, no research-repo imports (each script that needs this defines
# its own copy -- see worker.py's identical DB class). Confirmed root cause
# of two production crashes ("SSL connection has been closed unexpectedly"):
# Neon can idle-close a held connection mid-script, and this script's own
# Section-B loop holds one across several minutes of per-video fetch/judge/
# poll network work between DB reads -- exactly the idle window that trips
# it. DB.query() is the single choke point every query in this script goes
# through, wrapping EVERY query site in a reopen-and-retry-once on
# psycopg2.OperationalError, not just the one confirmed crash site (the
# per-video post-poll read in study_section_b) -- any query following slow
# network work is equally exposed.
class DB:
    def __init__(self):
        self.conn = db_connect()

    def _reopen(self):
        try:
            self.conn.close()
        except Exception:
            pass
        self.conn = db_connect()

    def query(self, sql, params=None, fetch=None, cursor_factory=None):
        """fetch: None (no result expected), 'one', or 'all'. Retries the
        whole cursor/execute/fetch sequence once on a dropped connection."""
        for attempt in (1, 2):
            try:
                cur = self.conn.cursor(cursor_factory=cursor_factory)
                cur.execute(sql, params)
                result = cur.fetchall() if fetch == "all" else cur.fetchone() if fetch == "one" else None
                cur.close()
                return result
            except psycopg2.OperationalError as e:
                if attempt == 2:
                    raise
                print(f"[generate_preview] DB connection lost ({e}) -- reconnecting and retrying once", file=sys.stderr)
                self._reopen()

    def close(self):
        self.conn.close()


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


def fetch_live_pool_rows(db):
    """Mirrors server.js's SCORE_DISPLAY_FETCHERS.fetchShadowRows query
    exactly, plus posted_videos.handle (join-only addition -- needed for
    self-exclusion and the concentration watch-stat; the live app doesn't
    read this column itself)."""
    rows = db.query("""
        SELECT s.id, s.prediction, s.objective, s.created_at, s.platform, pv.handle
        FROM shadow_scores s
        LEFT JOIN posted_videos pv ON pv.id = s.posted_video_id
        WHERE s.prediction IS NOT NULL AND s.is_posted_video IS NOT TRUE AND s.pool_eligible
    """, fetch="all", cursor_factory=psycopg2.extras.RealDictCursor)
    return [
        {"key": f"shadow:{r['id']}", "prediction": r["prediction"], "objective": r["objective"],
         "date": r["created_at"], "handle": r["handle"]}
        for r in rows
    ]


def creator_research_video_ids(db, handle):
    """research_videos.id values (== corpus_reference_pool.json's video_id
    field) belonging to this creator, for self-exclusion. Empty for a
    --prospect handle -- correct and expected, not a bug: they have no
    research_videos rows at all."""
    rows = db.query(
        """SELECT v.id FROM research_videos v
           JOIN research_creators c ON c.id = v.creator_id
           WHERE lower(c.handle) = lower(%s)""",
        (handle,), fetch="all",
    )
    return {row[0] for row in rows}


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


def _clamped_ordinal(percentile):
    """Polish v3, Task 6: never DISPLAY 0th or 100th. Both are
    mathematically real outputs of midrank_percentile (the pool's actual
    lowest/highest value rounds to exactly 0 or 100), but "0th percentile"
    / "100th percentile" reads as a false-absolute claim ("literally the
    single worst/best video ever") this document never intends to make --
    ordinal framing only, everywhere else in this generator. Clamps the
    DISPLAY string only; the stored v["percentile"] stays the true
    computed value for anything that isn't user-facing text. Returns
    e.g. "99th" -- callers append " percentile" (+ scope, where wanted)."""
    n = max(1, min(99, int(round(percentile))))
    suffix = "th" if 11 <= (n % 100) <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"


def pill_text(percentile, mode, objective):
    """Full form, 'Nth percentile · <scope>' -- Polish v4, Task 1: used
    ONLY for the single, context-free bet-card instance now. Table rows
    use pill_text_short instead, since the comparison basis (niche name
    or "last 1,000") now lives once in the OUR SCORE column header's own
    subline rather than being repeated on every one of up to 13 rows."""
    if percentile is None:
        return None
    scope = objective if mode == "objective" else "all videos"
    return f"{_clamped_ordinal(percentile)} percentile · {scope}"


def pill_text_short(percentile):
    """'Nth percentile', no scope suffix -- Polish v4, Task 1: every
    row pill in both Section-A and Section-B tables."""
    if percentile is None:
        return None
    return f"{_clamped_ordinal(percentile)} percentile"


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


def _topbottom_k(n):
    """Single source of truth for 'how many rows count as top/bottom at
    this n', shared by topbottom_metrics and mark_top_bottom_pills so the
    hero sentence and the Section-A pills can never disagree about it.
    n>=6 -> 3; n in {4,5} -> 2 (a k=3 read at n=5 would pull the
    middle-ranked row into BOTH groups -- overlapping sets are worse than
    a smaller honest split); n<4 -> None (not enough spread to say
    anything about a top-vs-bottom split that isn't noise)."""
    if n >= 6:
        return 3
    if n >= 4:
        return 2
    return None


def mark_top_bottom_pills(section_a):
    """Polish v3: replaces the old shown-set top-half/bottom-half
    'CALLED IT?' rule with explicit TOP-N/BOTTOM-N pills -- same
    self-relative philosophy (this says whether our RANKING of YOUR
    videos called the direction right, not whether you're an
    above-average creator against the pool -- the percentile pill already
    answers that), just made concrete instead of implicit. Mutates each
    row with pill_kind ('top'|'bottom'|None), pill_group (display label,
    e.g. 'Top 3'), and pill_tick (True/False/None). TOP row: ✓ iff
    result_x>=1.0 (a top-scored video that actually over-performed),
    else ✗ (a top-scored video that under-performed -- a real miss).
    BOTTOM row: ✓ iff result_x<1.0, else ✗. Middle (non-pill) rows get
    neither a pill nor a mark -- their ranking wasn't confident enough to
    be one of the panel's actual calls.

    Polish v5, Task 1: the top/bottom split itself now comes from
    topbottom_metrics -- the SAME computation the adaptive hero sentence
    and send-check verdict read -- rather than re-sorting/re-selecting
    independently, so the pills and the hero/verdict can never disagree
    about which rows are top/bottom or whether a call was right."""
    for v in section_a:
        v["pill_kind"] = None
        v["pill_group"] = None
        v["pill_tick"] = None

    metrics = topbottom_metrics(section_a)
    if metrics is None:
        return section_a

    k = metrics["k"]
    for v in metrics["top_rows"]:
        v["pill_kind"] = "top"
        v["pill_group"] = f"Top {k}"
        v["pill_tick"] = v["result_x"] >= 1.0
    for v in metrics["bottom_rows"]:
        v["pill_kind"] = "bottom"
        v["pill_group"] = f"Bottom {k}"
        v["pill_tick"] = v["result_x"] < 1.0
    return section_a


def score_section_a(videos, pool):
    """videos: dicts with prediction (raw ŷ) and wec_rate (real 30-day
    result) already populated. Adds percentile/pill/result_x, plus
    pill_kind/pill_group/pill_tick via mark_top_bottom_pills. Median is
    over THIS shown set, not the creator's full history. Pill is the
    SHORT form (Polish v4, Task 1) -- mode/objective no longer needed
    here, the scope now lives once in the column header subline."""
    for v in videos:
        v["percentile"] = midrank_percentile(v["prediction"], pool)
        v["pill"] = pill_text_short(v["percentile"])

    wec_values = [v["wec_rate"] for v in videos if v.get("wec_rate") is not None]
    median_wec = statistics.median(wec_values) if wec_values else None
    for v in videos:
        v["result_x"] = (v["wec_rate"] / median_wec
                          if median_wec and v.get("wec_rate") is not None else None)

    mark_top_bottom_pills(videos)
    return videos


def topbottom_metrics(section_a_scored):
    """Polish v5, Task 1 -- single source of truth for the top-N/bottom-N
    split and everything derived from it, shared by mark_top_bottom_pills
    (the row pills' kind/tick), the adaptive hero sentence, and the
    send-check verdict -- none of them can ever disagree about which rows
    count, whether a call was right, or the resulting averages, because
    they all read from THIS one computation rather than each re-deriving
    it independently. Supersedes the old hero_contrast (same tiering via
    _topbottom_k, same 2*k<=n no-overlap guarantee), extended with the
    calls-record fields Polish v5's adaptive hero/verdict need.

    n (usable = has a real result_x, i.e. a real 30-day result exists)
    tiered via _topbottom_k -- same tiering mark_top_bottom_pills uses for
    the Section-A pills. n<4 -> None, caller drops the contrast and leads
    with the best-bet framing instead.

    Returns None or a dict:
      k                        -- 2 or 3, the N in "Top N / Bottom N"
      top_rows / bottom_rows   -- the actual row dicts (exposed so
        mark_top_bottom_pills doesn't re-sort/re-select independently)
      top_avg / bottom_avg     -- mean result_x within each group
      gap                      -- top_avg - bottom_avg
      calls_correct            -- rows where the panel's call matched
        (TOP: result_x>=1.0, BOTTOM: result_x<1.0), out of...
      calls_total              -- 2*k
    """
    usable = [v for v in section_a_scored if v.get("result_x") is not None]
    k = _topbottom_k(len(usable))
    if k is None:
        return None
    by_score = sorted(usable, key=lambda v: v["prediction"], reverse=True)
    top_rows = by_score[:k]
    bottom_rows = by_score[-k:]
    top_avg = statistics.mean(v["result_x"] for v in top_rows)
    bottom_avg = statistics.mean(v["result_x"] for v in bottom_rows)
    calls_correct = (sum(1 for v in top_rows if v["result_x"] >= 1.0)
                     + sum(1 for v in bottom_rows if v["result_x"] < 1.0))
    return {
        "k": k, "top_rows": top_rows, "bottom_rows": bottom_rows,
        "top_avg": top_avg, "bottom_avg": bottom_avg, "gap": top_avg - bottom_avg,
        "calls_correct": calls_correct, "calls_total": 2 * k,
    }


# Polish v5, Task 2 -- impressiveness tier thresholds. Named constants
# (rather than inlining 0.5/0.2) so send_check_verdict, averages_tier, and
# its own tests all reference the identical boundary values.
AVG_TIER_STRONG_GAP = 0.5
AVG_TIER_GOOD_GAP = 0.2


def averages_tier(gap):
    """Polish v5, Task 2 -- deterministic impressiveness tier from the
    top/bottom AVERAGES gap. Each named threshold is its bucket's
    INCLUSIVE lower bound, so an exact boundary value (0.5, 0.2, or 0.0)
    always resolves to the higher tier named for that threshold -- never
    ambiguous. gap<0 (top's average actually below bottom's) -> 0."""
    if gap >= AVG_TIER_STRONG_GAP:
        return 3
    if gap >= AVG_TIER_GOOD_GAP:
        return 2
    if gap >= 0.0:
        return 1
    return 0


def calls_tier(calls_correct, calls_total):
    """Polish v5, Task 2 -- deterministic impressiveness tier from the
    top/bottom CALLS record. Two separate scales depending on calls_total
    (4 when k=2, 6 when k=3 -- the only two values _topbottom_k ever
    produces, since calls_total == 2*k)."""
    if calls_total == 6:
        if calls_correct >= 5:
            return 3
        if calls_correct == 4:
            return 2
        if calls_correct == 3:
            return 1
        return 0
    if calls_total == 4:
        if calls_correct == 4:
            return 3
        if calls_correct == 3:
            return 2
        if calls_correct == 2:
            return 1
        return 0
    # calls_total is always 4 or 6 in practice (2*k, k in {2,3}) -- degrade
    # to the most conservative tier rather than raising if it somehow isn't.
    return 0


def pick_hero_form(hero, strongest):
    """Polish v5, Task 3 -- which hero sentence-2 form to render, single
    source for both render_html's own branch and the console SEND-CHECK
    log (so what's printed always matches what's actually in the
    document). Picks the HIGHER impressiveness tier (averages vs calls);
    a tie goes to averages (more visceral, per spec) EXCEPT when both are
    tier 0, which gets the dedicated neutral copy instead of averages
    phrasing -- averages wording would read as a fabricated boast on a
    genuinely flat/inverted result, and "no boast is fabricated, ever."
    'best_bet' / 'pending' cover the pre-existing n<4 branches (hero is
    None) so this stays the single place that decides the rendered form."""
    if hero is None:
        return "best_bet" if strongest else "pending"
    avg_t = averages_tier(hero["gap"])
    call_t = calls_tier(hero["calls_correct"], hero["calls_total"])
    if avg_t == 0 and call_t == 0:
        return "neutral"
    return "averages" if avg_t >= call_t else "calls"


def send_check_verdict(hero):
    """Polish v5, Task 4 -- remap: replaces the old STRONG/WEAK/INVERTED
    (averages-gap-only) verdict with one that also accounts for the
    calls-tier, since the hero sentence itself now sometimes leads with
    calls instead of averages (Task 3) -- the send-check should track
    whichever signal is actually the stronger one, same as the hero does
    (max tier), not just the averages gap. STRONG: max tier is 3 (either
    signal is genuinely impressive). MIXED: max tier is 1 or 2 (some
    positive signal, but read the doc before sending). DO NOT SEND: both
    tiers are 0 -- final, no override. N/A when hero is None (n<4, no
    contrast computed at all)."""
    if hero is None:
        return "N/A", "fewer than 4 Section-A videos with a real result -- no contrast to check"
    avg_t = averages_tier(hero["gap"])
    call_t = calls_tier(hero["calls_correct"], hero["calls_total"])
    max_tier = max(avg_t, call_t)
    if max_tier == 3:
        verdict = "STRONG"
    elif max_tier == 0:
        verdict = "DO NOT SEND"
    else:
        verdict = "MIXED"
    detail = (f"averages: top={hero['top_avg']:.2f}x bottom={hero['bottom_avg']:.2f}x "
              f"gap={hero['gap']:+.2f}x (tier {avg_t}) | "
              f"calls: {hero['calls_correct']} of {hero['calls_total']} (tier {call_t}) | "
              f"max_tier={max_tier}")
    return verdict, detail


def bet_card_fields(section_b, mode, objective):
    """Polish v4, Task 2: the bet card is Section-B ONLY now -- the old
    Section-A fallback (picking the best-scored video across BOTH
    sections) is removed. This is deliberately a different question from
    the hero sentence's own best-bet-fallback branch (still section_a +
    section_b, unchanged): the bet card specifically answers "what's
    still unproven," not "what scored best overall" -- a Section-A video
    already has a real result, so it was never really a "bet" by the time
    this document renders. Returns {'empty': True} when Section B has no
    videos at all, else {'empty': False, 'caption', 'date', 'pill'
    (FULL suffix -- a single, context-free instance, Task 1's row-pill
    dedup doesn't apply here), 'checkin'}."""
    if not section_b:
        return {"empty": True}
    video = max(section_b, key=lambda v: v["prediction"])
    return {
        "empty": False,
        "caption": truncate_caption(video["caption"]),
        "date": fmt_date(video["posted_at"]),
        "pill": pill_text(video["percentile"], mode, objective) or "—",
        "checkin": (video["posted_at"] + timedelta(days=30)).strftime("%b %-d"),
    }


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


def study_creator_id(db, handle):
    row = db.query("SELECT id FROM research_creators WHERE lower(handle) = lower(%s)", (handle,), fetch="one")
    if not row:
        sys.exit(f"[generate_preview] --study {handle}: not found in research_creators")
    return row[0]


def study_section_a(db, creator_id, oof_preds, mode, objective):
    """Videos posted 30+ days ago: OOF ŷ (prediction) + real day-30 result
    (weighted_engagement_rate) from research_metrics."""
    rows = db.query("""
        SELECT v.id AS video_id, v.posted_at, v.caption,
               m.weighted_engagement_rate AS wec_rate
        FROM research_videos v
        LEFT JOIN research_metrics m
          ON m.video_id = v.id AND m.interval_label IN ('day_30', 'backcatalog_day30_equiv_2026_07')
        WHERE v.creator_id = %s AND v.posted_at IS NOT NULL
          AND v.posted_at <= now() - interval '%s days'
        ORDER BY v.posted_at DESC
    """, (creator_id, AGED_MIN_DAYS), fetch="all", cursor_factory=psycopg2.extras.RealDictCursor)

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


def _reused_row_for_url(db, source_url, objective, mode, reuse_within_hours):
    """Hotfix v2, Task 2 -- PER-VIDEO reuse, replaces the old batch-level
    _recent_reused_section_b_rows (which required the whole batch to match
    exactly -- a single crash or a single new post since the last render
    meant re-spending from zero). Looks up the most recent shadow_scores
    row for THIS EXACT tiktok video URL within reuse_within_hours. Requires
    source_url to have been populated at score time (shadowScore.js's
    recordShadowScore, threaded from job.sourceUrl in server.js) -- a row
    written before that column existed simply won't match and falls
    through to a live fetch, same as any other cache miss. Returns None
    (caller fetches live) if nothing matches."""
    obj_filter = "AND s.objective = %s" if mode == "objective" else ""
    params = [source_url]
    if mode == "objective":
        params.append(objective)
    params.append(reuse_within_hours)
    return db.query(f"""
        SELECT s.prediction, s.input_features FROM shadow_scores s
        WHERE s.source_url = %s {obj_filter}
          AND s.created_at > now() - interval '%s hours'
        ORDER BY s.created_at DESC LIMIT 1
    """, params, fetch="one", cursor_factory=psycopg2.extras.RealDictCursor)


def study_section_b(db, creator_id, handle, mode, objective, reuse_within_hours=24):
    """Videos posted <30 days ago: scored FRESH, via the live app's own
    public link-fetch path (/api/fetch-video) -- fully out-of-sample,
    byte-identical to a real user's result for that URL. Hotfix v2, Task 2:
    reuse is now PER-VIDEO and the default (reuse_within_hours=24) -- pass
    0 (or None) to disable and force a full live re-fetch. A crashed run's
    partial progress is recovered per-video instead of re-spent wholesale,
    and a video posted since the last render fetches only itself."""
    rows = db.query("""
        SELECT id AS video_id, posted_at, caption, source_url
        FROM research_videos
        WHERE creator_id = %s AND posted_at IS NOT NULL
          AND posted_at > now() - interval '%s days' AND source_url IS NOT NULL
        ORDER BY posted_at DESC
    """, (creator_id, AGED_MIN_DAYS), fetch="all", cursor_factory=psycopg2.extras.RealDictCursor)

    # Determine the reuse/fetch split UP FRONT (before any live fetches
    # start) so the honest "reusing K of N; fetching N-K" line prints as a
    # plan, not a running tally -- same operator-facing shape the old
    # batch-level log line had.
    hits = {}
    if reuse_within_hours:
        for r in rows:
            hit = _reused_row_for_url(db, r["source_url"], objective, mode, reuse_within_hours)
            if hit and hit.get("prediction") is not None:
                hits[r["video_id"]] = hit
        print(f"[generate_preview] reusing {len(hits)} of {len(rows)}; fetching {len(rows) - len(hits)}")

    out = []
    for r in rows:
        hit = hits.get(r["video_id"])
        if hit is not None:
            out.append({
                "posted_at": r["posted_at"], "caption": r["caption"] or "(no caption)",
                "prediction": hit["prediction"],
                "axis_scores": axis_scores_from_input_features(hit["input_features"]),
            })
            continue

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
        #
        # Hotfix v2, Task 1: THIS read is the confirmed crash site -- it
        # runs immediately after the video's own multi-minute fetch/judge
        # cycle above, exactly the idle window Neon can close a held
        # connection on. db.query() reopens and retries once automatically.
        pred_row = None
        for _ in range(15):
            pred_row = db.query("""
                SELECT s.prediction, s.input_features FROM shadow_scores s
                JOIN submissions sub ON sub.id = s.submission_id
                WHERE sub.job_id = %s
            """, (job_id,), fetch="one", cursor_factory=psycopg2.extras.RealDictCursor)
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
def prospect_rows(db, handle, aged):
    status_clause = "pv.is_day30_equiv IS TRUE" if aged else "pv.is_day30_equiv IS NOT TRUE"
    rows = db.query(f"""
        SELECT pv.posted_at, pv.caption, pv.day30_wec_rate AS wec_rate,
               s.prediction, s.input_features
        FROM posted_videos pv
        JOIN shadow_scores s ON s.posted_video_id = pv.id
        WHERE lower(pv.handle) = lower(%s) AND pv.source = 'prospect_report' AND {status_clause}
        ORDER BY pv.posted_at DESC
    """, (handle,), fetch="all", cursor_factory=psycopg2.extras.RealDictCursor)
    out = [
        {"posted_at": r["posted_at"], "caption": r["caption"] or "(no caption)",
         "prediction": r["prediction"], "wec_rate": r["wec_rate"] if aged else None,
         "axis_scores": axis_scores_from_input_features(r["input_features"])}
        for r in rows
    ]
    return out


def prospect_section_a(db, handle):
    return size_section_a_window(prospect_rows(db, handle, aged=True))


def prospect_section_b(db, handle):
    return prospect_rows(db, handle, aged=False)


# ── HTML rendering (edits Josh's template string in place -- structure/CSS
#    untouched, only data + the mode-marked strings change) ─────────────────
ROW_A_RE = re.compile(
    r'<tr><td class="date">.*?</td><td class="video">.*?</td><td class="score">.*?</td>'
    r'<td class="result[^"]*">.*?</td><td class="match">.*?</td></tr>'
)
ROW_B_RE = re.compile(
    r'<tr><td class="date">.*?</td><td class="video">.*?</td><td class="score">.*?</td>'
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
    pill = v.get("pill") or "—"
    # Inline TOP/BOTTOM pill next to the percentile pill -- only on rows
    # mark_top_bottom_pills actually placed in one of the two groups.
    badge = f'<span class="pill-{v["pill_kind"]}">{v["pill_group"]}</span>' if v.get("pill_kind") else ""
    # ✓/✗ ONLY on pill rows -- a miss renders as a real ✗ (var(--low)), not
    # a near-invisible dash. Middle (non-pill) rows get an explicit small
    # muted "no call" (Polish v4, Task 4) instead of a blank cell -- their
    # ranking wasn't confident enough to be one of the panel's actual
    # calls, and that's worth saying rather than leaving unexplained.
    if v.get("pill_tick") is None:
        mark_html = '<span class="no-call">no call</span>'
    elif v["pill_tick"]:
        mark_html = '<span class="tick">✓</span>'
    else:
        mark_html = '<span class="miss">✗</span>'
    cap = truncate_caption(v["caption"])
    return (f'<tr><td class="date">{fmt_date(v["posted_at"])}</td>'
            f'<td class="video"><span class="cap">"{cap}"</span></td>'
            f'<td class="score"><span class="pill">{pill}</span>{badge}</td>'
            f'<td class="result {result_class}">{result_text}</td>'
            f'<td class="match">{mark_html}</td></tr>')


def build_section_a_rows_html(section_a):
    """Polish v3: sorted by score descending (fixes the date-sort
    regression -- an earlier version left rows in the data-source
    adapters' date order, but the spec was always score-sort). No divider
    row anymore -- the TOP/BOTTOM pills (row_a_html) mark the split
    explicitly now, inline, so a separate hairline row would be
    redundant."""
    if not section_a:
        return '<tr><td colspan="5">No videos in this window yet.</td></tr>'
    by_score = sorted(section_a, key=lambda v: v["prediction"], reverse=True)
    return "\n    ".join(row_a_html(v) for v in by_score)


def row_b_html(v, checkin_date):
    pill = v.get("pill") or "—"
    cap = truncate_caption(v["caption"])
    return (f'<tr><td class="date">{fmt_date(v["posted_at"])}</td>'
            f'<td class="video"><span class="cap">"{cap}"</span></td>'
            f'<td class="score"><span class="pill">{pill}</span></td>'
            f'<td class="checkin">{checkin_date}</td></tr>')


def render_html(*, handle, niche_line, prepared_date, render_date, section_a_start,
                 section_a, section_b, hero, insight, precision_caveat, mode, objective):
    html = TEMPLATE_PATH.read_text()

    # Shared rule: MOCKUP ribbon removed entirely, not just print-hidden.
    html = re.sub(r'\s*<div class="ribbon">.*?</div>\n?', "", html, flags=re.S)

    html = html.replace('PreviewPanel — Performance Preview · @maya.gets.glowy',
                         f'PreviewPanel — Performance Preview · @{handle}')
    html = html.replace('<div class="handle">@maya.gets.glowy</div>', f'<div class="handle">@{handle}</div>')
    # Polish v3, Task 2: end of the posted-videos range is the REPORT RUN
    # DATE, not the latest video's own posted_at -- "posted videos X to
    # (effectively) now," not "X to whenever the last video happened to
    # land." The engagement-definition clause moved off this line entirely
    # (now lives on the result column's own subline, Task 4).
    html = re.sub(
        r'<div class="meta">.*?</div>\s*</div>\s*</header>',
        f'<div class="meta">{niche_line} · TikTok · prepared {prepared_date}<br>\n'
        f'      posted videos {section_a_start} – {render_date}</div>\n    </div>\n  </header>',
        html, count=1, flags=re.S,
    )

    all_rows_for_bet = section_a + section_b
    strongest = max(all_rows_for_bet, key=lambda v: v["prediction"]) if all_rows_for_bet else None
    # Polish v3, Task 3: opening clause is now dynamic and carries the
    # completeness claim itself ("every public video ... since <date>"),
    # rather than a generic "last two months" -- the actual claim is
    # "since Section A's oldest video," whatever span that really is.
    opening = (f"We rated every public video you've posted since {section_a_start} — "
               f"from content alone, never seeing a single view count.")
    # Polish v5, Task 3: sentence 1 (the opening clause above) is unchanged
    # in every form. Sentence 2 is now adaptive -- pick_hero_form is the
    # single source deciding which of the 5 forms below renders (also
    # logged to the console, see main()), so the document and the
    # send-check log can never describe two different sentences.
    hero_form = pick_hero_form(hero, strongest)
    if hero_form == "averages":
        word = {2: "2", 3: "3"}[hero["k"]]
        thesis_h1 = (
            f'{opening} '
            f'Your <b>{word} highest-rated</b> averaged <b class="up">{hero["top_avg"]:.1f}×</b> your typical engagement. '
            f'Your <b>{word} lowest-rated</b> averaged <b class="down">{hero["bottom_avg"]:.1f}×</b>.'
        )
    elif hero_form == "calls":
        # Calls form: leads with the panel's hit rate instead of the raw
        # averages -- picked over averages when the CALLS tier outranks
        # the AVERAGES tier (see pick_hero_form). Bold "C of 2N"; green
        # only when the hit rate clears 2/3, same bar as an easy pass on a
        # 6-call board would be a real accomplishment (>=.67), not a bare
        # majority.
        word = {2: "2", 3: "3"}[hero["k"]]
        ratio = hero["calls_correct"] / hero["calls_total"]
        calls_b = (f'<b class="up">{hero["calls_correct"]} of {hero["calls_total"]}</b>' if ratio >= 0.67
                   else f'<b>{hero["calls_correct"]} of {hero["calls_total"]}</b>')
        thesis_h1 = (
            f'{opening} '
            f'We made calls on your {word} highest- and {word} lowest-rated — and got {calls_b} right.'
        )
    elif hero_form == "neutral":
        # Neither the averages gap nor the calls record clears even the
        # lowest impressiveness tier -- no boast is fabricated, ever; the
        # table itself is the honest account.
        thesis_h1 = f'{opening} Every call — hit and miss — is in the table below.'
    elif hero_form == "best_bet":
        # Hero-contrast guard: fewer than 4 Section-A rows with a real
        # result isn't enough spread for an honest top-vs-bottom split
        # (see pick_hero_form/topbottom_metrics) -- lead with the best bet
        # instead of forcing a noisy contrast.
        thesis_h1 = (
            f'{opening} '
            f'Your strongest bet so far: <b>"{truncate_caption(strongest["caption"])}"</b>, '
            f'<b class="up">{strongest.get("pill") or "—"}</b>.'
        )
    else:  # "pending"
        thesis_h1 = (
            f'{opening} '
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

    # Polish v4, Task 1: the OUR SCORE column subline is where the
    # niche/overall comparison basis now lives (row pills dropped it --
    # see pill_text_short) -- both tables show the identical subline, one
    # global replace catches both header cells.
    score_col_sub = (f'percentile among recent {objective} videos' if mode == "objective"
                      else "percentile among the last 1,000 videos we've scored")
    html = html.replace('percentile among recent Makeup videos', score_col_sub)

    bet = bet_card_fields(section_b, mode, objective)
    if bet["empty"]:
        bet_replacement = ('<div class="video">Nothing posted in the last 30 days — your next video is '
                            'your strongest bet. Run it first.</div>')
    else:
        bet_replacement = (
            f'<div class="video">"{bet["caption"]}" · {bet["date"]}</div>\n      '
            f'<span class="pill">{bet["pill"]}</span>\n      '
            f'<div class="note">Logged before results exist — day-30 check-in {bet["checkin"]}.</div>'
        )
    html = re.sub(
        r'<div class="video">.*?</div>\s*<span class="pill">.*?</span>\s*<div class="note">.*?</div>',
        bet_replacement,
        html, count=1, flags=re.S,
    )

    rows_a_html = build_section_a_rows_html(section_a)
    html = ROW_A_RE.sub("@@ROW_A@@", html)
    html = re.sub(r'(@@ROW_A@@\s*)+', rows_a_html, html)

    # Stamp redesign: flat chip in the section-h line, not a rotated
    # absolute-positioned badge -- no overlap possible by construction
    # (see the template's .chip-predicted rule / removed .stamp rule).
    chip_html = f'Predicted {prepared_date} · before results exist'
    html = re.sub(r'<span class="chip-predicted">.*?</span>', f'<span class="chip-predicted">{chip_html}</span>', html, count=1)
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

    # Polish v5, Task 4: hero_form is returned alongside the html (not just
    # used internally above) so main() can print it next to the send-check
    # verdict -- "which hero form rendered" always describes what's
    # actually in THIS document, not a separately-recomputed guess.
    return html, hero_form


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
    ap.add_argument("--reuse-section-b-hours", type=float, default=24,
                     help="--study only: per-video Section-B reuse -- for each candidate video, reuse an "
                          "existing scored row for that exact tiktok video URL from within this many hours "
                          "instead of re-fetching it live (default 24; pass 0 to disable and force a full "
                          "live re-fetch of every Section-B video)")
    args = ap.parse_args()

    handle = (args.study or args.prospect).lstrip("@")
    is_study = args.study is not None
    mode = "objective" if args.objective else "overall"
    objective = args.objective

    tiers = load_tiers()
    precision_caveat = None
    if mode == "objective":
        precision_caveat = check_objective_gate(objective, tiers)

    db = DB()
    exclude_video_ids = creator_research_video_ids(db, handle)
    corpus_rows = load_corpus_rows()
    shadow_rows = fetch_live_pool_rows(db)
    pools = build_pools(corpus_rows, shadow_rows, exclude_video_ids=exclude_video_ids, exclude_handle=handle)
    pool = pools["by_objective"].get(objective, []) if mode == "objective" else pools["overall"]
    report_concentration_watch_stat_for_render(pools, objective, mode)

    if is_study:
        creator_id = study_creator_id(db, handle)
        oof_preds = load_oof_predictions()
        section_a_full = study_section_a(db, creator_id, oof_preds, mode, objective)
        # Section B is scored FRESH by default, via a real (billed) live
        # link-fetch call per video -- unless --reuse-section-b-hours (per
        # video, default 24h) finds a matching prior row for that exact URL.
        section_b = study_section_b(db, creator_id, handle, mode, objective,
                                     reuse_within_hours=args.reuse_section_b_hours)
    else:
        section_a_full = prospect_section_a(db, handle)
        section_b = prospect_section_b(db, handle)

    for v in section_b:
        v["percentile"] = midrank_percentile(v["prediction"], pool)
        v["pill"] = pill_text_short(v["percentile"])

    prepared_date = datetime.now(timezone.utc).strftime("%B %-d, %Y")
    niche_line = objective if mode == "objective" else args.descriptor
    RECRUITMENT_DIR.mkdir(exist_ok=True)
    date_tag = datetime.now(timezone.utc).strftime("%Y%m%d")
    stem = f"preview_@{handle}_{mode}_{date_tag}"
    html_path = RECRUITMENT_DIR / f"{stem}.html"
    pdf_path = RECRUITMENT_DIR / f"{stem}.pdf"

    # Section A targets exactly SECTION_A_MAX_ROWS (8) -- study_section_a /
    # prospect_section_a already extend their lookback as far as each mode
    # allows (unlimited for --study; capped at the 100-day phase5c boundary
    # for --prospect) and cap at 8 via size_section_a_window, never fewer
    # unless genuinely fewer videos exist. No shrink-to-fit here anymore:
    # the one-page target is now the LAYOUT's job (compact header/type,
    # Task 3), not the row count's. If 8A+5B genuinely doesn't fit one
    # page, the document grows to page 2 -- never drop rows below spec or
    # shrink type to force a fit.
    section_a = score_section_a(list(section_a_full), pool)
    if len(section_a) < SECTION_A_MAX_ROWS:
        print(f"[generate_preview] NOTE: only {len(section_a)}/{SECTION_A_MAX_ROWS} Section-A videos exist "
              f"within this mode's lookback window -- rendering what exists, not padding or erroring.")
    hero = topbottom_metrics(section_a)
    insight = insight_line(section_a + section_b)
    # Polish v3, Tasks 2-3: "Section-A start date" is the single date both
    # the meta line and the dynamic hero sentence hang off of -- the
    # OLDEST Section-A video specifically (not blended with Section B).
    section_a_dates = [v["posted_at"] for v in section_a if v.get("posted_at")]
    section_a_start = fmt_date(min(section_a_dates)) if section_a_dates else "—"
    render_date = fmt_date(datetime.now(timezone.utc))

    html, hero_form = render_html(
        handle=handle, niche_line=niche_line, prepared_date=prepared_date,
        render_date=render_date, section_a_start=section_a_start,
        section_a=section_a, section_b=section_b, hero=hero, insight=insight,
        precision_caveat=precision_caveat, mode=mode, objective=objective,
    )
    html_path.write_text(html)
    render_pdf(html_path, pdf_path)
    pages = pdf_page_count(pdf_path)
    print(f"[generate_preview] {len(section_a)} Section-A + {len(section_b)} Section-B rows -> {pages} page(s)")
    if pages != 1:
        print(f"[generate_preview] NOTE: {pages} pages -- {len(section_a)}A+{len(section_b)}B genuinely doesn't "
              f"fit one page at this layout; shipping as-is per the fit rule (row counts and type size are "
              f"fixed by spec, not adjustable to force a 1-page fit).")

    # Polish v5, Task 4: always print BOTH metrics (averages gap + calls
    # record, both baked into send_check_verdict's `detail`) and which
    # hero form actually rendered (pick_hero_form, single source with the
    # sentence above) -- never just the verdict alone.
    verdict, detail = send_check_verdict(hero)
    print(f"[generate_preview] SEND-CHECK: {verdict} ({detail}) -- hero form: {hero_form}")
    if verdict == "DO NOT SEND":
        print("[generate_preview]   DO NOT SEND = final -- neither the averages nor the calls signal clears "
              "even the lowest impressiveness tier; do not send this document without a human rewrite.",
              file=sys.stderr)

    print(f"[generate_preview] wrote {html_path}")
    print(f"[generate_preview] wrote {pdf_path} ({pages} page(s))")

    db.close()


if __name__ == "__main__":
    main()
