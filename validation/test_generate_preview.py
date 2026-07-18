#!/usr/bin/env python3
"""
Polish v2, Task 5 -- unit tests for topbottom_metrics's tiered guard
(n>=6 -> 3-vs-3, n in {4,5} -> 2-vs-2, n<4 -> None), covering n=3,4,5,6,8
per the prompt's explicit list. No DB/network required -- pure function
over synthetic rows.

Polish v3, Task 5 -- extended with the same n=3,4,5,6,8 coverage for
mark_top_bottom_pills (the TOP-N/BOTTOM-N pill + ✓/✗ logic that replaced
the hairline divider), sharing _topbottom_k with topbottom_metrics so both
are exercised against the same tiering rule.

Polish v5, Task 2 -- topbottom_metrics renamed from hero_contrast (same
tiering, extended with calls_correct/calls_total) when the adaptive hero
(Task 3) and send-check remap (Task 4) were built. Added averages_tier/
calls_tier boundary coverage (incl. exact-threshold tie-break) and
pick_hero_form's tier-selection tie-break (both non-zero -> averages;
both zero -> neutral, never averages).

Usage: ./_venv/bin/python3 test_generate_preview.py
"""
import sys

from datetime import datetime, timezone

from generate_preview import (
    topbottom_metrics, mark_top_bottom_pills, bet_card_fields,
    averages_tier, calls_tier, pick_hero_form, send_check_verdict,
)


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


def assert_no_pill_overlap(rows):
    tops = {id(v) for v in rows if v.get("pill_kind") == "top"}
    bottoms = {id(v) for v in rows if v.get("pill_kind") == "bottom"}
    assert not (tops & bottoms), "top/bottom pill groups overlap"


def test_pills():
    """mark_top_bottom_pills at n=3,4,5,6,8 -- kind/label/tick assignment,
    middle rows getting neither, no overlap. n=8 uses explicit result_x
    values (not make_rows' monotonic sequence) so all four tick branches
    -- TOP hit, TOP miss, BOTTOM hit, BOTTOM miss -- actually get
    exercised, not just the "everything above the line beats 1.0x" case."""
    failures = []

    # n=3: below the floor for even a 2-vs-2 split -- no pills, no marks.
    rows = make_rows(3)
    mark_top_bottom_pills(rows)
    if any(v["pill_kind"] is not None for v in rows):
        failures.append("n=3: expected no pill_kind set on any row")
    if any(v["pill_tick"] is not None for v in rows):
        failures.append("n=3: expected no pill_tick set on any row")

    # n=4: Top 2 / Bottom 2, no middle rows (2+2=4).
    rows = make_rows(4)
    mark_top_bottom_pills(rows)
    kinds = [v["pill_kind"] for v in rows]  # make_rows is already score-descending
    if kinds != ["top", "top", "bottom", "bottom"]:
        failures.append(f"n=4: expected [top,top,bottom,bottom] by score order, got {kinds}")
    labels = {v["pill_group"] for v in rows}
    if labels != {"Top 2", "Bottom 2"}:
        failures.append(f"n=4: expected labels {{'Top 2','Bottom 2'}}, got {labels}")
    assert_no_pill_overlap(rows)

    # n=5: Top 2 / Bottom 2, one middle row (rank 3) with no pill.
    rows = make_rows(5)
    mark_top_bottom_pills(rows)
    kinds = [v["pill_kind"] for v in rows]
    if kinds != ["top", "top", None, "bottom", "bottom"]:
        failures.append(f"n=5: expected [top,top,None,bottom,bottom], got {kinds}")
    assert_no_pill_overlap(rows)

    # n=6: Top 3 / Bottom 3, no middle rows (3+3=6).
    rows = make_rows(6)
    mark_top_bottom_pills(rows)
    kinds = [v["pill_kind"] for v in rows]
    if kinds != ["top", "top", "top", "bottom", "bottom", "bottom"]:
        failures.append(f"n=6: expected 3 top then 3 bottom, got {kinds}")
    assert_no_pill_overlap(rows)

    # n=8 (the real Section-A target): Top 3 / Bottom 3, 2 middle rows,
    # all four tick branches exercised explicitly.
    rows = [
        {"prediction": 8.0, "result_x": 1.5},   # TOP, hit  (>=1.0 -> True)
        {"prediction": 7.0, "result_x": 0.8},   # TOP, MISS (<1.0 -> False)
        {"prediction": 6.0, "result_x": 1.2},   # TOP, hit
        {"prediction": 5.0, "result_x": 1.1},   # middle -- no pill regardless of result
        {"prediction": 4.0, "result_x": 0.9},   # middle -- no pill regardless of result
        {"prediction": 3.0, "result_x": 0.7},   # BOTTOM, hit  (<1.0 -> True)
        {"prediction": 2.0, "result_x": 1.3},   # BOTTOM, MISS (>=1.0 -> False)
        {"prediction": 1.0, "result_x": 0.5},   # BOTTOM, hit
    ]
    mark_top_bottom_pills(rows)
    expected_kind = ["top", "top", "top", None, None, "bottom", "bottom", "bottom"]
    expected_tick = [True, False, True, None, None, True, False, True]
    got_kind = [v["pill_kind"] for v in rows]
    got_tick = [v["pill_tick"] for v in rows]
    if got_kind != expected_kind:
        failures.append(f"n=8 kinds: expected {expected_kind}, got {got_kind}")
    if got_tick != expected_tick:
        failures.append(f"n=8 ticks: expected {expected_tick}, got {got_tick}")
    bad_labels = [v["pill_group"] for v in rows if v["pill_group"] not in ("Top 3", "Bottom 3", None)]
    if bad_labels:
        failures.append(f"n=8: unexpected pill_group labels {bad_labels}")
    assert_no_pill_overlap(rows)

    return failures


