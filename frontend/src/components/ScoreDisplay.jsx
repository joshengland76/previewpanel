import { B } from "../brand.js";

// ─────────────────────────────────────────────────────────────────────────────
// Phase B3, Task 5 — dark-launched score display. Renders NOTHING unless the
// backend actually returned a scoreDisplay object (only happens when the
// server's DISPLAY_SCORE flag is "true", which it is not in production yet).
// DISPLAY_SCORE_ENABLED below is a second, frontend-side gate so this never
// renders even if a future dev flips the backend flag without meaning to
// surface it in the UI yet -- B3's user-facing review is what should flip
// this, not an accidental env change.
// ─────────────────────────────────────────────────────────────────────────────

export const DISPLAY_SCORE_ENABLED = false;

export function ScoreDisplay({ scoreDisplay }) {
  if (!DISPLAY_SCORE_ENABLED || !scoreDisplay) return null;

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

  const lines = [scoreDisplay.headline, scoreDisplay.personalHeadline, scoreDisplay.overallAppHeadline].filter(Boolean);

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ background: "#fff", border: `1px solid ${B.border}`, borderRadius: 20, padding: "15px 17px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {lines.map((line, i) => (
            <div key={i} style={{ fontWeight: i === 0 ? 800 : 600, fontSize: i === 0 ? 15 : 13, color: i === 0 ? B.body : B.grey }}>
              {line}
            </div>
          ))}
        </div>
        {scoreDisplay.trimNote && (
          <div style={{ fontSize: 11, color: B.grey, marginTop: 10, fontStyle: "italic" }}>{scoreDisplay.trimNote}</div>
        )}
      </div>
    </section>
  );
}

export default ScoreDisplay;
