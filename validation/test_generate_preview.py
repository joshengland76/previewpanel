#!/usr/bin/env python3
"""
Polish v2, Task 5 -- unit tests for hero_contrast's tiered guard
(n>=6 -> 3-vs-3, n in {4,5} -> 2-vs-2, n<4 -> None), covering n=3,4,5,6,8
per the prompt's explicit list. No DB/network required -- pure function
over synthetic rows.

Usage: ./_venv/bin/python3 test_generate_preview.py
"""
import sys

from generate_preview import hero_contrast


def make_rows(n):
    """n rows with distinct, ordered prediction/result_x pairs -- prediction
    descending (rank 1 = highest score), result_x set so top-half rows are
    intentionally NOT all >=1.0 (keeps the test honest about which rows
    hero_contrast actually picks, not just "the biggest n numbers")."""
    rows = []
    for i in range(n):
        rows.append({
            "prediction": float(n - i),          # n, n-1, ..., 1 (descending)
            "result_x": 2.0 - (i * 0.1),          # descending too, but distinct scale
        })
    return rows


def assert_no_overlap(hero, rows):
    by_score = sorted(rows, key=lambda v: v["prediction"], reverse=True)
    top_set = {id(v) for v in by_score[:hero["k"]]}
    bottom_set = {id(v) for v in by_score[-hero["k"]:]}
    assert not (top_set & bottom_set), f"top/bottom sets overlap at k={hero['k']}, n={len(rows)}"


def run():
    failures = []

    # n=3: below the n>=4 floor for even a 2-vs-2 split -- must drop entirely.
    rows = make_rows(3)
    hero = hero_contrast(rows)
    if hero is not None:
        failures.append(f"n=3: expected None (too few for any contrast), got {hero}")

    # n=4: exactly enough for 2-vs-2, not enough for 3-vs-3 (would overlap).
    rows = make_rows(4)
    hero = hero_contrast(rows)
    if hero is None or hero["k"] != 2:
        failures.append(f"n=4: expected k=2, got {hero}")
    elif hero is not None:
        assert_no_overlap(hero, rows)

    # n=5: still 2-vs-2 -- a 3-vs-3 read here would double-count the middle row.
    rows = make_rows(5)
    hero = hero_contrast(rows)
    if hero is None or hero["k"] != 2:
        failures.append(f"n=5: expected k=2, got {hero}")
    elif hero is not None:
        assert_no_overlap(hero, rows)

    # n=6: exactly enough for 3-vs-3.
    rows = make_rows(6)
    hero = hero_contrast(rows)
    if hero is None or hero["k"] != 3:
        failures.append(f"n=6: expected k=3, got {hero}")
    elif hero is not None:
        assert_no_overlap(hero, rows)

    # n=8: the real Section-A target -- still 3-vs-3 (spec never asks for
    # k to grow past 3 regardless of n).
    rows = make_rows(8)
    hero = hero_contrast(rows)
    if hero is None or hero["k"] != 3:
        failures.append(f"n=8: expected k=3, got {hero}")
    elif hero is not None:
        assert_no_overlap(hero, rows)

    # Value sanity at n=8: top3 = rows ranked 1-3 (result_x 2.0,1.9,1.8 -> mean 1.9),
    # bottom3 = rows ranked 6-8 (result_x 1.5,1.4,1.3 -> mean 1.4).
    rows = make_rows(8)
    hero = hero_contrast(rows)
    if hero and (abs(hero["top"] - 1.9) > 1e-9 or abs(hero["bottom"] - 1.4) > 1e-9):
        failures.append(f"n=8 values: expected top=1.9 bottom=1.4, got {hero}")

    # Rows with no real result (result_x=None) don't count toward n at all.
    rows = make_rows(6) + [{"prediction": 100.0, "result_x": None}] * 3
    hero = hero_contrast(rows)
    if hero is None or hero["k"] != 3:
        failures.append(f"n=6 usable (+3 unusable): expected k=3, got {hero}")

    if failures:
        print(f"FAILED ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("All hero_contrast tier tests passed (n=3,4,5,6,8 + no-result-rows case).")


if __name__ == "__main__":
    run()