def test_bet_card():
    """Polish v4, Task 2: bet_card_fields is Section-B ONLY -- both
    branches (empty and non-empty), plus confirming it picks the
    HIGHEST-scored Section-B video (not just the first/most-recent one)
    and that the pill keeps its FULL suffix (unlike the row pills)."""
    failures = []

    # Empty Section B -> {'empty': True}, no other keys relied upon.
    result = bet_card_fields([], "objective", "Aesthetic/Vibes")
    if result != {"empty": True}:
        failures.append(f"empty section_b: expected {{'empty': True}}, got {result}")

    # Non-empty -> picks the HIGHEST-scored row, not the first in the list.
    section_b = [
        {"prediction": 0.1, "percentile": 60, "caption": "low one",
         "posted_at": datetime(2026, 7, 1, tzinfo=timezone.utc)},
        {"prediction": 0.5, "percentile": 91, "caption": "high one",
         "posted_at": datetime(2026, 7, 3, tzinfo=timezone.utc)},
    ]
    result = bet_card_fields(section_b, "objective", "Aesthetic/Vibes")
    if result["empty"] is not False:
        failures.append(f"non-empty section_b: expected empty=False, got {result}")
    if result.get("caption") != "high one":
        failures.append(f"non-empty section_b: expected the higher-scored video ('high one'), got {result}")
    if result.get("pill") != "91st percentile · Aesthetic/Vibes":
        failures.append(f"bet card pill should keep its FULL suffix (single context-free "
                         f"instance, unlike row pills), got {result.get('pill')!r}")
    if result.get("checkin") != "Aug 2":
        failures.append(f"checkin should be posted_at + 30 days, expected 'Aug 2', got {result.get('checkin')}")

    # --overall mode: pill scope is "all videos", not an objective name.
    result = bet_card_fields(section_b, "overall", None)
    if result.get("pill") != "91st percentile · all videos":
        failures.append(f"--overall bet card pill: expected 'all videos' scope, got {result.get('pill')!r}")

    return failures


def _hero(gap, calls_correct, calls_total, k=None):
    """Synthetic topbottom_metrics()-shaped dict for pick_hero_form/
    send_check_verdict tests -- avoids depending on real row data when
    only gap/calls fields matter."""
    return {"k": k or calls_total // 2, "top_avg": 1.0 + gap, "bottom_avg": 1.0,
            "gap": gap, "calls_correct": calls_correct, "calls_total": calls_total}


