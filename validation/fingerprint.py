#!/usr/bin/env python3
"""
Phase C, Task 2 -- vendored fingerprinting module. Implements EXACTLY the
~/fingerprint_spike/fingerprint_spike.py spec (see SPIKE_NOTES.md): pHash
(imagehash) on 1fps frames with a 10% border crop, chromaprint via
`fpcalc -raw`, and duration (ffprobe-equivalent via ffmpeg -i stderr
parsing, matching server.js's own probe pattern rather than requiring a
separate ffprobe binary).

CLI usage: `python3 fingerprint.py <video_path>` -- prints ONE line of
compact JSON to stdout: {duration, frame_hashes_hex, audio_fingerprint,
fingerprint_time_s}. Exit code 0 on success. On any failure, prints
{"error": "<message>"} to stdout and exits 1 -- the caller (server.js) is
expected to treat any non-zero exit / error field as "skip fingerprinting
for this submission," never as a reason to fail the analysis itself.

No disk cache (unlike the spike) -- production fingerprints a given source
file exactly once, at submission time, then the source file is deleted;
there is nothing to reuse a cache against.
"""
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from PIL import Image
import imagehash

FPS = 1
BORDER_CROP = 0.10          # crop 10% off each side (keep center 80% x 80%)

# ── Matching (Task 4/5) -- ported from the spike, with ONE amendment ────────
# baked in directly to classify_tier: audio agreement alone (duration
# mismatched) never solo-qualifies for Tier 2 -- it becomes Tier 3 with a
# possibly_related flag instead. See SPIKE_NOTES.md's two amendments.
PHASH_MATCH_THRESHOLD = 8    # hamming distance <=8 (of 64 bits) counts as "same frame"
AUDIO_BLOCK_MATCH_BITS = 10  # avg hamming distance per 32-bit chromaprint block <=10 counts as audio match
AUDIO_MAX_OFFSET = 30        # blocks to search for best alignment (~ +/-4s at chromaprint's ~0.13s/block)
TIER1_OVERLAP = 0.90
TIER2_OVERLAP = 0.15         # below this AND no (audio+duration) corroboration -> Tier 3
DURATION_TOLERANCE_S = 2.0   # audio corroboration also requires duration agreement within this


def popcount32(x: int) -> int:
    return bin(x & 0xFFFFFFFF).count("1")


def frame_overlap_fraction(hashes_a, hashes_b) -> float:
    """For each hash in the SHORTER list, does it have a close match (hamming
    <= threshold) anywhere in the other list? Best-match search, not
    positional -- robust to trims/reordering, since a trimmed video's
    surviving frames should still each find a close match in the untrimmed
    original. hashes_a/hashes_b are imagehash.ImageHash objects (use
    imagehash.hex_to_hash() first if you have hex strings, e.g. from stored
    fp_json)."""
    if not hashes_a or not hashes_b:
        return 0.0
    if len(hashes_a) > len(hashes_b):
        hashes_a, hashes_b = hashes_b, hashes_a
    matched = 0
    for ha in hashes_a:
        best = min((ha - hb) for hb in hashes_b)
        if best <= PHASH_MATCH_THRESHOLD:
            matched += 1
    return matched / len(hashes_a)


def audio_match(fp_a, fp_b):
    """Best-offset alignment: try shifting fp_b relative to fp_a within
    +/-AUDIO_MAX_OFFSET blocks, compute mean per-block hamming distance at
    each offset over the overlapping region, keep the best (lowest-distance)
    offset. Returns (match_bool_or_None, best_mean_hamming_distance_or_None)."""
    if not fp_a or not fp_b:
        return None, None
    best_mean = None
    for offset in range(-AUDIO_MAX_OFFSET, AUDIO_MAX_OFFSET + 1):
        if offset >= 0:
            a, b = fp_a[offset:], fp_b
        else:
            a, b = fp_a, fp_b[-offset:]
        n = min(len(a), len(b))
        if n < 10:
            continue
        dists = [popcount32(a[i] ^ b[i]) for i in range(n)]
        mean_d = sum(dists) / n
        if best_mean is None or mean_d < best_mean:
            best_mean = mean_d
    if best_mean is None:
        return None, None
    return best_mean <= AUDIO_BLOCK_MATCH_BITS, round(best_mean, 2)


