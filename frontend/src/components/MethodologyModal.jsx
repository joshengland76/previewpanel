import { useState } from "react";
import { B } from "../brand.js";
import { METHODOLOGY_MODAL_TEXT, STUDY_STATS } from "../studyCopy.js";

// "How this score works" -- score display UI overhaul: this now matches
// PerformanceRadar's "What do these signals mean?" pattern exactly (icon +
// text + chevron button, content revealed INLINE below, no modal for this
// first level) rather than opening its own modal. "See how we validated it"
// still drills one level deeper into a real modal (ValidationDetail) -- that
// content is long enough (stats grid, several sections) that a modal still
// earns its keep there; only the outer, first-click affordance changed to
// stop behaving like a link and start behaving like the scorecard's dropdown.
// poolInfoTooltip (the pool-composition note, previously a separate hover-
// only "i" icon next to the percentile stats) is now folded into this same
// expanded content -- one info affordance total, not two.
export function MethodologyDropdown({ platform = null, poolInfoTooltip = null }) {
  const [open, setOpen] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        style={{
          display: "flex", alignItems: "center", gap: 6, margin: "0 auto", background: B.bg,
          border: `1px solid ${B.border}`, borderRadius: 999, padding: "6px 12px", cursor: "pointer",
          fontFamily: "inherit", fontSize: 11, fontWeight: 700, color: "#8a8178",
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
        </svg>
        How the scoring works
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div style={{
          marginTop: 11, textAlign: "left", fontSize: 12.5, lineHeight: 1.55, color: B.body,
          borderTop: `1px solid ${B.lightBrown}`, paddingTop: 12, whiteSpace: "pre-line",
        }}>
          {METHODOLOGY_MODAL_TEXT.replace(" See how we validated it →", "")}
          {platform && platform !== "tiktok" && (
            <div style={{ marginTop: 10 }}>
              This score is based on our TikTok engagement study — treat it as a strong proxy for other short-form platforms.
            </div>
          )}
          {poolInfoTooltip && <div style={{ marginTop: 10 }}>{poolInfoTooltip}</div>}
          {/* Inline link, flush with the preceding sentence (normal word-spacing,
              no orphan gap): a leading space + display:inline so it reads as the
              last words of the body, not a detached block. */}
          {" "}
          <button
            type="button"
            onClick={() => setShowDetail(true)}
            style={{
              display: "inline", fontSize: 12.5, fontWeight: 700, color: B.action,
              background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit",
            }}
          >
            See how we validated it →
          </button>
        </div>
      )}

      {showDetail && (
        <div
          onClick={() => setShowDetail(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(20,15,10,.45)",
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 20, zIndex: 1000,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff", borderRadius: 20, maxWidth: 460, width: "100%",
              maxHeight: "85vh", overflowY: "auto",
              padding: "24px 22px", boxShadow: "0 12px 40px rgba(0,0,0,.25)",
            }}
          >
            <ValidationDetail onClose={() => setShowDetail(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

// Content mirrors frontend/public/methodology.html's prose exactly (that
// static page stays as the external/shareable version); duplicated rather
// than shared at build time since one is a static asset and this is live
// React, but both must be updated together if the study copy ever changes.
function ValidationDetail({ onClose }) {
  return (
    <div>
      <button
        type="button"
        onClick={onClose}
        style={{
          display: "flex", alignItems: "center", gap: 4, background: "none", border: "none",
          padding: 0, marginBottom: 14, fontSize: 12, fontWeight: 700, color: B.grey, cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        Back
      </button>

      <div style={{ fontWeight: 800, fontSize: 16, color: B.body, marginBottom: 4 }}>
        How we validated the PreviewPanel score
      </div>
      <div style={{ fontSize: 11.5, color: B.grey, marginBottom: 16 }}>
        A plain explanation of the study behind the prediction.
      </div>

      <Section title="What we did">
        We recruited {STUDY_STATS.nCreators} creators across {STUDY_STATS.nNiches} content
        niches and collected about 4,900 of their TikTok videos. Before we ever looked at how those
        videos actually performed, our AI judging panel scored each one on hook strength,
        emotional pull, pacing, clarity, and related factors. Only after scoring was
        locked in did we track each video's real {STUDY_STATS.outcomeWindowDays}-day
        engagement: likes, shares, and saves per view.
      </Section>

      <Section title="How we kept ourselves honest">
        The model was tested only on creators it had never seen during training. Before
        testing began, we set aside a sealed group of {STUDY_STATS.lockboxCreators}{" "}
        creators — a "lockbox" — and opened it exactly once. Every analysis choice was
        written down and dated before we saw its result, not after. Every video is scored
        against its own creator's typical performance, not the whole platform's.
      </Section>

      {/* Numbers here mirror STUDY_STATS (decile pairwise/pooled CV+lockbox,
          rank correlations, niches); exact copy per VALIDATION_MODAL_READOUT. */}
      <Section title="What we found">
        <p style={{ margin: "0 0 8px" }}>
          Head-to-head, the videos our model ranked in a creator's top decile beat that same
          creator's bottom-decile videos 3 times in 4 — 75.6% of all top-vs-bottom pairings,
          cross-validated across 199 creators — and drew 1.6× their 30-day engagement. On the
          30 sealed creators opened exactly once: 70% and 1.5×.
        </p>
        <p style={{ margin: "0 0 8px" }}>
          Against each creator's own average video, top-decile picks beat typical engagement 68% of
          the time — more than 2 in 3 (a coin flip would be 1 in 2) — averaging about 1.4× typical,
          while bottom-decile picks averaged about 0.9×.
        </p>
        <p style={{ margin: 0 }}>
          Overall held-out rank correlation: +0.28 cross-validated, +0.25 on the sealed holdout.
          The scored experience holds in 18 of the 19 niches we studied — 2 of those carry a
          plain-language note that top-pick precision is still maturing, and the remaining niche
          (dance) gets qualitative feedback only while we keep collecting data.
        </p>
      </Section>

      <Section title="What it can't do">
        This is not a virality predictor, and a score is never a promise about any single
        video's outcome. The patterns behind the score are correlations measured across
        thousands of real videos — a read on how your video is likely to stack up, not a
        guarantee, and not a set of mechanical instructions.
      </Section>

      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
        background: B.bg, border: `1px solid ${B.border}`, borderRadius: 14, padding: 14, margin: "16px 0",
      }}>
        <Stat value="3 in 4" label="head-to-head wins, top vs bottom decile" />
        <Stat value="1.6×" label="top-decile engagement vs bottom" />
        <Stat value={`+${STUDY_STATS.crossValidatedRankCorrelation}`} label="Cross-validated correlation" />
        <Stat value="68%" label="top-decile precision" />
        <Stat value="~4,900" label="videos studied" />
        <Stat value={STUDY_STATS.nCreators} label="creators" />
        <Stat value={`${STUDY_STATS.outcomeWindowDays} days`} label="real engagement window" />
        <Stat value={`${STUDY_STATS.nNichesWithScores} / ${STUDY_STATS.nNiches}`} label="niches with a score shown" />
      </div>

      <button
        onClick={onClose}
        style={{
          display: "block", marginLeft: "auto", background: B.lightBrown,
          border: "none", borderRadius: 999, padding: "8px 16px", fontSize: 12,
          fontWeight: 700, color: B.body, cursor: "pointer",
        }}
      >
        Close
      </button>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: B.body, marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "#5c544a" }}>{children}</div>
    </div>
  );
}

function Stat({ value, label }) {
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 800, color: B.action }}>{value}</div>
      <div style={{ fontSize: 10, color: B.grey, marginTop: 1 }}>{label}</div>
    </div>
  );
}

export default MethodologyDropdown;
