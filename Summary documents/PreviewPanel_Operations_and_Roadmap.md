# PreviewPanel — Operations & Roadmap

**Date:** 2026-07-10 · **Supersedes:** PROJECT_PLAN_v14.md (the PROJECT_PLAN lineage continues under this stable filename; git history + the dated header carry revisions)
**Status:** Correlation research **complete** (capstone model v2, lockbox-
confirmed). **Model v2 is live in the app** — scoring, percentiles, tiers,
methodology page all shipped. Judge prompt **judges-v2.1** live (gated cutover).
App hardened (memory, atomic task claiming). **Phase C real-user validation
machinery COMPLETE** — C2 (day-30 collector + dashboard) shipped and verified
end-to-end (real 32-day-old public video run through the full chain;
`PHASEC2_READOUT.md`).
**Current action: invite the test-user batch** — every subsystem from here is
idle until real creators feed it.
**Scope split:** this document = how the system works and runs (living). The
science — study design, evidence, model spec, calibration — lives in
`PreviewPanel_Scoring_Model_Report.md` (change only when evidence changes).

> **Source-of-truth guardrails (if a fresh session's memory conflicts, trust
> this doc + the Scoring Model Report):** The scoring model is capstone v2 — global
> additive ElasticNet, creator-level partition, **duration_secs is an ACTIVE
> input** (the one revived mechanical column; the rest of those blocks stay
> cut). TwelveLabs stays in the model (3 inconclusive removal tests; inputs are
> free since judges run for the product anyway). The **judge prompt's scored
> fields are a frozen model-input contract** — prose may evolve only through
> the dual-run gate. **Never compare new numbers to the stale +0.247** (round-1
> corpus/partition). The Anthropic API is an **independent feature source, not
> a fallback**. Creator statuses are active / inactive / **enrolled** (§3c).
> **Never touch the keep-warm path** (§1b). Tier convention for all future
> cohorts: **small 1K–50K / mid 50K–500K / large >500K**.

---

## 1. The product — how PreviewPanel works today

PWA for short-form creators: upload a video pre-post → judge feedback + a
performance score. Frontend Vercel (`~/previewpanel/frontend`), backend Render
2GB/1CPU (`~/previewpanel/backend`, single instance), Neon Postgres. GitHub
`joshengland76/previewpanel` (private).

### 1a. The submission pipeline (per video)

1. **Upload + convert** — ffmpeg (spawn-only), stream-copy when codecs allow;
   converted mp4 retained 30 min for trims/fingerprinting.
2. **TwelveLabs Pegasus 1.5 judges** — Editor / Trendsetter / Connector,
   prompt `judges-v2.1` (stamped per row as `prompt_version`); async tasks in
   `analyze_tasks`, claimed by the poller (§1c).
3. **C_dims Claude extraction** — locked v1 prompt, 4 frames, own key
   (`CDIMS_ANTHROPIC_API_KEY`), ~$0.028/video, flag `EXTRACT_CDIMS`.
4. **Node scorer** — pure function over `scoring_spec_v2.json` (parity vs the
   research pkl proven by 421 golden vectors at ~1e-16); duration clamped to
   [5, 273.2]s in feature assembly (`CLAMP_DURATION`, default on).
5. **Shadow row** — every submission writes `shadow_scores` (all 116 features
   JSON, prediction, calibrated percentile, tier, prompt_version,
   pegasus_model, platform, user_id, source flags).
6. **Score display** — pool-based percentiles (§1d) gated by tiers v2.1:
   16 PREDICT objectives get full display; 3 ABSTAIN (Dancing, Gaming,
   Educational) get qualitative feedback, percentiles suppressed, one honest
   line. Copy rules baked into `scoreDisplayCopy.js`: baseline-relative framing
   only; **no causal duration advice anywhere**; neutral trim note.
7. **Synthesis layer** — separate Claude call (`SYNTHESIS_ANTHROPIC_API_KEY`,
   prompt synthesis-v2.4), app-path only, fire-and-forget.