def test_impressiveness_tiers():
    """Polish v5, Task 2 -- averages_tier/calls_tier boundary coverage,
    explicitly including the exact-threshold values (0.5, 0.2, 0.0 for
    averages; the calls_total=4-vs-6 scale split) so a tier boundary is
    never ambiguous. Task 3's pick_hero_form tie-break: equal non-zero
    tiers -> averages (more visceral); both-zero -> neutral, NEVER
    averages (no boast is fabricated). Task 4's send_check_verdict remap:
    STRONG/MIXED/DO NOT SEND/N/A from max(averages_tier, calls_tier)."""
    failures = []

    # averages_tier: exact boundaries resolve to the HIGHER named tier.
    avg_cases = [
        (0.5, 3), (0.51, 3), (10.0, 3),
        (0.49, 2), (0.2, 2), (0.35, 2),
        (0.19, 1), (0.0, 1), (0.1, 1),
        (-0.001, 0), (-1.0, 0),
    ]
    for gap, expected in avg_cases:
        got = averages_tier(gap)
        if got != expected:
            failures.append(f"averages_tier({gap}): expected {expected}, got {got}")

    # calls_tier, calls_total=6 (k=3): 6,5->3; 4->2; 3->1; <=2->0.
    calls6_cases = [(6, 3), (5, 3), (4, 2), (3, 1), (2, 0), (1, 0), (0, 0)]
    for correct, expected in calls6_cases:
        got = calls_tier(correct, 6)
        if got != expected:
            failures.append(f"calls_tier({correct}, 6): expected {expected}, got {got}")

    # calls_tier, calls_total=4 (k=2): 4->3; 3->2; 2->1; <=1->0.
    calls4_cases = [(4, 3), (3, 2), (2, 1), (1, 0), (0, 0)]
    for correct, expected in calls4_cases:
        got = calls_tier(correct, 4)
        if got != expected:
            failures.append(f"calls_tier({correct}, 4): expected {expected}, got {got}")

    # pick_hero_form tie-break, both non-zero and EQUAL -> averages (more
    # visceral). gap=0.3 -> averages_tier=2; calls 4 of 6 -> calls_tier=2.
    hero = _hero(gap=0.3, calls_correct=4, calls_total=6)
    form = pick_hero_form(hero, strongest=None)
    if form != "averages":
        failures.append(f"tie-break (2==2): expected 'averages', got {form!r}")

    # pick_hero_form: calls strictly outranks averages -> calls form.
    # gap=0.05 -> averages_tier=1; calls 4 of 6 -> calls_tier=2.
    hero = _hero(gap=0.05, calls_correct=4, calls_total=6)
    form = pick_hero_form(hero, strongest=None)
    if form != "calls":
        failures.append(f"calls outranks averages (1 vs 2): expected 'calls', got {form!r}")

    # pick_hero_form: averages strictly outranks calls -> averages form.
    hero = _hero(gap=0.6, calls_correct=2, calls_total=6)
    form = pick_hero_form(hero, strongest=None)
    if form != "averages":
        failures.append(f"averages outranks calls (3 vs 0): expected 'averages', got {form!r}")

    # pick_hero_form: BOTH tier 0 -> neutral, never averages (no fabricated
    # boast on a flat/inverted result) even though 0==0 is technically a tie.
    hero = _hero(gap=-0.1, calls_correct=2, calls_total=6)
    form = pick_hero_form(hero, strongest=None)
    if form != "neutral":
        failures.append(f"both tier 0 (tie): expected 'neutral', got {form!r}")

    # pick_hero_form: hero is None (n<4) -- best_bet when a scored video
    # exists, pending when nothing does.
    if pick_hero_form(None, strongest={"caption": "x"}) != "best_bet":
        failures.append("hero=None with a strongest video: expected 'best_bet'")
    if pick_hero_form(None, strongest=None) != "pending":
        failures.append("hero=None with nothing scored: expected 'pending'")

    # send_check_verdict remap: STRONG (max tier 3), MIXED (max tier 1-2),
    # DO NOT SEND (both tier 0), N/A (hero is None).
    verdict, _ = send_check_verdict(_hero(gap=0.6, calls_correct=0, calls_total=6))
    if verdict != "STRONG":
        failures.append(f"max_tier=3 (via averages): expected STRONG, got {verdict}")
    verdict, _ = send_check_verdict(_hero(gap=0.0, calls_correct=6, calls_total=6))
    if verdict != "STRONG":
        failures.append(f"max_tier=3 (via calls): expected STRONG, got {verdict}")
    verdict, _ = send_check_verdict(_hero(gap=0.3, calls_correct=2, calls_total=6))
    if verdict != "MIXED":
        failures.append(f"max_tier=2 (averages beats calls): expected MIXED, got {verdict}")
    verdict, _ = send_check_verdict(_hero(gap=-0.1, calls_correct=3, calls_total=6))
    if verdict != "MIXED":
        failures.append(f"max_tier=1 (calls beats averages): expected MIXED, got {verdict}")
    verdict, _ = send_check_verdict(_hero(gap=-0.1, calls_correct=2, calls_total=6))
    if verdict != "DO NOT SEND":
        failures.append(f"both tier 0: expected 'DO NOT SEND', got {verdict}")
    verdict, _ = send_check_verdict(None)
    if verdict != "N/A":
        failures.append(f"hero=None: expected 'N/A', got {verdict}")

    return failures


