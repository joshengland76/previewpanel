import { useEffect, useRef, useState } from "react";
import { B, JUDGES, ACTION } from "../brand.js";
import { MethodologyDropdown } from "./MethodologyModal.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// Part B — Verdict hero + sticky condensed verdict bar.
//
// Consumes the real synthesis contract from /api/status:
//   .synthesis = { verdict:{headline_score,action,gist}, panel:{judges_present,
//                  judges_missing}, ... }
//   .results   = per-judge { status, data:{ overall, ... } }  (mini-scores,
//                used only by the sticky bar now -- the hero's own judge
//                mini-score row was removed, see below)
//   .scoreDisplay = the capstone-v2 percentile payload (null if DISPLAY_SCORE
//                is off, or not ready yet, or an older submission predates it)
//
// The hero's main circle used to show the combined judge score (0-10), then
// (a later revision) the niche percentile. Score display UI overhaul: it now
// shows the OVERALL-APP percentile (vs the last 1,000 videos scored) -- the
// largest, most stable pool, so it's the most representative single number
// for the main circle. Niche and personal percentiles are still shown, as
// more prominent secondary stats (see SecondaryStat below) rather than
// blended into small fine print. Falls back to the old judge-score gauge
// when scoreDisplay is absent, so the hero never looks broken for
// submissions without it. Renders nothing when synthesis is absent, same as
// before.
// ─────────────────────────────────────────────────────────────────────────────

// Defensive: derive action from score if the model returns an unexpected value
// (backend overwrites action deterministically, but the UI must never crash).
// Still used for the no-scoreDisplay fallback gauge's color; the "POLISH
// FIRST"/etc. label itself was removed from the hero (score display UI
// overhaul) -- the percentile stats carry that signal now.
function actionFor(verdict) {
  if (verdict?.action && ACTION[verdict.action]) return ACTION[verdict.action];
  const s = Number(verdict?.headline_score) || 0;
  return s >= 8 ? ACTION.post : s >= 5 ? ACTION.polish : ACTION.rework;
}

// Percentile -> color, same 3-color scale as the judge-score action colors
// (green/amber/red), banded into rough thirds: >=66 green, >=33 amber, else
// red. Unchanged by the score display UI overhaul (still applied to whichever
// percentile drives the main gauge) -- only WHICH percentile it colors moved.
function percentileColor(p) {
  if (p == null) return B.grey;
  if (p >= 66) return ACTION.post.color;
  if (p >= 33) return ACTION.polish.color;
  return ACTION.rework.color;
}

