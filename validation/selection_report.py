#!/usr/bin/env python3
"""
Phase C, Task 6 -- selection-bias instrumentation. Answers: do previews that
eventually get posted (and matched back via Task 4's worker) score
differently, on average, than previews that never get posted? If posted
previews systematically score higher, any correlation we later measure
between predicted score and real-world outcome (Phase C2) is measuring a
SELECTED sample, not a random one -- this report doesn't fix that, it makes
the attenuation visible so it can be accounted for.

Population definitions:
  - "preview" = a submissions row (source='app' implicitly -- validation
    ingestion never writes to submissions) that has a shadow_scores
    prediction (requires SHADOW_SCORING to have been on at submission time).
  - "posted" = a preview whose submission_id appears as some
    posted_videos.matched_submission_id (Task 4's worker found a fingerprint
    match, tier 1 or 2, and Task 3's ingestion recorded it).
  - "unposted" = a preview never matched to any posted video (either
    genuinely never posted, or posted but not yet discovered/matched by the
    Task 4 worker -- this report cannot distinguish those two cases, which is
    itself worth stating plainly rather than glossing over).

Runs against the LIVE app tables (read-only). No repo/DB writes. Reads
DATABASE_URL from backend/.env -- same app DB as the rest of validation/,
never the research repo's tables.

Empty-state: prints an explicit "no data yet" message per section rather
than crashing or showing misleading zero/NaN stats, since this is being
built well before real users have connected accounts or posted anything.
"""
import pathlib
import statistics

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
    return psycopg2.connect(url.replace("-pooler", ""))


def mean_median(values):
    if not values:
        return None, None
    return statistics.mean(values), statistics.median(values)


def per_user_report(conn):
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT ss.user_id,
               ss.submission_id,
               ss.prediction,
               (pv.matched_submission_id IS NOT NULL) AS is_posted
        FROM shadow_scores ss
        LEFT JOIN posted_videos pv ON pv.matched_submission_id = ss.submission_id
        WHERE ss.user_id IS NOT NULL
          AND ss.prediction IS NOT NULL
          AND ss.is_posted_video IS NOT TRUE
    """)
    rows = cur.fetchall()
    cur.close()

    if not rows:
        print("No preview data with a connected user_id yet -- report will populate as users connect "
              "accounts and submit previews. This is expected pre-launch, not an error.\n")
        return {}

    by_user = {}
    for r in rows:
        u = by_user.setdefault(r["user_id"], {"posted": [], "unposted": []})
        (u["posted"] if r["is_posted"] else u["unposted"]).append(r["prediction"])

    print(f"{'user_id':40s} {'previews':>9s} {'posted':>7s} {'mean(posted)':>13s} {'mean(unposted)':>15s}")
    for user_id, groups in by_user.items():
        n_preview = len(groups["posted"]) + len(groups["unposted"])
        n_posted = len(groups["posted"])
        mean_posted, _ = mean_median(groups["posted"])
        mean_unposted, _ = mean_median(groups["unposted"])
        print(f"{user_id[:40]:40s} {n_preview:>9d} {n_posted:>7d} "
              f"{'n/a' if mean_posted is None else f'{mean_posted:.4f}':>13s} "
              f"{'n/a' if mean_unposted is None else f'{mean_unposted:.4f}':>15s}")
    return by_user


def overall_attenuation(by_user):
    all_posted = [v for u in by_user.values() for v in u["posted"]]
    all_unposted = [v for u in by_user.values() for v in u["unposted"]]

    print("\n=== Overall attenuation summary ===")
    if not all_posted and not all_unposted:
        print("No data yet.")
        return
    if not all_posted:
        print(f"n_unposted={len(all_unposted)}, n_posted=0 -- no posted-and-matched previews yet, "
              "nothing to compare against. Not an error: expected until Task 4's worker has found "
              "and matched at least one real posted video.")
        return
    if not all_unposted:
        print(f"n_posted={len(all_posted)}, n_unposted=0 -- every scored preview on record has been "
              "posted and matched; no unposted comparison group exists yet.")
        return

    mean_posted, median_posted = mean_median(all_posted)
    mean_unposted, median_unposted = mean_median(all_unposted)
    delta = mean_posted - mean_unposted
    print(f"n_posted={len(all_posted)}, n_unposted={len(all_unposted)}")
    print(f"mean(yhat | posted)   = {mean_posted:.4f}  (median {median_posted:.4f})")
    print(f"mean(yhat | unposted) = {mean_unposted:.4f}  (median {median_unposted:.4f})")
    print(f"delta (posted - unposted) = {delta:+.4f}")
    if delta > 0.01:
        print("-> Posted previews score HIGHER on average: consistent with selection bias "
              "(people tend to post their better-predicted videos). Any later correlation between "
              "predicted score and real outcome, measured only on posted videos, likely understates "
              "the model's true discriminative range across the full preview population.")
    elif delta < -0.01:
        print("-> Posted previews score LOWER on average -- an unexpected direction; worth "
              "investigating (small n, or a real substantive pattern) before drawing conclusions.")
    else:
        print("-> No material difference detected at this sample size -- either genuinely little "
              "selection effect, or (more likely pre-launch) too few posted-and-matched previews yet "
              "to say anything.")


def matching_coverage(conn):
    """How many posted_videos exist at all, regardless of match outcome --
    context for interpreting the attenuation numbers (a near-empty
    posted_videos table means the numbers above are not yet meaningful)."""
    cur = conn.cursor()
    cur.execute("SELECT status, count(*) FROM posted_videos GROUP BY status ORDER BY status")
    rows = cur.fetchall()
    cur.close()
    print("\n=== posted_videos status breakdown (context) ===")
    if not rows:
        print("No posted_videos rows yet -- Task 4's worker hasn't discovered/ingested anything yet.")
        return
    for status, count in rows:
        print(f"  {status:15s} {count}")


def main():
    conn = db_connect()
    print("=== Selection-bias report (Phase C, Task 6) ===\n")
    by_user = per_user_report(conn)
    overall_attenuation(by_user)
    matching_coverage(conn)
    conn.close()


if __name__ == "__main__":
    main()
