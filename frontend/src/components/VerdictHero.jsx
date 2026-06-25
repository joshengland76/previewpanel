import { useEffect, useRef, useState } from "react";
import { B, JUDGES, ACTION } from "../brand.js";

// ─────────────────────────────────────────────────────────────────────────────
// Part B — Verdict hero + sticky condensed verdict bar.
//
// Consumes the real synthesis contract from /api/status:
//   .synthesis = { verdict:{headline_score,action,gist}, panel:{judges_present,
//                  judges_missing}, ... }
//   .results   = per-judge { status, data:{ overall, ... } }  (mini-scores)
//
// Renders nothing when synthesis is absent — the parent falls back to the raw
// judge view (graceful degradation when .synthesis is null / synthesisStatus !=
// "ready"). Brand tokens come from the shared brand.js (real owls/colors,
// Montserrat inherited).
// ─────────────────────────────────────────────────────────────────────────────

// Defensive: derive action from score if the model returns an unexpected value
// (backend overwrites action deterministically, but the UI must never crash).
function actionFor(verdict) {
  if (verdict?.action && ACTION[verdict.action]) return ACTION[verdict.action];
  const s = Number(verdict?.headline_score) || 0;
  return s >= 8 ? ACTION.post : s >= 5 ? ACTION.polish : ACTION.rework;
}

function judgeScore(results, id) {
  const r = results?.[id];
  return r && r.status === "done" && r.data && r.data.overall != null ? r.data.overall : null;
}

function Owl({ judge, size = 24 }) {
  return (
    <img src={judge.avatar} alt={judge.name}
      style={{ width: size, height: size, objectFit: "contain", display: "block",
        transform: judge.avatarScale ? `scale(${judge.avatarScale})` : undefined }} />
  );
}

// ── Gauge (same SVG idiom as PreviewPanel ScoreRing, scaled up) ──
function Gauge({ score, color, size = 132 }) {
  const stroke = 11;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(10, Number(score) || 0));
  const fill = (clamped / 10) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={B.lightBrown} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.16,1,0.3,1)" }} />
      <text x="50%" y="47%" dominantBaseline="middle" textAnchor="middle"
        fontSize="46" fontWeight="800" fill={B.body} fontFamily="Montserrat, sans-serif">{score}</text>
      <text x="50%" y="66%" dominantBaseline="middle" textAnchor="middle"
        fontSize="12" fontWeight="700" fill={B.grey} fontFamily="Montserrat, sans-serif">/ 10</text>
    </svg>
  );
}