8. **Extras** — spider chart axes = the model-weighted dimensions; "How this
   score works" modal + static `/methodology` one-pager; server-side trim
   feature (background job, 1080p cap, niceness 19, own queue); **preview
   fingerprinting** (pHash 1fps border-cropped + chromaprint + duration via
   vendored `validation/fingerprint.py`) before the converted file is deleted.
9. **Platform selector** (TikTok / Reels=`instagram` / Shorts=`youtube`) —
   conditions judge-prompt framing only; a pre-registered framing gate proved
   it doesn't move model inputs, so one model + unified pools serve all
   platforms, with a TikTok-validated/strong-proxy copy line on non-TikTok.

### 1b. Keep-warm — DO NOT TOUCH

Two in-process timers in `server.js` (on Render, not the Mac): a ~14-min
TwelveLabs warm-up ping (tiny black video via uploadAssetDirect+analyzeAsync —
without it, cold-start TL responses take ~10 min) and a Render self-ping to
`/health`. Logs: `[warmup] TwelveLabs warm-up ping sent` / `[keep-warm] ping
ok`. Hard-won via extensive diagnosis; the disk sweep explicitly excludes
`warmup.mp4`. Any prompt touching the backend carries a do-not-touch
constraint on this path.

### 1c. Hardening + reliability (all live)

- **Jobs-map eviction:** completed/errored jobs leave memory 30 min after
  terminal state (the June-30 OOM ratchet fix); status endpoint 404s
  gracefully afterward.
- **Log diet:** structured logs to stdout, 8KB line cap, thumbnail *length*
  logged never the base64 body.
- **Memory telemetry:** rss/heapUsed at job start/completion + every 20th
  poller heartbeat — the next anomaly self-diagnoses from logs.
- **ffmpeg:** spawn-only, one global semaphore (max 2) across conversions and
  trims; boot-time disk sweep of `uploads/` >60 min (warmup.mp4 excluded).
- **Atomic task claiming:** `claimed_by`/`claimed_at` lease with per-process
  `SELF_RUN_ID`, `FOR UPDATE SKIP LOCKED`, self-renewal, 10-min stale
  reclamation, **AND role scoping** (`created_by_instance`) so prod and local
  dev sharing the DB never claim each other's rows — verified against a real
  blue-green deploy (two live prod containers, zero double-claims).
- **Deploy notes:** Render env-var changes do **not** auto-redeploy — trigger
  one manually. Blue-green overlap (~15–30s of two containers) is normal and
  now safe. **`render.yaml` is documentation-only** — the live service was
  never created as a Render Blueprint, so it's dashboard/API-configured;
  editing the file alone changes nothing real. Apply build/start-command or
  env-var changes via the Render dashboard or API (`PATCH
  /v1/services/{id}`, `PUT /v1/services/{id}/env-vars/{key}`), and update
  `render.yaml` alongside as the historical record, not the other way
  around.
- **Drift instrument:** 30-video **anchor set** rescored through the full live
  path monthly (~$2; `anchor_rescore.mjs` → `anchor_history.jsonl`); alert at
  |median Δŷ| > 0.02 or rank corr < 0.95. Next run ~Aug 9.
- **Flags:** `EXTRACT_CDIMS`, `SHADOW_SCORING`, `DISPLAY_SCORE`,
  `FINGERPRINT_PREVIEWS`, `JUDGES_V21`, `CLAMP_DURATION` (all true in prod),
  `PYTHON_BIN` (fingerprint venv), `INSTANCE_ID=production`.

### 1d. Percentile pools (how the displayed score works)

Pools = frozen **corpus seed** (3,840 small+mid floor-5 study videos,
creator-level objectives, version-calibrated predictions) UNION live
`shadow_scores`, newest-first, windowed: **last 100 same-objective** (headline)
and **last 1,000 overall**; integer midrank, self-excluded. **Personal**
percentile at ≥5 previews (ordinal display under 20). Live submissions
naturally displace corpus rows — the seed retires itself, which also dissolves
the Pegasus-version calibration question over time. Posted-video validation
rescores are **excluded** from all pools. `calibrated_percentile` on shadow
rows is an internal frozen-reference drift field, not the display path.

