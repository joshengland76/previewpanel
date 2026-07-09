import { useState } from "react";
import { B, JUDGES } from "../brand.js";

// ─────────────────────────────────────────────────────────────────────────────
// Part B — Performance radar. Phase B4, Task 4: redesigned so its axes are
// exactly the dims that carry nonzero weight in the scoring model (per
// scoring_spec_v2.json's coefficients) — "authentic" dropped (zero weight on
// both judge and Claude sides; Task 1 verdict PRUNABLE), and the old
// hook_strength/completion_likelihood/share_save_worthiness/platform-specific
// dims dropped too (none ever had model weight; that was a separate, useful
// UI concept but not what this chart is for now). Claude-side "polished" is
// NOT included: it's a single C_dims-extracted value with no natural
// per-judge breakdown, so it doesn't fit this chart's panel-average +
// ghosted-per-judge-lines structure "sensibly" (the explicit bar Task 4 set
// for including it) — flagged in PHASEB4_READOUT.md as a deliberate
// exclusion, not an oversight.
//
// Field names read from .results[id].data.dimensions.big_picture[key] (the
// REAL judge output shape). Works identically for v1 rows and v2 rows: v1's
// big_picture object has 10 keys (including "authentic"), v2 has 9 — this
// component only ever reads the 9 it cares about, so no version check and no
// data migration are needed.
//
//   • Bold panel-AVERAGE polygon (present judges only) — ALWAYS prominent, no fill.
//   • Per-judge thin color lines — GHOSTED by default (the judges nearly coincide
//     on real data, so the average is the clean default signal). Tap a legend chip
//     to bring that judge to full strength; tap again to re-ghost. No fill, no dots.
//   • Partial: average from present judges only; missing judge absent from the
//     chart and greyed/struck in the legend.
//   • Graceful: no per-judge dimension data -> renders nothing.
// ─────────────────────────────────────────────────────────────────────────────

const BIG_PICTURE_AXES = [
  { key: "compelling", label: "Compelling" },
  { key: "emotionally_resonant", label: "Emotional" },
  { key: "emotion_intensity", label: "Intensity" },
  { key: "funny", label: "Funny" },
  { key: "novel", label: "Novel" },
  { key: "relatable", label: "Relatable" },
  { key: "surprising", label: "Surprising" },
  { key: "useful", label: "Useful" },
  { key: "visually_engaging", label: "Visual" },
];

// Dimension explanations. Every entry obeys the same two hard rules as the
// score-display copy (scoreDisplayCopy.js): baseline-relative/correlational
// framing only ("videos that... tend to..."), never an absolute or causal
// claim; no duration/length advice anywhere.
const DIMENSION_INFO = {
  compelling: `Whether the video commands attention without the viewer having to work for it — no slow ramp-up, no wasted setup before something happens. In our data, videos judged more compelling tend to hold viewers further in and tend to get shared more.`,
  emotionally_resonant: `Whether the video actually moves the viewer — makes them feel something, not just observe it. Videos that create a genuine emotional reaction tend to be shared and saved more than videos that only inform or entertain passively.`,
  emotion_intensity: `How intense or "loud" the emotions depicted in the video are, regardless of which emotion — calm and neutral videos score low, dramatic or ecstatic ones score high. This describes the content itself, not a judgment that either end of the scale is better.`,
  funny: `Whether the video produces genuine humor, not just an attempt at it. Videos that land real humor tend to be highly shared — comedy is one of the most DM-shared content categories in our data.`,
  novel: `Whether the video shows the viewer something they haven't seen before — a new angle, format, or idea. Novel content tends to interrupt the scroll and stand out in a crowded feed.`,
  relatable: `Whether the video speaks to something specific in the viewer's own life or experience. Relatable content tends to get shared directly to a specific person, rather than posted generally.`,
  surprising: `Whether the video subverts what the viewer expects, in a way that lands. Content that plays with expectation tends to hold attention longer and get rewatched more.`,
  useful: `Whether the viewer walks away with something concrete — information, a technique, an idea they can use. Useful content tends to be saved for later far more than it's liked.`,
  visually_engaging: `Whether the imagery itself rewards looking, independent of what's being said. Visually engaging content tends to perform well even without sound, which matters since many viewers watch muted.`,
  objective_fit: `Objective Fit measures how well this video succeeds at the specific goal you selected (e.g., comedy, education, brand awareness). Each judge evaluates this through their own lens — The Editor on craft execution, The Trendsetter on platform-native delivery, The Connector on emotional resonance.`,
};

