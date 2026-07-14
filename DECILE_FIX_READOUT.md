# Radar Decile Fix — Strict-Dominance Mapping — Readout

App repo only. `keep-warm` untouched.

## 1. The rule

Replaced the midrank-based decile mapping in `axisPools.js` with strict
dominance:

```
strictly_below_fraction = (# window rows with raw value STRICTLY LESS than
                            this video's raw value) / window_n
decile = clamp(1 + floor(strictly_below_fraction * 10), 1, 10)
```

The old formula (`(below + 0.5*equal) / n`, `decile = ceil(pct*10)`) gave a
tied value **half-credit for every row sharing its exact score**. That's a
reasonable convention for smooth, mostly-unique continuous data, but several
axes here are coarse enough — a judge consensus that lands on one common
whole number, a trend signal that's really just a small integer count — that
a single tied raw value can represent 15-25% of the entire window. Half-credit
on a tie block that big is enough to round a large chunk of "merely common"
videos into the *next* decile up, past what they actually beat.

Strict dominance drops all tie credit. A displayed decile `d` now only ever
asserts the plain, defensible claim **"beat >= (d-1)*10% of the window
outright"** — a tie block can never inflate itself past what it strictly
beat. Applied identically to all 8 axes, the bold average polygon, and every
individual judge's own ghost line (no code path treats them differently;
`decileFor()` is the single call site both go through).

`axisMidrankFraction` is gone — nothing else in the codebase called it
directly (checked via repo-wide grep), so it's a clean replacement rather
than a second code path left dangling. `axisStrictBelowFraction` takes its
place, same signature (`(value, pool, { excludeKey })`), same null-pool /
null-value graceful-degradation contract.

## 2. Tests (`axisPoolsTest.mjs`, all 5 required cases)

Built on 100-row synthetic windows so percentile boundaries land on exact,
checkable numbers:

| Case | Setup | Old (midrank) | New (strict) |
|---|---|---|---|
| (a) tie block spanning pct 83-98 | 83 below, 15-row tie block, 2 above | — | **decile 9**, not 10 |
| (b) value with 98% strictly below | 98 below, 2 above | — | **decile 10** |
| (c) median tie block spanning pct 40-60 | 40 below, 20-row tie, 40 above | — | **decile 5** |
| (c) tie block spanning pct 50-70 | 50 below, 20-row tie, 30 above | — | **decile 6** |
| (d) thin-tie continuous (2-row tie in a 7-row pool) | pool `[1,2,3,4,4,6,7]`, query `4` | 6 (reconstructed old formula, inline in the test) | **5** — within 1, never above |
| (d) non-tied continuous value | pool `[1..7]`, query `4.5` | matches old exactly (no tie, nothing to strip) | matches old exactly |
| (e) all-identical window | 5 rows all value `5`, query `5` | — | **decile 1**, no error |

Plus the retained floor/ceiling clamp checks (a value below the entire pool
floors at decile 1, never 0; beating the entire window caps at decile 10,
never 11) and the null-value/null-pool graceful-degradation checks. All
pass — `node scoring/axisPoolsTest.mjs`.

## 3. Copy

`PerformanceRadar.jsx`'s top-of-card line:

> ~~On each axis, 5 = the median of the last 1,000 videos we've scored.~~
> **On each axis, 5-6 ≈ typical — the median of the last 1,000 videos we've scored.**

Tooltips unchanged, per the prompt.

## 4. Diagnostic table (live production data, today's window)

Per axis: `n` and distinct raw value count in the live window, share of the
pool that displayed a 10 **before** (old midrank) vs **after** (new strict),
and the minimum raw value that now earns a 10.

| Axis | n | distinct raw values | 10-share BEFORE | 10-share AFTER | min raw for a 10 (after) |
|---|---|---|---|---|---|
| Compelling | 1,000 | 25 | 11.3% | **5.4%** | 8 |
| Novel | 1,000 | 25 | 10.5% | **7.9%** | 7 |
| Emotionally Resonant | 1,000 | 24 | 11.2% | **7.6%** | 7 |
| Emotion Intensity | 1,000 | 25 | 8.4% | 8.4% | 8 |
| Funny | 1,000 | 23 | 11.1% | **8.7%** | 6.67 |
| Objective Fit | 993 | 25 | 10.1% | **4.1%** | 9 |
| **Trend Align** | 581 | 6 | **16.9%** | **1.9%** | 5 |
| Trending Topic | 581 | 7 | 8.4% | 8.4% | 7 |

