# Phase C, Prompt 1 — Platform Audit + Validation Pipeline Readout

**Status: ALL TASKS COMPLETE (0a–0d, 1–7).** Framing gate PASSED on both
arms — the single tiktok-framing selector stays as-is, percentile pools
remain unified across platforms. The full posted-video validation pipeline
(preview fingerprinting → Mac-side discovery/matching → validation ingestion
→ pool exclusion) is built, verified end-to-end with a real Tier-1 match,
and the fingerprint-matching thresholds are stress-tested at ~130x the
spike's original sample size with zero misclassifications.

**Hard constraints honored**: the TwelveLabs keep-warm/warm-up path was not
touched. The research repo and research DB tables were never written to —
`validation/worker.py` and `validation/selection_report.py` read only the
app's own tables (`users`, `posted_videos`, `preview_fingerprints`,
`submissions`, `shadow_scores`) via the app's `DATABASE_URL`, with no
research-repo imports.

---

## Task 0a — platform audit

Rendered `buildTLPrompt` for all 3 platform codes at `judges-v2.1`. Findings:

- **No literal "reels"/"shorts" platform values exist anywhere in the
  codebase.** The internal codes are `tiktok`, `instagram` (= Reels), and
  `youtube` (= Shorts) — both frontend (`PLATFORMS` array, labels "TikTok" /
  "Reels" / "Shorts") and backend (`PLATFORM_FOCUS`, dimension-def branches)
  use this mapping consistently. This prompt's own "T/R/S" arm naming in
  Task 0c mirrors it.
- Optimal-length lines: confirmed absent from all three rendered prompts.
- Platform-specific dimension defs, framing ("pay special attention to"),
  and `platformFit` metric references: present and correctly isolated per
  platform (diffs are clean, touching only 4 regions each time).
- `OVERALL WEIGHTING` is deliberately **not** platform-specific (byte-identical
  across all three) — a durable decision from 4b, not a gap.
- Bonus: the `cool` judge's hashtag block is correctly platform-gated too
  (present for tiktok/instagram, absent for youtube).

## Task 0b — platform column + backfill

Added `platform TEXT` to `shadow_scores`, backfilled from `submissions` via a
one-time (idempotent, NULL-only) `UPDATE`. `percentilePools.js` and the
`fetchShadowRows`/`fetchPersonalPredictions` queries now carry `platform`
through — plumbing only, no filtering, pending 0c's verdict. Corpus seed
rows are tagged `platform: "tiktok"` (the corpus is the TikTok engagement
study population). Verified: migration applied cleanly, all 32 pre-existing
`shadow_scores` rows backfilled to `platform='tiktok'`.

## Task 0c — FRAMING GATE: **PASS**

Pre-registered in `CAPSTONE_PREREG_v2.md` amendment 34 *before* any
framing-gate judge call ran. 30 videos (fresh sample, `phasec1_framing_sample.py`,
SEED=5820), 3 arms same session (T=tiktok, R=instagram, S=youtube framing,
`judges-v2.1` prompt held fixed throughout), reusing 4b's hardened harness.
30/30 succeeded, zero unrecovered failures.

| Arm | mean(ŷ_arm − ŷ_T) | 95% CI | Spearman(arm, T) | Result |
|---|---|---|---|---|
| R (instagram/Reels) | −0.00211 | [−0.01335, +0.00913] | 0.984 | **PASS** |
| S (youtube/Shorts) | +0.00365 | [−0.00590, +0.01319] | 0.981 | **PASS** |

