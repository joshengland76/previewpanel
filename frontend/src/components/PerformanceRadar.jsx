import { useState } from "react";
import { B, JUDGES } from "../brand.js";
import { DetectedSignals } from "./DetectedSignals.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// Part B — Performance radar. Phase B4, Task 4 originally set the axes to
// every dim carrying nonzero model weight; Sweep C (this revision) narrowed
// that further, now that the FULL nonzero-coefficient table exists
// (scoring_spec_v2.json, 56 of 116 nonzero) rather than just a presence/
// absence read. Signs, from that table (jc_* = judge consensus mean):
//   jc_compelling            +0.0118   KEPT
//   jc_novel                 +0.0277   KEPT
//   jc_emotionally_resonant  +0.0202   KEPT
//   jc_emotion_intensity     +0.0120   KEPT
//   jc_funny                 +0.0122   KEPT
//   jc_surprising            -0.0111   REMOVED (negative)
//   jc_relatable             -0.0179   REMOVED (negative)
//   jc_visually_engaging     -0.0211   REMOVED (negative)
//   jc_useful                -0.0302   REMOVED (negative)
//   cl_big_polished          -0.0072   never included here (single C_dims value,
//                                      no per-judge breakdown -- PHASEB4_READOUT.md)
// "authentic" was already dropped pre-Sweep-C (zero weight both sides).
// objective_fit is judge-scored but lives outside big_picture (its own
// per-judge column) -- kept, unaffected by any of the above.
//
// Spider v3 adds two PANEL-ONLY "content read" axes -- Trend Alignment and
// Trending Topic -- backed by trendAxes (prop, from the API response's
// job.trendAxes, computed server-side in backend/scoring/contentReadAxes.js
// via computeTrendAxes(), a direct 0-10 read of the C_dims
// trending_alignment_signals/trending_topic_likelihood fields, NOT from
// judge output). Both carry real but modest positive model coefficients
// (+0.0209 and +0.0138 in scoring_spec_v2.json) -- their tooltips say so
// explicitly rather than overselling them. There is no per-judge breakdown
// for these -- a single scalar per video, no ghost lines, marked with a
// subtle "content read" legend note rather than a judge chip. Final: 8 axes
// (6 judge-scored + 2 content-read).
//
// Spider v3 REMOVED the earlier Curiosity/Inspiration axes (Sweep C): a
// zero-rate analysis found they sat at a near-certain 0 vertex on ~99% of
// videos (mostly because C_dims simply never ran on most historical rows --
// see SPIDER_V3_READOUT.md), which read as "broken" even on rows where it
// was an accurate reading. Their underlying 0-10 values still exist
// (computeContentReadAxes(), job.contentReadAxes) but are now surfaced only
// as "Detected signals" presence chips (DetectedSignals.jsx). Spider v3.1
// moved that chip block ONTO this card, and split it into two labeled
// sub-rows (positive/negative) covering six more presence signals
// beyond Curiosity/Inspiration/Save-CTA -- see DetectedSignals.jsx's own
// header comment for the full list and the model coefficients behind them.
//
// Field names read from .results[id].data.dimensions.big_picture[key] (the
// REAL judge output shape). Works identically for v1 rows and v2 rows: v1's
// big_picture object has 10 keys (including "authentic"), v2 has 9 — this
// component only ever reads the ones it cares about, so no version check and
// no data migration are needed.
//
//   • Bold panel-AVERAGE polygon (present judges only) — ALWAYS prominent, no fill.
//   • Per-judge thin color lines — GHOSTED by default (the judges nearly coincide
//     on real data, so the average is the clean default signal). Tap a legend chip
//     to bring that judge to full strength; tap again to re-ghost. No fill, no dots.
//     At the two content-read vertices, every per-judge line and the avg line
//     coincide at the same point (by design -- there's one scalar, not a
//     per-judge reading, at those two axes).
//   • Partial: average from present judges only; missing judge absent from the
//     chart and greyed/struck in the legend.
//   • Graceful: no per-judge dimension data -> renders nothing.
// ─────────────────────────────────────────────────────────────────────────────

const BIG_PICTURE_AXES = [
  { key: "compelling", label: "Compelling" },
  { key: "novel", label: "Novel" },
  { key: "emotionally_resonant", label: "Emotional" },
  { key: "emotion_intensity", label: "Intensity" },
  { key: "funny", label: "Funny" },
];

