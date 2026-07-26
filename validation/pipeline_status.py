#!/usr/bin/env python3
"""
pipeline_status.py — Tester Funnel + day-30 status. Read-only report against the
live app tables (Neon Postgres, backend/.env DATABASE_URL) — writes nothing,
imports nothing from the research repo.

FUNNEL (one row PER CODE, including codes sent but not yet redeemed):
  code · label · handle · first redeemed_at · redemptions used ·
  opens/runs/TR-views at 24h/7d/all-time · last-seen · [internal] marker.
Sourced from user_events (Track Record v2, Task 4 telemetry:
session_open="opens", preview_run="runs", track_record_view="TR views"),
aggregated over all of a code's redeemers. Internal identities (founder/team,
Track Record v2 Task 0) are INCLUDED and marked [internal]; their runs carry a
pool_eligible sanity column (internal runs must not enter the comparison pool).
Graceful empty states throughout.

DAY-30 block below: posted-video collection status (the model-validation feed).

Usage: ./_venv/bin/python3 pipeline_status.py
"""
import pathlib

import psycopg2
import psycopg2.extras


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


def code_funnel(conn):
    """One row per invite code, redeemed or not. Activity aggregated over every
    redeemer of the code; handle prefers the code's pre-linked handle, else a
    redeemer's connected handle."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            ic.code, ic.label, COALESCE(ic.is_internal, false) AS is_internal,
            COALESCE(ic.known_tiktok_handle, MAX(u.tiktok_handle)) AS handle,
            COUNT(DISTINCT r.user_id) AS redemptions,
            MIN(r.redeemed_at) AS first_redeemed,
            MAX(ue.created_at) AS last_seen,
            COUNT(*) FILTER (WHERE ue.event='session_open' AND ue.created_at > now()-interval '24 hours') AS o24,
            COUNT(*) FILTER (WHERE ue.event='session_open' AND ue.created_at > now()-interval '7 days')  AS o7,
            COUNT(*) FILTER (WHERE ue.event='session_open') AS oall,
            COUNT(*) FILTER (WHERE ue.event='preview_run' AND ue.created_at > now()-interval '24 hours') AS r24,
            COUNT(*) FILTER (WHERE ue.event='preview_run' AND ue.created_at > now()-interval '7 days')  AS r7,
            COUNT(*) FILTER (WHERE ue.event='preview_run') AS rall,
            COUNT(*) FILTER (WHERE ue.event='track_record_view' AND ue.created_at > now()-interval '24 hours') AS t24,
            COUNT(*) FILTER (WHERE ue.event='track_record_view' AND ue.created_at > now()-interval '7 days')  AS t7,
            COUNT(*) FILTER (WHERE ue.event='track_record_view') AS tall
        FROM invite_codes ic
        LEFT JOIN redemptions r ON r.code = ic.code
        LEFT JOIN users u       ON u.user_id = r.user_id
        LEFT JOIN user_events ue ON ue.user_id = r.user_id
        GROUP BY ic.code, ic.label, ic.is_internal, ic.known_tiktok_handle
        ORDER BY COALESCE(ic.is_internal, false), MIN(r.redeemed_at) NULLS LAST, ic.code
    """)
    rows = cur.fetchall()
    cur.close()
    return rows


def internal_pool_sanity(conn):
    """Per INTERNAL code: how many of its redeemers' shadow_scores are
    pool_eligible=false (they all should be — internal identities are excluded
    from the comparison pools). Returns {code: (ineligible, total)}."""
    cur = conn.cursor()
    cur.execute("""
        SELECT ic.code,
               COUNT(*) FILTER (WHERE ss.pool_eligible = false) AS ineligible,
               COUNT(ss.id) AS total
        FROM invite_codes ic
        JOIN redemptions r ON r.code = ic.code
        LEFT JOIN shadow_scores ss ON ss.user_id = r.user_id
        WHERE COALESCE(ic.is_internal, false) = true
        GROUP BY ic.code
    """)
    out = {code: (ineligible, total) for code, ineligible, total in cur.fetchall()}
    cur.close()
    return out


def telemetry_epoch(conn):
    cur = conn.cursor()
    cur.execute("SELECT MIN(created_at) FROM user_events")
    e = cur.fetchone()[0]
    cur.close()
    return e


def print_funnel(rows, pool_sanity, epoch):
    print("=== TESTER FUNNEL — one row per invite code ===")
    if epoch:
        print(f"(telemetry epoch: {epoch:%Y-%m-%d %H:%M UTC} — activity before this is invisible)")
    if not rows:
        print("No invite codes exist yet.")
        return
    hdr = f"{'code':10} {'label':20} {'handle':17} {'redeemed':11} {'used':4} {'opens 24h/7d/all':17} {'runs':12} {'TR 24h/7d/all':15} {'last-seen':11} tag"
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        redeemed = r["first_redeemed"].strftime("%Y-%m-%d") if r["first_redeemed"] else "— awaiting"
        used = str(r["redemptions"]) if r["redemptions"] else "0"
        opens = f"{r['o24']}/{r['o7']}/{r['oall']}"
        runs = f"{r['r24']}/{r['r7']}/{r['rall']}"
        tr = f"{r['t24']}/{r['t7']}/{r['tall']}"
        last = r["last_seen"].strftime("%Y-%m-%d") if r["last_seen"] else "—"
        tag = ""
        if r["is_internal"]:
            ineligible, total = pool_sanity.get(r["code"], (0, 0))
            tag = f"[internal] pool_elig=false {ineligible}/{total}"
        print(f"{r['code']:10} {(r['label'] or '—'):20.20} {(r['handle'] or '—'):17.17} "
              f"{redeemed:11} {used:4} {opens:17} {runs:12} {tr:15} {last:11} {tag}")


def day30_status(conn):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT status, COUNT(*) n,
               COUNT(*) FILTER (WHERE day30_wec_rate IS NOT NULL) collected,
               COUNT(*) FILTER (WHERE times_typical IS NOT NULL) graded
        FROM posted_videos
        WHERE COALESCE(test_row, false) = false
        GROUP BY status ORDER BY n DESC
    """)
    rows = cur.fetchall()
    cur.close()
    return rows


def print_day30(rows):
    print("\n=== POSTED-VIDEO / DAY-30 COLLECTION (model-validation feed) ===")
    if not rows:
        print("No posted videos tracked yet.")
        return
    print(f"{'status':22} {'rows':6} {'day30 collected':16} {'graded':7}")
    for r in rows:
        print(f"{r['status']:22} {r['n']:<6} {r['collected']:<16} {r['graded']:<7}")


def main():
    conn = db_connect()
    print("=" * 100)
    print("PreviewPanel Real-User Validation — Pipeline Status")
    print("=" * 100)
    epoch = telemetry_epoch(conn)
    print_funnel(code_funnel(conn), internal_pool_sanity(conn), epoch)
    print_day30(day30_status(conn))
    conn.close()


if __name__ == "__main__":
    main()
