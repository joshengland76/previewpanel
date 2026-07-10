#!/usr/bin/env python3
"""
Phase C, Task 5 -- threshold stress test, before trusting the fingerprint
tiers anywhere in production. Two parts:

(A) Frame-overlap ALL-PAIRS on 100+ corpus videos (all genuinely different
    videos -- expect Tier 3 everywhere). Reports the max observed
    "false overlap" (frame_overlap between two unrelated videos) and its
    margin to the Tier-2 floor (0.15), compared against the spike's own
    finding at n=10 (max false overlap 0.098, from only 45 cross-pairs).

(B) Regenerates the spike's synthetic variant suite (SPIKE_NOTES.md) on 20
    FRESH corpus videos, disjoint from both (A)'s sample and the original
    spike's 10 -- 2 videos per each of the spike's 10 transform types.
    Builds a confusion table matching SPIKE_NOTES.md's structure.

No disk cache of the videos/fingerprints is committed to the repo -- this is
an analysis run, not vendored test fixtures. Output: a JSON report + a
markdown-formatted confusion table, both under validation/_stress_test_out/.
"""
import json
import pathlib
import random
import subprocess
import sys
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import fingerprint as fp

VIDEOS_DIR = pathlib.Path.home() / "correlation-research" / "videos"
OUT_DIR = pathlib.Path(__file__).resolve().parent / "_stress_test_out"
WORK_DIR = OUT_DIR / "_work"
SPIKE_ORIGINALS_DIR = pathlib.Path.home() / "fingerprint_spike" / "videos"

N_CROSS_PAIR_SAMPLE = 110
N_VARIANT_ORIGINALS = 20
SEED = 71234

SPIKE_MAX_FALSE_OVERLAP = 0.098  # from SPIKE_NOTES.md, n=10 originals / 45 cross-pairs


def run(cmd, timeout=120):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def already_used_ids():
    """Video ids used by the original spike -- excluded from this fresh sample."""
    ids = set()
    for f in SPIKE_ORIGINALS_DIR.glob("orig_*.mp4"):
        ids.add(f.stem.replace("orig_", ""))
    return ids


def pick_fresh_videos(n, exclude_ids):
    all_files = list(VIDEOS_DIR.glob("*.mp4"))
    random.Random(SEED).shuffle(all_files)
    picked = []
    for f in all_files:
        vid = f.stem
        if vid in exclude_ids:
            continue
        picked.append(f)
        if len(picked) >= n:
            break
    return picked


def fingerprint_all(paths, label):
    fps = {}
    t0 = time.time()
    for i, p in enumerate(paths):
        fps[p.stem] = fp.fingerprint_video(p)
        if (i + 1) % 20 == 0:
            print(f"  [{label}] fingerprinted {i + 1}/{len(paths)} ({time.time() - t0:.0f}s elapsed)")
    print(f"  [{label}] fingerprinted {len(paths)} videos in {time.time() - t0:.0f}s")
    return fps


