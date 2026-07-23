# Prompt-Cache Enablement — Readout

Direct-Anthropic prompt caching. App repo (`server.js`) + research repo
(`parser.py` Stage-D telemetry). **HARD RULE honored:** zero changes to prompt
TEXT or content ORDER anywhere — `cache_control` breakpoints and request
metadata only. Any site whose static block isn't already a byte-stable prefix
was REPORTED, not modified. Doc ticks to `PreviewPanel_Operations_and_Roadmap.md`
(§1c/§3d). Keep-warm untouched.

## 0. Verdict (read this first)

**Realized savings at current scale are negligible** — fractions of a cent per
app submission, and **zero on the batch paths**. Two structural reasons:

1. The only Anthropic call with a byte-stable static prefix is **synthesis**, and
   it's **app-only and sporadic** (one per user submission, never in a batch).
   Isolated calls pay a ~+25% write premium on the prefix (~$0.003); reads only
   pay off when submissions cluster within the 5-min window.
2. The **high-volume batch paths** (15-video prospect ingest, 400-video cohort)
   have exactly one Anthropic call each — the **C_dims vision extractor** — which
   is the **locked scoring artifact**. Its content order is `[frames…, text]`
   with per-video interpolation, so its static text is not a cacheable prefix. It
   is reported, not modified.

**Anthropic's ~37% blanket savings estimate does not fit this workload.** That
figure assumes a large static prefix reused across many calls in a batch. Here
the batchy calls are uncacheable-by-lock and the cacheable call isn't batched, so
the estimate's premise doesn't hold.

**The C_dims restructuring case is PARKED, with numbers** (§5). Even if
restructured, it saves ~$0.05 on a ~$1.50 15-video ingest and ~$1.40 on a ~$40
400-video cohort (~3%), while the entry cost is a **dual-run equivalence gate
(~$40–60)** to prove the restructured locked prompt scores identically, plus the
5-min window barely spanning the batch's per-video pacing. **Revisit only if
Claude-call volume grows ~100× (paid-tier scale).** No further cache work after
this dispatch.

## 1. Audit — every direct Anthropic call site (both repos)

Measured (`cache_creation_input_tokens` on a real first call = exact prefix size;
frames estimated at ~1500 tok/image):

| # | Site | Static block | Per-call dynamic | Byte-stable prefix? | Cluster | Action |
|---|------|-------------|------------------|---------------------|---------|--------|
| 1 | `backend/scoring/cdims.js:208` — C_dims extractor | ~1320-tok prompt, **last** (after ~6000 tok of frames), interpolates `{platform}/{posted_at}/{caption}/{audio_track}` | ~6000 tok frames (per-video) | **No** — frames-first order + interpolated text | batch (prospect ingest) | **REPORT** (locked artifact) |
| 2 | `backend/server.js:2584` — `structureWithClaude` (dormant fallback) | `system` = `You are ${judge.name}. …` (~30 tok, below the 1024-tok min), user block has `${rawAnalysis}` interleaved mid-prompt + `${platform}` in the JSON template | raw analysis prose | **No** — dynamic per-judge system + interleaved content | sporadic (fallback) | **REPORT** |
| 3 | `backend/server.js:2690` — synthesis | `system` = file-loaded module constant, **2503 tok (v2.4) / 3625 tok (v2.5)** | user JSON (judges + video + scoring_context, ~1.5–2.5k tok) | **Yes** — identical bytes, precedes user message | sporadic (app /api/analyze + link-fetch) | **ENABLE** |
| 4 | `correlation-research/parser.py:978` — Stage-D | ~1320-tok prompt, **last** (after frames), interpolated | ~6000 tok frames | **No** — same shape as #1 | batch (cohort) | **REPORT** (locked artifact) |
| 5 | `claude_features_v2{,_1}.py`, `phase6e_e6_anchors.py`, `phase6e_pairwise.py`, `analysis/…/phase3_claude_reliability.py` | vision prompts, `[frames…, text]` | frames | **No** — frames-first | batch / one-off research | **REPORT** (locked vision family) |

