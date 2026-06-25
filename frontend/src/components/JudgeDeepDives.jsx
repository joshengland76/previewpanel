import { B, JUDGES, VALENCE } from "../brand.js";

// ─────────────────────────────────────────────────────────────────────────────
// Part B — Collapsible per-judge deep-dive cards (the only collapsed part of the
// page; the overview above stays open). Reads judge data from .results[id].data:
//   positives ("What's working"), objective_fit{verdict,score,reasoning},
//   delivery ("How it's presented"), content ("What's shown"), platformFit,
//   moments:[{timestamp,type,note}], reaction (header quote), overall (score).
//
// The old per-judge signal bars are intentionally NOT rendered (radar replaced
// them). Missing fields omit their sub-section. A judge that didn't return shows
// a collapsed "didn't respond" card (no retry).
//
// Controlled open state (openIds + onToggle) so the verdict hero / sticky bar can
// jump to and expand a specific judge.
// ─────────────────────────────────────────────────────────────────────────────

const OF = {
  hits: { label: "Hits the objective", c: "#2E7D32", bg: "#E8F5E9" },
  partial: { label: "Partially hits", c: "#E65100", bg: "#FFF3E0" },
  misses: { label: "Misses the objective", c: "#C62828", bg: "#FFEBEE" },
};

function momentMark(type) {
  if (type === "peak") return { ch: "▲", c: VALENCE.strength };
  if (type === "drop") return { ch: "▼", c: VALENCE.risk };
  return { ch: "•", c: B.grey };
}

function Section({ label, children }) {
  return (
    <div style={{ marginTop: 15 }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase",
        color: "#9C9281", marginBottom: 7 }}>{label}</div>
      {children}
    </div>
  );
}

