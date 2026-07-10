#!/usr/bin/env python3
"""
Phase C, Prompt 2, Task 2 -- validation dashboard. Read-only report against
the live app tables (Neon Postgres, backend/.env DATABASE_URL) -- writes
nothing, imports nothing from the research repo.

Sections:
  a. FUNNEL -- users connected, previews (+fingerprinted), posted videos by
     status, matches by tier (incl. possibly_related), day-30 pending vs
     collected vs failed.
  b. PRIMARY METRIC -- per-user Spearman(posted-video y_pred, observed
     day30_wec_rate) over a user's day30_collected videos, pooled across
     qualifying (>=5 videos) users. EVERY scored posted video from a
     connected user counts here, matched or not -- match tiers exist for
     C3's attribution questions, not for model validation. See
     pooled_spearman()'s docstring for the exact standing definition being
     reimplemented (mirrors capstone_stage4.py's pooled_wc /
     stage1_arm_b.py's bootstrap_ci in the research repo, ported here with
     zero research-repo imports).
  c. SECONDARY -- attribution-adjacent: Spearman(preview y_pred, posted
     outcome), restricted to Tier 1/2 matched pairs, reported per tier.
  d. Attenuation context -- reuses this same directory's selection_report.py
     (app-repo code, not research-repo -- reuse is fine) for its
     posted-vs-unposted preview y-hat summary.
  e. Every section prints an explicit "accruing, n=X of N" line rather than
     a misleading zero/NaN when a floor isn't met yet.
"""
import numpy as np
import psycopg2.extras
from scipy.stats import spearmanr

import selection_report as sel

N_FLOOR = 5           # minimum videos/pairs to compute a Spearman that means anything
BOOTSTRAP_B = 2000
BOOTSTRAP_SEED = 7


def pooled_spearman(pairs_by_group, min_n=N_FLOOR):
    """
    Standing pooled-metric definition (reimplemented here, no research-repo
    import -- mirrors the research repo's capstone_stage4.py::pooled_wc):
    for each group (a connected user, keyed by user_id) with >= min_n
    (prediction, outcome) pairs AND nonzero variance in both series,
    compute ONE Spearman rho for that group. "Pooled" means the unweighted
    mean of those per-group rho values -- each qualifying user contributes
    exactly one number regardless of how many videos they have, so a
    single prolific user can't dominate the pooled estimate the way a
    single flat Spearman over every row pooled together would let them.

    Returns {group_key: rho} for groups that qualified and produced a
    non-NaN rho.
    """
    per_group_rho = {}
    for key, (preds, outcomes) in pairs_by_group.items():
        if len(preds) < min_n:
            continue
        p = np.asarray(preds, dtype=float)
        o = np.asarray(outcomes, dtype=float)
        if p.std() == 0 or o.std() == 0:
            continue
        rho = spearmanr(p, o).statistic
        if not np.isnan(rho):
            per_group_rho[key] = float(rho)
    return per_group_rho


def bootstrap_ci(values, B=BOOTSTRAP_B, seed=BOOTSTRAP_SEED):
    """
    Standing bootstrap definition (reimplemented, no research-repo import --
    mirrors stage1_arm_b.py::bootstrap_ci): a standard percentile bootstrap
    OVER USERS (resample the per-user rho array with replacement, B=2000,
    fixed seed for reproducibility), 95% CI = [2.5th, 97.5th] percentile of
    the B resampled means.
    """
    arr = np.array(list(values), dtype=float)
    arr = arr[~np.isnan(arr)]
    if len(arr) == 0:
        return None
    rng = np.random.default_rng(seed)
    n = len(arr)
    means = np.array([arr[rng.integers(0, n, n)].mean() for _ in range(B)])
    return {"mean": float(arr.mean()), "lo": float(np.percentile(means, 2.5)),
            "hi": float(np.percentile(means, 97.5)), "n": n}


def section_a_funnel(conn):
    print("=== a. FUNNEL ===")
    cur = conn.cursor()

    cur.execute("SELECT count(*) FROM users WHERE tiktok_handle IS NOT NULL")
    print(f"Users connected (tiktok handle set): {cur.fetchone()[0]}")

    cur.execute("SELECT count(*) FROM shadow_scores WHERE COALESCE(is_posted_video, false) IS NOT TRUE")
    n_previews = cur.fetchone()[0]
    cur.execute("SELECT count(DISTINCT submission_id) FROM preview_fingerprints WHERE submission_id IS NOT NULL")
    n_fingerprinted = cur.fetchone()[0]
    print(f"Previews scored: {n_previews}  (of which fingerprinted: {n_fingerprinted})")

    cur.execute("""
        SELECT status, count(*) FROM posted_videos
        WHERE COALESCE(test_row, false) IS NOT TRUE
        GROUP BY status ORDER BY status
    """)
    rows = cur.fetchall()
    print("Posted videos by status:")
    if not rows:
        print("  (none yet)")
    for status, count in rows:
        print(f"  {status:16s} {count}")

    cur.execute("""
        SELECT match_tier, count(*) FROM posted_videos
        WHERE COALESCE(test_row, false) IS NOT TRUE AND match_tier IS NOT NULL
        GROUP BY match_tier ORDER BY match_tier
    """)
    tier_rows = cur.fetchall()
    cur.execute("""
        SELECT count(*) FROM posted_videos
        WHERE COALESCE(test_row, false) IS NOT TRUE AND possibly_related IS TRUE
    """)
    n_possibly_related = cur.fetchone()[0]
    print("Matches by tier:")
    if not tier_rows:
        print("  (none yet)")
    for tier, count in tier_rows:
        print(f"  Tier {tier}: {count}")
    print(f"  (possibly_related -- Tier 3, audio-agreement w/ mismatched duration): {n_possibly_related}")

    cur.execute("""
        SELECT
          count(*) FILTER (WHERE status IN ('scored', 'matched'))   AS pending,
          count(*) FILTER (WHERE status = 'day30_collected')        AS collected,
          count(*) FILTER (WHERE status = 'failed')                 AS failed
        FROM posted_videos
        WHERE COALESCE(test_row, false) IS NOT TRUE
    """)
    pending, collected, failed = cur.fetchone()
    print(f"Day-30 outcomes: pending={pending}  collected={collected}  failed={failed} (failed = any stage, not just day-30)")
    cur.close()


