# Recruit Target Analysis — Readout

**Date:** 2026-07-19 · **Read-only.** No DB writes, no syncs, no `posted_videos` rows, no invite mints, no invites sent, no pool changes. Sole outputs: `Recruitment/RECRUIT_TARGETS.csv` + this file.

## What this is

A $0 projection of the Track Record board **every OOF-covered study creator would show at mint time** — computed in memory by joining each creator's cached ENDGAME OOF ŷ with their recorded day-30 / day30-equivalent outcomes (`research_metrics`), exactly what `sync_study_history` would stage, but **never written**. The board math runs through the *same shared `call_semantics.json` v3 module* the live app and PDF use (`_topbottom_k`, `mark_call_chips`, `strong_weak_metrics`, `pick_hero_form`, `send_check_verdict`), so a projection and a real render agree — verified against the two already-rendered creators: jamieegabrielle (n=13, 8/8, 1.58×/0.58×, R=2.7×, averages) and thecolorfulpantry (n=10, 4/6, 1.62×/0.78×, averages) reproduce their PDFs exactly.

**Coverage:** 199 OOF-covered creators. Send-check verdict mix: MIXED 98, STRONG 77, DO NOT SEND 22, N/A 2.

## Ranking rule

**send-check verdict tier (desc) → graded_n (desc) → within-creator Spearman (desc).** STRONG > MIXED > DO NOT SEND > N/A. Ties on verdict break toward the creator with more already-graded videos (a fuller, more convincing board at $0), then toward the stronger within-creator rank signal.