def run():
    failures = []
    failures += test_pills()
    failures += test_bet_card()
    failures += test_impressiveness_tiers()

    # n=3: below the n>=4 floor for even a 2-vs-2 split -- must drop entirely.
    rows = make_rows(3)
    hero = topbottom_metrics(rows)
    if hero is not None:
        failures.append(f"n=3: expected None (too few for any contrast), got {hero}")

    # n=4: exactly enough for 2-vs-2, not enough for 3-vs-3 (would overlap).
    rows = make_rows(4)
    hero = topbottom_metrics(rows)
    if hero is None or hero["k"] != 2:
        failures.append(f"n=4: expected k=2, got {hero}")
    elif hero is not None:
        assert_no_overlap(hero, rows)

    # n=5: still 2-vs-2 -- a 3-vs-3 read here would double-count the middle row.
    rows = make_rows(5)
    hero = topbottom_metrics(rows)
    if hero is None or hero["k"] != 2:
        failures.append(f"n=5: expected k=2, got {hero}")
    elif hero is not None:
        assert_no_overlap(hero, rows)

    # n=6: exactly enough for 3-vs-3.
    rows = make_rows(6)
    hero = topbottom_metrics(rows)
    if hero is None or hero["k"] != 3:
        failures.append(f"n=6: expected k=3, got {hero}")
    elif hero is not None:
        assert_no_overlap(hero, rows)

    # n=8: the real Section-A target -- still 3-vs-3 (spec never asks for
    # k to grow past 3 regardless of n).
    rows = make_rows(8)
    hero = topbottom_metrics(rows)
    if hero is None or hero["k"] != 3:
        failures.append(f"n=8: expected k=3, got {hero}")
    elif hero is not None:
        assert_no_overlap(hero, rows)

    # Value sanity at n=8: top3 = rows ranked 1-3 (result_x 2.0,1.9,1.8 -> mean 1.9),
    # bottom3 = rows ranked 6-8 (result_x 1.5,1.4,1.3 -> mean 1.4).
    rows = make_rows(8)
    hero = topbottom_metrics(rows)
    if hero and (abs(hero["top_avg"] - 1.9) > 1e-9 or abs(hero["bottom_avg"] - 1.4) > 1e-9):
        failures.append(f"n=8 values: expected top_avg=1.9 bottom_avg=1.4, got {hero}")
    # calls_correct/calls_total (Polish v5): make_rows' result_x is always
    # >=1.0 in the top half and (at n=8) some of the bottom half dips below
    # 1.0 too (1.5,1.4,1.3 -- all still >=1.0), so EVERY top call is a hit
    # (>=1.0) and every bottom call is a MISS (also >=1.0, so bottom's own
    # <1.0 check fails) -- calls_correct should be exactly k (top hits only).
    if hero and (hero["calls_correct"] != hero["k"] or hero["calls_total"] != 2 * hero["k"]):
        failures.append(f"n=8 calls: expected calls_correct=k={hero['k']} (top-only hits), "
                         f"calls_total=2k={2 * hero['k']}, got {hero}")

    # Rows with no real result (result_x=None) don't count toward n at all.
    rows = make_rows(6) + [{"prediction": 100.0, "result_x": None}] * 3
    hero = topbottom_metrics(rows)
    if hero is None or hero["k"] != 3:
        failures.append(f"n=6 usable (+3 unusable): expected k=3, got {hero}")

    if failures:
        print(f"FAILED ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("All topbottom_metrics + mark_top_bottom_pills + bet_card_fields + "
          "impressiveness-tier/tie-break tests passed "
          "(n=3,4,5,6,8 + no-result-rows case, all 4 tick branches at n=8, "
          "bet card empty/non-empty branches, averages/calls tier boundaries, "
          "pick_hero_form tie-break, send_check_verdict remap).")


if __name__ == "__main__":
    run()
