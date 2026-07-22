# Recruitment Runbook — Performance Preview

Operational reference for running the prospect-report pipeline and the
Performance Preview generator day to day. Companion to
`PreviewPanel_Operations_and_Roadmap.md` (§1d/§1e — the mechanism/design
doc) and `PREVIEW_PIPELINE_READOUT.md` / `PREVIEW_POLISH2_READOUT.md` /
`PREVIEW_POLISH3_READOUT.md` (the build history). This file is the
"what do I actually type" quick reference — copy-paste commands, not
design rationale.

## Prerequisites

```bash
cd ~/PreviewPanel/validation
```

- **Python:** `./_venv/bin/python3` — a project-local venv already
  populated (`requirements.txt`: psycopg2-binary, requests, pandas,
  pyarrow, pymupdf, yt-dlp, imagehash, pillow, numpy, scipy). No `source
  activate` step — invoke the venv's own binary directly, as every
  command below does.
- **Database:** reads `~/PreviewPanel/backend/.env`'s `DATABASE_URL`
  automatically (both scripts do this themselves — nothing to export).
  The app DB and research DB are the same Neon instance.
- **Chrome:** `/Applications/Google Chrome.app/Contents/MacOS/Google
  Chrome` must exist locally (headless PDF rendering) — already the case
  on this Mac, nothing to install.
- **`PP_API_BASE`:** needs setting for both modes -- `--study` mode's
  Section B and `--prospect` mode's ingest step (`worker.py`) both POST
  to `/api/validation/ingest` on a real backend (Transport hotfix,
  Task 1: `--study` Section B moved onto this SAME Mac-side transport
  `--prospect` already used, replacing the old Render-side
  `/api/fetch-video` link-fetch). Defaults to `http://localhost:3001`
  (local dev server) if unset. For a real document, **export the
  production URL**:
  ```bash
  export PP_API_BASE=https://previewpanel.onrender.com
  ```

## `--prospect` workflow (not-yet-enrolled creator)

Two steps: ingest (real API cost, ~15 min for a full batch), then render
(free, repeatable).

> **Track Record v5 note:** a prospect ingest's `--objective` (or its absence)
> shapes the **BLIND era only** — the prepopulated "before you joined" board a
> creator sees at mint. It has no bearing on the JOINED era: once a creator
> posts a video they previewed, that posted video is rescored under a **uniform
> null config** (the borrow-from-matched-preview objective path was removed,
> research rider), and its JOINED-tab percentile is the *preview's own* stored
> score, not the rescore. So `--objective` here is purely a BLIND-era / prospect-
> document choice.

```bash
cd ~/PreviewPanel/validation
export PP_API_BASE=https://previewpanel.onrender.com

# Step 1 — ingest. Discovers the handle's public posts, scores each
# through the real live path.
#
# CHOOSE THE INGEST CONFIG (post-diagnostic, see below):
#   niche-pure creator -> ingest WITH --objective (validated config: the
#     judges get the category lens + objective_fit, matching the app AND
#     the corpus the model was trained on).
./_venv/bin/python3 worker.py --prospect somehandle --objective "Food & Drinks/Cooking"
#   multi-niche creator -> omit --objective (null config), render --overall.
./_venv/bin/python3 worker.py --prospect somehandle
#   optional: --max-aged 14 (default) --max-fresh 4 (default)

# Step 2 — render. Pick ONE mode per document; run it twice (objective +
# overall) for $0 extra cost -- prospect mode never calls a live endpoint,
# both renders just read what Step 1 already wrote.
./_venv/bin/python3 generate_preview.py --prospect somehandle --objective "Aesthetic/Vibes"
./_venv/bin/python3 generate_preview.py --prospect somehandle --overall
```

**Ingest config — niche-pure vs multi-niche (post-diagnostic).** The
objective-conditioning diagnostic (`OBJECTIVE_CONDITIONING_DIAGNOSTIC.md`)
established that the null (objective-blind) config scores **structurally
higher** than the app — the judges apply no category lens and
`objfit_consensus` is median-imputed to a good fit (raw 8.333, an
off-distribution input: **0** of 4,897 corpus rows were scored
objective-blind). So:

- **Niche-pure creator** (clearly one category): ingest **WITH
  `--objective "<canonical>"`** — the *validated config*, matching the app
  and the corpus. Then render `--objective` (niche pill) and/or
  `--overall`; the numbers are directly comparable to what the invitee
  will see in-app.
- **Multi-niche creator** (no single category fits): ingest **without
  `--objective`** (null config) and render **`--overall` only**. A
  null-config render auto-appends an honesty footer line
  ("Scores in this preview were produced without a content-category
  lens…") so the recipient isn't surprised when their in-app numbers
  differ.
- **One creator, one config.** `generate_preview.py` **refuses to render
  a handle whose rows mix configs** (some null, some objective, or two
  different objectives) — their predictions aren't comparable. Re-ingest
  consistently if you switch. The render prints the config stamp it used
  (`rows scored under validated-config (objective='…')` /
  `null-config (objective-blind judges)`).

**Spend-reuse note:** re-running Step 2 (either mode, any number of
times) never re-spends — `--prospect` render always reads Task 1's
already-scored `posted_videos`/`shadow_scores` rows. Only Step 1 (the
ingest) costs money, and it's idempotent on `tiktok_video_id` (a second
`worker.py --prospect` run on the same handle skips videos it already
has).

**`--force-redraw` — re-score after a suspected outlier draw (~$1.50).**
The noise study (`POST_DIAGNOSTIC_READOUT.md`) put typical run-to-run ŷ SD
at ~0.025–0.03, but **rare outlier draws happen** (the diagnostic caught
one). If a handle's send-check looks off in a way that reads as a bad
draw — a video scoring far from where its content suggests, a verdict
that flipped implausibly — re-score the whole handle as **fresh draws**:

```bash
./_venv/bin/python3 worker.py --prospect somehandle --force-redraw   # add --objective if that's the config
```

This bypasses the idempotent skip, re-scores every already-ingested video
(new `shadow_scores` rows), and **retires each prior draw**
(`pool_eligible=false`) so the pool counts the video once and the render
shows the fresh draw. The `posted_videos` row is updated in place (fresh
`y_pred`; the frozen day-30 outcome is preserved — a redraw re-draws the
prediction, not the result). Cost ~$1.50 for a full handle
(~$0.10/video). **Use sparingly and deliberately** — this is for a
genuine suspected-outlier case, not a reflex; a single draw is normally
representative, and re-drawing until you like the number is
p-hacking your own preview. Match the config: pass `--objective` (or omit
it) the same way the handle was originally ingested, or the redraw's rows
will mix configs and the render will refuse.

**Step 3 — after ingest + preview send, mint the tester's invite code.**
A pre-linked code (`--handle`) auto-connects their account and claims the
`posted_videos`/`shadow_scores` rows Step 1 just wrote the moment they
confirm "that's me" in-app — their history and track record start
populated instead of empty. See `BETA_PRELINK_READOUT.md` for the full
redemption flow.

```bash
./_venv/bin/python3 beta_admin.py mint --label "Name" --handle theirhandle
```

For an already-enrolled research creator (an OOF-covered `--study` handle),
mint also stages their aged/outcome-resolved study history automatically
(`sync_study_history.py`, Track Record Task 3b) — their tab opens ACTIVE
day one instead of waiting on prospect ingest or their own future posts.
`--no-sync` skips this.

Founder/team access: `mint --internal` (Track Record v2, Task 0) — their
submissions never enter the comparison pools and their activity is
excluded from tester engagement stats (`pipeline_status.py`).

## `--study` workflow (already-enrolled research creator)