// Panel-only, no ghost lines -- see header comment. trendAxes is
// {trend_alignment, trending_topic}, each 0-10, from computeTrendAxes().
const TREND_AXES = [
  { key: "trend_alignment", label: "Trend Align", contentRead: true },
  { key: "trending_topic", label: "Trending Topic", contentRead: true },
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
  objective_fit: `Objective Fit measures how well this video succeeds at the specific goal you selected (e.g., comedy, education, brand awareness). Each judge evaluates this through their own lens — The Editor on craft execution, The Trendsetter on platform-native delivery, The Connector on emotional resonance.`,
  trend_alignment: `How many recognizable trending-format patterns — sounds, edits, structural beats — this video picks up on. Videos that align with more of these patterns tend to perform better than those that don't.`,
  trending_topic: `How likely this video's subject matter is to be currently trending, independent of format or execution. Videos on trending topics tend to outperform ones that aren't.`,
};

const CX = 160, CY = 150, R = 88;
const AVG = "#1F1B16"; // bold near-black for the panel average

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
// trendAxes is only consulted for axis.contentRead entries -- every
// per-judge polygon reads the SAME value there (see header comment: these
// are single scalars per video, not per-judge readings), so `data` (the
// per-judge payload) is simply irrelevant for those two axes.
// groupMeanBigPicture (flattened {judge}_big_{dim}/{judge}_objective_fit_score
// keys, from the API response's job.groupMeanBigPicture) smooths the other 6
// judge-scored axes across repeat runs of the same video -- preferred when
// present, falling back to this run's own per-judge data otherwise
// (ungrouped submissions, or fields predating this feature). trendAxes gets
// NO such smoothing (Spider v3, point 4): always this run's own value.
function judgeAxisValue(data, axis, trendAxes, groupMeanBigPicture, judgeId) {
  if (axis.contentRead) return num(trendAxes?.[axis.key]);
  // groupMeanBigPicture's keys come from the backend's BIG_PICTURE_COLUMNS,
  // which prefixes with "trendsetter" (the submissions-table/DB judge id) --
  // JUDGES' frontend id for that judge is "cool" (see brand.js), so remap.
  const dbJudgeId = judgeId === "cool" ? "trendsetter" : judgeId;
  const groupKey = axis.key === "__objfit" ? `${dbJudgeId}_objective_fit_score` : `${dbJudgeId}_big_${axis.key}`;
  if (groupMeanBigPicture && groupMeanBigPicture[groupKey] != null) return num(groupMeanBigPicture[groupKey]);
  if (axis.key === "__objfit") return num(data?.objective_fit?.score);
  return num(data?.dimensions?.big_picture?.[axis.key]);
}

// Dynamic inside/outside placement for each vertex's numeric label. Inside
// (toward center) is the default look -- it keeps values well clear of the
// axis labels, which sit further out past the rim. That breaks down on a
// low-scoring video: every vertex sits close to the center already, so
// insetting further inward only shrinks the room between them, and the
// labels overlap each other. There's plenty of room on the OUTSIDE in that
// exact case (the open ring between the small polygon and the rim is
// unused), so the fix is to choose ALL-INSIDE or ALL-OUTSIDE once, from the
// actual geometry (the chord distance between adjacent labels at the
// average vertex radius, after the inward offset) rather than the values
// looking "high" or "low" in the abstract -- then resolve any leftover
// LOCAL collision (e.g. one axis much higher than its neighbors) by flipping
// just that one label to the opposite side, greedily, pairwise.
const LABEL_INSIDE_OFFSET = 15;
const LABEL_OUTSIDE_OFFSET = 14;
const MIN_LABEL_SPACING = 20; // px between label centers below which they read as overlapping