**Pool eligibility** (`shadow_scores.pool_eligible`, default true; both
windows filter on it): one-time backfill set `pool_eligible=false` for every
row scored before **2026-07-12T00:22:39.032Z** (the whole dev/test period
predating real testers — see `POOL_CONSISTENCY_READOUT.md`), a fixed,
hardcoded cutoff safe to re-run on every boot. Going forward, it also
implements **fingerprint-group dedupe**: at shadow-scoring time, a submission
is matched (Tier-1 fingerprint overlap) against the same user's own previews
from the trailing 30 days; if matched, only the group's *first* row stays
pool_eligible — every repeat run of a video the user already scored is
excluded, so testing/re-running a video doesn't inflate or skew the pools.
Matched groups share `fp_group_key`; `group_k`/`group_mean_prediction` record
the group's size and averaged ŷ as of each row's own insert. The *displayed*
prediction/percentiles for a group (k≥2) use the group mean, not any single
run's raw ŷ — the score card shows "Average of k analyses of this video."
when that applies. Raw per-run `prediction` is always stored unchanged.

**Personal pool = distinct videos, not runs**: the ≥5 activation floor and
the ordinal "rank X of N" count distinct fingerprint groups (a repeat run
counts once, at its group mean), never raw runs — deliberately *not*
filtered on `pool_eligible` (that flag is cross-user pool hygiene; a user's
own history dedupes by video identity via the fingerprint group instead).
See `PERSONAL_DEDUP_READOUT.md`.

### 1e. Real-user validation subsystem (Phase C)

- **Identity-lite:** persistent client UUID; `users` table with TikTok
  (required to participate) + Instagram/YouTube handles (stored for future);
  bio-code verification stubbed dormant.
- **Tables:** `preview_fingerprints`; `posted_videos` (status chain
  discovered → downloaded → scored → matched → day30_pending →
  day30_collected / failed).
- **Mac-side worker** (`validation/worker.py`): scans connected handles'
  public posts (yt-dlp), downloads, fingerprints, matches vs that user's
  trailing-30-day previews (Tier 1 >0.90 overlap; Tier 2 0.15–0.90 or
  audio+duration≤2s — audio never solo-qualifies), POSTs into
  `/api/validation/ingest` → full live scoring (~$0.10/video), shadow row
  flagged `is_posted_video`. **Every scored posted video validates the model;
  match tiers serve attribution questions only.**
- **Day-30 collector** (`validation/collect_day30.py`, C2): window day 30–37,
  retry cap 3, deletion recorded as an outcome, WEC_rate computed per study
  formula.
- **Dashboard** (`validation/dashboard.py`, C2): funnel; per-user
  Spearman(posted ŷ, WEC_rate) at ≥5 collected; pooled + bootstrap CI;
  selection-bias report (posted-vs-unposted preview ŷ — expect attenuation).
- **Cadence:** manual daily `worker.py` then `collect_day30.py` (~2 min);
  LaunchAgent deferred until the test batch is live.

## 2. The research asset (summary — details in the Scoring Model Report)

Corpus 5,109 day-30 videos / 259 creators / 19 objectives; small+mid floor-5
modeling population 3,840 / 199; large tier held out. Headline: **lockbox
generalization ≈ +0.25 within-creator Spearman; top-decile precision ~2/3;
tiers v2.1 = 16 PREDICT / 3 ABSTAIN**. Duration is the one revived mechanical
input (+0.02 lift; +0.205 standalone). Everything method-level — partition,
lockbox, drift handling, prompt governance, platform gate, validation design —
is in the Scoring Model Report.

## 3. Research pipeline operations (restored reference)

### 3a. Repos, paths, environment

- Research repo: `~/correlation-research` (GitHub
  `joshengland76/previewpanel-research`, private). App repo: `~/previewpanel`.
  Neither lives under `~/Desktop` (macOS TCC sandbox lesson).
