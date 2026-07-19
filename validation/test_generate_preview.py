#!/usr/bin/env python3
"""
Track Record v4 -- RANK-based call semantics (supersedes the v3 threshold
rewrite). Tests _topbottom_k (the shared size tiers), mark_call_chips
(TOP k / BOTTOM k of the shown set, ranked by prediction), and
strong_weak_metrics over the rank groups. The defining property tested is
now the OPPOSITE of v3's: a row's call DEPENDS on the set it's ranked in
(weak in a 6-set, none in an 8-set) -- calls are relative to the creator's
own graded window, not an absolute per-row percentile threshold.

Polish v5, Task 2's averages_tier/calls_tier/pick_hero_form/
send_check_verdict coverage is kept and extended: averages_tier is
UNCHANGED (still takes a bare gap, now strong_avg-weak_avg instead of
top_avg-bottom_avg -- same function, different caller-supplied input,
nothing to retest there beyond confirming the existing boundary cases
still hold). calls_tier is GENERALIZED (was two fixed lookup tables for
calls_total in {4,6}, now a proportion-based scale for ANY calls_total,
since strong/weak counts are independent -- no longer a forced
symmetric 2*k) -- added asymmetric-count cases (calls_total=9, 5, 7) on
top of the original 4/6 cases to confirm the generalization lands on the
identical tier the old tables gave for those two cases.

Transport hotfix, Task 2 -- unit tests for hero_opening_sentence's two
branches (full coverage keeps "every"; any gap drops it) and
coverage_note's full-coverage/gap-present cases. NEVER "every" over
partial data is the one hard requirement here. Unchanged by this rewrite.

Usage: ./_venv/bin/python3 test_generate_preview.py
"""
import sys

from datetime import datetime, timezone

from generate_preview import (
    _topbottom_k, mark_call_chips, strong_weak_metrics, bet_card_fields,
    averages_tier, calls_tier, pick_hero_form, send_check_verdict,
    hero_opening_sentence, coverage_note,
)


def _r(prediction, result_x, **kw):
    """Synthetic section_a row for the RANK tests -- prediction drives the
    ranking, result_x drives the tick."""
    return {"prediction": prediction, "result_x": result_x, **kw}


def test_topbottom_k():
    """_topbottom_k: the shared size-tier boundaries read from
    call_semantics.json. n>=6 -> 3; n in {4,5} -> 2; n<4 -> None. 2k<=n at
    every tier so the top/bottom groups never overlap. This is the ONE
    source both surfaces (server.js topBottomK, the PDF) read."""
    failures = []
    cases = [(0, None), (1, None), (3, None), (4, 2), (5, 2), (6, 3), (7, 3), (8, 3), (20, 3)]
    for n, expected in cases:
        got = _topbottom_k(n)
        if got != expected:
            failures.append(f"_topbottom_k({n}): expected {expected}, got {got}")
    return failures