> **Track Record v4.1 — Section B removed, `--study` now renders for $0.**
> The document is a single graded-window structure: hero → **top performers
> (k) → bottom performers (k) → other (remaining graded, no call)**. There is
> no more Section B (last-30-days on-record table / PREDICTED chips / check-in
> dates / "strongest recent bet" card) — it lives only as a dormant commented
> template block. So `--study` does **no live fetching at all** and costs
> **$0** end to end; **everything below about Section-B reuse, per-video
> fetching, `--reuse-section-b-hours`, and the stored-features/live-fetched
> split is DORMANT** (the flags still parse, the machinery is retained for
> possible future use, but nothing calls it on a `--study` run). `--prospect`
> ingest is unchanged — it still fetches fresh videos live; a freshly-posted
> video simply surfaces on the tab/PDF once its **day-30 outcome matures**
> and it enters the graded window.
>
> **Call tiers (`call_semantics.json` v3), by in-window graded count n:**
>
> | graded n | k (top / bottom each) | calls total (2k) |
> |---|---|---|
> | n < 6 | — no calls | 0 |
> | 6 – 8 | 2 | 4 |
> | 9 – 11 | 3 | 6 |
> | 12 – 40 | 4 | 8 |
>
> The graded set is the **40 most-recent graded videos** by `posted_at`
> (rolling; at the full window k=4/40 is the top/bottom decile). Both the PDF
> and the app tab read this same file.

One step — render reads Section A from cached OOF and renders (no live pulls).

```bash
cd ~/PreviewPanel/validation
export PP_API_BASE=https://previewpanel.onrender.com

./_venv/bin/python3 generate_preview.py --study somehandle --objective "Aesthetic/Vibes"
```

Section B (last-30-days videos) reuse is now **PER-VIDEO and on by
default** (Hotfix v2, Task 2): for each Section-B candidate, the script
checks whether *that exact tiktok video* was already scored within the
last 24 hours (`--reuse-section-b-hours`, default `24`) and only fetches
the ones that aren't. A crashed run's partial progress is recovered
instead of re-spent from zero, and a video posted since your last render
fetches only itself — no more "the whole batch has to match exactly or
none of it reuses."

```bash
./_venv/bin/python3 generate_preview.py --study somehandle --objective "Aesthetic/Vibes"
#   default behavior: reuses any Section-B video already scored in the
#   last 24h, fetches (real cost) only the rest. Prints the honest split
#   up front, e.g.:
#   [generate_preview] reusing 2 of 7; fetching 5

# Widen or narrow the reuse window:
./_venv/bin/python3 generate_preview.py --study somehandle --objective "Aesthetic/Vibes" \
  --reuse-section-b-hours 72

# Force a full live re-fetch of every Section-B video (explicit 0 disables reuse):
./_venv/bin/python3 generate_preview.py --study somehandle --objective "Aesthetic/Vibes" \
  --reuse-section-b-hours 0
```

`--study` mode requires the handle to already exist in
`research_creators` — it will exit with an error naming the handle if
not found. (`--prospect` mode has no such requirement, by design.)