const CX = 160, CY = 150, R = 88;
const AVG = "#1F1B16"; // bold near-black for the panel average

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function judgeAxisValue(data, axis) {
  if (axis.key === "__objfit") return num(data?.objective_fit?.score);
  return num(data?.dimensions?.big_picture?.[axis.key]);
}

export function PerformanceRadar({ results }) {
  const [focus, setFocus] = useState("avg"); // "avg" shows all four; a judge id isolates that judge
  const [showInfo, setShowInfo] = useState(false);

  const present = JUDGES
    .map((j) => ({ judge: j, data: results?.[j.id]?.status === "done" ? results[j.id].data : null }))
    .filter((x) => x.data && (x.data.dimensions || x.data.objective_fit));
  const presentIds = new Set(present.map((x) => x.judge.id));
  if (present.length === 0) return null;

  const axes = [...BIG_PICTURE_AXES, { key: "__objfit", label: "Objective Fit" }];

  if (!present.some((x) => axes.some((a) => judgeAxisValue(x.data, a) != null))) return null;

  const ang = (i) => (-90 + i * (360 / axes.length)) * Math.PI / 180;
  const pt = (i, v) => {
    const rr = (Math.max(0, Math.min(10, v)) / 10) * R;
    return [CX + rr * Math.cos(ang(i)), CY + rr * Math.sin(ang(i))];
  };
  const polyPoints = (vals) => vals.map((v, i) => pt(i, v ?? 0).map((n) => n.toFixed(1)).join(",")).join(" ");

  const judgeVals = present.map((x) => ({ judge: x.judge, vals: axes.map((a) => judgeAxisValue(x.data, a)) }));
  const avgVals = axes.map((_, i) => {
    const xs = judgeVals.map((jv) => jv.vals[i]).filter((v) => v != null);
    return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
  });

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ fontWeight: 800, fontSize: 16, color: B.body, margin: "0 2px 10px" }}>Scorecard</div>

      <div style={{ background: "#fff", border: `1px solid ${B.border}`, borderRadius: 20,
        boxShadow: "0 1px 2px rgba(60,40,20,.04), 0 6px 20px rgba(60,40,20,.05)", padding: "12px 16px 12px" }}>
        <div style={{ fontSize: 11, color: B.grey }}>Each judge across the factors our scoring model weighs, 0–10.</div>

        <svg viewBox="-6 8 332 286" style={{ width: "100%", maxWidth: 330, height: "auto", display: "block", margin: "0 auto" }}>
          {[2, 4, 6, 8, 10].map((g) => (
            <polygon key={g} points={axes.map((_, i) => pt(i, g).map((n) => n.toFixed(1)).join(",")).join(" ")}
              fill="none" stroke={B.border} strokeWidth={g === 10 ? 1.4 : 1} />
          ))}
          {axes.map((a, i) => {
            const sp = pt(i, 10), lp = pt(i, 12.6);
            const anchor = Math.abs(lp[0] - CX) < 6 ? "middle" : lp[0] > CX ? "start" : "end";
            const dy = lp[1] < CY - 10 ? -2 : lp[1] > CY + 10 ? 9 : 3;
            return (
              <g key={a.key}>
                <line x1={CX} y1={CY} x2={sp[0]} y2={sp[1]} stroke={B.border} strokeWidth="1" />
                <text x={lp[0].toFixed(1)} y={(lp[1] + dy).toFixed(1)} fontFamily="Montserrat, sans-serif"
                  fontSize="8.5" fontWeight="700" fill="#8a8178" textAnchor={anchor}>{a.label}</text>
              </g>
            );
          })}

          {/* per-judge lines — all shown in the avg view; tapping a judge isolates only its line */}
          {judgeVals.map(({ judge, vals }) => {
            if (focus !== "avg" && focus !== judge.id) return null;
            const solo = focus === judge.id;
            return (
              <polygon key={judge.id} points={polyPoints(vals)} fill="none" stroke={judge.color}
                strokeWidth={solo ? 3 : 2} strokeOpacity={1} strokeLinejoin="round" />
            );
          })}

          {/* bold panel-average — only in the default (avg) view */}
          {focus === "avg" && (
            <>
              <polygon points={polyPoints(avgVals)} fill="none" stroke={AVG} strokeWidth="4" strokeLinejoin="round" />
              {avgVals.map((v, i) => { const [x, y] = pt(i, v); return (
                <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="4.5" fill={AVG} stroke="#fff" strokeWidth="1.8" />
              ); })}
            </>
          )}

          {/* numeric value at each vertex — avg values by default, the isolated judge's otherwise */}
          {(() => {
            const fj = focus === "avg" ? null : judgeVals.find((jv) => jv.judge.id === focus);
            const vals = fj ? fj.vals.map((v) => Number(v) || 0) : avgVals;
            const col = fj ? fj.judge.color : AVG;
            return vals.map((v, i) => {
              const [nx, ny] = pt(i, v);
              const ux = Math.cos(ang(i)), uy = Math.sin(ang(i));
              // offset INWARD (toward center) so the value never overlaps the rim axis label
              const lx = nx - ux * 15, ly = ny - uy * 15;
              return (
                <text key={"n" + i} x={lx.toFixed(1)} y={(ly + 3.5).toFixed(1)} fontFamily="Montserrat, sans-serif"
                  fontSize="10.5" fontWeight="800" fill={col} stroke="#fff" strokeWidth="3" paintOrder="stroke" textAnchor="middle">
                  {v.toFixed(1)}
                </text>
              );
            });
          })()}
        </svg>

        <div style={{ textAlign: "center", fontSize: 10, color: B.grey, margin: "4px 0 7px" }}>Tap a judge to isolate their line</div>

        {/* legend — one row, all chips equal height; Avg restores the default view, a judge isolates its line */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 4, flexWrap: "nowrap" }}>
          <button type="button" onClick={() => setFocus("avg")}
            style={{ display: "flex", alignItems: "center", gap: 5, height: 28, boxSizing: "border-box", flexShrink: 0,
              background: focus === "avg" ? "#fff" : B.bg, border: `1px solid ${focus === "avg" ? AVG : B.border}`, borderRadius: 999,
              padding: "0 9px 0 6px", cursor: "pointer", fontFamily: "inherit",
              boxShadow: focus === "avg" ? `0 0 0 2px ${AVG}22` : "none" }}>
            <span style={{ width: 16, height: 10, borderRadius: 3, background: AVG, flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: B.body }}>Avg</span>
          </button>
          {JUDGES.filter((j) => results && results[j.id]).map((j) => {
            const missing = !presentIds.has(j.id);
            const on = focus === j.id;
            return (
              <button key={j.id} type="button" disabled={missing} onClick={() => !missing && setFocus(j.id)}
                style={{ display: "flex", alignItems: "center", gap: 4, height: 28, boxSizing: "border-box", flexShrink: 0,
                  background: on ? "#fff" : B.bg, border: `1px solid ${on ? j.color : B.border}`, borderRadius: 999,
                  padding: "0 9px 0 4px", cursor: missing ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                  boxShadow: on ? `0 0 0 2px ${j.color}30` : "none", opacity: missing ? 0.5 : 1 }}>
                <img src={j.avatar} alt={j.name} style={{ width: 20, height: 20, objectFit: "contain", flexShrink: 0,
                  transform: j.avatarScale ? `scale(${j.avatarScale})` : undefined, filter: missing ? "grayscale(1)" : undefined }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: "#8a8178",
                  textDecoration: missing ? "line-through" : "none" }}>{j.name.replace("The ", "")}</span>
              </button>
            );
          })}
        </div>

        {/* one tappable explainer for all signals shown */}
        <button type="button" onClick={() => setShowInfo((s) => !s)}
          style={{ display: "flex", alignItems: "center", gap: 6, margin: "10px auto 0", background: B.bg,
            border: `1px solid ${B.border}`, borderRadius: 999, padding: "6px 12px", cursor: "pointer",
            fontFamily: "inherit", fontSize: 11, fontWeight: 700, color: "#8a8178" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" strokeLinecap="round" /></svg>
          What do these signals mean?
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showInfo ? "rotate(180deg)" : "none", transition: "transform .2s" }}><path d="m6 9 6 6 6-6" /></svg>
        </button>
        {showInfo && (
          <div style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 10, borderTop: `1px solid ${B.lightBrown}`, paddingTop: 12 }}>
            {axes.map((a) => (
              <div key={a.key}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: B.body }}>{a.label}</div>
                <div style={{ fontSize: 11, lineHeight: 1.45, color: "#5c544a", marginTop: 2 }}>
                  {DIMENSION_INFO[a.key === "__objfit" ? "objective_fit" : a.key] || ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default PerformanceRadar;
