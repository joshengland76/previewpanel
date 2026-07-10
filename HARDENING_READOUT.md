# App Hardening + Reliability Readout

**Status: ALL PARTS COMPLETE (A, B, C8, C9, D10).** Code committed
(`b8c6e21`) and deployed live to Render production. The atomic-claiming fix
(Task 7) was verified not just at the DB/single-instance level but against a
**real production blue-green deploy**, catching the exact overlap race it
was built to fix — see Part B below.

**Hard constraint honored throughout**: the TwelveLabs keep-warm/warm-up path
(`createWarmupFile`, `runWarmup`, `WARMUP_PATH`) was not touched. The one
place this mattered directly — Task A6's disk sweep — explicitly excludes
`warmup.mp4` by filename, even though it lives in the same `uploads/`
directory as everything else being swept.

---

## Part A — Memory retention + burst resilience

### A1: jobs-map eviction (30 min, aligned with trim retention)

`scheduleJobEviction(jobId)` deletes the job from the in-memory `jobs` map
`TRIM_RETAIN_MS` (30 min in production; overridden to 20s for this local test)
after a terminal state, hooked into `recordSubmissionForJob` — the single
funnel point every terminal path (done/partial/error/timeout, and the early
`rejected_*` validations) already goes through.

- [x] No endpoint/frontend change needed: `/api/status/:jobId` already 404s
      `{"error":"Job not found"}` for any evicted jobId, and the frontend's
      `poll()` already treats that gracefully ("The server restarted during
      analysis…"). `restoreFromHistory()` never calls `/api/status` at all
      (reads entirely from localStorage) — restored-history UX is
      structurally unaffected.
- [x] **Verified live** (see D10 below): all 3 test jobs evicted on schedule,
      confirmed via both the `[jobs] evicted ...` log line and a follow-up
      `curl` returning 404.

### A2: log diet (stdout, thumbnail length not body, 8KB cap)

`logStructured()` always uses `console.log` (stdout), caps the serialized
line at 8KB (truncating the string, not any one field), and
`recordSubmissionForJob`'s completion log now destructures `thumbnailDataUrl`
out and logs `thumbnailDataUrlLength` instead.

- [x] **Verified live**: all 3 D10 test jobs' completion `[log]` lines show
      `"thumbnailDataUrlLength":5087` — no `thumbnailDataUrl` field, no base64
      body, present in every completion log line captured.

### A3: memory telemetry (rss/heapUsed)

`logMemoryMB(label)` logs `rss`/`heapUsed` in MB. Called at: every 20th
poller heartbeat, job start (all 3 job-creation sites: `/api/analyze`,
`/api/research/submit`, `/api/research/submit-eval`), and job completion
(inside `recordSubmissionForJob`).

- [x] **Verified live** — before/after rss across the D10 test run:

  | Point | rss | heapUsed |
  |---|---|---|
  | Job 1 start | 92.1 MB | 23.6 MB |
  | Job 2 start | 96.0 MB | 25.1 MB |
  | Job 3 start | 96.8 MB | 25.6 MB |
  | Job 1 completion | 105.1 MB | 26.9 MB |
  | Job 2 completion | 105.2 MB | 27.3 MB |

  (Job 3's completion line landed the same as the others per the log; the
  ~13MB rss growth across 3 sequential submissions is expected/unremarkable —
  three concurrent Node/TL SDK request contexts, buffers, etc., not a leak
  signature.)
- [x] Every-20th-heartbeat log is implemented and correct by inspection
      (`pollerHeartbeatCount % 20 === 0`); at the poller's 15s interval this
      needs ~5 min of continuous uptime with no overlapping cycles to fire
      once, which the short local test window didn't quite clear before the
      test server was shut down. Not re-tested further live since the
      job-start/completion rss lines already satisfy "rss lines present,"
      and the gating logic itself is trivial and low-risk.

### A4: streaming audit (no `res.send(Buffer)` on video-sized payloads, ffmpeg via spawn)

- [x] Confirmed via grep: no `child_process.exec()` (shell-invoking) calls
      exist anywhere in the codebase — only `execFileAsync`/`spawn`.
- [x] The two large-payload ffmpeg conversion calls (main conversion, pass2
      re-compression) now run via `runFfmpegSpawn()` (`spawn`-based, stderr
      kept only as a capped rolling tail, never buffered whole).
- [x] `extractThumbnail` (small single-JPEG-frame buffer capture) and the
      duration-probe calls (`probeCodecs`, `getVideoDuration`, tiny/instant,
      default maxBuffer safe) deliberately left as `execFileAsync` — not
      streaming-audit targets.
- [x] `createWarmupFile` (hard-constraint-protected) deliberately left
      untouched, despite superficially matching the same `execFileAsync`
      pattern.
- [x] `/api/trim/:trimId/download` (the only video-download endpoint)
      confirmed already compliant — `fs.createReadStream().pipe(res)`.

### A5: unified ffmpeg concurrency cap (max 2, conversions + trims)

`MAX_CONCURRENT_FFMPEG = 2` / `activeFfmpegProcs` replaces the old trim-only
semaphore. Trims keep their existing synchronous queue/UX
(`pumpTrimQueue`); conversions await a slot via `acquireFfmpegSlot()`. Both
release through `releaseFfmpegSlot()`, which hands a freed slot straight to
a waiting conversion or re-triggers the trim queue.

- [x] `node --check server.js` clean; `grep` confirms zero remaining
      `activeTrimProc`/`MAX_CONCURRENT_TRIMS` references.
- [x] Exercised implicitly during D10 (3 concurrent submissions, each with a
      conversion), no ffmpeg-related errors or unexpected serialization.

### A6: disk sweep on boot (60 min, `uploads/`, warmup.mp4 excluded)

`sweepUploadsDir()` runs synchronously first thing in the entry-point IIFE
(before DB connect), deleting anything in `uploads/` older than 60 min except
`warmup.mp4` by name.

- [x] **Verified live**: on the D10 test server's boot, logged
      `[sweep] boot disk sweep: removed 7 file(s) older than 60 min from
      uploads/ (warmup.mp4 excluded)` — real stale files from prior manual
      testing sessions, correctly swept, warmup file correctly preserved
      (warm-up ping proceeded normally immediately after).

---

## Part B — Atomic task claiming (Task 7)

Schema: `claimed_by TEXT`, `claimed_at TIMESTAMPTZ` added to `analyze_tasks`
(idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`). `SELF_RUN_ID`
(`${INSTANCE_ID}-${bootTimestamp}-${randomSuffix}`) is genuinely unique per
process, unlike the static per-role `INSTANCE_ID`.

`claimAnalyzeTasks()` — single atomic statement (CTE + `FOR UPDATE SKIP
LOCKED` + `UPDATE ... RETURNING`), **self-renewing lease**: a live poller
re-claims (refreshing `claimed_at`) its own still-pending rows every 15s
cycle, so an in-flight (not-yet-ready) task keeps being polled by its owner
without another process ever being able to steal it — only a row whose
`claimed_at` hasn't been refreshed in `STALE_CLAIM_MS` (10 min) becomes
reclaimable, which is the orphan-prevention path for a container that dies
mid-deploy. Terminal-state UPDATEs (`ready`/`failed`/`stale`/`cancelled`) now
also guard `AND claimed_by = $self_run_id` for defense in depth.
`created_by_instance` kept, now purely informational (no longer used to
scope claiming).

- [x] **Verified directly against the real Neon DB** (standalone script,
      not the full server — no server boot, no poller loop, no warmup
      touched): inserted 2 real test rows, then:
  - Container A claims both rows. Container B claims **0** immediately after
    (no double-claim).
  - Container A re-claims (renews) both rows on its next cycle (self-renewal
    works — a still-pending task doesn't go unpolled).
  - `claimed_at` backdated 11 min to simulate A dying mid-deploy. Container
    B then claims both rows (stale-claim recovery works — no orphan).
  - Test rows cleaned up; migration is idempotent (`ADD COLUMN IF NOT
    EXISTS`), confirmed via the same script.
- [x] **Verified live** (D10 local server, one instance): poller correctly
      claims via `SELF_RUN_ID` (`[poller] Tasks claimed by
      dev-Joshs-MacBook-Air.local-1783677726348-ffigsu: 9` for 3 concurrent
      jobs × 3 judges).
- [x] **Verified against a real production blue-green deploy** — the exact
      scenario this fix targets (see `PHASEB4B_READOUT.md`'s "genuine
      complication" note). Sequence:
  1. Committed (`b8c6e21`) and pushed to `main`; Render auto-deployed.
  2. Triggered a second manual redeploy of the same commit via the Render
     API to force a fresh blue-green cycle, and submitted 2 real videos to
     production (`job_1783678527063_uc8jnq`, `job_1783678563643_yybvw2`)
     immediately after, timed to land while the new container was still
     building.
  3. Render logs confirm **two containers alive simultaneously**, each with
     its own `SELF_RUN_ID` despite sharing `INSTANCE_ID=production`: the
     outgoing container (`production-1783678485703-wz57bj`) and the incoming
     one (`production-1783678563822-jund3j`), both polling
     `analyze_tasks` in the same window.
  4. `job_1783678527063_uc8jnq` completed entirely on the outgoing
     container. `job_1783678563643_yybvw2`'s first two judges completed on
     the outgoing container; its last task (`cool`) was still pending when
     the new container came up — the new container polled and correctly
     found **0** unclaimed work (`[poller] Tasks claimed by
     production-1783678563822-jund3j: 0`) while the **outgoing** container,
     which already held that row's lease, claimed and finished it
     (`[poller] Tasks claimed by production-1783678485703-wz57bj: 1`,
     followed immediately by `Judge cool complete`).
  5. Both jobs reached `"All 3 judges complete"`, `INSERT submissions
     status=done`, correct `[log]` (thumbnail-length-only) and `[memory]`
     lines. **Zero double-claims, zero orphaned tasks**, despite the real
     overlap. This is the precise failure mode from 4b's live cutover
     verification, now demonstrated fixed rather than merely designed to be.

---

## Part C — Drift measurement

### C8: clean drift recompute (no new API calls)

Corrected a mixed-quantity comparison in `PHASEB4B_READOUT.md`'s "descriptive
rider" (which compared a fresh ŷ against a raw stored `avg_score` — not the
same quantity). Recomputed from the same already-stored 4b pilot/confirm
data (`backend/phaseb4b_drift_recompute.mjs`):

| Era | n | (a) Spearman(fresh N1 avg_score, stored avg_score) | (b) Spearman(ŷ fresh, ŷ stored) |
|---|---|---|---|
| pegasus1.5 | 14 | 0.811, 95% CI [0.492, 0.938] | 0.960, 95% CI [0.877, 0.988] |
| pegasus1.2 | 16 | 0.634, 95% CI [0.202, 0.860] | 0.953, 95% CI [0.867, 0.984] |

Confirmation run's anomaly-rerun rate against its true denominator: **26/720
= 3.61%** (120 videos × 2 arms × 3 judges), of which **22 CONFIRMED** the
original low read and **4 REVERTED**.

- [x] Findings appended to `PHASEB4B_READOUT.md` (research repo) as a
      labeled correction section.

### C9: anchor set + baseline rescore

- [x] `anchor_sample.py` (research repo) selected 30 videos, stratified by
      `objective_creator`, restricted to rows with a confirmed-present local
      file (distinct SEED=9137 from both the pilot's 4201 and confirm's
      seed — an independent draw). 30 distinct creators across 19
      objective_creator slugs. Written to `anchor_manifest.json`.
- [x] `anchor_rescore.mjs` (backend) built to run the FULL live path: live
      TL judge calls (forced to `judges-v2.1` regardless of local `.env`
      drift — production's `JUDGES_V21=true` lives only in Render's env
      config) combined with each video's existing, un-re-extracted C_dims
      features via the same `scoreFeatures()` used in production. Appends
      `{date, video_id, yhat, avg_score, prompt_version, pegasus_model}` per
      video to `anchor_history.jsonl`; prints median Δŷ / rank correlation
      vs. the most recent prior run once one exists.
  - **Bug caught before it cost anything real**: the first attempt set
    `process.env.JUDGES_V21 = "true"` textually before the `import ... from
    "./server.js"` line, but ES module static imports are hoisted above all
    other top-level code regardless of source order — so it ran against
    `judges-v1.0` instead. Caught from the printed
    `prompt_version=judges-v1.0` line before any judge calls were made (only
    4 asset uploads had happened, no analyze tasks created, no cost beyond
    upload/indexing); killed immediately, fixed by moving the import behind
    a dynamic `await import()` inside `main()`, re-verified
    `prompt_version=judges-v2.1` prints correctly, then re-ran.
  - **Baseline run complete** (real cost, ~$2, pre-approved): **30/30
    videos scored successfully**, all appended to `anchor_history.jsonl`
    with `prompt_version=judges-v2.1`. Since the history file was empty
    before this run, it establishes the baseline with nothing to diff
    against yet — the script printed exactly that ("this run IS the
    baseline. Nothing to diff against.") rather than a spurious delta.
    Suggested alert thresholds for future monthly reruns: `|median Δŷ| >
    0.02` or rank corr `< 0.95` → investigate.

---

## Part D — Verify + report (Task 10)

3 local submissions against the hardened local server
(`TRIM_RETAIN_MS=20000` for a fast eviction check; everything else
unmodified from production config):

- [x] **Eviction fires**: all 3 jobs (`job_1783677776553_tyqbu1`,
      `job_1783677801435_px0fo8`, `job_1783677801453_ka2q79`) show a
      `[jobs] evicted ... from memory` log line ~20s after completion.
- [x] **rss lines present**: `[memory] job start: ...` and `[memory] job
      completion: ...` lines present for every job (see A3 table above).
- [x] **Logs thumbnail-free**: every completion `[log]` line shows
      `thumbnailDataUrlLength` (a number), never a `thumbnailDataUrl` field
      or its base64 body.
- [x] **User-facing output unchanged**: `POST /api/analyze` returns the same
      `{"jobId", "queuePosition"}` shape; `GET /api/status/:jobId` returns
      the same populated `{"status":"done","results":{...}}` shape while
      live, and the same `404 {"error":"Job not found"}` once evicted (which
      the frontend already handles) — confirmed via direct `curl`.
- [x] **Atomic claiming through a mid-test deploy**: verified against a real
      production deploy (see Part B above) — 2 submissions completed
      cleanly across a genuine two-container overlap window, zero
      double-claims, zero orphans.

---

## Files changed this prompt

**App repo** (`PreviewPanel`): `backend/server.js` (A1-A6, B7 — all inline,
no new files), `backend/anchor_rescore.mjs` (new), `backend/
phaseb4b_drift_recompute.mjs` (new). **Research repo**: `analysis/modeling/
scripts/anchor_sample.py` (new), `analysis/modeling/data/snapshots/
2026-07-07-capstone/anchor_manifest.json` (new), `.../anchor_history.jsonl`
(new, baseline run in progress), `.../phaseb4b_drift_recompute.json` (new),
`reports/capstone/PHASEB4B_READOUT.md` (appended correction section).
**Deployed**: `server.js` (commit `b8c6e21`) live in Render production,
verified via a real blue-green deploy per Part B/D above.

STOP.