// Secondary percentile stat (niche, personal) -- score display UI overhaul:
// previously 12px grey text that read as fine print; now a bordered stat
// pill with real weight, so these don't get lost next to the main gauge.
function SecondaryStat({ label, sub }) {
  return (
    <div style={{
      background: B.bg, border: `1px solid ${B.border}`, borderRadius: 12,
      padding: "8px 14px", textAlign: "center", minWidth: 0,
    }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: B.body, lineHeight: 1.3 }}>{label}</div>
      {sub && <div style={{ fontSize: 10.5, color: B.grey, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Gauge (same SVG idiom throughout -- value/max generalized so it can show
//    either a percentile (0-100) or the legacy judge score (0-10)) ──
function Gauge({ value, max, unitLabel, color, size = 132 }) {
  const stroke = 11;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(max, Number(value) || 0));
  const fill = (clamped / max) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={B.lightBrown} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.16,1,0.3,1)" }} />
      <text x="50%" y="47%" dominantBaseline="middle" textAnchor="middle"
        fontSize="46" fontWeight="800" fill={B.body} fontFamily="Montserrat, sans-serif">{value}</text>
      <text x="50%" y="66%" dominantBaseline="middle" textAnchor="middle"
        fontSize="12" fontWeight="700" fill={B.grey} fontFamily="Montserrat, sans-serif">{unitLabel}</text>
    </svg>
  );
}

// ABSTAIN: a neutral ring (no fill, no number) -- there is deliberately no
// percentile to show here, the honest line below explains why.
function AbstainRing({ size = 132 }) {
  const stroke = 11;
  const r = (size - stroke) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={B.lightBrown} strokeWidth={stroke} />
      <text x="50%" y="53%" dominantBaseline="middle" textAnchor="middle"
        fontSize="40" fontWeight="800" fill={B.grey} fontFamily="Montserrat, sans-serif">—</text>
    </svg>
  );
}

function VerdictHero({ synthesis, scoreDisplay, onJumpToJudge, heroRef, platform }) {
  const verdict = synthesis.verdict || {};
  const act = actionFor(verdict);
  const present = synthesis.panel?.judges_present || [];
  const missing = synthesis.panel?.judges_missing || [];
  const partial = missing.length > 0;

  const hasPercentile = !!(scoreDisplay && scoreDisplay.showPercentile);
  const isAbstain = !!(scoreDisplay && !scoreDisplay.showPercentile);

  return (
    <div ref={heroRef} style={{
      background: "#fff", border: `1px solid ${B.border}`, borderRadius: 20,
      boxShadow: "0 1px 2px rgba(60,40,20,.04), 0 6px 20px rgba(60,40,20,.05)",
      padding: "24px 20px 18px", textAlign: "center", position: "relative", overflow: "hidden",
    }}>
      <div style={{ width: 132, height: 132, margin: "2px auto 4px" }}>
        {hasPercentile ? (
          <Gauge value={scoreDisplay.overallAppPercentile} max={100} unitLabel="percentile" color={percentileColor(scoreDisplay.overallAppPercentile)} />
        ) : isAbstain ? (
          <AbstainRing />
        ) : (
          <Gauge value={verdict.headline_score} max={10} unitLabel="/ 10" color={act.color} />
        )}
      </div>

      {hasPercentile && (
        <div style={{ marginTop: 4 }}>
          {scoreDisplay.overallAppHeadline && (
            <div style={{ fontSize: 15, fontWeight: 800, color: B.body }}>{scoreDisplay.overallAppHeadline}</div>
          )}
          {(scoreDisplay.headline || scoreDisplay.personalHeadline) && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              {scoreDisplay.headline && (
                <SecondaryStat label={scoreDisplay.headline} sub={scoreDisplay.sub} />
              )}
              {scoreDisplay.personalHeadline && (
                <SecondaryStat label={scoreDisplay.personalHeadline} />
              )}
            </div>
          )}
        </div>
      )}

      {isAbstain && (
        <div style={{ fontSize: 13, lineHeight: 1.4, color: B.grey, marginTop: 6, maxWidth: 280, marginLeft: "auto", marginRight: "auto" }}>
          {scoreDisplay.honestLine}
        </div>
      )}

      {partial && (
        <div style={{ fontSize: 11, color: B.grey, fontWeight: 700, marginTop: 14 }}>
          Based on {present.length} of {present.length + missing.length} judges
        </div>
      )}

      <p style={{ fontSize: 16, lineHeight: 1.5, color: B.body, fontWeight: 500,
        margin: "15px auto 4px", maxWidth: "34ch" }}>{verdict.gist}</p>

      {scoreDisplay?.groupAverageNote && (
        <div style={{ fontSize: 11, color: B.grey, marginTop: 8, maxWidth: 320, marginLeft: "auto", marginRight: "auto" }}>
          {scoreDisplay.groupAverageNote}
        </div>
      )}

      {scoreDisplay?.trimNote && (
        <div style={{ fontSize: 11, color: B.grey, marginTop: 8, fontStyle: "italic", maxWidth: 320, marginLeft: "auto", marginRight: "auto" }}>
          {scoreDisplay.trimNote}
        </div>
      )}

      <MethodologyDropdown platform={platform} poolInfoTooltip={scoreDisplay?.poolInfoTooltip} />
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
            const r = results?.[j.id];
            const score = r && r.status === "done" && r.data && r.data.overall != null ? r.data.overall : null;
            return (
              <button key={j.id} type="button" onClick={() => onJumpToJudge && onJumpToJudge(j.id)}
                style={{ display: "flex", alignItems: "center", gap: 3, background: "#fff",
                  border: `1px solid ${B.border}`, borderRadius: 999, padding: "2px 8px 2px 4px",
                  cursor: "pointer", fontFamily: "Montserrat, sans-serif", fontWeight: 800, fontSize: 12.5,
                  color: score != null ? j.color : B.grey, opacity: score != null ? 1 : 0.55 }}>
                <img src={j.avatar} alt={j.name} style={{ width: 16, height: 16, objectFit: "contain",
                  transform: j.avatarScale ? `scale(${j.avatarScale})` : undefined }} />
                {score != null ? score : "—"}
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
export function VerdictPanel({ synthesis, results, scoreDisplay, onJumpToJudge, platform }) {
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
      <VerdictHero synthesis={synthesis} scoreDisplay={scoreDisplay} onJumpToJudge={onJumpToJudge} heroRef={heroRef} platform={platform} />
    </div>
  );
}

export default VerdictPanel;
