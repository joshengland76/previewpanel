# Radar Decile v2 — Midrank with Earned Endpoints — Readout

App repo only. `keep-warm` untouched. Amends `DECILE_FIX_READOUT.md`'s pure
strict-dominance mapping.

## 1. The rule

```
sb = fraction of window rows STRICTLY BELOW the value
sa = fraction of window rows STRICTLY ABOVE the value
pctMid = (sb + (1 - sa)) / 2                    -- classic midrank statistic
decile = clamp(1 + floor(pctMid * 10), 1, 10)
then, earned-endpoint overrides:
  computed decile 10 requires sb >= 0.90, else display 9
  computed decile 1  requires sa >= 0.90, else display 2
```

`pctMid` as defined above is algebraically identical to the textbook midrank
statistic `(below + 0.5*equal) / n` — ties split their credit evenly between
the two sides. That's the correct general-purpose ranking convention (and
what the codebase used before `DECILE_FIX`), but midrank alone reintroduces
`DECILE_FIX`'s original problem at the *top*: a tie block sitting at
percentile 83-98 has `pctMid = 0.905`, a plain midrank "10," despite only
83% of the window actually sitting below it. The earned-endpoint rule keeps
midrank everywhere in the middle (deciles 2-9) — where "this row split the
difference with everyone it tied" is exactly the right read — but requires
the two endpoints to *also* clear the outright-beat bar `DECILE_FIX`
established, since decile 10 and decile 1 are the only two that assert
"better/worse than nearly everyone," not just "in the same neighborhood as."

`axisMidrankFraction(value, pool, opts)` returns `{ pctMid, sb, sa }`;
`decileFor` consumes it and applies the two overrides. Same null-pool /
null-value graceful-degradation contract as before.

## 2. Tests (`axisPoolsTest.mjs`, all required cases)

Built on 100-row synthetic windows so percentile boundaries land on exact,
checkable numbers:

| Case | Setup | Result |
|---|---|---|
| (a) top tie block, pct 83-98 | sb=0.83, sa=0.02 → pctMid=0.905 → computed 10, sb<0.90 | **decile 9** (override) |
| (a) top tie block, pct 92-100 | sb=0.92, sa=0 → pctMid=0.96 → computed 10, sb≥0.90 | **decile 10** (earned) |
| (b) bottom tie block, pct 0-25 | sb=0, sa=0.75 → pctMid=0.125 → decile 2 (not an endpoint case) | **decile 2** |
| (b) bottom tie block, pct 0-8 | sb=0, sa=0.92 → pctMid=0.04 → computed 1, sa≥0.90 | **decile 1** (earned) |
| (b) bottom tie block, pct 0-15 | sb=0, sa=0.85 → pctMid=0.075 → computed 1, sa<0.90 | **decile 2** (override) |
| (c) middle tie block, pct 20-60 | pctMid=0.40 | **decile 5** |
| (c) median tie block, pct 40-60 | pctMid=0.50 | **decile 6** |
| (d) thin-tie (2/7 rows) | matches classic midrank exactly (same algebra, no endpoint involved) | **exact match** |
| (d) non-tied continuous value | matches classic midrank exactly | **exact match** |
| (e) all-identical window | pctMid=0.5, no endpoint override applies | **decile 6**, no error |

Plus retained clamp checks: a value below the entire pool has `sa=1≥0.90`
so it still earns decile 1 (never 0); a value above the entire pool has
`sb=1≥0.90` so it still earns decile 10 (never 11). All pass —
`node scoring/axisPoolsTest.mjs`.

## 3. Copy

Legend line is unchanged from `DECILE_FIX`: **"On each axis, 5-6 ≈ typical —
the median of the last 1,000 videos we've scored."** (Superseded by a
separate, later request in this same session reverting it back to the
original "5 = the median..." wording — see the final commit list below;
noted here since the DECILE_V2 prompt itself didn't ask for a copy change.)

## 4. Diagnostic table (live production data, today's windows)

Per axis: share of the pool displaying decile 10 and decile 1, **before**
(v1, pure strict-dominance) vs **after** (v2, midrank + earned endpoints),
plus the minimum raw value now earning a 10 and the maximum raw value still
stuck at 1.

| Axis | n | 10-share before→after | 1-share before→after | min raw for 10 | max raw stuck at 1 |
|---|---|---|---|---|---|
| Compelling | 1,000 | 5.5% → 5.5% | 10.7% → **8.8%** | 8 | 2.33 |
| Novel | 1,000 | 8.0% → 8.0% | 10.7% → **7.8%** | 7 | 1.67 |
| Emotionally Resonant | 1,000 | 7.6% → 7.6% | 11.3% → **9.9%** | 7 | 2.67 |
| Emotion Intensity | 1,000 | 8.4% → 8.4% | 11.1% → **8.4%** | 8 | 2.67 |
| Funny | 1,000 | 8.7% → 8.7% | 16.5% → **9.9%** | 6.67 | 1.33 |
| Objective Fit | 991 | 10.0% → 10.0% | 10.8% → **9.2%** | 8.67 | 2 |
| **Trend Align** | 581 | 1.9% → 1.9% | **39.2% → 4.5%** | 5 | 1 |
| Trending Topic | 581 | 8.4% → 8.4% | **22.4% → 2.1%** | 7 | 3 |