function VerdictHero({ synthesis, results, onJumpToJudge, heroRef }) {
  const verdict = synthesis.verdict || {};
  const act = actionFor(verdict);
  const present = synthesis.panel?.judges_present || [];
  const missing = synthesis.panel?.judges_missing || [];
  const partial = missing.length > 0;

  return (
    <div ref={heroRef} style={{
      background: "#fff", border: `1px solid ${B.border}`, borderRadius: 20,
      boxShadow: "0 1px 2px rgba(60,40,20,.04), 0 6px 20px rgba(60,40,20,.05)",
      padding: "24px 20px 18px", textAlign: "center", position: "relative", overflow: "hidden",
    }}>
      <div style={{ width: 132, height: 132, margin: "2px auto 4px" }}>
        <Gauge score={verdict.headline_score} color={act.color} />
      </div>

      <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: ".12em",
        textTransform: "uppercase", color: act.color, marginTop: 6 }}>{act.label}</div>

      {partial && (
        <div style={{ fontSize: 11, color: B.grey, fontWeight: 700, marginTop: 3 }}>
          Based on {present.length} of {present.length + missing.length} judges
        </div>
      )}

      <p style={{ fontSize: 16, lineHeight: 1.5, color: B.body, fontWeight: 500,
        margin: "15px auto 4px", maxWidth: "34ch" }}>{verdict.gist}</p>

      {/* Judge mini-scores — tappable to jump to that judge's deep-dive */}
      <div style={{ display: "flex", justifyContent: "center", gap: 9, marginTop: 18,
        borderTop: `1px solid ${B.lightBrown}`, paddingTop: 16 }}>
        {JUDGES.filter((j) => results && results[j.id]).map((j) => {
          const score = judgeScore(results, j.id);
          const here = score != null;
          return (
            <button key={j.id} type="button" onClick={() => onJumpToJudge && onJumpToJudge(j.id)}
              style={{ flex: 1, maxWidth: 108, background: B.bg, border: `1px solid ${B.border}`,
                borderRadius: 14, padding: "9px 6px 8px", cursor: "pointer", textAlign: "center",
                fontFamily: "inherit", opacity: here ? 1 : 0.55 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                <Owl judge={j} size={24} />
                <span style={{ fontFamily: "Montserrat, sans-serif", fontWeight: 800, fontSize: 21,
                  lineHeight: 1, color: here ? j.color : B.grey }}>{here ? score : "—"}</span>
              </div>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#bbb", marginTop: 5 }}>{j.name}</div>
            </button>
          );
        })}
      </div>

      {/* Predicted performance — disabled placeholder (NOT wired) */}
      <div aria-disabled="true" style={{ margin: "12px auto 0", maxWidth: 342, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 10,
        background: "repeating-linear-gradient(135deg,#F3EDE1,#F3EDE1 8px,#EFE8DA 8px,#EFE8DA 16px)",
        border: `1px dashed ${B.border}`, borderRadius: 14, padding: "11px 14px" }}>
        <span style={{ width: 26, height: 26, flex: "none", borderRadius: "50%", background: B.lightBrown,
          display: "flex", alignItems: "center", justifyContent: "center", color: B.grey }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
        </span>
        <div style={{ textAlign: "left" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#8a8178" }}>Predicted performance</div>
          <div style={{ fontSize: 10.5, color: B.grey, marginTop: 1 }}>vs. your typical posts — trained on real day-30 results</div>
        </div>
        <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 800, letterSpacing: ".1em",
          textTransform: "uppercase", color: B.grey, background: "#fff", border: `1px solid ${B.border}`,
          padding: "3px 8px", borderRadius: 999 }}>Soon</span>
      </div>
    </div>
  );
}

// ── Sticky condensed verdict bar — revealed once the hero scrolls out of view ──
function StickyVerdictBar({ synthesis, results, visible, onJumpToJudge }) {
  const verdict = synthesis.verdict || {};
  const act = actionFor(verdict);
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 40, background: B.bg,
      maxHeight: visible ? 60 : 0, opacity: visible ? 1 : 0,
      overflow: "hidden", pointerEvents: visible ? "auto" : "none",
      transition: "max-height .3s ease, opacity .25s ease",
      borderBottom: visible ? `1px solid ${B.border}` : "1px solid transparent" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 4px" }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: act.color, flex: "none" }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: B.body, whiteSpace: "nowrap" }}>
          <b style={{ fontFamily: "Montserrat, sans-serif", fontSize: 14, fontWeight: 800 }}>{verdict.headline_score}</b>
          /10 · {act.label}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 5 }}>
          {JUDGES.filter((j) => results && results[j.id]).map((j) => {
            const score = judgeScore(results, j.id);
            return (
              <button key={j.id} type="button" onClick={() => onJumpToJudge && onJumpToJudge(j.id)}
                style={{ display: "flex", alignItems: "center", gap: 3, background: "#fff",
                  border: `1px solid ${B.border}`, borderRadius: 999, padding: "2px 8px 2px 4px",
                  cursor: "pointer", fontFamily: "Montserrat, sans-serif", fontWeight: 800, fontSize: 12.5,
                  color: score != null ? j.color : B.grey, opacity: score != null ? 1 : 0.55 }}>
                <Owl judge={j} size={16} />{score != null ? score : "—"}
              </button>
            );
          })}
        </span>
      </div>
    </div>
  );
}

// Combined section: sticky bar + hero, with the scroll-observer wiring. Render
// only when synthesis is ready; otherwise the parent shows the raw judge view.
export function VerdictPanel({ synthesis, results, onJumpToJudge }) {
  const heroRef = useRef(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = heroRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 0, rootMargin: "-64px 0px 0px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!synthesis || !synthesis.verdict) return null;

  return (
    <div>
      <StickyVerdictBar synthesis={synthesis} results={results} visible={scrolled} onJumpToJudge={onJumpToJudge} />
      <VerdictHero synthesis={synthesis} results={results} onJumpToJudge={onJumpToJudge} heroRef={heroRef} />
    </div>
  );
}

export default VerdictPanel;
