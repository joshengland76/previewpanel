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
- **`PP_API_BASE`:** only needs setting for `--study` mode (Section B's
  live link-fetch hits a real backend). Defaults to
  `http://localhost:3001` (local dev server) if unset. For a real
  document, **export the production URL**:
  ```bash
  export PP_API_BASE=https://previewpanel.onrender.com
  ```
  `--prospect` mode's ingest step (`worker.py`) needs the same variable
  for the same reason (it POSTs to `/api/validation/ingest`).

## `--prospect` workflow (not-yet-enrolled creator)

Two steps: ingest (real API cost, ~15 min for a full batch), then render
(free, repeatable).

```bash
cd ~/PreviewPanel/validation
export PP_API_BASE=https://previewpanel.onrender.com

# Step 1 — ingest. Discovers the handle's public posts, scores each
# through the real live path. No --objective needed here.
./_venv/bin/python3 worker.py --prospect somehandle
#   optional: --max-aged 14 (default) --max-fresh 4 (default)

# Step 2 — render. Pick ONE mode per document; run it twice (objective +
# overall) for $0 extra cost -- prospect mode never calls a live endpoint,
# both renders just read what Step 1 already wrote.
./_venv/bin/python3 generate_preview.py --prospect somehandle --objective "Aesthetic/Vibes"
./_venv/bin/python3 generate_preview.py --prospect somehandle --overall
```

**Spend-reuse note:** re-running Step 2 (either mode, any number of
times) never re-spends — `--prospect` render always reads Task 1's
already-scored `posted_videos`/`shadow_scores` rows. Only Step 1 (the
ingest) costs money, and it's idempotent on `tiktok_video_id` (a second
`worker.py --prospect` run on the same handle skips videos it already
has).

## `--study` workflow (already-enrolled research creator)

One step — render does its own data pulls (Section A from cached OOF,
Section B live).

```bash
cd ~/PreviewPanel/validation
export PP_API_BASE=https://previewpanel.onrender.com

./_venv/bin/python3 generate_preview.py --study somehandle --objective "Aesthetic/Vibes"
```

Section B (last-30-days videos) is scored **fresh, live, real cost**
every time you run this — there is no free re-render for `--study`
Section B the way there is for `--prospect`, *unless* you know a
matching batch was already scored recently:

```bash
# Re-render without re-spending on Section B, IF the same handle/objective
# was rendered within the lookback window you give it. Falls back to a
# live re-fetch automatically if the row count doesn't match exactly (a
# different set of "last 30 days" videos, unrelated traffic, etc.) --
# never guesses, never silently uses stale/wrong rows.
./_venv/bin/python3 generate_preview.py --study somehandle --objective "Aesthetic/Vibes" \
  --reuse-section-b-hours 24
```

`--study` mode requires the handle to already exist in
`research_creators` — it will exit with an error naming the handle if
not found. (`--prospect` mode has no such requirement, by design.)

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

## Costs and typical durations

| Step | Cost | Typical duration |
|---|---|---|
| `worker.py --prospect` (per video, real live-path scoring) | ~$0.10/video | ~1 min/video (TwelveLabs judges + C_dims), so a full 12-aged + 4-fresh batch runs ~15-18 min end to end, politeness delays included |
| `generate_preview.py --study` Section B (per video, live link-fetch) | ~$0.10/video | ~1 min/video; a typical last-30-days batch (3-5 videos) runs ~4-6 min |
| `generate_preview.py --prospect` (either mode) | **$0** | seconds — pure DB read + PDF render, no scoring |
| `generate_preview.py --study` with `--reuse-section-b-hours` (cache hit) | **$0** | seconds |
| PDF render itself (headless Chrome) | $0 | ~2-3 sec |

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
signal is actually the stronger one, not the averages gap alone:

```
[generate_preview] SEND-CHECK: MIXED (averages: top=1.24x bottom=1.26x gap=-0.02x (tier 0) | calls: 4 of 6 (tier 2) | max_tier=2) -- hero form: calls
```

Both metrics (averages gap AND calls record) and which hero form
actually rendered are always printed together — never just the verdict.

- **STRONG** (either signal reaches its top impressiveness tier — averages
  gap ≥ 0.5×, or the panel called 6/6 or 5/6 on a 6-call board / 4/4 on a
  4-call board): a real, visible contrast or a genuinely strong hit rate.
  Safe to send as-is.
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
- **N/A** (fewer than 4 Section-A videos with a real result): no contrast
  was computed at all — nothing to check, not a red flag.

## Reading the adaptive hero

Sentence 1 (the opening "We rated every public video…" claim) never
changes. Sentence 2 picks whichever of two forms is more impressive,
tiered 0–3 on each (see `generate_preview.py`'s `averages_tier`/
`calls_tier` for the exact boundaries) — a tie goes to the **averages**
form (more visceral), except when both are tier 0, which gets a neutral
line instead of a fabricated boast:

- **Averages form**: `"Your N highest-rated averaged X× your typical
  engagement. Your N lowest-rated averaged Y×."`
- **Calls form**: `"We made calls on your N highest- and N lowest-rated —
  and got C of 2N right."` (bold; green only when C/2N ≥ .67)
- **Neutral form** (both tiers 0): `"Every call — hit and miss — is in
  the table below."`

The console SEND-CHECK line always names which form rendered
(`hero form: averages|calls|neutral|best_bet|pending`) so this never has
to be guessed from the verdict alone.

## Output paths

`Recruitment/preview_@<handle>_<objective|overall>_<YYYYMMDD>.{html,pdf}`
— gitignored (generated output, not source; only
`performance_preview_template.html` itself is tracked). Re-running the
same handle/mode/day overwrites in place.