**The decile-10 share is identical on every single axis, before and after**
— exactly as expected, since v1's decile-10 threshold was already precisely
`sb ≥ 0.90`, the same requirement v2's earned-endpoint override reimposes.
The fix is entirely on the decile-1 side, where it matters most: **Trend
Align's fat tie of low, heavily-duplicated raw values had stuck 39% of all
videos at a rock-bottom decile 1** under pure strict dominance (a raw value
tied by a huge slice of the window never beats anyone outright, no matter
how large its own tie block is) — midrank correctly recognizes that a value
tied with, say, 60% of the window sits in the *middle* of that tie block,
not at its very floor. Trending Topic shows the identical pattern at a
smaller scale (22.4% → 2.1%). Every judge axis also drops 2-7 points on the
"1" side for the same reason, just less severely (their raw values are less
coarse than the two trend axes).

## 5. Before/after vertex tables — three real submissions

Found via direct production-DB query (not synthetic examples):

**`shadow:562` — the four-10 case (from `DECILE_FIX_READOUT.md`):**

| Axis | Raw | v1 (strict) | v2 (midrank+earned) |
|---|---|---|---|
| Compelling | 8.00 | 10 | 10 |
| Novel | 7.33 | 10 | 10 |
| Emotionally Resonant | 6.67 | 9 | 9 |
| Emotion Intensity | 6.33 | 7 | 7 |
| Funny | 3.67 | 7 | 7 |
| Objective Fit | 9.00 | 10 | 10 |
| Trend Align | 3 | 4 | **7** |
| Trending Topic | 6 | 7 | **9** |

**`shadow:123` — the two-10 case:**

| Axis | Raw | v1 (strict) | v2 (midrank+earned) |
|---|---|---|---|
| Compelling | 6.33 | 5 | 5 |
| Novel | 4.67 | 5 | 5 |
| Emotionally Resonant | 6.00 | 8 | 8 |
| Emotion Intensity | 6.67 | 8 | 8 |
| Funny | 5.67 | 9 | 9 |
| Objective Fit | 7.33 | 4 | **5** |
| Trend Align | 4 | 9 | 9 |
| Trending Topic | 7 | 10 | 10 |

**`shadow:535` — a genuine low-scorer (8 of 8 axes at v1-decile-1, found by
searching for the highest decile-1 count among recent submissions):**

| Axis | Raw | v1 (strict) | v2 (midrank+earned) |
|---|---|---|---|
| Compelling | 2 | 1 | 1 |
| Novel | 2 | 1 | **2** |
| Emotionally Resonant | 1 | 1 | 1 |
| Emotion Intensity | 2 | 1 | 1 |
| Funny | 1 | 1 | 1 |
| Objective Fit | 1 | 1 | 1 |
| Trend Align | 1 | 1 | 1 |
| Trending Topic | 4 | 1 | **2** |

This is the confirming case the prompt asked for: Trend Align's raw value of
1 **still correctly lands at decile 1 under v2** — it genuinely loses to
≥90% of the window outright (`sa≥0.90`), so the earned-endpoint rule keeps
it there. No "fat-tie 1" survives incorrectly; where the tie block was
large enough that the row didn't actually lose to 90% of the window
(Novel, Trending Topic here), v2 correctly relieves it to decile 2. The
other five axes — genuinely bottom-tier on this video — are unaffected by
either fix.

## 6. Live verification

Deployed `1217378` (Render backend sha confirmed). Submitted one fresh real
TikTok video via the link-fetch path: Scorecard rendered cleanly, sensible
1-10 decile labels across all plotted axes, no crash, no null placeholders.

## Files changed

`backend/scoring/axisPools.js` (`axisMidrankFraction` replaces
`axisStrictBelowFraction`; `decileFor`'s formula gains the earned-endpoint
step), `backend/scoring/axisPoolsTest.mjs` (full rewrite for the new rule).

Research repo: `PreviewPanel_Operations_and_Roadmap.md` §1a updated from
"strict-dominance deciles" to describe midrank with earned endpoints.

## Verification summary

- `node scoring/axisPoolsTest.mjs`: all PASS, including every required case.
- `node scoring/scoreDisplayTest.mjs`, `percentilePoolsTest.mjs`: PASS
  (unaffected by this change, run anyway per convention).
- `node --check server.js`: clean.
- Live diagnostic against production data: full before/after table above,
  plus three real-submission vertex tables, computed directly from the live
  corpus+shadow window.
- Live production submission: Scorecard renders correctly post-deploy.

## STOP

Per the prompt's explicit instruction — no further work started after this
readout.