Excluded from the ranking (annotated in the CSV, not ranked): **dancing** creators (5 — Josh screens these out; ABSTAIN tier, overall-only), **already prospect-ingested** (1: thecolorfulpantry — ballerinafarm & marisjones aren't OOF-covered, so they never entered this pool), and **docs already rendered** (1: jamieegabrielle).

## Top 25 targets

| # | handle | objective | obj-tier | n | H/C | top×/bot× | R | hero | verdict | ρ | active | last post | 30–100d | <30d | $→n12 | $→40 |
|--:|---|---|---|--:|:--:|---|--:|---|---|--:|:--:|---|--:|--:|--:|--:|
| 1 | itsjuliaflood | fashion | PREDICT | 40 | 5/8 | 1.804×/0.837× | 2.156 | averages | STRONG | 0.4901 | · | 2026-07-20 | 98 | 78 | $0.0 | $0.0 |
| 2 | raeshelgoesglobal | travel | PREDICT | 40 | 4/8 | 2.025×/1.031× | 1.964 | averages | STRONG | 0.4846 | · | 2026-07-16 | 73 | 44 | $0.0 | $0.0 |
| 3 | .dylansnyder | fitness | PREDICT | 40 | 6/8 | 1.14×/0.452× | 2.519 | averages | STRONG | 0.4741 | · | 2026-07-19 | 75 | 125 | $0.0 | $0.0 |
| 4 | everypointcounts | travel | PREDICT | 40 | 6/8 | 1.596×/0.636× | 2.508 | averages | STRONG | 0.414 | · | 2026-07-19 | 29 | 30 | $0.0 | $0.0 |
| 5 | lorainetheprairiedog | pets | PREDICT | 40 | 7/8 | 1.126×/0.603× | 1.867 | averages | STRONG | 0.3467 | · | 2026-07-18 | 31 | 68 | $0.0 | $0.0 |
| 6 | jordynwoodruff | beauty | PREDICT | 37 | 8/8 | 1.522×/0.33× | 4.616 | averages | STRONG | 0.6074 | · | 2026-07-20 | 40 | 53 | $0.0 | $0.3 |
| 7 | blakeoftoday | storytelling | PREDICT | 33 | 7/8 | 1.193×/0.756× | 1.578 | calls | STRONG | 0.2814 | · | 2026-07-19 | 18 | 22 | $0.0 | $0.7 |
| 8 | moneycoachdave | finance | PREDICT | 32 | 6/8 | 1.865×/0.811× | 2.301 | averages | STRONG | 0.5663 | · | 2026-07-19 | 25 | 28 | $0.0 | $0.8 |
| 9 | vinyasawithval | fitness | PREDICT | 31 | 6/8 | 1.458×/0.699× | 2.087 | averages | STRONG | 0.6173 | · | 2026-07-19 | 28 | 30 | $0.0 | $0.9 |
| 10 | mysistersskin | beauty | PREDICT | 31 | 7/8 | 2.0×/0.711× | 2.814 | averages | STRONG | 0.579 | · | 2026-07-19 | 19 | 26 | $0.0 | $0.9 |
| 11 | lexnicoleta | aesthetic | PREDICT | 29 | 7/8 | 1.725×/0.721× | 2.392 | averages | STRONG | 0.5394 | · | 2026-07-19 | 7 | 43 | $0.0 | $0.7 (short 4) |
| 12 | undine_makeupartist | beauty | PREDICT | 27 | 7/8 | 1.378×/0.995× | 1.385 | calls | STRONG | 0.4432 | · | 2026-07-18 | 16 | 18 | $0.0 | $1.3 |
| 13 | samantha.janessa | shopping | PREDICT | 25 | 8/8 | 1.535×/0.853× | 1.8 | averages | STRONG | 0.1962 | · | 2026-07-16 | 1 | 25 | $0.0 | $0.1 (short 14) |
| 14 | andysautoadvice | automotive | PREDICT | 24 | 6/8 | 1.432×/0.926× | 1.547 | averages | STRONG | 0.5913 | · | 2026-07-19 | 2 | 25 | $0.0 | $0.2 (short 14) |
| 15 | dr.starkid | myth_busting | PREDICT | 23 | 7/8 | 1.357×/0.836× | 1.624 | averages | STRONG | 0.5682 | · | 2026-07-19 | 4 | 33 | $0.0 | $0.4 (short 13) |
| 16 | alvathehotdog | pets | PREDICT | 22 | 7/8 | 1.479×/0.712× | 2.077 | averages | STRONG | 0.5313 | · | 2026-07-19 | 12 | 21 | $0.0 | $1.2 (short 6) |
| 17 | raimeetravel | travel | PREDICT | 21 | 6/8 | 3.471×/0.681× | 5.094 | averages | STRONG | 0.5273 | · | 2026-07-16 | 0 | 2 | $0.0 | $0.0 (short 19) |
| 18 | bghost23 | gaming | PROVISIONAL | 21 | 7/8 | 1.512×/0.919× | 1.645 | averages | STRONG | 0.3455 | · | 2026-07-18 | 9 | 19 | $0.0 | $0.9 (short 10) |
| 19 | thatblackchemist | myth_busting | PREDICT | 20 | 7/8 | 1.867×/0.9× | 2.074 | averages | STRONG | 0.7023 | · | 2026-07-19 | 52 | 85 | $0.0 | $2.0 |
| 20 | oklaurizzle | fashion | PREDICT | 20 | 8/8 | 2.18×/0.51× | 4.273 | averages | STRONG | 0.7008 | · | 2026-07-16 | 12 | 13 | $0.0 | $1.2 (short 8) |
| 21 | bynicolemv | beauty | PREDICT | 20 | 7/8 | 1.303×/0.632× | 2.06 | averages | STRONG | 0.6962 | · | 2026-07-17 | 11 | 14 | $0.0 | $1.1 (short 9) |
| 22 | smobyday | finance | PREDICT | 20 | 6/8 | 2.73×/0.673× | 4.053 | averages | STRONG | 0.6887 | · | 2026-07-19 | 28 | 36 | $0.0 | $2.0 |
| 23 | emmieedit | finance | PREDICT | 20 | 7/8 | 1.904×/0.629× | 3.029 | averages | STRONG | 0.6511 | · | 2026-07-19 | 28 | 23 | $0.0 | $2.0 |
| 24 | roganplaysgames | gaming | PROVISIONAL | 20 | 7/8 | 1.484×/0.557× | 2.665 | averages | STRONG | 0.6195 | · | 2026-07-18 | 23 | 23 | $0.0 | $2.0 |
| 25 | athomewithashley | aesthetic | PREDICT | 20 | 6/8 | 1.52×/0.777× | 1.956 | averages | STRONG | 0.5504 | · | 2026-07-19 | 21 | 19 | $0.0 | $2.0 |

`ρ` = within-creator OOF Spearman. `30–100d` / `<30d` = public videos posted **after** the creator's corpus window, by current age (metadata-only yt-dlp, no downloads). `$→n12` = cost to reach n=12 (k=4); `$→40` = cost to fill toward the 40-video window cap, at ~$0.10/video (score) + $0 outcome capture. `short N` = that many more gradable videos would be needed than currently exist aged 30–100d.

## Notes

- **Basis invariance (ρ):** the within-creator Spearman is a *rank* correlation of cached OOF ŷ against the recorded outcome, so it is identical whether the outcome is expressed as raw WEC, percentile, or ×typical — one number per creator, unaffected by the display basis. Computed over each creator's full OOF∩outcome set.

- **$0 today:** every board above is renderable **right now for $0** — the OOF ŷ and the day-30 outcomes already exist; nothing needs to be fetched or scored to produce the projected document. The Phase-2 `$→40` column is the *optional* cost to grow a board that isn't yet at the 40-video cap by scoring the creator's newer post-corpus videos; it is never required to send.

- **Active roster (✓):** morning-chain–monitored creators grow their window at $0 as new posts age past 30 days — their `$→40` shrinks on its own over time.

- **n=40 already:** any creator at graded_n=40 is at the window cap and k=4 today; `$→n12` and `$→40` are both $0 (nothing to extend).

## Non-actions (explicit)

Nothing was written to either database. No `sync_study_history` run, no `posted_videos` rows, no invite codes minted, no invites sent, no pool or corpus changes, no renders committed. Phase-2 TikTok reads were metadata-only (`yt-dlp --flat-playlist`, no video downloads), throttled with politeness delays and a PAUSE/stop-on-repeated-failure guard, run well clear of the 5 AM window. **Cleanup: n/a — this analysis is read-only.**

## Git state

Two new untracked files in `PreviewPanel/Recruitment/`: `RECRUIT_TARGETS.csv` and `RECRUIT_TARGETS_READOUT.md`. No other repo changes; nothing committed.