- All research scripts are PROJECT_ROOT-relative; `.env` holds only
  credentials/URLs. Python 3.14 venv; `anthropic` SDK pinned <0.70;
  `requirements.txt` committed. `exports/` is gitignored.
- Key env names: `DATABASE_URL` (Neon; note: shell `source .env` does not
  export it — extract via
  `psql "$(grep -m1 -oE "postgres(ql)?://[^'\"[:space:]]+" .env)"`),
  TwelveLabs key, research-path Anthropic key (Stage-D extractor —
  independent daily source), plus the app-side keys in Render.

### 3b. The morning chain (active-creator collection)

LaunchAgent **`local.correlationresearch.morning`** fires 5:00 AM, running
`run_morning.py`:

| Step | Script | Function |
|---|---|---|
| 0 | follower_snapshot.py | Follower counts for active creators → history table |
| 1 | creator_monitor.py | Discover/download new videos from **active** creators (yt-dlp) |
| 2 | nightly_chain.py | Neon→SQLite creator sync → parser (ffmpeg + Claude Stage-D) → export → staged-upsert import to Neon → follower backfill |
| 3 | submit_to_pp.py | Submit unsubmitted videos to the app's research API (TL judges) |
| 4 | day30_metrics.py | Capture day-30 engagement for videos crossing the window |

**Daily commands:**
```
cd ~/correlation-research && source venv/bin/activate && python pipeline_status.py
python run_morning.py            # manual full run (--skip-snapshot, --skip-monitor)
```
Manual runs always work regardless of LaunchAgent state (shell trust ≠ launchd
trust) — the standing fallback if 5 AM didn't fire; `pipeline_status.py` is the
detection glance. LaunchAgent lesson: post-reboot EX_CONFIG(78) failures are
keyed to the *label's* BTM identity — a fresh never-seen label fixes it;
rebootstrapping the old one doesn't.

**Reliability patterns:** Neon autosuspends — `ensure_connection(conn)`
(reassign!) before any write that follows slow network work
(creator_monitor / submit_to_pp / day30_metrics), or scrape-then-write
(follower_snapshot); nightly_chain is exempt (short-lived children +
retry_db_connect). Day-30 fetch: retry cap 3 + 7-day recapture window
(migration 008). **5 AM contention rule:** never run on-demand scoring batches
across the morning run (single backend instance).

### 3c. Creator status model + commands

- **active** — in the daily sweep (steps 0–1 read the active list from Neon).
- **inactive** — capped/retired. The cap is **manual**, judged on **scored
  (≥2-judge) count, not collected count**.
- **enrolled** — cohorts 3+ convention: outside the daily sweep entirely;
  back-catalog collected **once** (30–90-day-old window, **20-video cap**,
  day-30-equivalent interval label via `backcatalog_recapture.py`-style
  collection). Non-backfill policy for cohort_1/2 pre-enrollment catalogs.

Neon is the source of truth; `sync_creators.py` overwrites SQLite each night:
```
psql "$(grep -m1 -oE "postgres(ql)?://[^'\"[:space:]]+" .env)" \
  -c "UPDATE research_creators SET status='inactive' WHERE handle='HANDLE';"
# reactivate: status='active' ; multiple: WHERE handle IN ('A','B','C')
```

### 3d. Cost constants

TwelveLabs $0.0262/min (billing-verified May 2026; reconcile annually) ·
C_dims $0.028/video · posted-video validation rescore ~$0.10 · anchor run ~$2
· back-catalog collection ~$0.05/video all-in.

## 4. Roadmap — phases

- **Phase A — research close-out: COMPLETE.** Residuals: ~Sept 60-day drift
  retest (calendared); this doc records the tier convention decision.
- **Phase B — integration: COMPLETE.** Shipped: spec/golden/Node scorer;
  C_dims in the live path; shadow scoring; pool percentiles + score card +
  methodology; tiers v2.1 gating; judges-v2.1 (gated cutover); spider-chart
  redesign; hardening + atomic claiming; anchor baseline; framing gate.