Both arms clear the bar (required Spearman ≥ 0.965, 4b's noise floor − 0.02)
with wide margin. **Result logged as amendment 35: selector stays, pools
stay unified across all platforms** — the `platform` column added in 0b
remains plumbing-only. Real cost: ~$6 (270 judge calls: 30 videos × 3 arms
× 3 judges), as budgeted.

## Task 0d — copy + durable decision

One modest, conditional line added to the score-card tooltip
(`poolInfoTooltip` is now a function of `platform`) and the methodology
modal, shown only when `platform !== "tiktok"`: *"This score is based on our
TikTok engagement study — treat it as a strong proxy for other short-form
platforms."* No disclaimer wall. Logged in `PROJECT_PLAN_v14.md` §6: one
model serves all platforms; platform-specific models are an explicit
**post-validation** revisit, not a near-term item.

---

## Task 1 — identity-lite (multi-platform handles)

- Client: persistent UUID (`crypto.randomUUID()`, `localStorage` key
  `pp_user_id`), sent with every `/api/analyze` submission.
- Server: `users(user_id PK, tiktok_handle, instagram_handle, youtube_handle,
  connected_at, verified, bio_code)`; `submissions.user_id` added.
  `POST /api/user/connect` normalizes handles (strip `@`, lowercase;
  YouTube additionally accepts a full channel URL and extracts the trailing
  path segment — Instagram/TikTok do NOT get URL-parsing, per the prompt's
  literal wording, a known scope boundary worth flagging if it turns out
  users commonly paste profile URLs there too). TikTok is enforced
  server-side as required (400 if missing); bio-code generated once per user
  and returned every time, verification check itself is a dormant stub.
- `AccountSettingsTrigger`/`AccountSettingsModal` (new frontend component)
  wired in next to the History button.
- Personal percentile switched from the empty stub to a real
  `user_id`-scoped query. **Verified against the real wired query path**
  (not just the pre-existing mocked unit test): inserted rows to cross both
  B3 thresholds — n=4 → `personal: null`; n=5 → `{type:"ordinal", rank:4,
  total:5}`; n=20 → `{type:"percentile", value:13}`. All three transitions
  correct.
- Validation scanning this phase is TikTok-only, as specified; IG/YT handles
  are stored (confirmed via a real connect+fetch round-trip) with no
  scanning code for them.

**Finding surfaced during this task's testing (not fixed here, see Part B7
note below)**: production's live poller was found to claim and half-process
a job created by a local dev server sharing the same database — see the
B7 fix under Task 4.

## Task 2 — preview fingerprinting

`validation/fingerprint.py` implements the spike spec exactly (pHash on
1fps frames, 10% border crop; chromaprint via `fpcalc -raw`; duration via
`ffmpeg -i` stderr parsing, matching `server.js`'s own probe pattern). Invoked
via `spawn` (never `exec`) on the converted mp4, fire-and-forget but
structured so the delete of that file is deferred into the same async chain
— fingerprinting always gets to read it first, with **zero added delay** to
the analyze pipeline's own critical path (verified with real timing: task
creation logged complete at 892ms while fingerprinting, running
concurrently, took 2891ms). Stored in `preview_fingerprints(submission_id,
user_id, platform, fp_json JSONB, created_at)`; `submission_id` starts NULL
(unknown at upload time) and is backfilled once the submission completes.
Scoped to real end-user previews only (`job.source` undefined) — never runs
for research-API or validation-ingestion traffic. `render.yaml`'s
`buildCommand` extended: `python3`, `python3-venv`, `chromaprint` via apt;
`imagehash`/`pillow` into a dedicated venv (`/opt/pp_venv`, sidesteps
Debian's PEP 668 restriction on bare `pip install`); `PYTHON_BIN` env var
points at that venv's interpreter. Full round-trip verified live (including
`submission_id` backfill).

## Task 3 — posted_videos + validation ingestion

`posted_videos` table (exact schema per spec) with a
`discovered → downloaded → scored → (matched) → day30_pending → day30_collected`
status chain (`failed` at any point). New `POST /api/validation/ingest`
(reuses `requireResearchAuth`) runs the exact same synchronous
enqueueJob/runPipeline/waitForJobCompletion pattern as
`/api/research/submit-eval`, forced to `platform="tiktok"`, objective
borrowed from the matched preview's submission (`null` for an unmatched/
Tier-3 video — handled gracefully, same as everywhere else). `job.source =
"validation"` routes around the `submissions` table write entirely (the
scoring result lives on `posted_videos` directly) and around the
score-display computation (no display payload, nothing polls this job).
`shadow_scores` gained `source`, `is_posted_video`, `posted_video_id`;
niche/overall pool and personal-history queries both gained an
`is_posted_video IS NOT TRUE` filter. New dedicated test
(`scoring/postedVideoExclusionTest.mjs`, DB-backed — unlike this directory's
other pure-function tests, exclusion is fundamentally a SQL WHERE-clause
concern) confirms both queries correctly exclude a tagged row. Full
round-trip verified live: `posted_videos` reached `status='scored'`
(unmatched case) with `y_pred`/`avg_score`/`prompt_version`/`pegasus_model`
populated, zero `submissions` rows written.

