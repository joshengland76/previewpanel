import { B } from "../brand.js";
import { MethodologyTrigger } from "./MethodologyModal.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// Score card. Renders whenever the backend returns a non-null scoreDisplay
// payload (i.e. whenever DISPLAY_SCORE="true" server-side). The separate
// frontend-side DISPLAY_SCORE_ENABLED gate from Phase B3 was removed in
// Phase B3b's Task 5 (gating collapse) -- the backend flag is now the single
// source of truth for whether this feature is live.
// ─────────────────────────────────────────────────────────────────────────────

function InfoIcon({ text }) {
  return (
    <span
      title={text}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 14, height: 14, borderRadius: "50%", marginLeft: 5,
        border: `1px solid ${B.grey}`, color: B.grey, fontSize: 10, fontWeight: 700,
        cursor: "help", flexShrink: 0,
      }}
    >
      i
    </span>
  );
}

function PoolRow({ headline, sub, tooltip, primary }) {
  if (!headline) return null;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", fontWeight: primary ? 800 : 600, fontSize: primary ? 16 : 13, color: primary ? B.body : B.grey }}>
        {headline}
        {tooltip && <InfoIcon text={tooltip} />}
      </div>
      {sub && <div style={{ fontSize: 11, color: B.grey, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function ScoreDisplay({ scoreDisplay }) {
  if (!scoreDisplay) return null;

  if (!scoreDisplay.showPercentile) {
    return (
      <section style={{ marginTop: 26 }}>
        <div style={{ background: "#fff", border: `1px solid ${B.border}`, borderRadius: 20, padding: "15px 17px" }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: B.body, marginBottom: 6 }}>
            {scoreDisplay.headline}
          </div>
          <div style={{ fontSize: 12, color: B.grey }}>{scoreDisplay.honestLine}</div>
        </div>
      </section>
    );
  }

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ background: "#fff", border: `1px solid ${B.border}`, borderRadius: 20, padding: "15px 17px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <PoolRow
            primary
            headline={scoreDisplay.headline}
            sub={scoreDisplay.sub}
            tooltip={scoreDisplay.poolInfoTooltip}
          />
          <PoolRow
            headline={scoreDisplay.overallAppHeadline}
            tooltip={scoreDisplay.poolInfoTooltip}
          />
          {scoreDisplay.personalHeadline && (
            <PoolRow headline={scoreDisplay.personalHeadline} />
          )}
        </div>
        {scoreDisplay.trimNote && (
          <div style={{ fontSize: 11, color: B.grey, marginTop: 12, fontStyle: "italic" }}>{scoreDisplay.trimNote}</div>
        )}
        <MethodologyTrigger />
      </div>
    </section>
  );
}

export default ScoreDisplay;