**Trend Align was the worst offender, by far** — only 6 distinct raw values
exist in the entire window (it's really a small integer count dressed up as
an axis), and the single value "4" alone occupied 15% of the pool. Under the
old formula that whole 15% got swept into decile 10 along with the genuine
top scorers; under strict dominance, only the true top ~2% (raw value 5, the
observed max) earns it. Objective Fit and Compelling both dropped by roughly
half too — both had a single common raw value (8 and a value near 8
respectively) sitting right at the old 90th-percentile tie block. Emotion
Intensity and Trending Topic were essentially unaffected (10.1% before →
same after) — their raw-value distributions don't have a large tie sitting
at that specific boundary, so there was nothing to correct.

## 5. Before/after on the two real flagged submissions

Found via the same diagnostic (searching all `pool_eligible` shadow rows for
the highest old-decile-10 counts) — these are the actual rows behind what
Josh flagged, not synthetic examples.

**`shadow:562`, 2026-07-13 23:53 UTC — the four-10 case:**

| Axis | Raw | Old decile | New decile |
|---|---|---|---|
| Compelling | 8.00 | 10 | 10 |
| Novel | 7.33 | 10 | 10 |
| Emotionally Resonant | 6.67 | 10 | **9** |
| Emotion Intensity | 6.33 | 7 | 7 |
| Funny | 3.67 | 7 | 7 |
| Objective Fit | 9.00 | 10 | 10 |
| Trend Align | 3 | 7 | **4** |
| Trending Topic | 6 | 9 | **7** |

Old: 4 axes at decile 10. New: 3 axes at decile 10 (Compelling, Novel,
Objective Fit — all three have genuinely high raw values with little
competition above them, so they hold) plus a real correction on Emotionally
Resonant (10→9) and a much larger correction on both trend axes, which had
been inflated by the coarse-value tie effect described above.

**`shadow:123`, 2026-07-12 04:05 UTC — the two-10 case:**

| Axis | Raw | Old decile | New decile |
|---|---|---|---|
| Compelling | 6.33 | 5 | 5 |
| Novel | 4.67 | 5 | 5 |
| Emotionally Resonant | 6.00 | 8 | 8 |
| Emotion Intensity | 6.67 | 8 | 8 |
| Funny | 5.67 | 9 | 9 |
| Objective Fit | 7.33 | 5 | **4** |
| Trend Align | 4 | 10 | **9** |
| Trending Topic | 7 | 10 | 10 |

Old: 2 axes at decile 10 (both trend axes). New: 1 axis at decile 10
(Trending Topic — its raw value of 7 was already close to the genuine
ceiling, so it correctly holds); Trend Align drops from a misleadingly
perfect 10 to a 9, and Objective Fit shifts down one notch (5→4) as its own
tie-block correction ripples through.

## 6. Live verification

Deployed `0022e3c` (Render backend sha confirmed). Submitted one fresh real
TikTok video via the link-fetch path (no objective selected, so this doubles
as a re-check of the Polish-4 objective-fit skip): Scorecard rendered
Compelling 6.0 / Novel 8.0 / Emotionally Resonant 4.0 / Emotion Intensity 1.0
/ Funny 1.0 / Trend Align 1.0 / Trending Topic 1.0, Objective Fit correctly
muted/skipped, all values in the expected 1-10 range, no nulls, no crash.
Top-of-card copy confirmed live: "On each axis, 5-6 ≈ typical — the median of
the last 1,000 videos we've scored."

## Files changed

`backend/scoring/axisPools.js` (`axisMidrankFraction` → `axisStrictBelowFraction`,
`decileFor`'s formula), `backend/scoring/axisPoolsTest.mjs` (full rewrite for
the new behavior), `frontend/src/components/PerformanceRadar.jsx` (copy line).

Research repo: `PreviewPanel_Operations_and_Roadmap.md` §1a ticked.

## Verification summary

- `node scoring/axisPoolsTest.mjs`: all PASS, including all 5 required cases.
- `node scoring/scoreDisplayTest.mjs`, `percentilePoolsTest.mjs`: PASS
  (unaffected by this change, run anyway per convention).
- `node --check server.js`, `npx vite build`: clean.
- Live diagnostic against production data: full before/after table above,
  computed directly from the live corpus+shadow window, not estimated.
- Live production submission: Scorecard renders correctly post-deploy, new
  copy line confirmed.

## STOP

Per the prompt's explicit instruction — no further work started after this
readout.