# ── Part A: all-pairs cross comparison ──────────────────────────────────────
def run_part_a():
    print("\n=== PART A: frame-overlap all-pairs on 100+ corpus videos ===")
    exclude = already_used_ids()
    videos = pick_fresh_videos(N_CROSS_PAIR_SAMPLE, exclude)
    print(f"sampled {len(videos)} fresh videos (excluding the {len(exclude)} original spike videos)")

    fps = fingerprint_all(videos, "part A")
    names = list(fps.keys())
    n = len(names)
    total_pairs = n * (n - 1) // 2
    print(f"computing {total_pairs} all-pairs match scores...")

    max_overlap = 0.0
    max_overlap_pair = None
    tier_counts = {1: 0, 2: 0, 3: 0}
    overlaps = []
    t0 = time.time()
    for i in range(n):
        for j in range(i + 1, n):
            score = fp.match_score(fps[names[i]], fps[names[j]])
            overlaps.append(score["frame_overlap"])
            tier_counts[score["tier"]] += 1
            if score["frame_overlap"] > max_overlap:
                max_overlap = score["frame_overlap"]
                max_overlap_pair = (names[i], names[j])
    elapsed = time.time() - t0
    print(f"done in {elapsed:.0f}s")

    overlaps.sort()
    margin = 0.15 - max_overlap
    result = {
        "n_videos": n,
        "n_pairs": total_pairs,
        "tier_counts": tier_counts,
        "max_false_overlap": max_overlap,
        "max_false_overlap_pair": max_overlap_pair,
        "margin_to_tier2_floor": margin,
        "spike_max_false_overlap_n10": SPIKE_MAX_FALSE_OVERLAP,
        "margin_thinner_than_spike": margin < (0.15 - SPIKE_MAX_FALSE_OVERLAP),
        "overlap_percentiles": {
            "p50": overlaps[len(overlaps) // 2],
            "p90": overlaps[int(len(overlaps) * 0.90)],
            "p99": overlaps[int(len(overlaps) * 0.99)],
            "max": overlaps[-1],
        },
    }
    print(f"\nTier counts across {total_pairs} cross-pairs: {tier_counts}")
    print(f"Max false overlap: {max_overlap:.4f} (pair: {max_overlap_pair})")
    print(f"Margin to Tier-2 floor (0.15): {margin:.4f}")
    print(f"Spike's max false overlap at n=10 (45 pairs): {SPIKE_MAX_FALSE_OVERLAP}")
    print(f"This run's margin {'IS' if result['margin_thinner_than_spike'] else 'is NOT'} thinner than the spike's")
    return result


# ── Part B: synthetic variant suite on 20 fresh videos ──────────────────────
TRANSFORMS = [
    "reencode_low_bitrate", "reencode_high_bitrate", "reencode_fast_preset",
    "trim_head", "trim_tail", "trim_reencode", "trim_overlay", "overlay_only",
    "muted", "crop_10pct",
]
EXPECTED_TIER = {t: 1 for t in TRANSFORMS}
EXPECTED_TIER["crop_10pct"] = 2  # the spike's one exception


def ffmpeg_duration(path):
    r = run(["ffmpeg", "-i", str(path)])
    for line in r.stderr.splitlines():
        line = line.strip()
        if line.startswith("Duration:"):
            ts = line.split(",")[0].replace("Duration:", "").strip()
            h, m, s = ts.split(":")
            return int(h) * 3600 + int(m) * 60 + float(s)
    return None


def make_variant(transform, src, out):
    dur = ffmpeg_duration(src)
    if transform == "reencode_low_bitrate":
        cmd = ["ffmpeg", "-y", "-i", str(src), "-c:v", "libx264", "-b:v", "400k", "-c:a", "aac", "-b:a", "64k", str(out)]
    elif transform == "reencode_high_bitrate":
        cmd = ["ffmpeg", "-y", "-i", str(src), "-c:v", "libx264", "-b:v", "4000k", "-c:a", "aac", "-b:a", "192k", str(out)]
    elif transform == "reencode_fast_preset":
        cmd = ["ffmpeg", "-y", "-i", str(src), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-c:a", "aac", str(out)]
    elif transform == "trim_head":
        cmd = ["ffmpeg", "-y", "-ss", "2", "-i", str(src), "-c", "copy", str(out)]
    elif transform == "trim_tail":
        if not dur or dur <= 4:
            return False
        cmd = ["ffmpeg", "-y", "-i", str(src), "-t", str(max(1, dur - 2)), "-c", "copy", str(out)]
    elif transform == "trim_reencode":
        cmd = ["ffmpeg", "-y", "-ss", "2", "-i", str(src), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-c:a", "aac", str(out)]
    elif transform == "trim_overlay":
        cmd = ["ffmpeg", "-y", "-ss", "2", "-i", str(src), "-vf", "drawbox=x=10:y=10:w=200:h=60:color=black@0.6:t=fill",
               "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-c:a", "aac", str(out)]
    elif transform == "overlay_only":
        cmd = ["ffmpeg", "-y", "-i", str(src), "-vf", "drawbox=x=10:y=10:w=200:h=60:color=black@0.6:t=fill",
               "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-c:a", "aac", str(out)]
    elif transform == "muted":
        cmd = ["ffmpeg", "-y", "-i", str(src), "-c:v", "copy", "-an", str(out)]
    elif transform == "crop_10pct":
        cmd = ["ffmpeg", "-y", "-i", str(src), "-vf", "crop=iw*0.8:ih*0.8",
               "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-c:a", "aac", str(out)]
    else:
        return False
    r = run(cmd, timeout=180)
    return out.exists() and out.stat().st_size > 0


def run_part_b():
    print("\n=== PART B: synthetic variant suite on 20 fresh corpus videos ===")
    exclude = already_used_ids()
    videos = pick_fresh_videos(N_VARIANT_ORIGINALS + N_CROSS_PAIR_SAMPLE, exclude)[N_CROSS_PAIR_SAMPLE:]  # disjoint from Part A
    if len(videos) < N_VARIANT_ORIGINALS:
        print(f"WARNING: only found {len(videos)} disjoint videos for Part B")
    videos = videos[:N_VARIANT_ORIGINALS]
    print(f"sampled {len(videos)} fresh videos, disjoint from Part A and the original spike")

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    pairs = []  # (video, transform, variant_path)
    for i, src in enumerate(videos):
        transform = TRANSFORMS[i % len(TRANSFORMS)]
        out = WORK_DIR / f"var_{transform}_{src.stem}.mp4"
        ok = make_variant(transform, src, out)
        if ok:
            pairs.append((src, transform, out))
        else:
            print(f"  [warn] variant generation failed: {transform} on {src.stem}")

    print(f"generated {len(pairs)}/{len(videos)} variants")

    results = []
    confusion = {}  # (expected_bucket) -> {predicted_tier: count}
    for src, transform, variant_path in pairs:
        fp_orig = fp.fingerprint_video(src)
        fp_var = fp.fingerprint_video(variant_path)
        score = fp.match_score(fp_orig, fp_var)
        expected = EXPECTED_TIER[transform]
        bucket = "same-footage-cropped" if transform == "crop_10pct" else "same-cut/re-encode/trim/overlay"
        confusion.setdefault(bucket, {1: 0, 2: 0, 3: 0})
        confusion[bucket][score["tier"]] += 1
        results.append({
            "video_id": src.stem, "transform": transform, "expected_tier": expected,
            "actual_tier": score["tier"], "frame_overlap": score["frame_overlap"],
            "audio_match": score["audio_match"], "duration_delta_s": score["duration_delta_s"],
            "match_expected": score["tier"] == expected,
        })
        print(f"  {transform:22s} {src.stem[:30]:32s} overlap={score['frame_overlap']:.3f} "
              f"audio={score['audio_match']} -> tier={score['tier']} (expected {expected}) "
              f"{'OK' if score['tier'] == expected else 'MISMATCH'}")
        variant_path.unlink(missing_ok=True)  # don't keep generated variants on disk

    n_mismatches = sum(1 for r in results if not r["match_expected"])
    print(f"\n{len(results) - n_mismatches}/{len(results)} matched their expected tier")
    print("\nConfusion table:")
    print(f"{'Actual category':35s} {'Tier 1':>8s} {'Tier 2':>8s} {'Tier 3':>8s}")
    for bucket, counts in confusion.items():
        print(f"{bucket:35s} {counts[1]:>8d} {counts[2]:>8d} {counts[3]:>8d}")

    return {"results": results, "confusion": confusion, "n_mismatches": n_mismatches}


def main():
    OUT_DIR.mkdir(exist_ok=True)
    part_a = run_part_a()
    part_b = run_part_b()

    report = {"part_a": part_a, "part_b": part_b}
    out_path = OUT_DIR / "threshold_stress_report.json"
    out_path.write_text(json.dumps(report, indent=2, default=str))
    print(f"\nWrote full report -> {out_path}")

    print("\n=== FLOOR-ADJUSTMENT CHECK ===")
    if part_a["margin_thinner_than_spike"]:
        print(f"WARNING: this run's margin ({part_a['margin_to_tier2_floor']:.4f}) is THINNER than the "
              f"spike's ({0.15 - SPIKE_MAX_FALSE_OVERLAP:.4f}) at n=10. A floor adjustment should be "
              f"PROPOSED (not silently applied) -- see the report for the specific pair driving this.")
    else:
        print(f"Margin holds (or improves) at this larger scale ({part_a['n_pairs']} pairs vs. the "
              f"spike's 45) -- no floor adjustment proposed.")


if __name__ == "__main__":
    main()