def test_call_chips():
    """mark_call_chips (v4 RANK): TOP k -> strong, BOTTOM k -> weak, the
    middle -> none, ranked by prediction DESC; k from the size tier. Covers
    the four tick branches, the TOP N/BOTTOM N labels, the below-tier drop,
    and -- the DEFINING difference from the retired threshold rule -- that
    the SAME row's call now DEPENDS on the set it's ranked in."""
    failures = []

    # 6 rows -> k=3: top 3 strong, bottom 3 weak (6 = 2*3, no middle).
    rows = [_r(0.9, 1.5), _r(0.7, 0.8), _r(0.5, 1.2), _r(0.3, 0.9), _r(0.1, 0.7), _r(-0.1, 1.3)]
    mark_call_chips(rows)
    got_type = {round(v["prediction"], 1): v["call_type"] for v in rows}
    exp_type = {0.9: "strong", 0.7: "strong", 0.5: "strong", 0.3: "weak", 0.1: "weak", -0.1: "weak"}
    if got_type != exp_type:
        failures.append(f"6-row k=3 call_type: expected {exp_type}, got {got_type}")
    # ticks: strong hit iff result>=1.0; weak hit iff result<1.0.
    got_tick = {round(v["prediction"], 1): v["call_tick"] for v in rows}
    exp_tick = {0.9: True, 0.7: False, 0.5: True, 0.3: True, 0.1: True, -0.1: False}
    if got_tick != exp_tick:
        failures.append(f"6-row tick: expected {exp_tick}, got {got_tick}")
    top_label = next(v["call_label"] for v in rows if v["call_type"] == "strong")
    bot_label = next(v["call_label"] for v in rows if v["call_type"] == "weak")
    if top_label != "TOP 3" or bot_label != "BOTTOM 3":
        failures.append(f"labels: expected TOP 3/BOTTOM 3, got {top_label!r}/{bot_label!r}")

    # 5 rows -> k=2: top 2 strong, bottom 2 weak, 1 middle none.
    rows5 = [_r(0.9, 1.0), _r(0.6, 1.0), _r(0.4, 1.0), _r(0.2, 1.0), _r(0.0, 1.0)]
    mark_call_chips(rows5)
    types5 = [v["call_type"] for v in sorted(rows5, key=lambda v: -v["prediction"])]
    if types5 != ["strong", "strong", "none", "weak", "weak"]:
        failures.append(f"5-row k=2: expected [strong,strong,none,weak,weak], got {types5}")

    # 3 rows -> k=None: no calls at all (below the tier).
    rows3 = [_r(0.9, 1.0), _r(0.5, 1.0), _r(0.1, 1.0)]
    mark_call_chips(rows3)
    if any(v["call_type"] != "none" for v in rows3):
        failures.append(f"3-row: expected all none, got {[v['call_type'] for v in rows3]}")

    # RANK DEPENDENCE (the opposite of the retired threshold invariant): the
    # SAME prediction=0.3 row is a WEAK call in a 6-row set (rank 4 -> in the
    # bottom 3) but a NONE (middle) call in an 8-row set where it's rank 4 of
    # 8 (top 3 + middle 2 + bottom 3). A row's call is a function of the set.
    six = [_r(0.9, 1.0), _r(0.7, 1.0), _r(0.5, 1.0), _r(0.3, 1.0), _r(0.1, 1.0), _r(-0.1, 1.0)]
    mark_call_chips(six)
    c6 = next(v for v in six if abs(v["prediction"] - 0.3) < 1e-9)["call_type"]
    eight = [_r(0.9, 1.0), _r(0.7, 1.0), _r(0.5, 1.0), _r(0.3, 1.0),
             _r(0.2, 1.0), _r(0.1, 1.0), _r(0.0, 1.0), _r(-0.1, 1.0)]
    mark_call_chips(eight)
    c8 = next(v for v in eight if abs(v["prediction"] - 0.3) < 1e-9)["call_type"]
    if not (c6 == "weak" and c8 == "none"):
        failures.append(f"rank dependence: prediction=0.3 expected weak in 6-set / none in 8-set, got {c6}/{c8}")
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
    # Date basis (T5): fmt_date renders the UTC date as-is (no per-viewer TZ
    # conversion), so a UTC fixture's Jul 3 + 30 days = Aug 2.
    if result.get("checkin") != "Aug 2":
        failures.append(f"checkin should be posted_at + 30 days, expected 'Aug 2', got {result.get('checkin')}")

    # --overall mode: pill scope is "all videos", not an objective name.
    result = bet_card_fields(section_b, "overall", None)
    if result.get("pill") != "91st percentile · all videos":
        failures.append(f"--overall bet card pill: expected 'all videos' scope, got {result.get('pill')!r}")

    return failures


def _hero(gap, calls_correct, calls_total):
    """Synthetic strong_weak_metrics()-shaped dict for pick_hero_form/
    send_check_verdict tests -- avoids depending on real row data when
    only gap/calls fields matter. No 'k' field anymore (unified call
    semantics dropped the fixed-symmetric-split concept entirely --
    strong_rows/weak_rows counts are independent, and neither
    pick_hero_form nor send_check_verdict ever read a 'k')."""
    return {"strong_avg": 1.0 + gap, "weak_avg": 1.0,
            "gap": gap, "calls_correct": calls_correct, "calls_total": calls_total}