- **Phase C — real-user validation: machinery COMPLETE** (C2 day-30 collector
  + dashboard shipped, verified end-to-end via a real public video —
  `PHASEC2_READOUT.md`). **→ CURRENT ACTION: invite the test-user batch.**
  C3 (attribution analyses — e.g., do Tier-2 "changed after feedback" posts
  beat the same users' Tier-1 posts?) entry criterion: first users with ≥5
  collected posted videos.
- **Phase D — post-validation:**
  1. **Cohort_5 enrollment** (vetting done 2026-07-09; block in
     STAGED_WORK.md): Dancing 9 · Gaming 8 · Educational 7 keeps (+4
     reserves), 20-video cap, re-verify the 30–90-day window at enrollment,
     50/500 tier convention. Then **tier re-estimation** for the three ABSTAIN
     objectives (projected rankable n ≈ 14/19/20).
  2. Gaming/Educational precision recheck (both rank-confident already;
     ABSTAIN on precision only — a possible third display state is stubbed in
     code).
  3. Platform-specific models — revisit only with platform outcome data.
  4. v3 sharpened C_dims extractor — parked lab avenue.
- **Standing calendar:** anchor rescore ~Aug 9 · drift retest ~Sept ·
  TL cost-constant reconciliation ~May 2027.

## 5. Durable decisions (cumulative — do not re-litigate without new evidence)

Creator-level partition permanent · tier convention 50K/500K for all future
cohorts · judge scored-field roster frozen as model-input contract (changes
only via the fresh-vs-fresh dual-run gate with noise floor; field drops
abandoned after the v2.0 lesson) · duration guardrails (correlational framing
only; inference clamp; no length advice in any copy or judge prose) · TL stays
in the model; $345 rescore closed · E5/E6 closed · hook/DSP/mech blocks closed
(duration the sole exception, via forensic decomposition — decompose blocks
before verdicting them) · audio fingerprint match never solo-qualifies ·
posted-video rescores never enter percentile pools · floor-5 inclusion stands
· one model for all platforms pending platform outcome data · Anthropic API =
independent source, never "fallback" · keep-warm untouchable.

## 6. Cowork discovery reference (for future cohorts)

Per-objective prompt templates exist (Dancing/Gaming/Educational latest, in
STAGED_WORK.md lineage); standing conventions: overshoot ~2× the intended
keeps (keep-count undisclosed to Cowork) · hard window ≥10 videos posted
30–90 days ago, individually verified · purity ≥70% with per-objective
coherence litmus · disqualifier traps: repost/clip-farm + AI/TTS farms
(categorical), founder/funnel-dominant feeds (<30% rule; feed decides over
bio), single-fluke variance (multi-hit required), sponsored-saturation ·
minors excluded, with exclude-on-ambiguity for teen-heavy niches (Dancing,
Gaming); monetization-platform participation acceptable as an adulthood proxy
for faceless creators · dedup lists pulled fresh from
`research_creators` at prompt time.

## 7. Document map

- **`PreviewPanel_Scoring_Model_Report.md`** — the self-contained science
  record (study, model spec, calibration, drift governance, validation
  design).
- `analysis/modeling/reports/capstone/` — `CAPSTONE_PREREG_v2.md` (35-entry
  amendment trail) + every stage readout (STAGE0A → PHASEC1, HARDENING).
- `analysis/modeling/data/artifacts/v2_capstone/` — model pkl + tiers_v2_1.
- App scoring files — `backend/scoring/` (spec, golden vectors, references,
  corpus pool, scorer, display, pools) · `validation/` (fingerprint, worker,
  collector, dashboard) · `PROD_ENABLE_CHECKLIST.md`.
- `STAGED_WORK.md` (Josh's queue file) — cohort_5 block + staged prompts.
- Historical: writeups v1/v2, plans v11–v14 (retained, superseded).

## How to maintain

Update §1 when the app materially changes, §4 as phases move, §5 for durable
decisions. Keep science out of this doc — it belongs in the Scoring Model Report, which
changes only when evidence changes. Filename stays stable; refresh the dated header at the next major
handoff; if a fresh session's memory conflicts with the guardrails above,
trust this document and the Scoring Model Report.