**Section B is now Mac-side** (Transport hotfix, Task 1): each un-reused
video is downloaded locally (this machine's own residential IP) and
submitted through the same `/api/validation/ingest` path `--prospect`
mode already uses, instead of the old Render-side `/api/fetch-video`
link-fetch. Render's datacenter IP can be (and has been) blocked by
TikTok on a per-video basis — this transport is immune to that, since
the fetch never leaves this Mac.

**Active-creator renders are the cheapest of all** (Enhancements,
Task 2). If the handle is an active creator, its own daily morning chain
(`submit_to_pp.py` + parser.py's Stage-D) usually already scored a
Section-B video through the real live path BEFORE you ever run this
script — judge data sits in `submissions`, C_dims in
`research_pp_runs_claude`. When that's true (≥2 of 3 judges + a C_dims
row), `spec_scorer.py` (a pure-Python port of the same
`scoring_spec_v2.json` the app itself scores with, golden-vector-verified
to ≤1e-9) scores it **locally, at $0, no network call at all** — cheaper
than even a reused row, since nothing touches the DB write path or
Render. Per-video reuse and the Mac-side live fetch are still there as
the next two tiers, in that order, for whatever the morning chain hasn't
covered yet. The console always reports the three-way split:

```
[generate_preview] stored-features: 8, live-fetched: 1, unfetchable: 0
```

An active creator with a full recent posting history can render for
**$0 or close to it** — the "typical cost" table below is really the
worst case (a --study handle with NO morning-chain coverage at all, or a
brand-new --prospect ingest).

## `--study` says no OOF coverage

Before spending anything on Section B, the script checks whether this
handle has ANY video in the frozen OOF snapshot at all -- Section A
depends on it entirely, and a creator with zero coverage will always
render an empty Section A. If none exists:

```
[generate_preview] --study somehandle: no OOF coverage (large-tier (the OOF
modeling population is small+mid only; large tier is held out)) -- use
--prospect somehandle for a full document (~$1.50, scores fresh, works
for any public creator).
```

The reason is queried, not guessed -- `large-tier` (held out of the
small+mid modeling population), `cohort_5` (enrolled after the frozen
snapshot), or `sub-floor` (in-population tier/cohort, but this creator's
own videos didn't clear the floor-5 bar). **Use `--prospect` instead** --
it scores fresh through the live path and works for any public creator,
enrolled or not. To deliberately proceed anyway (e.g. finishing a
document already in flight), pass `--force`.

## If it crashes

Both `generate_preview.py --study` and `worker.py --prospect` hold a
database connection across each video's multi-minute fetch/judge/poll
cycle. Neon can idle-close that connection mid-run — you'll see:

```
psycopg2.OperationalError: SSL connection has been closed unexpectedly
```

As of Hotfix v2 (Task 1), every query in both scripts reopens the
connection and retries once automatically, so this should now be rare.
If it still happens (or happened before this hotfix):

- **The SSL message means a timeout during scoring, not a scoring
  failure or bad data.** Any video that already finished scoring before
  the crash is safe and already in the database.
- **Just re-run the exact same command.** Section-B's per-video reuse
  (above) means already-scored videos from the crashed attempt are
  recognized and reused, not re-fetched — the re-run picks up exactly
  where the crash left off, at no extra cost for what already completed.
- This applies to `--study` Section B and to `worker.py --prospect`'s
  video-by-video ingest loop identically.

## Real-app link-paste TikTok failures (context, not a pipeline concern)

The live app's own paste-a-link feature (`/api/fetch-video`, separate
from this pipeline) runs from Render's datacenter IP, which TikTok can
and does block on a per-video basis (the same failure this hotfix moved
Section B off of). **Some TikTok links may fail from our server; the app
already tells users to upload the file instead** when that happens
(graceful, existing UX -- not new). A per-domain fetch-failure counter
now logs each occurrence to Render logs (`[link-fetch] failure #N for
<domain> (...)`), so the real block rate on actual user traffic is
observable -- see `PreviewPanel_Operations_and_Roadmap.md` §1a.

## The 19 canonical objectives (`--objective "<exact string>"`)

Copy-paste exactly, including punctuation — these are the live app's own
`tiers_v2_2.json` keys, not the lowercase research-side slugs used
elsewhere in this project (`research_creators.objective` uses a
*different* vocabulary — don't mix them up):

```
ASMR                      Life Hacks
Aesthetic/Vibes           Makeup/Beauty
Business/Finance          Myth Busting
Cars/Automotive           Pets/Animals
Fashion                   Shopping
Fitness/Wellness          Storytelling
Food & Drinks/Cooking     Travel
Fun Facts
Funny Videos/Comedy
Educational/How-To  (PROVISIONAL -- shows a percentile + a maturing-precision caveat, not suppressed)
Gaming               (PROVISIONAL -- same caveat)
Dancing               (ABSTAIN -- REFUSED, see below)
```

Or skip picking one entirely: `--overall` (last-1,000-pool percentile,
no objective, no tier gate, works for every handle).

## The Dancing refusal

```
$ ./_venv/bin/python3 generate_preview.py --study somehandle --objective "Dancing"
[generate_preview] Refusing --objective Dancing: p_gt0=0.613 (bar is >=0.95) --
not statistically supported for a ranking claim yet. No honest percentile
document exists for this niche.
```

This is a hard stop (nonzero exit, no file written), not a warning —
Dancing is the one objective that fails the live app's own
ranking-confidence bar (`p_gt0>=0.95`) outright. There is no override
flag. If a Dancing creator needs a document, use `--overall` instead
(no tier gate).

## Which document is canonical: `--overall` vs `--objective`

Track Record v3, Task 7: **`--overall` is the canonical invitee
document** — it's the same last-1,000-videos overall-pool percentile
basis the in-app Track Record tab itself uses, so an invitee who redeems
their invite code sees the identical vocabulary (CALLED STRONG/WEAK
chips), the identical threshold rule (strong ≥ 70th percentile, weak ≤
30th), and — coverage caveats aside — the same calls their preview
document already told them about. It also works for every handle
unconditionally (no tier gate, no Dancing-style refusal, no per-objective
statistical-confidence bar to clear).

`--objective` is an **optional niche-pure supplement** — send it
*alongside* `--overall`, never *instead of* it. It answers a narrower,
sometimes more persuasive question ("how do you rank against other
Fitness/Wellness creators specifically") but its comparison pool is
different from the one the live app's Track Record tab shows (a niche
pool vs. the overall last-1,000 pool), so its percentiles and its
calls can legitimately disagree with what the invitee later sees in-app
— always caveat this when sending both ("your niche percentile above is
a different, narrower comparison than what you'll see in your live
Track Record after you sign up").

In short: **always render and send `--overall`.** Add `--objective` on
top of it only when the creator has a clear, gate-clearing niche and the
extra document adds something the overall one doesn't — never as a
replacement.

## Costs and typical durations

| Step | Cost | Typical duration |
|---|---|---|
| `worker.py --prospect` (per video, real live-path scoring) | ~$0.10/video | ~1 min/video (TwelveLabs judges + C_dims), so a full 12-aged + 4-fresh batch runs ~15-18 min end to end, politeness delays included |
| `generate_preview.py --study` (v4.1 — Section B removed) | **$0** | seconds — pure DB read + PDF render, no live fetching at all |
| `generate_preview.py --prospect` (either mode) | **$0** | seconds — pure DB read + PDF render, no scoring |
| PDF render itself (headless Chrome) | $0 | ~2-3 sec |
| ~~`--study` Section B live link-fetch / per-video reuse~~ | ~~$0.10/vid · $0 reused~~ | **dormant in v4.1** — Section B no longer fetched; rows kept for reference only |

(TwelveLabs $0.0262/min + C_dims ~$0.028/video — the same constants as
the rest of the pipeline, `PreviewPanel_Operations_and_Roadmap.md` §3d.)

## The 5 AM window rule

**Never run `worker.py --prospect` or a `--study` render across the 5 AM
LaunchAgent window** (the morning chain: `creator_monitor.py` →
`nightly_chain.py` → `submit_to_pp.py` → `day30_metrics.py` →
`validation/worker.py` → `validation/collect_day30.py`). Same
single-backend-instance contention rule as the rest of this project's
on-demand scoring batches (`PreviewPanel_Operations_and_Roadmap.md` §3b)
— a long recruitment batch that runs past 5 AM (or starts an evening run
that's still going at 5 AM) risks the same kind of duplicate-submission
collision already seen once in production. If a batch is still running
as 5 AM approaches, let it finish before the next morning-chain fire
rather than starting a new one alongside it.

## Reading the send-check verdict

Printed after every render — **advisory only, never blocks the file
from being written**. Polish v5 remap: the hero sentence itself now
sometimes leads with the panel's **calls record** instead of the
**averages gap** (whichever is the more impressive of the two — see
"Reading the adaptive hero" below), so the verdict tracks whichever
signal is actually the stronger one, not the averages gap alone.
Track Record v4.1 call semantics: calls are **rank-based** — the TOP k /
BOTTOM k of the 40-most-recent graded window (k=2/3/4 by the tier table
above), so each side has exactly k calls (2k total). The send-check reports
both the averages gap and the calls record (H of 2k), plus which hero form
rendered:

```
[generate_preview] SEND-CHECK: MIXED (averages: strong=1.24x weak=1.26x gap=-0.02x (tier 0) | calls: 4 of 6 (tier 2) | max_tier=2) -- hero form: calls
```

Both metrics (averages gap AND calls record) and which hero form
actually rendered are always printed together — never just the verdict.

- **STRONG** (either signal reaches its top impressiveness tier — averages
  gap ≥ 0.5×, or the panel's calls-correct/calls-total ratio ≥ 5⁄6, e.g.
  8/8, 7/8, 6/6, 5/6, 4/4): a real, visible contrast or a genuinely strong
  hit rate. Safe to send as-is.
- **MIXED** (some positive signal, but neither clears the top tier):
  **read the doc before sending.** Still an honest document — the numbers
  are what they are — but worth a second look at which of the two
  signals is actually carrying the sentence, and whether it holds up.
- **DO NOT SEND** (both signals are at the bottom tier — averages
  inverted or flat, AND the calls record is weak): **final, no override.**
  Not necessarily a bug (this is real 30-day WEC data, and reversals
  happen — see e.g. `thecolorfulpantry --objective "Food & Drinks/Cooking"`,
  gap=-0.02× against a genuine calls tier of only 2 — a near-tie two
  individual misses produced) — but neither signal is strong enough to
  lead an honest sentence with, so the document needs a human rewrite
  before it goes to a prospect, not an automatic pass.
- **N/A** (fewer than **6** graded videos in the window — v4.1 raised the
  call floor from 4 to 6): no contrast was computed at all — nothing to
  check, not a red flag.

## Reading the adaptive hero

Sentence 1 (the opening "We rated every public video…" claim) never
changes. Sentence 2 picks whichever of two forms is more impressive,
tiered 0–3 on each (see `generate_preview.py`'s `averages_tier`/
`calls_tier` for the exact boundaries) — a tie goes to the **averages**
form (more visceral), except when both are tier 0, which gets a neutral
line instead of a fabricated boast. Track Record v4.1: RANK-based call
semantics — the "calls" are the **TOP k / BOTTOM k of the graded window**
(`k` from `_topbottom_k` / `call_semantics.json` v3: **n 6–8→2, 9–11→3,
12–40→4, n<6→none**; window = 40 most-recent graded), and the wording is
the rank language the app tab uses. The `calls_tier` boundaries are the
hit fraction C/2k at **5⁄6 → 3, 2⁄3 → 2, 1⁄2 → 1**:

- **Averages form** (v4.1): leads with the ratio —
  `"Our top picks outperformed our bottom picks by R×."` (R = top_avg /
  bottom_avg, capped `"10×+"`, 1dp), with `"Called it: H of C."` folded
  into the body. Guarded: needs ≥2 top and ≥2 bottom calls AND
  bottom_avg > 0.1, else it falls back to the pair form
  `"Top picks: X× · bottom picks: Y×."`
- **Calls form**: `"We called it on H out of C."` with the averages in
  the body.
- **Neutral form** (both tiers 0): `"Every call — hit and miss — below."`

The Section-A pills are **TOP k / BOTTOM k** (green/rust tints) — these
ARE the calls. The in-app Track Record tab shows the same underlying rank
calls and now labels the row chips **Top k / Bottom k** (matching the
section titles "Top k Predictions" / "Bottom k Predictions"); both surfaces
read `call_semantics.json`'s tiers, so the document and the tab can never
disagree about how many rows count as top/bottom or which ones they are.
The ×typical result label always sits on the verdict's own side of 1.0
(strong hits read >1.0, weak hits <1.0 — never a rounding-induced 1.0×).

The console SEND-CHECK line always names which form rendered
(`hero form: averages|calls|neutral|best_bet|pending`) so this never has
to be guessed from the verdict alone.

## Output paths

`Recruitment/preview_@<handle>_<study|prospect>_<objective|overall>_<YYYYMMDD>.{html,pdf}`
— gitignored (generated output, not source; only
`performance_preview_template.html` itself is tracked). The `study`/
`prospect` segment keeps the two data sources from colliding — without
it, a `--study` and a `--prospect` render of the same handle/objective on
the same day shared a filename and silently overwrote each other
(observed live, `PREVIEW_SPECSCORER_READOUT.md` Task 5). Re-running the
same handle/source/mode/day still overwrites in place, as before.