function computeLabelPlacements(vals, n, pt, ang) {
  const base = vals.map((v, i) => {
    const val = Number(v) || 0;
    const [vx, vy] = pt(i, val);
    return { i, val, vx, vy, ux: Math.cos(ang(i)), uy: Math.sin(ang(i)) };
  });

  const avgVal = base.reduce((s, p) => s + p.val, 0) / (n || 1);
  const avgR = (Math.max(0, Math.min(10, avgVal)) / 10) * R;
  const chordAtInsideR = 2 * Math.max(0, avgR - LABEL_INSIDE_OFFSET) * Math.sin(Math.PI / n);
  const globalSide = chordAtInsideR >= MIN_LABEL_SPACING ? "inside" : "outside";

  const placements = base.map((p) => ({ ...p, side: globalSide }));
  const labelXY = (p) => {
    const offset = p.side === "inside" ? -LABEL_INSIDE_OFFSET : LABEL_OUTSIDE_OFFSET;
    return [p.vx + p.ux * offset, p.vy + p.uy * offset];
  };

  let changed = true, guard = 0;
  while (changed && guard < 20) {
    changed = false; guard++;
    for (let a = 0; a < placements.length; a++) {
      for (let b = a + 1; b < placements.length; b++) {
        const [ax, ay] = labelXY(placements[a]);
        const [bx, by] = labelXY(placements[b]);
        if (Math.hypot(ax - bx, ay - by) < MIN_LABEL_SPACING) {
          // Flip whichever of the pair has the smaller value -- the larger
          // one's vertex is closer to the rim already and more likely to
          // have real room on its current side.
          const flip = placements[a].val <= placements[b].val ? a : b;
          placements[flip].side = placements[flip].side === "inside" ? "outside" : "inside";
          changed = true;
        }
      }
    }
  }

  return placements.map((p) => {
    const [x, y] = labelXY(p);
    return { i: p.i, val: p.val, x, y };
  });
}

export function PerformanceRadar({ results, trendAxes, groupMeanBigPicture, contentReadAxes, signalFields }) {
  const [focus, setFocus] = useState("avg"); // "avg" shows all four; a judge id isolates that judge
  const [showInfo, setShowInfo] = useState(false);

  const present = JUDGES
    .map((j) => ({ judge: j, data: results?.[j.id]?.status === "done" ? results[j.id].data : null }))
    .filter((x) => x.data && (x.data.dimensions || x.data.objective_fit));
  const presentIds = new Set(present.map((x) => x.judge.id));
  if (present.length === 0) return null;

  const axes = [...BIG_PICTURE_AXES, { key: "__objfit", label: "Objective Fit" }, ...TREND_AXES];

  if (!present.some((x) => axes.some((a) => judgeAxisValue(x.data, a, trendAxes, groupMeanBigPicture, x.judge.id) != null))) return null;

  const ang = (i) => (-90 + i * (360 / axes.length)) * Math.PI / 180;
  const pt = (i, v) => {
    const rr = (Math.max(0, Math.min(10, v)) / 10) * R;
    return [CX + rr * Math.cos(ang(i)), CY + rr * Math.sin(ang(i))];
  };
  const polyPoints = (vals) => vals.map((v, i) => pt(i, v ?? 0).map((n) => n.toFixed(1)).join(",")).join(" ");

  const judgeVals = present.map((x) => ({ judge: x.judge, vals: axes.map((a) => judgeAxisValue(x.data, a, trendAxes, groupMeanBigPicture, x.judge.id)) }));
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

        {/* viewBox tightened to the actual drawn extent (label text tops out
            around y=30, bottoms out around y=272) -- the old 8-294 window
            baked in ~35px of empty margin above and below the octagon on
            every render, since height:auto locks the rendered SVG height to
            this viewBox's own aspect ratio. */}
        <svg viewBox="-6 24 332 252" style={{ width: "100%", maxWidth: 330, height: "auto", display: "block", margin: "0 auto" }}>
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
                  fontSize="8.5" fontWeight="700" fill="#8a8178" textAnchor={anchor}>
                  {a.label}
                </text>
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

          {/* numeric value at each vertex — avg values by default, the isolated judge's
              otherwise. Placement (inside vs outside) is dynamic -- see computeLabelPlacements. */}
          {(() => {
            const fj = focus === "avg" ? null : judgeVals.find((jv) => jv.judge.id === focus);
            const vals = fj ? fj.vals.map((v) => Number(v) || 0) : avgVals;
            const col = fj ? fj.judge.color : AVG;
            const placements = computeLabelPlacements(vals, axes.length, pt, ang);
            return placements.map(({ i, val, x, y }) => (
              <text key={"n" + i} x={x.toFixed(1)} y={(y + 3.5).toFixed(1)} fontFamily="Montserrat, sans-serif"
                fontSize="10.5" fontWeight="800" fill={col} stroke="#fff" strokeWidth="3" paintOrder="stroke" textAnchor="middle">
                {val.toFixed(1)}
              </text>
            ));
          })()}
        </svg>

        {/* Spider v3.2 -- directly below the radar, above "Tap a judge to
            isolate their line." Renders nothing at all when no signal is
            earned -- see DetectedSignals.jsx. */}
        <DetectedSignals contentReadAxes={contentReadAxes} signalFields={signalFields} />

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
