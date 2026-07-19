#!/usr/bin/env python3
"""
Track Record v3, Task 1 -- UNIFIED CALL SEMANTICS rewrite. Retires the old
rank-based topbottom_metrics/mark_top_bottom_pills tests (n=3,4,5,6,8
tiered top-k/bottom-k coverage) in favor of testing the new
percentile-THRESHOLD rule (call_type_for/mark_call_chips/
strong_weak_metrics): a row's call_type is now a direct function of its
OWN percentile (>=70 strong, <=30 weak, else none), never of how many
other rows are in the shown set or what rank it holds among them.

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
    call_type_for, mark_call_chips, strong_weak_metrics, bet_card_fields,
    averages_tier, calls_tier, pick_hero_form, send_check_verdict,
    hero_opening_sentence, coverage_note,
)


def test_call_type_for():
    """call_type_for: strong >=70, weak <=30, none in between, both
    thresholds inclusive (exact 70/30 resolve to a real call, not a
    near-miss no-call), None percentile -> None call_type."""
    failures = []
    cases = [
        (100, "strong"), (99, "strong"), (70, "strong"), (71, "strong"),
        (69, "none"), (50, "none"), (31, "none"), (30, "weak"),
        (29, "weak"), (1, "weak"), (0, "weak"),
        (None, None),
    ]
    for percentile, expected in cases:
        got = call_type_for(percentile)
        if got != expected:
            failures.append(f"call_type_for({percentile}): expected {expected!r}, got {got!r}")
    return failures


def test_call_chips():
    """mark_call_chips: call_type/call_tick driven ENTIRELY by each row's
    own percentile -- confirms two rows with identical percentiles get
    identical call_type regardless of how many other rows are in the set
    (the defining difference from the old rank-based pill system, where
    the SAME row could be 'top' in an 8-row set and unmarked in a 3-row
    one). Also covers all four tick branches (strong hit/miss, weak
    hit/miss) and the no-call/no-result guards."""
    failures = []
    rows = [
        {"percentile": 92, "result_x": 1.5},   # strong, hit  (>=1.0 -> True)
        {"percentile": 71, "result_x": 0.8},   # strong, MISS (<1.0 -> False)
        {"percentile": 55, "result_x": 1.2},   # none -- no chip regardless of result
        {"percentile": 40, "result_x": 0.9},   # none -- no chip regardless of result
        {"percentile": 28, "result_x": 0.7},   # weak, hit  (<1.0 -> True)
        {"percentile": 12, "result_x": 1.3},   # weak, MISS (>=1.0 -> False)
        {"percentile": 5,  "result_x": None},  # weak percentile but no real result -- no tick
    ]
    mark_call_chips(rows)
    expected_type = ["strong", "strong", "none", "none", "weak", "weak", "weak"]
    expected_tick = [True, False, None, None, True, False, None]
    got_type = [v["call_type"] for v in rows]
    got_tick = [v["call_tick"] for v in rows]
    if got_type != expected_type:
        failures.append(f"call_type: expected {expected_type}, got {got_type}")
    if got_tick != expected_tick:
        failures.append(f"call_tick: expected {expected_tick}, got {got_tick}")

    # Same percentile, wildly different set sizes/positions -- call_type
    # must be identical (the whole point of a threshold rule vs. a rank
    # rule). A percentile=80 row is 'strong' whether it's alone or amid
    # 7 other rows, top-ranked or not.
    solo = [{"percentile": 80, "result_x": 1.1}]
    mark_call_chips(solo)
    crowded = [{"percentile": 80, "result_x": 1.1}] + [{"percentile": p, "result_x": 1.0} for p in (95, 90, 85, 60, 50)]
    mark_call_chips(crowded)
    if solo[0]["call_type"] != crowded[0]["call_type"]:
        failures.append(
            f"percentile=80 should be 'strong' regardless of set size/rank: "
            f"solo={solo[0]['call_type']!r}, crowded={crowded[0]['call_type']!r}"
        )
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


def _rows(strong_n, weak_n, none_n=0, strong_result=1.0, weak_result=1.0):
    """Synthetic section_a-shaped rows for strong_weak_metrics: strong_n
    rows at percentile=90 (all with the SAME result_x, for easy average
    verification), weak_n at percentile=10, none_n at percentile=50
    (never counted as a call)."""
    rows = [{"percentile": 90, "result_x": strong_result} for _ in range(strong_n)]
    rows += [{"percentile": 10, "result_x": weak_result} for _ in range(weak_n)]
    rows += [{"percentile": 50, "result_x": 1.0} for _ in range(none_n)]
    mark_call_chips(rows)
    return rows


def test_strong_weak_metrics():
    """strong_weak_metrics: needs >=2 strong AND >=2 weak calls (Track
    Record's own hero-averages floor) to return real metrics; below that
    -> None regardless of how many total/none-call rows exist. Also
    confirms ASYMMETRIC counts (impossible under the old forced 2*k
    split) compute correctly, and that 'none' rows never leak into
    either group or the total."""
    failures = []

    # 1 strong + 5 weak: strong count fails the >=2 floor -> None, even
    # though there are plenty of total usable rows (the old n<4 guard
    # would have accepted this; the new floor is about CALL counts, not
    # usable-row counts).
    rows = _rows(strong_n=1, weak_n=5)
    if strong_weak_metrics(rows) is not None:
        failures.append("1 strong + 5 weak: expected None (strong count below floor)")

    # 2 strong + 2 weak: exactly at the floor -> real metrics.
    rows = _rows(strong_n=2, weak_n=2, strong_result=1.5, weak_result=0.6)
    hero = strong_weak_metrics(rows)
    if hero is None:
        failures.append("2 strong + 2 weak: expected real metrics, got None")
    else:
        if hero["calls_total"] != 4:
            failures.append(f"2+2: expected calls_total=4, got {hero['calls_total']}")
        if abs(hero["strong_avg"] - 1.5) > 1e-9 or abs(hero["weak_avg"] - 0.6) > 1e-9:
            failures.append(f"2+2 averages: expected strong_avg=1.5 weak_avg=0.6, got {hero}")
        if hero["calls_correct"] != 4:
            failures.append(f"2+2 calls_correct: expected 4 (all hits: strong>=1.0, weak<1.0), got {hero['calls_correct']}")

    # ASYMMETRIC: 7 strong + 2 weak -- impossible under the old forced
    # 2*k split, routine under unified call semantics. Mixed hit/miss.
    rows = ([{"percentile": 90, "result_x": 1.2}] * 5 + [{"percentile": 90, "result_x": 0.8}] * 2
            + [{"percentile": 10, "result_x": 0.5}, {"percentile": 10, "result_x": 1.1}])
    mark_call_chips(rows)
    hero = strong_weak_metrics(rows)
    if hero is None:
        failures.append("7 strong + 2 weak: expected real metrics, got None")
    else:
        if hero["calls_total"] != 9:
            failures.append(f"7+2: expected calls_total=9, got {hero['calls_total']}")
        # correct: 5 strong hits (>=1.0) + 1 weak hit (<1.0) = 6
        if hero["calls_correct"] != 6:
            failures.append(f"7+2 calls_correct: expected 6, got {hero['calls_correct']}")

    # 'none' rows never leak into either group or the total, regardless
    # of how many there are.
    rows = _rows(strong_n=3, weak_n=3, none_n=10)
    hero = strong_weak_metrics(rows)
    if hero is None or hero["calls_total"] != 6:
        failures.append(f"3 strong + 3 weak + 10 none: expected calls_total=6 (none excluded), got {hero}")

    # Rows with no real result (result_x=None) don't count as a call even
    # if their percentile crosses a threshold.
    rows = [{"percentile": 90, "result_x": None}] * 5 + _rows(strong_n=2, weak_n=2)
    hero = strong_weak_metrics(rows)
    if hero is None or hero["calls_total"] != 4:
        failures.append(f"5 no-result strong-percentile rows + 2+2 real: expected calls_total=4 (no-result excluded), got {hero}")

    return failures


def run():
    failures = []
    failures += test_call_type_for()
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
    print("All call_type_for + mark_call_chips + strong_weak_metrics + bet_card_fields + "
          "impressiveness-tier/tie-break + coverage-honest-copy tests passed "
          "(threshold boundaries, same-percentile-different-set-size invariant, "
          "asymmetric strong/weak counts, calls_tier generalization, "
          "bet card empty/non-empty branches, averages/calls tier boundaries, "
          "pick_hero_form tie-break, send_check_verdict remap, "
          "hero_opening_sentence both branches, coverage_note full/gap/nothing-attempted).")


if __name__ == "__main__":
    run()