def test_impressiveness_tiers():
    """averages_tier: UNCHANGED function, still just a bare-gap threshold
    -- boundary coverage kept verbatim (the gap's SOURCE changed from
    top_avg-bottom_avg to strong_avg-weak_avg upstream, but this function
    never knew or cared where its input came from). calls_tier:
    GENERALIZED from two fixed lookup tables (calls_total in {4,6}, the
    only values a forced symmetric 2*k split could ever produce) to a
    proportion-based scale for ANY calls_total, since strong/weak counts
    are independent now -- confirms the original 4/6 cases still land on
    their old tier AND covers asymmetric totals (5, 7, 9) the old code
    could never even receive."""
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

    # calls_tier, calls_total=6 (the old k=3 case): 6,5->3; 4->2; 3->1; <=2->0.
    calls6_cases = [(6, 3), (5, 3), (4, 2), (3, 1), (2, 0), (1, 0), (0, 0)]
    for correct, expected in calls6_cases:
        got = calls_tier(correct, 6)
        if got != expected:
            failures.append(f"calls_tier({correct}, 6): expected {expected}, got {got}")

    # calls_tier, calls_total=4 (the old k=2 case): 4->3; 3->2; 2->1; <=1->0.
    calls4_cases = [(4, 3), (3, 2), (2, 1), (1, 0), (0, 0)]
    for correct, expected in calls4_cases:
        got = calls_tier(correct, 4)
        if got != expected:
            failures.append(f"calls_tier({correct}, 4): expected {expected}, got {got}")

    # calls_tier, ASYMMETRIC totals -- impossible under the old rank-based
    # system (2*k could only ever be 4 or 6), routine now (e.g. 7 strong
    # calls + 2 weak calls = calls_total=9). Verifies the generalized
    # proportion scale (>=.8->3, >=.65->2, >=.5->1) behaves sensibly.
    asym_cases = [
        (9, 8, 3),   # 0.889 -- clearly tier 3
        (9, 6, 2),   # 0.667 -- clearly tier 2
        (9, 5, 1),   # 0.556 -- clearly tier 1
        (9, 4, 0),   # 0.444 -- below the tier-1 floor
        (5, 5, 3), (5, 4, 3), (5, 3, 1), (5, 2, 0),
        (7, 6, 3), (7, 5, 2), (7, 4, 1), (7, 3, 0),
    ]
    for total, correct, expected in asym_cases:
        got = calls_tier(correct, total)
        if got != expected:
            failures.append(f"calls_tier({correct}, {total}): expected {expected}, got {got}")

    # calls_tier degenerate guard: calls_total<=0 -> 0, never a ZeroDivisionError.
    if calls_tier(0, 0) != 0:
        failures.append(f"calls_tier(0, 0): expected 0 (degenerate guard), got {calls_tier(0, 0)}")

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

    # pick_hero_form: hero is None (fewer than 2 strong + 2 weak calls) --
    # best_bet when a scored video exists, pending when nothing does.
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


def test_coverage_honest_copy():
    """Transport hotfix, Task 2 -- hero_opening_sentence NEVER renders
    "every" over partial data; coverage_note is None at full coverage
    (including the attempted<=0 edge, where nothing was even eligible to
    fail) and a formatted gap string otherwise."""
    failures = []

    full = hero_opening_sentence("Jul 1", full_coverage=True)
    if "every public video you've posted" not in full:
        failures.append(f"full_coverage=True: expected the 'every' claim, got {full!r}")
    if "since Jul 1" not in full or not full.endswith("never seeing a single view count."):
        failures.append(f"full_coverage=True: unexpected sentence shape, got {full!r}")

    partial = hero_opening_sentence("Jul 1", full_coverage=False)
    if "every" in partial:
        failures.append(f"full_coverage=False: 'every' must NEVER appear over partial data, got {partial!r}")
    if "your public videos posted" not in partial:
        failures.append(f"full_coverage=False: expected the honest plural claim, got {partial!r}")
    if "since Jul 1" not in partial or not partial.endswith("never seeing a single view count."):
        failures.append(f"full_coverage=False: unexpected sentence shape, got {partial!r}")

    # coverage_note: full coverage (including the "nothing attempted" edge)
    # -> None; a real gap -> the formatted string.
    if coverage_note("Section B", 7, 7) is not None:
        failures.append("coverage_note(7,7): expected None (full coverage)")
    if coverage_note("Section B", 0, 0) is not None:
        failures.append("coverage_note(0,0): expected None (nothing attempted)")
    if coverage_note("Section B", 7, 4) != "Section B: 4 of 7 fetchable":
        failures.append(f"coverage_note(7,4): expected 'Section B: 4 of 7 fetchable', got {coverage_note('Section B', 7, 4)!r}")

    return failures


