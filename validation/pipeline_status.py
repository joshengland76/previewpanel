#!/usr/bin/env python3
"""
pipeline_status.py — Track Record v2, Task 4: Real-User Validation panel.
Read-only report against the live app tables (Neon Postgres, backend/.env
DATABASE_URL) -- writes nothing, imports nothing from the research repo.
No prior script by this name existed; created fresh for this dispatch's
own "Real-User Validation panel gains a per-tester table" ask rather than
folding it into dashboard.py's existing Phase C2 model-validation stats,
a different concern (tester engagement vs. prediction-accuracy analysis).

Per-tester activity table: invite label + handle x [opens | runs | TR
views] x [24h | 7d | all-time], sourced from user_events (Track Record
v2, Task 4's telemetry: session_open="opens", preview_run="runs",
track_record_view="TR views"). is_internal identities (founder/team
access, Track Record v2 Task 0) are excluded -- their usage isn't tester
engagement. Graceful empty state when there's nothing to show yet.

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


def per_tester_activity(conn):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            ic.label, u.tiktok_handle, r.user_id,
            COUNT(*) FILTER (WHERE ue.event = 'session_open' AND ue.created_at > now() - interval '24 hours') AS opens_24h,
            COUNT(*) FILTER (WHERE ue.event = 'session_open' AND ue.created_at > now() - interval '7 days') AS opens_7d,
            COUNT(*) FILTER (WHERE ue.event = 'session_open') AS opens_all,
            COUNT(*) FILTER (WHERE ue.event = 'preview_run' AND ue.created_at > now() - interval '24 hours') AS runs_24h,
            COUNT(*) FILTER (WHERE ue.event = 'preview_run' AND ue.created_at > now() - interval '7 days') AS runs_7d,
            COUNT(*) FILTER (WHERE ue.event = 'preview_run') AS runs_all,
            COUNT(*) FILTER (WHERE ue.event = 'track_record_view' AND ue.created_at > now() - interval '24 hours') AS tr_24h,
            COUNT(*) FILTER (WHERE ue.event = 'track_record_view' AND ue.created_at > now() - interval '7 days') AS tr_7d,
            COUNT(*) FILTER (WHERE ue.event = 'track_record_view') AS tr_all
        FROM redemptions r
        JOIN invite_codes ic ON ic.code = r.code
        LEFT JOIN users u ON u.user_id = r.user_id
        LEFT JOIN user_events ue ON ue.user_id = r.user_id
        WHERE COALESCE(u.is_internal, false) = false
        GROUP BY ic.label, u.tiktok_handle, r.user_id
        ORDER BY runs_all DESC, opens_all DESC
    """)
    rows = cur.fetchall()
    cur.close()
    return rows


def print_activity_table(rows):
    print("=== REAL-USER VALIDATION -- TESTER ACTIVITY ===")
    if not rows:
        print("No non-internal testers with redemptions yet.")
        return
    print(f"{'label':22} {'handle':18} {'opens (24h/7d/all)':20} {'runs (24h/7d/all)':20} {'TR views (24h/7d/all)':22}")
    for r in rows:
        handle = r["tiktok_handle"] or "—"
        opens = f"{r['opens_24h']}/{r['opens_7d']}/{r['opens_all']}"
        runs = f"{r['runs_24h']}/{r['runs_7d']}/{r['runs_all']}"
        tr = f"{r['tr_24h']}/{r['tr_7d']}/{r['tr_all']}"
        print(f"{(r['label'] or ''):22.22} {handle:18.18} {opens:20} {runs:20} {tr:22}")


def main():
    conn = db_connect()
    print("=" * 78)
    print("PreviewPanel Real-User Validation -- Pipeline Status")
    print("=" * 78)
    print_activity_table(per_tester_activity(conn))
    conn.close()


if __name__ == "__main__":
    main()