def classify_tier(overlap: float, aud_match, duration_delta):
    """Returns (tier: int, possibly_related: bool). Amendment (SPIKE_NOTES.md):
    audio corroborates a match only TOGETHER with duration agreement (within
    DURATION_TOLERANCE_S) -- audio-only agreement with a duration mismatch
    never solo-qualifies for Tier 2. It still means something (a video that
    shares audio but not footage/duration could be a remix, a different clip
    with reused sound, etc.) -- flagged as Tier 3 + possibly_related rather
    than silently discarded."""
    if overlap > TIER1_OVERLAP:
        return 1, False
    duration_ok = duration_delta is not None and abs(duration_delta) <= DURATION_TOLERANCE_S
    if overlap >= TIER2_OVERLAP or (aud_match is True and duration_ok):
        return 2, False
    if aud_match is True and not duration_ok:
        return 3, True
    return 3, False


def match_score(fp_a: dict, fp_b: dict) -> dict:
    """Compares two fingerprint dicts (the exact shape fingerprint_video()
    returns, or the equivalent loaded from stored fp_json -- frame_hashes_hex
    as hex strings, audio_fingerprint as a raw int list, duration as float).
    Returns overlap, audio_match, audio_mean_hamming, duration_delta_s, tier,
    possibly_related."""
    hashes_a = [imagehash.hex_to_hash(h) for h in fp_a.get("frame_hashes_hex", [])]
    hashes_b = [imagehash.hex_to_hash(h) for h in fp_b.get("frame_hashes_hex", [])]
    overlap = frame_overlap_fraction(hashes_a, hashes_b)
    aud_match, aud_dist = audio_match(fp_a.get("audio_fingerprint"), fp_b.get("audio_fingerprint"))
    dur_delta = abs((fp_a.get("duration") or 0) - (fp_b.get("duration") or 0))
    tier, possibly_related = classify_tier(overlap, aud_match, dur_delta)
    return {
        "frame_overlap": round(overlap, 3),
        "audio_match": aud_match, "audio_mean_hamming": aud_dist,
        "duration_delta_s": round(dur_delta, 2),
        "tier": tier, "possibly_related": possibly_related,
    }


def run(cmd, timeout=60):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def get_duration(video_path: Path) -> float:
    # ffmpeg -i (not ffprobe) -- same guaranteed-available-binary rationale
    # as server.js's own probeCodecs/getVideoDuration: exits 1 with no
    # output given, but writes full stream info (including Duration:) to
    # stderr, which we parse.
    r = run(["ffmpeg", "-i", str(video_path)])
    for line in r.stderr.splitlines():
        line = line.strip()
        if line.startswith("Duration:"):
            # "Duration: 00:01:28.88, start: ..."
            ts = line.split(",")[0].replace("Duration:", "").strip()
            h, m, s = ts.split(":")
            try:
                return int(h) * 3600 + int(m) * 60 + float(s)
            except ValueError:
                return 0.0
    return 0.0


def extract_frame_hashes(video_path: Path) -> list:
    with tempfile.TemporaryDirectory() as td:
        pattern = str(Path(td) / "f_%05d.jpg")
        run(["ffmpeg", "-y", "-i", str(video_path), "-vf", f"fps={FPS}",
             "-q:v", "3", pattern], timeout=120)
        frames = sorted(Path(td).glob("f_*.jpg"))
        hashes = []
        for fp in frames:
            try:
                img = Image.open(fp)
                w, h = img.size
                cx, cy = int(w * BORDER_CROP), int(h * BORDER_CROP)
                img = img.crop((cx, cy, w - cx, h - cy))
                hashes.append(imagehash.phash(img))
            except Exception as e:
                print(f"[fingerprint] frame hash failed for {fp.name}: {e}", file=sys.stderr)
        return hashes


def audio_fingerprint(video_path: Path):
    r = run(["fpcalc", "-raw", "-json", str(video_path)], timeout=60)
    if r.returncode != 0 or not r.stdout.strip():
        return None
    try:
        data = json.loads(r.stdout)
        return data.get("fingerprint")
    except json.JSONDecodeError:
        return None


def fingerprint_video(video_path: Path) -> dict:
    t0 = time.time()
    duration = get_duration(video_path)
    frame_hashes = extract_frame_hashes(video_path)
    audio_fp = audio_fingerprint(video_path)
    elapsed = time.time() - t0
    return {
        "duration": duration,
        "frame_hashes_hex": [str(h) for h in frame_hashes],
        "audio_fingerprint": audio_fp,
        "fingerprint_time_s": round(elapsed, 3),
    }


def main():
    if len(sys.argv) != 2:
        print(json.dumps({"error": "usage: fingerprint.py <video_path>"}))
        sys.exit(1)
    video_path = Path(sys.argv[1])
    if not video_path.exists():
        print(json.dumps({"error": f"file not found: {video_path}"}))
        sys.exit(1)
    try:
        result = fingerprint_video(video_path)
        print(json.dumps(result))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
