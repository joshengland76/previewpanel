import { B, VALENCE, JUDGE_BY_CANON } from "../brand.js";

// ─────────────────────────────────────────────────────────────────────────────
// Part B — conditional "Where they disagree" card (from synthesis.consensus.splits).
// Each split = neutral question + contrasting judge positions (owl + colored name
// + stance). Renders NOTHING when splits is empty (the common case, e.g. crookie)
// — no header, no empty state.
// ─────────────────────────────────────────────────────────────────────────────

const AMBER = VALENCE.split;

function Owl({ canon, size = 16 }) {
  const j = JUDGE_BY_CANON[canon];
  if (!j) return null;
  return <img src={j.avatar} alt={j.name} style={{ width: size, height: size, objectFit: "contain", flexShrink: 0, transform: j.avatarScale ? `scale(${j.avatarScale})` : undefined }} />;
}

function SplitItem({ split }) {
  const positions = (split.positions || []).filter((p) => JUDGE_BY_CANON[p.judge] && p.stance);
  const twoUp = positions.length === 2;
  return (
    <div style={{ background: B.bg, border: `1px solid ${B.lightBrown}`, borderRadius: 14, padding: "12px 13px" }}>
      {split.question && <div style={{ fontSize: 11, fontWeight: 700, color: "#8a8178", marginBottom: 9 }}>{split.question}</div>}
      <div style={twoUp
        ? { display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 9, alignItems: "stretch" }
        : { display: "flex", flexDirection: "column", gap: 10 }}>
        {positions.flatMap((p, i) => {
          const j = JUDGE_BY_CANON[p.judge];
          const side = (
            <div key={`pos-${i}`} style={{ fontSize: 12, lineHeight: 1.4, color: B.body }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4, fontSize: 10, fontWeight: 800, letterSpacing: ".03em", textTransform: "uppercase", color: j.color }}>
                <Owl canon={p.judge} size={16} />{j.name}
              </div>
              {p.stance}
            </div>
          );
          return twoUp && i === 1
            ? [<div key="vs" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontStyle: "italic", fontSize: 11, color: B.grey, border: `1px solid ${B.border}`, borderRadius: 999, padding: "2px 7px", background: "#fff" }}>vs</span>
              </div>, side]
            : [side];
        })}
      </div>
    </div>
  );
}

export function DisagreementCard({ synthesis }) {
  const splits = (synthesis?.consensus?.splits || []).filter((s) => s && (s.positions || []).length > 0);
  if (splits.length === 0) return null;

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ fontWeight: 800, fontSize: 16, color: B.body, margin: "0 2px 10px" }}>Where they disagree</div>
      <div style={{ background: "#fff", border: `1px solid ${B.border}`, borderRadius: 20,
        boxShadow: "0 1px 2px rgba(60,40,20,.04), 0 6px 20px rgba(60,40,20,.05)", padding: "15px 17px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
          <span style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, background: AMBER + "26", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a6a1f" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 9c0 6-12 6-12 6" /></svg>
          </span>
          <span style={{ fontSize: 12, color: B.grey, fontWeight: 600 }}>The panel split — your call</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {splits.map((s, i) => <SplitItem key={i} split={s} />)}
        </div>
      </div>
    </section>
  );
}

export default DisagreementCard;
