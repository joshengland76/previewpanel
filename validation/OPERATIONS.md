# Validation pipeline — manual operations note

Phase C2 (day-30 outcome collection + validation dashboard) runs manually
from Josh's Mac. No cron/LaunchAgent is installed yet — deferred until a real
test batch of connected users + posted videos is actually live, so the first
LaunchAgent setup has real traffic to schedule around rather than being
tuned against an empty table.

## Daily cadence (~2 minutes)

Run in order, from the `PreviewPanel` repo root:

```bash
python3 validation/worker.py
python3 validation/collect_day30.py
```

- `worker.py` scans every connected user's TikTok handle for newly-posted
  videos (idempotent — already-discovered `tiktok_video_id`s are skipped),
  fingerprints and matches each new one against that user's recent previews,
  and POSTs it to production for scoring. Takes seconds per new video found;
  near-instant if nothing new posted.
- `collect_day30.py` fetches real public counters for any posted video that
  entered its day 30–37 window since the last run, computes `wec_rate`, and
  advances it to `day30_collected` (or `failed` with a reason, on permanent
  unavailability). Also near-instant when nothing is newly eligible.

Check `validation/dashboard.py` whenever you want the current funnel/metric
state — it's read-only and safe to run as often as you like:

```bash
python3 validation/dashboard.py
```

## Why manual, for now

Both scripts are cheap (a handful of yt-dlp calls) and idempotent, so running
them late, or missing a day, costs nothing beyond a slightly wider day-30
collection window (the 30–37 day grace period exists exactly for this). Once
a real batch of users/posted videos is live, wire this into a LaunchAgent
(macOS's cron equivalent — survives reboots, easy to inspect) running both
scripts once daily; until then, the manual cadence is simpler to reason about
and to change on the fly while the pipeline itself is still young.

## Environment prerequisites

- `backend/.env` must have a working `DATABASE_URL` (same Neon Postgres the
  production app uses) and `RESEARCH_API_KEY` (auth for `worker.py`'s POST to
  `/api/validation/ingest`).
- `yt-dlp` and `ffmpeg` on PATH (Homebrew on Mac); `fpcalc` on PATH (Homebrew
  `chromaprint`) for local fingerprinting — production uses its own bundled
  static binary instead, see `render.yaml`.