def section_b_primary(conn):
    print(f"\n=== b. PRIMARY METRIC -- model validation on real users ===")
    print("Every scored posted video from a connected user counts here, matched or not")
    print("(match tiers are for C3's attribution questions, not model validation).")
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT user_id, y_pred, day30_wec_rate
        FROM posted_videos
        WHERE status = 'day30_collected'
          AND COALESCE(test_row, false) IS NOT TRUE
          AND y_pred IS NOT NULL
          AND day30_wec_rate IS NOT NULL
          AND user_id IS NOT NULL
    """)
    rows = cur.fetchall()
    cur.close()

    if not rows:
        print(f"No day30_collected posted videos with y_pred + wec_rate yet -- accruing, n=0 of {N_FLOOR} users.")
        return

    by_user = {}
    for r in rows:
        u = by_user.setdefault(r["user_id"], ([], []))
        u[0].append(r["y_pred"])
        u[1].append(r["day30_wec_rate"])

    per_user_n = {u: len(v[0]) for u, v in by_user.items()}
    per_user_rho = pooled_spearman(by_user, min_n=N_FLOOR)

    if not per_user_rho:
        closest = max(per_user_n.values())
        print(f"No user has reached {N_FLOOR} day30_collected videos yet -- accruing, n={closest} of "
              f"{N_FLOOR} (closest user); {len(by_user)} user(s) total with >=1 collected video.")
        return

    ci = bootstrap_ci(per_user_rho.values())
    print(f"Qualifying users (>= {N_FLOOR} day30_collected videos): {len(per_user_rho)} of {len(by_user)} "
          f"user(s) with any collected videos")
    for u, rho in sorted(per_user_rho.items(), key=lambda kv: -per_user_n[kv[0]]):
        print(f"  user={u[:16]:16s} n={per_user_n[u]:3d}  spearman={rho:+.3f}")
    print(f"Pooled (unweighted mean across {ci['n']} qualifying users) = {ci['mean']:+.4f}  "
          f"95% CI [{ci['lo']:+.4f}, {ci['hi']:+.4f}]")


def section_c_secondary(conn):
    print("\n=== c. SECONDARY -- attribution-adjacent (Tier 1/2 matched pairs only) ===")
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT ss.prediction AS preview_y_pred, pv.day30_wec_rate, pv.match_tier
        FROM posted_videos pv
        JOIN shadow_scores ss ON ss.submission_id = pv.matched_submission_id
        WHERE pv.status = 'day30_collected'
          AND COALESCE(pv.test_row, false) IS NOT TRUE
          AND pv.match_tier IN (1, 2)
          AND pv.day30_wec_rate IS NOT NULL
          AND ss.prediction IS NOT NULL
    """)
    rows = cur.fetchall()
    cur.close()

    if not rows:
        print(f"No Tier 1/2 matched + day30_collected pairs yet -- accruing, n=0 of {N_FLOOR}.")
        return

    by_tier = {}
    for r in rows:
        t = by_tier.setdefault(r["match_tier"], ([], []))
        t[0].append(r["preview_y_pred"])
        t[1].append(r["day30_wec_rate"])

    for tier in (1, 2):
        preds, outcomes = by_tier.get(tier, ([], []))
        n = len(preds)
        if n < N_FLOOR:
            print(f"  Tier {tier}: accruing, n={n} of {N_FLOOR}")
            continue
        p, o = np.asarray(preds, dtype=float), np.asarray(outcomes, dtype=float)
        if p.std() == 0 or o.std() == 0:
            print(f"  Tier {tier}: n={n} but no variance in prediction or outcome -- rho undefined")
            continue
        rho = spearmanr(p, o).statistic
        print(f"  Tier {tier}: n={n}  spearman(preview y_pred, posted wec_rate)={rho:+.3f}")


def section_d_attenuation(conn):
    print("\n=== d. Attenuation context (posted vs. unposted preview y-hat) ===")
    by_user = sel.per_user_report(conn)
    sel.overall_attenuation(by_user)


def main():
    conn = sel.db_connect()
    print("=" * 78)
    print("PreviewPanel Validation Dashboard -- Phase C2")
    print("=" * 78)
    section_a_funnel(conn)
    section_b_primary(conn)
    section_c_secondary(conn)
    section_d_attenuation(conn)
    conn.close()


if __name__ == "__main__":
    main()
