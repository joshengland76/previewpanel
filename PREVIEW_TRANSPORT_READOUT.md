# Preview Transport + Honesty Gates Readout

Mac-side Section B, coverage-honest copy, `--study` eligibility gate. App
repo (backend + generator + docs). **Hard constraint honored:** the
TwelveLabs keep-warm/warm-up path was not touched.

## Task 1 — Study Section-B transport

Replaced the Render-side `/api/fetch-video` link-fetch (a datacenter IP
TikTok can and does block per-video — see the marisjones incident below)
with the same Mac-side pattern `worker.py --prospect` already uses:
download locally via yt-dlp (this machine's own IP), then submit through
`/api/validation/ingest` (`source="prospect_report"` — pool-eligible, not
flagged `is_posted_video`, the same category prospect rows already are).
Caption comes straight from `research_videos.caption` (already populated
by the research ingestion pipeline — no separate caption probe needed,
unlike worker.py's own real-user scan).

`/api/validation/ingest` gained two additive, backward-compatible params:
- `sourceUrl` — per-video reuse identity, no longer gated on
  `source==="link_fetch"` (broadened in `recordShadowScore`'s call site).
- `objective` — explicit override, used before falling back to the
  matched-submission-derived value. Worker.py's existing callers never
  send either and are provably unaffected (both are optional, default to
  the pre-existing behavior).

Per-video reuse (Hotfix v2) unchanged in shape; politeness delay
(`INTER_VIDEO_DELAY_S=2`) added between Mac-side fetches, matching
worker.py's own constant. `/api/validation/ingest` is synchronous (awaits
full judging before responding), so the old poll-based read-back loop is
gone — one `db.query()` read (Hotfix v2's reconnect guard) right after,
keyed on the returned `postedVideoId`.

**Follow-up, found live:** the client's ingest timeout (8 min) exactly
matched the server's own internal cap (`waitForJobCompletion`'s
`maxWaitMs`) — under real load, the client gave up with a `Read timed
out` while the server kept going and wrote a real, successful
`shadow_scores` row moments later. Raised to 12 minutes, comfortably
above the server's cap.

## Task 2 — Coverage-honest copy

`study_section_a`/`study_section_b`/`prospect_section_a`/
`prospect_section_b` all now return `(rows, attempted, succeeded)` —
trivially full coverage for `--prospect` (nothing is fetched at render
time), genuinely trackable for `--study`. New pure functions:
- `hero_opening_sentence(section_a_start, full_coverage)` — sentence 1,
  the ONLY place this claim is made. Full coverage keeps "every public
  video you've posted"; any gap drops it for "your public videos posted"
  instead. Unit-tested both branches — never "every" over partial data.
- `coverage_note(label, attempted, succeeded)` — `None` at full coverage
  (including the "nothing attempted" edge), else `"Label: S of A
  fetchable"` for the send-check line.

A `--study` Section-A gap (OOF-coverage) triggers the identical
adaptation as a Section-B fetch gap — either one means the document
isn't actually rating "every" video.

**Follow-up, found live:** a creator with a genuinely EMPTY Section A
(marisjones — 0/9, see Task 4) hit a bare `"—"` date placeholder that
collided with `hero_opening_sentence`'s own `"since {date} —"` template,
rendering the visibly broken `"since — —"`. Falls back to Section B's own
earliest date when Section A has none at all; visually confirmed fixed.

```
$ ./_venv/bin/python3 test_generate_preview.py
All ... + coverage-honest-copy tests passed (... hero_opening_sentence
both branches, coverage_note full/gap/nothing-attempted).
```

## Task 3 — `--study` eligibility gate

Before any Section-B spend: `study_eligibility_reason` checks whether
ANY of the handle's `research_videos` ids appear in the frozen OOF
snapshot. If not, queries (not guesses) the reason from
`research_creators.tier`/`.cohort`:
- `tier == 'large'` → large-tier (OOF/training population is small+mid
  only).
- `cohort == 'cohort_5'` → enrolled after the frozen snapshot.
- otherwise → sub-floor.

Exits with the guidance line pointing at `--prospect`. `--force` bypasses
for a deliberate completion run (used for marisjones, Task 4).
`RECRUITMENT_RUNBOOK.md` gained a short "`--study` says no OOF coverage"
entry.

**Verified live** (Task 6): `--study marisjones` (no `--force`) exits
cleanly, zero cost, with the exact expected message.

## Task 4 — marisjones resolution

**Actual status:** `tier='large'`, `cohort='cohort_2'` (enrolled
2026-05-31, well before the frozen OOF snapshot). Her reason is
unambiguously **large-tier** — the OOF/training population is small+mid
only, large tier held out by design (Ops doc §2). Not cohort_5 (she
predates it), not sub-floor (tier/cohort don't even reach that check).

**Section B completion:** attempted the 3 still-missing videos via the
new transport. All 3 currently return `"Your IP address is blocked from
accessing this post"` — confirmed via a bare `yt-dlp` call independent of
this pipeline's code, so this is TikTok-side, not a transport defect.
Notably, one of these three (`7660952008551140638`) was ALSO blocked
during earlier diagnosis of the original crash; the other two had
downloaded cleanly from this same machine roughly an hour earlier in this
session, then were blocked too by the time of this attempt — consistent
with a reactive, request-pattern-triggered block (this exact video set
had been repeatedly probed across this session's diagnosis and testing),
not a permanent IP ban. Did not keep retrying against a currently-blocked
target. **Banked count: still 4 of 7** (unchanged) — no additional spend
materialized this session, despite the transport itself working
correctly (see jamieegabrielle, which DID complete a fresh fetch).

**Re-rendered, coverage-honest:** 0 Section A + 4 Section B, one page,
`SEND-CHECK: N/A` (fewer than 4 Section-A rows — no contrast to check),
hero form `best_bet`, `coverage: Section A: 0 of 9 fetchable; Section B:
4 of 7 fetchable`. Hero sentence correctly reads "We rated your public
videos posted since Jun 26 —..." (no "every"). Visually confirmed.

**Superseded prior render:** the false-"every" PDF from before this
hotfix (`preview_@marisjones_objective_20260718.{html,pdf}`, written
during Hotfix v2's own verification, predating coverage-honest copy) was
deleted before re-rendering — no stale false-complete document left in
`Recruitment/`.

## Task 5 — Link-paste visibility

`/api/fetch-video` gained an in-memory per-domain fetch-failure counter
(`logLinkFetchFailure`), incrementing on the two genuine-fetch-failure
paths (probe failure, download failure — not the pre-flight rejections
like unsupported-platform or rate-limit, which never attempted a real
fetch). Logs `[link-fetch] failure #N for <domain> (...)` to Render logs.
No proxies, no new persisted metric — purely log-observable, resets on
restart. Noted in `PreviewPanel_Operations_and_Roadmap.md` §1a (existing
graceful-error UX unchanged) and `RECRUITMENT_RUNBOOK.md`.

## Task 6 — Verify

- **jamieegabrielle**, `--reuse-section-b-hours 24`: expected $0 per the
  prompt's own assumption — **didn't hold**, and the reason is
  instructive: her existing Section-B `shadow_scores` rows were written
  during Polish v4/v5, BEFORE the `source_url` column existed at all
  (added in Hotfix v2), so they were unmatchable by the new per-video
  mechanism — the same situation marisjones's rows were in before Hotfix
  v2's Task 3 backfilled them specifically. Reused 3 of 5 (correct — no
  regression in matching), fetched 2 fresh. Result: 8 Section-A + 4
  Section-B, `SEND-CHECK: STRONG` (top=1.36× bottom=0.64× gap=+0.71×,
  calls 6 of 6) — **identical to every prior render of this creator**,
  confirming the underlying scoring/rendering pipeline has zero
  regression from this hotfix. Coverage: `Section B: 4 of 5 fetchable`
  (the 5th candidate hit the same reactive TikTok block described above).
- **marisjones** — see Task 4.
- **No-OOF gate**, marisjones without `--force` — see Task 3.

**Unresolved finding, flagged not chased further:** during the
jamieegabrielle re-render, two of her videos were each ingested TWICE
(confirmed: same `posted_video_id`, two distinct `shadow_scores` rows
~2–6 minutes apart, both successful). Root cause not conclusively
identified — the script itself calls `_ingest_video_local` exactly once
per candidate per run, so this wasn't reproduced as a code-level bug;
possibly related to a killed prior process's in-flight HTTP request
continuing server-side independently of the client-side kill signal, or
an execution-environment retry behavior. Cleaned up the same way Hotfix
v2's Task 3 did (kept the earlier `shadow_scores` row of each pair,
`pool_eligible=false` on the later duplicate; Aesthetic/Vibes pool 23→21).
**Recommend a follow-up look if this recurs** — it wasn't chased further
here to avoid additional live spend chasing an intermittent condition.

## Cleanup convention

Downloaded videos: `finally: local_path.unlink(missing_ok=True)` in
`study_section_b`, same as worker.py. No files left in `_downloads/`.

## Files changed

**App repo (`~/PreviewPanel`):**
- `backend/server.js` — `/api/validation/ingest` gains `sourceUrl` +
  explicit `objective` override; `recordShadowScore`'s `sourceUrl` no
  longer gated on `source==="link_fetch"`; per-domain fetch-failure
  counter on `/api/fetch-video`.
- `validation/generate_preview.py` — Mac-side transport
  (`_download_video_local`, `_ingest_video_local`, rewritten
  `study_section_b`); coverage tracking on all four section-source
  functions; `hero_opening_sentence`, `coverage_note`; `study_eligibility_reason`
  + `--force`; `_fetch_video`/`_poll_status` removed (dead); ingest
  timeout raised to 12 min; empty-Section-A date fallback.
- `validation/test_generate_preview.py` — `test_coverage_honest_copy()`.
- `Recruitment/RECRUITMENT_RUNBOOK.md` — Mac-side transport note,
  "`--study` says no OOF coverage" section, link-paste visibility note.

**Research repo (`~/correlation-research`):**
- `PreviewPanel_Operations_and_Roadmap.md` — §1e Transport hotfix
  one-liner; §1a link-paste TikTok-block visibility note.

**Database (applied directly):**
- Backfilled `source_url` is now populated going forward by the deployed
  backend — no further manual backfill needed beyond Hotfix v2's own.
- `shadow_scores.id IN (689, 690)` → `pool_eligible = false` (duplicate
  jamieegabrielle ingests, see Task 6's unresolved finding).

## Git / deploy state

- Commits: `7e31635` (Tasks 1–3, 5, docs), `8175a0f` (follow-up fixes:
  ingest timeout, empty-Section-A date fallback, duplicate cleanup),
  both on `origin/main`, both pushed.
- Research repo: `2ccbe52`, pushed.
- Deployed — Render (backend): Y, confirmed live via `/version`
  (`7e31635` before Task 4/6 verification began).
- Deployed — Vercel (frontend): N/A, no frontend files changed.

## STOP

Per the prompt's own instruction — no further work started after this
readout. The unresolved duplicate-ingest finding (Task 6) and the
currently-blocked 3 marisjones videos (Task 4) are flagged for
awareness, not picked up as new work here.