function JudgeCard({ judge, result, open, onToggle }) {
  const data = result && result.status === "done" ? result.data : null;

  // Didn't-return card (partial) — collapsed, greyed, no retry.
  if (!data) {
    return (
      <div id={`judge-${judge.id}`} style={{ background: "#fff", border: `1px solid ${B.border}`,
        borderLeft: `4px solid ${B.border}`, borderRadius: 16, padding: "14px 15px",
        display: "flex", alignItems: "center", gap: 12, opacity: 0.85, marginBottom: 11 }}>
        <img src={judge.avatar} alt={judge.name} style={{ width: 40, height: 40, objectFit: "contain", flexShrink: 0,
          transform: judge.avatarScale ? `scale(${judge.avatarScale})` : undefined, filter: "grayscale(1)", opacity: 0.5 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: "#bbb" }}>{judge.name}</div>
          <div style={{ fontSize: 11.5, color: B.grey, marginTop: 2 }}>Didn't return a verdict on this run.</div>
        </div>
        <span style={{ fontWeight: 800, fontSize: 22, color: "#ccc", flexShrink: 0 }}>—</span>
      </div>
    );
  }

  const of = data.objective_fit && OF[data.objective_fit.verdict];

  return (
    <div id={`judge-${judge.id}`} style={{ background: "#fff", border: `1px solid ${B.border}`,
      borderLeft: `4px solid ${judge.color}`, borderRadius: 16, overflow: "hidden", marginBottom: 11,
      boxShadow: open ? "0 2px 18px rgba(60,40,20,.07)" : "0 1px 2px rgba(60,40,20,.04)" }}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer",
          padding: "14px 15px", display: "flex", alignItems: "center", gap: 12, fontFamily: "inherit" }}>
        <img src={judge.avatar} alt={judge.name} style={{ width: 40, height: 40, objectFit: "contain", flexShrink: 0,
          transform: judge.avatarScale ? `scale(${judge.avatarScale})` : undefined }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.1, color: judge.color }}>{judge.name}</div>
          <div style={{ fontSize: 11, color: B.grey, marginTop: 1 }}>{judge.tagline}</div>
          {data.reaction && <div style={{ fontSize: 12, color: "#5c544a", lineHeight: 1.4, marginTop: 6, fontStyle: "italic" }}>"{data.reaction}"</div>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flexShrink: 0 }}>
          <span style={{ fontWeight: 800, fontSize: 24, lineHeight: 1, color: judge.color }}>{data.overall ?? "—"}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9C9281" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .25s" }}><path d="m6 9 6 6 6-6" /></svg>
        </div>
      </button>

      {open && (
        <div style={{ padding: "2px 15px 16px", borderTop: `1px solid ${B.lightBrown}` }}>
          {data.positives && (
            <Section label="What's working">
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, lineHeight: 1.5, color: B.body,
                background: VALENCE.strength + "14", border: `1px solid ${VALENCE.strength}3a`, borderLeft: `3px solid ${VALENCE.strength}`,
                borderRadius: 10, padding: "10px 12px" }}>
                <span style={{ color: "#3F7049", flexShrink: 0, marginTop: 1 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                </span>
                {data.positives}
              </div>
            </Section>
          )}

          {data.objective_fit && (
            <Section label="Objective fit">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase",
                  color: of ? of.c : B.grey, background: of ? of.bg : B.bg, padding: "3px 8px", borderRadius: 6 }}>
                  {of ? of.label : data.objective_fit.verdict}
                </span>
                {data.objective_fit.score != null && (
                  <span style={{ marginLeft: "auto", fontWeight: 800, fontSize: 18, color: B.body }}>
                    {data.objective_fit.score}<span style={{ fontSize: 11, color: B.grey, fontWeight: 600 }}>/10</span>
                  </span>
                )}
              </div>
              {data.objective_fit.reasoning && <div style={{ fontSize: 12.5, lineHeight: 1.5, color: B.body, marginTop: 7 }}>{data.objective_fit.reasoning}</div>}
            </Section>
          )}

          {(data.delivery || data.content) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 13, marginTop: 15 }}>
              {data.delivery && (
                <div><div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "#9C9281", marginBottom: 7 }}>How it's presented</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: B.body }}>{data.delivery}</div></div>
              )}
              {data.content && (
                <div><div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: "#9C9281", marginBottom: 7 }}>What's shown</div>
                  <div style={{ fontSize: 12.5, lineHeight: 1.5, color: B.body }}>{data.content}</div></div>
              )}
            </div>
          )}

          {data.platformFit && (
            <Section label="Platform fit"><div style={{ fontSize: 12.5, lineHeight: 1.5, color: B.body }}>{data.platformFit}</div></Section>
          )}

          {Array.isArray(data.moments) && data.moments.length > 0 && (
            <Section label={`Every moment the ${judge.name.replace("The ", "")} noted`}>
              {data.moments.map((m, i) => {
                const mk = momentMark(m.type);
                return (
                  <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "6px 0",
                    borderTop: i === 0 ? "none" : `1px dashed ${B.lightBrown}` }}>
                    <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10.5, fontWeight: 700, color: judge.color,
                      background: judge.color + "14", borderRadius: 5, padding: "2px 6px", flexShrink: 0 }}>{m.timestamp}</span>
                    <span style={{ color: mk.c, flexShrink: 0, marginTop: 1, fontSize: 10 }}>{mk.ch}</span>
                    <span style={{ fontSize: 11.5, lineHeight: 1.4, color: "#5c544a" }}>{m.note}</span>
                  </div>
                );
              })}
            </Section>
          )}

          {Array.isArray(data.suggestions) && data.suggestions.length > 0 && (
            <Section label="Suggestions">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.suggestions.map((s, i) => (
                  <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                    <div style={{ width: 18, height: 18, borderRadius: "50%", background: judge.color, color: "#fff",
                      fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
                    <span style={{ fontSize: 12.5, lineHeight: 1.5, color: B.body }}>{s}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

export function JudgeDeepDives({ results, openIds, onToggle }) {
  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ fontWeight: 800, fontSize: 16, color: B.body, margin: "0 2px 2px" }}>The full panel</div>
      <div style={{ fontSize: 11, color: B.grey, margin: "0 2px 12px" }}>Tap a judge for their complete read.</div>
      {JUDGES.filter((j) => results && results[j.id]).map((j) => (
        <JudgeCard key={j.id} judge={j} result={results?.[j.id]}
          open={!!openIds && openIds.has(j.id)} onToggle={() => onToggle && onToggle(j.id)} />
      ))}
    </section>
  );
}

export default JudgeDeepDives;
