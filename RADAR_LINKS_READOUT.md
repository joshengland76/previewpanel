# Radar Rolling-Decile Normalization + Link-Input Readout

Supersedes the prior radar/links prompt (never run). App repo + one research-DB
read-only export.

## Part A — Axes as rolling deciles vs. the last 1,000 scored videos

### A1. Research-DB export → `corpus_axis_seed.json`

Pool universe confirmed identical to the one already backing
`corpus_reference_pool.json` (4,077 video_ids). Two-source stitch:

- **3,840 historical rows** — already had all 8 fields + `pegasus_model` +
  `posted_at` in the existing `phaseb3b_corpus_seed_rows.json` snapshot. No DB
  query needed for this slice.
- **237 cohort_5 additions** — queried live: judge dimension scores from
  `submissions` (joined via `file_name`-encoded `external_video_id`, since no
  FK links a `submissions` row back to `research_videos` directly — the app
  and research repo share one Postgres instance, confirmed by diffing both
  repos' `DATABASE_URL` byte-for-byte) and trending fields from
  `research_pp_runs_claude` (joined on `video_id`). **All 237 rows matched
  cleanly on both joins** — no partial/lossy stitching.

**Coverage** (4,077 rows total):

| Field | Non-null | Coverage |
|---|---|---|
| jc_compelling / jc_novel / jc_emotionally_resonant / jc_funny / objfit_consensus | 4,077 | 100% |
| jc_emotion_intensity | 4,071 | 99.85% |
| trending_alignment_signals / trending_topic_likelihood | 4,055 | 99.46% |
| pegasus_model | 4,077 | 100% |

Gaps (6 emotion_intensity, 22 trending_*) are pre-existing, from the
historical snapshot slice — not introduced by this export's own joins.

Export script committed to the research repo
(`analysis/modeling/scripts/export_corpus_axis_seed.mjs`, Node rather than
Python — the file_name-parsing join was already interactively prototyped and
verified in Node this session; porting working logic to Python would only
reintroduce bugs already caught here). Output (`corpus_axis_seed.json`) is
gitignored data in the research repo, copied into
`backend/scoring/corpus_axis_seed.json` in the app repo, where `axisPools.js`
actually consumes it at runtime — analogous to how `corpus_reference_pool.json`
already ships with the deployed backend.

### A2. `axisPools.js`

Mirrors `percentilePools.js` exactly: same row universe (corpus seed UNION
`shadow_scores`), same eligibility (`pool_eligible=true` — itself the
fingerprint-dedupe mechanism — `is_posted_video` excluded), same newest-first
windowing, same 10-minute cache/TTL, invalidated at the same trigger point
(`shadowScore.js`'s `recordShadowScore`, alongside the existing
`invalidatePoolCache()` call).

Two windows:

- **Judge-axis window** (Compelling/Novel/Emotionally Resonant/Emotion
  Intensity/Funny/Objective Fit): newest 1,000 rows **where
  `pegasus_model='pegasus1.5'`**. Rationale: `calibratedYhat()` in `scorer.js`
  can shift a pegasus1.2 row's *final scalar prediction* onto the 1.5 scale
  because that has one calibration curve — the 6 raw per-dimension judge
  scores that feed into it don't have an equivalent, and reconstructing one
  from scratch for a display-only decile ranking was out of scope. Restricting
  the window beats guessing at a conversion; it converges to all-1.5 on its
  own as live volume grows, no migration step needed later.
- **Trend-axis window** (Trend Alignment/Trending Topic): newest 1,000 rows,
  **no version filter** — the locked C_dims extractor prompt is version-stable
  by construction, no calibration concern.

**Today's actual n and version mix** (verified live, both before and after
Part A's deploy — identical both times, confirming reproducibility):

| Window | n | Version mix |
|---|---|---|
| Judge axes | 1,000 (full window) | 100% pegasus1.5 (by definition of the filter) |
| Trend axes | 1,000 (full window) | 652 pegasus1.5 / 348 pegasus1.2 (65% / 35%) |

### A3. Display-time mapping

`axis value → midrank percentile (fraction, 0–1) vs. its window → decile =
clamp(ceil(pct×10), 1, 10)`. One shared grid per axis, built from the
**averaged** jc_*/objfit_consensus values — both the bold panel-average
polygon *and* each individual judge's own raw dimension score map through
this **same** grid (not a separate curve per judge), so a stricter judge's raw
score visibly lands on a lower decile than a lenient judge's — persona
strictness stays legible (Josh's call, per the prompt).

Restored-history sessions (`/api/status` DB-fallback path) recompute
`axisDeciles` from the row's own stored `input_features` + the joined
`submissions` columns — identical computation to the live path. **History
entries lacking raw dims degrade to `null` per axis** (never a crash, never a
silently-wrong decile): the frontend's `judgeAxisValue`/`axisAvgValue` fall
back to the pre-decile raw-value display in that case — the same
graceful-degradation contract every other C_dims-derived field in this
codebase already follows.

### A4. Copy

- Top-of-card line replaced: ~~"Each judge across the factors our scoring
  model weighs, 0–10."~~ → **"On each axis, 5 = the median of the last 1,000
  videos we've scored."**
- Content-read legend marker: there was no actually-*rendered* marker
  occupying that slot to relocate — the "content read" distinction was
  already carried entirely by the axis label + tooltip text, never a separate
  visual chip. Nothing to relocate; noted rather than silently skipped.
- All 8 axis tooltips gained one comparative clause ("Shown here compared
  with recent videos we've scored.") inserted between the descriptive
  sentence and the existing correlational close, which is **byte-for-byte
  unchanged** in all 8 entries.
- Chip rows (`DetectedSignals.jsx`) untouched, as specified.

### A6. Live verification (production, sha `78e9f80`, re-confirmed post-deploy)

**Per-axis p10/p50/p90**, live window:

| Axis | n | p10 | p50 | p90 |
|---|---|---|---|---|
| Compelling | 1,000 | 2.67 | 6.33 | 7.67 |
| Novel | 1,000 | 2.00 | 4.67 | 6.67 |
| Emotionally Resonant | 1,000 | 3.00 | 5.00 | 6.67 |
| Emotion Intensity | 1,000 | 3.00 | 5.67 | 7.67 |
| Funny | 1,000 | 1.67 | 3.00 | 6.33 |
| Objective Fit | 999 | 2.33 | 7.67 | 8.33 |
| Trend Alignment | 581 | 2.00 | 3.00 | 4.00 |
| Trending Topic | 581 | 4.00 | 5.00 | 6.00 |

**Sample submission (7086), raw → decile, all 8 axes**:

| Axis | Raw | Avg decile | Critic | Trendsetter | Connector |
|---|---|---|---|---|---|
| Compelling | 6.33 | 5 | 8 | 8 | 3 |
| Novel | 4.67 | 5 | 6 | 6 | 4 |
| Emotionally Resonant | 6.00 | 8 | 8 | 8 | 8 |
| Emotion Intensity | 6.67 | 8 | 8 | 8 | 7 |
| Funny | 5.67 | 9 | 9 | 9 | 8 |
| Objective Fit | 8.00 | 7 | 7 | 7 | 7 |
| Trend Alignment | 3 | 7 | — | — | — |
| Trending Topic | 6 | 9 | — | — | — |

**The headline check passes**: a raw Trend Alignment of 3 — which on the old
flat 0–10 scale would have read as "weak" — lands at **decile 7**,
meaningfully above mid-scale, because the whole population clusters low
(p50=3.00 in this exact window). This is the distortion the whole feature
exists to fix.

- **Ghosts render sensibly**: Compelling shows Critic/Trendsetter=8 vs.
  Connector=3 — real, visible persona-strictness spread through the shared
  grid, not normalized away.
- **No all-axes-low/high systematic artifact**: deciles span 3–9 across the 8
  axes for this one submission, not clustered at either extreme.
- **No zero-vertex regression**: nothing decile-clips to 0 (floor is 1 by
  `clamp`); confirmed both by the unit tests (`axisPoolsTest.mjs`) and this
  live row.

Also verified via the dev harness (screenshots, reverted before commit): the
new top-of-card copy renders correctly; tapping "Connector" isolates a line
showing Compelling=3.0/Novel=4.0 vs. the avg's 5.0/5.0 — visible persona
strictness on a real render, not just in the raw numbers; a tapped tooltip
shows the new comparative clause with the correlational close intact.

## Part B — Paste-a-link submissions

### B0. Feasibility spike (from Render's own environment)

yt-dlp installed on the fly into the existing fingerprinting venv; 3 TikTok +
2 YouTube Shorts URLs (real public videos, pulled live via browser) probed
with `--dump-json --no-warnings --skip-download`:

| URL | Platform | Outcome |
|---|---|---|
| `@gracia_lombardo/video/7661422101701627167` | TikTok | ✅ success (18,052-byte metadata JSON) |
| `@mihabana2/video/7551765207962504462` | TikTok | ✅ success (23,044-byte metadata JSON) |
| `@florcam/video/7078484551680527621` | TikTok | ✅ success (19,550-byte metadata JSON) |
| `youtube.com/shorts/UE6J-XG6I4M` | YouTube Shorts | ❌ blocked — "Sign in to confirm you're not a bot" |
| `youtube.com/shorts/z8yTF5fXld0` | YouTube Shorts | ❌ blocked — same bot-detection wall |

**Gate result: TikTok succeeded 3/3 → Part B proceeds** (the prompt's stop
condition is keyed specifically on TikTok). YouTube's bot-detection is a
well-known limitation of running yt-dlp from a datacenter IP, not something
fixable inside this scope — Shorts links are still allowlisted per spec, but
will currently always degrade to the generic fetch-failure message.

The temporary spike endpoint (`POST /api/_debug/ytdlp-spike`) was removed in
a follow-up commit immediately after reading these results.

### B1. UI

Inside the existing dashed upload box: a secondary "or paste a video link"
line, positioned beneath the existing upload prompt, with `zIndex:1` so it
sits above the invisible full-cover file `<input>` (verified live — clicking
it does **not** open the file picker, confirmed via browser automation).
Tapping it swaps the box to a plain `<div>` (deliberately **not** the
`<label>`/hidden-file-input pairing the file-picker mode uses) containing a
URL input + Go button, so typing or clicking there can never accidentally
trigger the file dialog. "← Upload a file instead" reverts. No new fields
elsewhere on the screen — `platform`/`objective`/`judges`/`userId` are all
read from the same state the file-upload path already uses.

### B2. Backend

`POST /api/fetch-video`:
- Allowlists `tiktok.com` / `youtube.com` (incl. Shorts) / `youtu.be` by
  hostname; Instagram gets its own explicit message, checked *before* the
  generic allowlist rejection.
- Probes yt-dlp's own metadata (`--dump-json --skip-download`) **first** —
  duration lives in this JSON, so a video over 5 minutes is rejected before
  any download starts.
- Downloads under the **same** `acquireFfmpegSlot()`/`releaseFfmpegSlot()`
  semaphore conversions and trims already share (max 2 concurrent).
- Hands off into the **exact** existing `preprocessUploadedVideo(jobId,
  filePath)` → `enqueueJob(jobId, () => runPipeline(...))` sequence a file
  upload uses — from that point on, a link-fetch submission is
  indistinguishable from an upload to the rest of the pipeline.
- Provenance: `source='link_fetch'` on the `shadow_scores` row
  (`recordShadowScore`'s source ternary extended alongside the existing
  `"validation"`/`"app"` cases).
- Per-user (or per-IP, if no `userId`) rate cap: 10 fetches/hour, in-memory.
- yt-dlp added to `validation/requirements.txt` as a **build-time**
  dependency (Render's existing `buildCommand` already `pip install`s from
  this file) — not the throwaway runtime install the B0 spike used.

**Bug found and fixed during B3** (see below): the initial implementation
invoked yt-dlp as a bare `spawn("yt-dlp", ...)` command. pip installs the
console-script entry point into the venv's own `bin/`, which isn't on `PATH`
the way `PYTHON_BIN`'s fully-qualified path is — every real request failed
silently into the generic fetch-error message. Fixed to `spawn(PYTHON_BIN,
["-m", "yt_dlp", ...])`, matching the B0 spike's already-verified-working
invocation exactly. Deployed as `cdaa530`; re-verified working immediately after.

### B3. Live verification (production, sha `cdaa530`)

**(a) TikTok link end-to-end** — `POST /api/fetch-video` with a real TikTok
URL → `jobId` returned → polled to `status: "done"` in ~40s → all 3 judges
completed (Editor/Trendsetter/Connector all scored 7) → video duration 44.65s
(confirms a real file was fetched and processed, not a stub). DB confirmed
directly:

```
shadow_scores.id=553, submission_id=7087, source='link_fetch',
platform='tiktok', user_id='radar_links_b3_verify',
submissions.file_name='tiktok_link_fetch.mp4'
```

**(b) Instagram URL** — returned exactly: *"Instagram blocks apps from
fetching videos by link — save the video to your device and upload the file
instead."*

**(c) >5-minute rejection** — found a real 60-minute TikTok video live
(`@oddlysatisfyingsoap1`) and submitted its URL. Response came back in
well under a second (impossible for a 60-minute download to have completed
in that time, confirming this is the **pre-download** metadata check, not a
post-download one): *"Video is 60:00 long. PreviewPanel currently supports
videos up to 5:00. Please link a shorter video."*

**(d) YouTube Shorts** — not re-tested in B3 (already characterized in B0 as
a consistent, deterministic bot-detection block, not a flake); noted here and
in the Ops doc as a known, current limitation rather than silently
unmentioned.

### B4. Ops doc

One-line addition to §1a (research repo, commit `1c2d8ef`) describing the
link-fetch path, its allowlist/duration-check/provenance behavior, and the
confirmed live TikTok-works/Shorts-blocked split.

## Files changed

**App repo**: `backend/scoring/axisPools.js` (new), `axisPoolsTest.mjs`
(new), `corpus_axis_seed.json` (new, data), `backend/scoring/shadowScore.js`,
`backend/server.js` (axis-decile computation + `/api/fetch-video` +
source-tag extension), `frontend/src/components/PerformanceRadar.jsx`,
`frontend/src/PreviewPanel.jsx`, `validation/requirements.txt`.

**Research repo**: `analysis/modeling/scripts/export_corpus_axis_seed.mjs`
(new), `PreviewPanel_Operations_and_Roadmap.md` (two ticks).

## Verification summary

- `node scoring/scoreDisplayTest.mjs`, `percentilePoolsTest.mjs`,
  `axisPoolsTest.mjs`: all PASS, every commit in this sequence.
- `node --check` clean on every touched backend file, every commit.
- `npx vite build`: clean, every commit.
- Dev-harness visual checks (screenshots, reverted before each commit): new
  top-of-card copy, persona-strictness ghost lines, tooltip comparative
  clause, click-through on the paste-a-link affordance.
- Live production verification: A6's full decile table + real-submission
  walkthrough; B3's TikTok/Instagram/>5min cases, each against real data, not
  synthetic fixtures.

## STOP

Per the prompt's explicit instruction — no further work started after this
readout.