**Fix made along the way**: `runShadowScoringForJob`'s shadow-scoring call
was fire-and-forget from `recordSubmissionForJob` (correct for the normal
app path — must never delay the user-facing response). The validation
endpoint's whole purpose is reporting the final score, so its promise is now
stashed on `job.shadowScoringPromise` and specifically awaited by
`/api/validation/ingest` before responding — every other caller's
fire-and-forget behavior is unchanged. Also: `runShadowScoringForJob` no
longer gates on `SHADOW_SCORING="true"` for `job.source==="validation"` —
that flag is a rollout switch for the *optional* app-side shadow A/B; for
validation ingestion, running this path is the entire point, not an
opt-in.

## Task 4 — Mac-side validation worker

`validation/worker.py`: for each connected `tiktok_handle`, lists recent
posts via a minimal yt-dlp reimplementation (flat-playlist, carousel
detection via missing/zero duration — no research-repo import), inserts new
`tiktok_video_id`s as `discovered`, downloads, fingerprints with the same
vendored module, matches against that user's `preview_fingerprints` from the
trailing 30 days (best match = lowest tier, then highest overlap), POSTs
into `/api/validation/ingest`. Tier logic (added to `fingerprint.py`
alongside the extraction functions, since Task 5's stress test needs the
identical matching code): **Tier 1** overlap > 0.90; **Tier 2** overlap ≥
0.15 OR (audio match AND duration agrees within 2s); **Tier 3** otherwise —
audio-only agreement with a duration mismatch lands Tier 3 with a
`possibly_related` flag rather than solo-qualifying (the spike's amendment,
verified against 5 hand-checked cases before any live test). Rate-limited
(default 10 videos/run, 3s politeness delay between profile scans), never
accumulates downloaded files on disk, idempotent via `tiktok_video_id`
UNIQUE. `--file` override mode built and used for both this task's smoke
test and Task 7's full verification.

