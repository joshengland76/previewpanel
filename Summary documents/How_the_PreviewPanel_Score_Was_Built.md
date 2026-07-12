# The PreviewPanel Score — How We Built It and What It Means

**The problem.** Creators can't tell which of their videos will land before
posting. Even good AI feedback tends to score most decent videos 7-or-8 out of
10 — pleasant, but not predictive. We wanted a number that actually correlates
with real-world performance.

**What the score is.** A prediction of *relative* performance: how a video is
likely to do **compared with that creator's own typical video**, based on what's
in the video itself — hook, emotional register, novelty, usefulness,
save-worthiness, pacing, length — before it's ever posted. It's a ranking aid
for choosing and improving your strongest work, not a virality crystal ball.

**How it was built.**
- We recruited **259 real TikTok creators across 19 niches** and tracked
  **~4,900 of their videos** to their actual 30-day engagement (likes, shares,
  saves per view) — real outcomes, not proxies.
- Every video was analyzed **before its outcome was known**, by two independent
  AI systems reading the content itself.
- Each video is compared only against **its own creator's baseline**, so big
  accounts can't skew the model and the score means the same thing at 2,000
  followers as at 200,000.

**How we kept ourselves honest.** The model was only ever evaluated on
**creators it had never seen**. Every analysis choice was **written down and dated before we saw its result, not after** — a running log that now stands at 38 entries. And before anything shipped, we sealed **30 creators in a
lockbox** untouched by the entire model-selection process, then opened it
exactly once, against pass/fail criteria committed in writing beforehand. It
passed.

**What we found.**
- A rank correlation of **+0.28** between the score and real 30-day engagement,
  cross-validated across all 199 study creators — and **+0.25** on a sealed
  30-creator holdout the selection process never touched, opened exactly once.
- Videos the model ranks in a creator's top tier beat that creator's typical
  engagement **68% of the time — more than 2 in 3** (a coin flip would be 1 in 2).
- Validated enough to show a score in **18 of 19 niches** — in two of those we
  add a plain-language caveat that our top-pick hit rate is still maturing. In
  the one exception (dance), we say so plainly and show feedback without a
  score rather than make up a number.
- One finding we didn't expect: within this study's range (~15–80 seconds),
  longer videos consistently earned more engagement per viewer — a pattern the
  model uses, and one we deliberately report as a *correlation*, never as
  "make your videos longer" advice.

**What it can't do.** It doesn't predict viral moments, doesn't compare you to
other creators, and its patterns are correlational — describing what has
performed, not guaranteeing what will. We'd rather under-promise here than
oversell a number.

**What's happening now.** The score is live in PreviewPanel, and we're running
the next validation stage on real users: creators connect their handle, and we
compare the model's pre-post predictions against their videos' actual 30-day
results. The methodology, in more detail, is published at
**previewpanel.vercel.app/methodology**.

*Numbers box: 259 creators · ~4,900 videos · 19 niches · 30-day real outcomes ·
+0.28 cross-validated / +0.25 sealed-holdout rank correlation · 68% top-tier
precision (more than 2 in 3) · 30-creator lockbox, opened once · fully
pre-registered.*