def _ranked_rows(n, strong_result=1.0, weak_result=1.0, mid_result=1.0):
    """n synthetic rows with DISTINCT descending predictions, marked by the
    rank rule. The TOP k get strong_result, the BOTTOM k weak_result, the
    middle mid_result (so averages are easy to verify). k = _topbottom_k(n)."""
    preds = [1.0 - i * 0.1 for i in range(n)]  # strictly descending, distinct
    k = _topbottom_k(n) or 0
    rows = []
    for i, p in enumerate(preds):
        if i < k:
            res = strong_result
        elif i >= n - k:
            res = weak_result
        else:
            res = mid_result
        rows.append(_r(p, res))
    mark_call_chips(rows)
    return rows


def test_strong_weak_metrics():
    """strong_weak_metrics (v4): metrics over the RANK groups (top-k strong,
    bottom-k weak). Below the tier (n<4 -> k=None) there are no calls ->
    None. At k>=2 the groups are symmetric (k each). 'none' middle rows and
    result_x=None rows never enter either group."""
    failures = []

    # 3 rows -> k=None -> no calls -> None.
    if strong_weak_metrics(_ranked_rows(3)) is not None:
        failures.append("3 rows (below tier): expected None (no calls)")

    # 4 rows -> k=2: strong=top2, weak=bottom2, calls_total=4.
    rows = _ranked_rows(4, strong_result=1.5, weak_result=0.6)
    hero = strong_weak_metrics(rows)
    if hero is None:
        failures.append("4 rows k=2: expected real metrics, got None")
    else:
        if hero["calls_total"] != 4:
            failures.append(f"4 rows: expected calls_total=4, got {hero['calls_total']}")
        if abs(hero["strong_avg"] - 1.5) > 1e-9 or abs(hero["weak_avg"] - 0.6) > 1e-9:
            failures.append(f"4 rows averages: expected strong_avg=1.5 weak_avg=0.6, got {hero}")
        if hero["calls_correct"] != 4:
            failures.append(f"4 rows calls_correct: expected 4 (all hits), got {hero['calls_correct']}")

    # 6 rows -> k=3: strong=top3, weak=bottom3, calls_total=6. Mixed results.
    # top3 all 1.2 (hits), bottom3 all 0.8 (weak hits, <1.0) -> 6 correct.
    rows = _ranked_rows(6, strong_result=1.2, weak_result=0.8)
    hero = strong_weak_metrics(rows)
    if hero is None or hero["calls_total"] != 6 or hero["calls_correct"] != 6:
        failures.append(f"6 rows k=3: expected calls_total=6 calls_correct=6, got {hero}")

    # 8 rows -> k=3: strong=top3, weak=bottom3, TWO middle 'none' rows never
    # counted -> calls_total stays 6, not 8.
    rows = _ranked_rows(8, strong_result=1.2, weak_result=0.8, mid_result=5.0)
    hero = strong_weak_metrics(rows)
    if hero is None or hero["calls_total"] != 6:
        failures.append(f"8 rows k=3: expected calls_total=6 (2 middle none excluded), got {hero}")

    # A top/bottom row missing its result_x drops below the >=2-each floor.
    rows = _ranked_rows(4)
    for v in rows:
        if v["call_type"] == "strong":
            v["result_x"] = None  # knock both strong rows' results out
    hero = strong_weak_metrics(rows)
    if hero is not None:
        failures.append("4 rows with both strong results missing: expected None (below >=2 floor)")

    return failures


def run():
    failures = []
    failures += test_topbottom_k()
    failures += test_call_chips()
    failures += test_bet_card()
    failures += test_impressiveness_tiers()
    failures += test_coverage_honest_copy()
    failures += test_strong_weak_metrics()

    if failures:
        print(f"FAILED ({len(failures)}):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    print("All _topbottom_k + mark_call_chips + strong_weak_metrics + bet_card_fields + "
          "impressiveness-tier/tie-break + coverage-honest-copy tests passed "
          "(v4 RANK: size-tier boundaries, top-k/bottom-k marking, rank-dependence, "
          "rank-group metrics, calls_tier generalization, "
          "bet card empty/non-empty branches, averages/calls tier boundaries, "
          "pick_hero_form tie-break, send_check_verdict remap, "
          "hero_opening_sentence both branches, coverage_note full/gap/nothing-attempted).")


if __name__ == "__main__":
    run()