**Real bug found and fixed while testing this task** (not asked for by the
prompt, but directly blocking reliable local verification — and a live risk
given this project's dev/prod DB-sharing convention):

> B7's atomic task-claiming (prior hardening prompt) deliberately removed
> ALL role-based scoping from the claim query, since `created_by_instance`
> couldn't distinguish two blue-green containers sharing
> `INSTANCE_ID=production`. True — but it also meant **production's live
> poller was free to claim rows created by a local dev server** (this
> project's normal setup: local dev and research scripts share the same
> `DATABASE_URL` as production). Production would claim, score, and mark the
> row `ready`, but since it has no matching entry in *its own* in-memory
> `jobs` map, the job could never actually finish: it just sits orphaned at
> `status='ready'` forever, and the local job hangs in `"analyzing"`
> indefinitely — hit twice live during this session's testing, once
> wasting a full `waitForJobCompletion` cycle. **Fix**: re-added
> `created_by_instance` as an *additional* `AND`-filter in the atomic claim
> query, alongside (not replacing) the self-renewing `SELF_RUN_ID` lease.
> Verified directly against the real DB: two "production" containers still
> correctly arbitrate via the lease (no double-claim); a "dev" container
> and a "production" container now never touch each other's rows. Confirmed
> live afterward — the re-tested worker.py job was correctly claimed by
> `dev-...`, not `production-...`.

## Task 5 — threshold stress test

**Part A** (frame-overlap all-pairs, 110 fresh corpus videos, disjoint from
the original spike's 10): **5,995 cross-pairs, 100% landed Tier 3** (zero
false Tier 1/2). Max false overlap **0.028** (vs. the spike's 0.098 at
n=10/45 pairs) — margin to the 0.15 floor is **0.122**, *wider* than the
spike's 0.052, not thinner. **No floor adjustment proposed** — the larger,
more representative sample shows more headroom, not less.

**Part B** (spike's synthetic variant suite regenerated on 20 fresh videos,
disjoint from Part A and the spike, 2 videos per transform type):
**20/20 matched their expected tier exactly.**

| Actual category | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| same-cut/re-encode/trim/overlay (18) | 18 | 0 | 0 |
| same-footage-cropped (2) | 0 | 2 | 0 |

Zero misclassifications across both parts, at ~130x the spike's original
pairwise scale.

## Task 6 — selection-bias instrumentation

`validation/selection_report.py`: per-user preview count, posted-matched
count, mean/median predicted score (ŷ) of posted vs. unposted previews, and
an overall attenuation summary flagging the direction (posted-higher =
selection bias signal). Runs against the live tables now — confirmed
graceful on the current genuinely-empty state (prints an explicit
"no data yet" message, never crashes or shows misleading zeros). Smoke-tested
with synthetic data (3 previews, 1 posted at a higher score) to confirm the
math and reporting are correct: correctly computed `delta=+0.225` and
surfaced the selection-bias interpretation.

## Task 7 — end-to-end verification: **all checks passed**

Connected a test identity (`tiktokHandle`, `instagramHandle`,
`youtubeHandle` — all three confirmed stored and normalized correctly).
Submitted one real preview (`objective=Travel`) — `preview_fingerprints` row
landed with `submission_id` backfilled after completion. Re-encoded the same
source file (different bitrate/preset, matching the spike's "re-encode"
transform) and fed it to `worker.py --file` under the same identity:

- **Tier 1 match** found (`overlap=1.000`, `audio_match=true`) against the
  original preview's fingerprint, exactly as expected for a re-encode.
- Full scoring ran (`prompt_version=judges-v1.0` in this local test — the
  code correctly tracks whatever prompt is live via `JUDGE_PROMPT_VERSION`,
  same as everywhere else; production would show `judges-v2.1`).
  `posted_videos` reached `status='matched'`, `matched_submission_id` set to
  the real preview's id, `y_pred`/`avg_score` populated.
- `shadow_scores` gained exactly 2 rows for this identity: the original
  preview (`source='app'`, `is_posted_video=false`) and the posted-video
  rescore (`source='validation'`, `is_posted_video=true`,
  `posted_video_id` correctly linked).
- **Pools unchanged**: a live re-query of the exact WHERE clause used by
  `fetchShadowRows`, restricted to these 2 rows, returned only the preview
  row — the posted-video row was correctly excluded.
- **Personal percentile unaffected**: `personal: null` both before and
  after (only 1 preview, below the n=5 floor) — and, per Task 3's dedicated
  exclusion test, the personal query uses the identical `is_posted_video`
  filter.

**Observed cost**: this one posted-video ingestion (3 TL judge calls + 1
C_dims Anthropic call, `cost=$0.0293` logged) lands at roughly **$0.10**,
matching the prompt's own estimate.

---

## Schema diffs (full list)

**New tables**: `users` (user_id PK, 3 handle columns, connected_at,
verified, bio_code), `preview_fingerprints` (submission_id, user_id,
platform, fp_json JSONB, created_at), `posted_videos` (full status-chain
schema per spec, including day30_* columns reserved for Phase C2).

**Altered tables**: `submissions` gained `user_id`. `shadow_scores` gained
`platform`, `source`, `is_posted_video`, `posted_video_id` (in addition to
the pre-existing `objective`/`user_id` from Phase B3).

**Config**: `render.yaml` build command extended for Python/pip/chromaprint;
new `PYTHON_BIN` env var.

## Files changed this prompt

**App repo**: `backend/server.js` (Task 0b/1/2/3, plus the B7 claim-scoping
fix), `backend/scoring/{shadowScore,scoreDisplay,scoreDisplayCopy,percentilePools}.js`,
`backend/scoring/postedVideoExclusionTest.mjs` (new), `backend/phasec1_framing_{gate,analyze}.mjs`
(new), `frontend/src/PreviewPanel.jsx`, `frontend/src/components/{VerdictHero,MethodologyModal}.jsx`,
`frontend/src/components/AccountSettings.jsx` (new), `render.yaml`.
**New `validation/` directory**: `fingerprint.py`, `worker.py`,
`selection_report.py`, `threshold_stress_test.py`, `requirements.txt`.
**Research repo**: `analysis/modeling/scripts/phasec1_framing_sample.py`
(new), `CAPSTONE_PREREG_v2.md` (amendments 34, 35), `PROJECT_PLAN_v14.md` §6.
**Not yet deployed**: none of this prompt's code is live in Render — all
verification was local + the framing gate (which used live TL API calls but
no code deploy).

STOP. Phase C2 (day-30 outcome collection + within-user Spearman dashboard)
is next.
