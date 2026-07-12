import { useState } from "react";
import { B } from "../brand.js";
import { METHODOLOGY_MODAL_TEXT, STUDY_STATS } from "../studyCopy.js";

// "How this score works" -- a trigger + modal, with an in-app "full"
// validation view. The full view used to be a real page navigation
// (target="_blank" to /methodology) -- inside the installed PWA that could
// open with no browser chrome and no way back, trapping the user (reported
// bug: had to force-quit the app). Fixed by keeping everything inside this
// same overlay: "See how we validated it" swaps to a second internal view,
// not a new page, so the existing Back/Close buttons always work. The
// static /methodology.html page still exists for external/shareable links,
// it's just no longer where this in-app flow sends anyone.

export function MethodologyTrigger({ pillStyle = false, platform = null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={pillStyle ? {
          display: "flex", alignItems: "center", gap: 6, margin: "12px auto 0", background: B.bg,
          border: `1px solid ${B.border}`, borderRadius: 999, padding: "6px 12px", cursor: "pointer",
          fontFamily: "inherit", fontSize: 11, fontWeight: 700, color: "#8a8178",
        } : {
          background: "none", border: "none", padding: 0, marginTop: 10,
          fontSize: 12, color: B.grey, textDecoration: "underline", cursor: "pointer",
        }}
      >
        {pillStyle && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" strokeLinecap="round" />
          </svg>
        )}
        How this score works
      </button>
      {open && <MethodologyModal onClose={() => setOpen(false)} platform={platform} />}
    </>
  );
}

function MethodologyModal({ onClose, platform }) {
  const [view, setView] = useState("summary"); // "summary" | "full"

  return (
    <div
      onClick={onClose}
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
        {view === "summary" ? (
          <>
            <div style={{ fontWeight: 800, fontSize: 16, color: B.body, marginBottom: 12 }}>
              How this score works
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, color: B.body, whiteSpace: "pre-line" }}>
              {METHODOLOGY_MODAL_TEXT.replace(" See how we validated it →", "")}
              {platform && platform !== "tiktok" && (
                <div style={{ marginTop: 10 }}>
                  This score is based on our TikTok engagement study — treat it as a strong proxy for other short-form platforms.
                </div>
              )}
              <div style={{ marginTop: 10 }}>
                Scores naturally vary a few points between analyses of the same video; repeat runs of the same video are averaged.
              </div>
            </div>
            <button
              type="button"
              onClick={() => setView("full")}
              style={{
                display: "inline-block", marginTop: 14, fontSize: 13, fontWeight: 700, color: B.action,
                background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              See how we validated it →
            </button>
            <button
              onClick={onClose}
              style={{
                display: "block", marginTop: 18, marginLeft: "auto", background: B.lightBrown,
                border: "none", borderRadius: 999, padding: "8px 16px", fontSize: 12,
                fontWeight: 700, color: B.body, cursor: "pointer",
              }}
            >
              Close
            </button>
          </>
        ) : (
          <ValidationDetail onBack={() => setView("summary")} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

// Content mirrors frontend/public/methodology.html's prose exactly (that
// static page stays as the external/shareable version); duplicated rather
// than shared at build time since one is a static asset and this is live
// React, but both must be updated together if the study copy ever changes.
function ValidationDetail({ onBack, onClose }) {
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
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
        niches and collected their TikTok videos. Before we ever looked at how those
        videos actually performed, our judging panel scored each one on hook strength,
        emotional pull, pacing, clarity, and related factors. Only after scoring was
        locked in did we track each video's real {STUDY_STATS.outcomeWindowDays}-day
        engagement: likes, shares, and saves per view.
      </Section>

      <Section title="How we kept ourselves honest">
        The model was tested only on creators it had never seen during training. Before
        testing began, we set aside a sealed group of {STUDY_STATS.lockboxCreators}{" "}
        creators — a "lockbox" — and opened it exactly once. Every analysis choice was
        written down and dated before we saw its result, not after ({STUDY_STATS.preregAmendments}{" "}
        logged amendments). Every video is scored against its own creator's typical
        performance, not the whole platform's.
      </Section>

      <Section title="What we found">
        Videos the model ranked in its top tier beat the creator's own typical
        engagement {STUDY_STATS.precisionAtDecileCasual} — well ahead of a coin flip.
        That held up reliably in {STUDY_STATS.nNichesReliable} of the {STUDY_STATS.nNiches} niches
        we studied. For the rest, you'll see qualitative feedback instead of a numeric
        score while we keep collecting data.
      </Section>

      <Section title="What it can't do">
        This is not a virality predictor and makes no promises about any single outcome.
        The patterns it's built on are correlational, not causal instructions — it
        doesn't tell you to make a video longer or shorter just because duration is one
        of the things it accounts for. Validating it against real PreviewPanel users'
        own posted videos is ongoing work, not yet complete.
      </Section>

      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
        background: B.bg, border: `1px solid ${B.border}`, borderRadius: 14, padding: 14, margin: "16px 0",
      }}>
        <Stat value={`+${STUDY_STATS.heldOutRankCorrelation}`} label="held-out rank correlation" />
        <Stat value="~68%" label="top-tier precision" />
        <Stat value="~4,900" label="videos studied" />
        <Stat value={STUDY_STATS.nCreators} label="creators" />
        <Stat value={`${STUDY_STATS.outcomeWindowDays} days`} label="real engagement window" />
        <Stat value={`${STUDY_STATS.nNichesReliable} / ${STUDY_STATS.nNiches}`} label="niches scored numerically" />
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

export default MethodologyTrigger;