The "caption-hashtag" path is not a separate call site — it's a comment in
`server.js` describing the caption slot folded into the C_dims extractor (#1).
**Byte-stable check across two real payloads:** for synthesis the two payloads
differ only in the user message; the `system` block is a module constant injected
verbatim — confirmed identical, so the prefix is stable by construction.

## 2. Enabled

**Synthesis only** (the sole stable-prefix site). `system: "<string>"` →
`system: [{ type: "text", text: <same string>, cache_control: { type:
"ephemeral" } }]` — a **format** change; the prompt bytes and their order are
unchanged. 5-min ephemeral, no TTL upgrade, no reorder, no text edit. The
per-video user JSON stays uncached.

## 3. Telemetry

- **Synthesis** (`server.js`): every call logs `[synthesis] cache write=<n>
  read=<n> in=<n> out=<n> model=… prompt=…`.
- **Stage-D** (`parser.py`): per-call `[D] cache write/read` + a one-line
  per-batch summary (`[cache] parse-run/backfill-claude batch summary …`). The
  Stage-D vision prompt carries no breakpoint (locked), so these read **0/0** by
  design — the telemetry documents that and turns real automatically if the
  prompt is ever restructured.

## 4. Verification

Exercised the **exact synthesis request shape** the deployed path emits (real
system-prompt bytes, real `SYNTHESIS_ANTHROPIC_API_KEY`, real breakpoint):

```
BATCH (3 calls, shared v2.4 prefix):
  call 1: cache_creation(write)=2503  cache_read=0     input=29  output=48
  call 2: cache_creation(write)=0     cache_read=2503  input=32  output=48
  call 3: cache_creation(write)=0     cache_read=2503  input=30  output=48
SPORADIC (distinct v2.5 prefix — cache miss):
  call:   cache_creation(write)=3625  cache_read=0     input=29  output=48
```

- **Batch write→read confirmed:** call 1 writes the 2503-tok prefix; calls 2–3
  read it (90%-discounted). The prefix size is measured directly (2503 v2.4 /
  3625 v2.5).
- **Sporadic write-without-read confirmed:** a distinct prefix is a cache miss —
  a lone **write**, paying 1.25× on the cached tokens = **+25% premium on the
  prefix** (~$0.003 for 3625 tok). Acceptable in isolation; batches amortize it,
  but synthesis rarely batches.
- **Output lands (live path):** one real link-fetch submission through the
  deployed backend (`ecffa5b`) → `pp_synthesis` row written (submission 7238,
  `claude-sonnet-4-6`, `synthesis-v2.5`, 4665-char synthesis). Output-transparent,
  as expected. **Production runs v2.5**, so the live cached prefix is **3625 tok**.
  All proxy artifacts deleted afterward (verified zero residue).

Spend: ~$0.05 (harness) + ~$0.16 (two live submissions, one re-run) ≈ **$0.21**.

## 5. Readout math

**Pricing (Claude Sonnet 4.x):** input $3/Mtok · cache write $3.75/Mtok (1.25×) ·
cache read $0.30/Mtok (0.1×). Static-token **share** of synthesis input ≈
**3625 / (3625 + ~2000) ≈ 64%** (v2.5; the rest is per-video judge/scoring JSON).

**Per synthesis call, on the 3625-tok prefix:**
- no cache: $0.0109 · isolated write: $0.0136 (**+$0.0027 premium**) · cached
  read: $0.0011 (**saves ~$0.0098**, ~90%). Fractions of a cent either way.

**Standard shapes:**

| Shape | Anthropic calls | Cache-eligible | Realized saving |
|---|---|---|---|
| 15-video prospect ingest | 15 × C_dims vision | none (locked, uncacheable) | **$0** |
| 400-video cohort batch | 400 × Stage-D vision | none (locked, uncacheable) | **$0** |
| Single live app submission | 1 × synthesis | 3625-tok prefix | isolated: **+$0.0027**; each extra submission within 5 min: **−$0.0098** |

**PARKED — C_dims restructuring (numbers).** If the locked vision prompt were
reshaped to `[static-instructions (prefix), frames, per-video-fields]` and
de-interpolated: cacheable ≈ 1320 tok of ~7320 tok/call (~18% share). 15-video
ingest → ~$0.05 saved (on ~$1.50); 400-video cohort → ~$1.42 saved (on ~$40,
~3.5%) — and only if consecutive calls land inside the 5-min window, which the
~2–3-min-per-video pipeline pacing barely holds. Entry cost: reopening a **locked
scoring artifact** + a **dual-run equivalence gate (~$40–60)** to prove identical
scores. Net-negative until Claude-call volume grows ~100× (paid-tier posted-video
tracking at scale). Parked.

## 6. Git / deploy state

App repo `origin/main`: `ecffa5b` (synthesis cache_control + telemetry) — live on
Render (`shortSha=ecffa5b`), no frontend change, no schema change. Research repo
`origin/main`: `472f292` (Stage-D cache telemetry, no prompt change; runs on the
Mac, no deploy). This readout: a follow-up app-repo commit. Locked C_dims
extractor, `structureWithClaude`, and the research vision family were audited and
**left byte-for-byte unchanged**. Keep-warm untouched.
