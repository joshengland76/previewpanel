import { useState } from "react";
import { B, VALENCE, JUDGE_BY_CANON } from "../brand.js";

// ─────────────────────────────────────────────────────────────────────────────
// Part B — merged "What's working & what to fix" block.
//
// Timeline + grouped lists from synthesis.takeaways: [{ kind:"strength"|
// "watchout"|"fix", text, judges:[canon], t_seconds, impact, takes:[{judge,text}] }].
//
//   • timeline marks = one ICON per flagging judge, in that judge's color:
//     strength → checkmark (above the line), watchout → exclamation (below),
//     fix → wrench (on the line). Count of icons = how many judges flagged it.
//   • grouped lists below — What's working / Watch-outs / Fixes — each row's text
//     + per-judge attribution icons (same metaphor) + (fixes) impact chip.
//   • tap a row (or its marker) to reveal a line per attributed judge.
// ─────────────────────────────────────────────────────────────────────────────

const GROUP_ORDER = ["strength", "watchout", "fix"];
const GROUP_LABEL = { strength: "What's working", watchout: "Watch-outs", fix: "Fixes" };
const IMPACT = {
  high: { c: "#A23B29", bg: VALENCE.risk + "18", label: "High impact" },
  medium: { c: "#B05E14", bg: "#FB8C0020", label: "Medium" },
};

const VB_W = 600, VB_H = 88, PAD = 56, BASE = 44;
const STACK_GAP = 22; // x-distance under which marks count as the SAME point
const STACK_OFF = 23; // vertical spacing when same-point marks stack above/on/below
// Vertical tier per kind: checkmark/strength stays on or above the line,
// exclamation/watchout on or below, wrench/fix in the middle.
const KIND_TIER = { strength: 0, fix: 1, watchout: 2 };
const WRENCH_D = "M507.73 109.1c-2.24-9.03-13.54-12.09-20.12-5.51l-74.36 74.36-67.88-11.31-11.31-67.88 74.36-74.36c6.62-6.62 3.43-17.9-5.66-20.16-47.38-11.74-99.55.91-136.58 37.93-39.64 39.64-50.55 97.1-34.05 147.2L18.74 402.76c-24.99 24.99-24.99 65.51 0 90.5 24.99 24.99 65.51 24.99 90.5 0l213.21-213.21c50.12 16.71 107.47 5.68 147.37-34.22 37.07-37.07 49.7-89.32 37.91-136.73z";

function fmt(sec) { const s = Math.max(0, Math.round(Number(sec) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
const attrib = (t) => (t.judges || []).filter((c) => JUDGE_BY_CANON[c]);
const takeText = (t, canon) => ((t.takes || []).find((x) => x.judge === canon && x.text) || {}).text || null;

// ── timeline icons (positioned in the strip's SVG) ──
function Check({ cx, cy, s, color }) {
  const r = s / 2;
  return <path d={`M${cx - r * 0.8} ${cy + r * 0.05}L${cx - r * 0.15} ${cy + r * 0.55}L${cx + r * 0.85} ${cy - r * 0.6}`}
    fill="none" stroke={color} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />;
}
function Bang({ cx, cy, s, color }) {
  const r = s / 2;
  return (
    <>
      <line x1={cx} y1={cy - r * 0.8} x2={cx} y2={cy + r * 0.18} stroke={color} strokeWidth="3.6" strokeLinecap="round" />
      <circle cx={cx} cy={cy + r * 0.74} r="2" fill={color} />
    </>
  );
}
function Wrench({ cx, cy, s, color }) {
  const k = s / 512;
  return (
    <g transform={`translate(${cx} ${cy}) scale(${k}) translate(-256 -256)`}>
      <path d={WRENCH_D} fill={color} />
    </g>
  );
}
const ICON = { strength: Check, watchout: Bang, fix: Wrench };

// ── inline icons for the lists (own <svg>; black for headers, judge-colored for attribution) ──
function MiniIcon({ kind, color, size = 14 }) {
  const st = { flexShrink: 0, display: "block" };
  if (kind === "watchout") return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={st}>
      <line x1="12" y1="3.5" x2="12" y2="15" stroke={color} strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="12" cy="20" r="2" fill={color} />
    </svg>
  );
  if (kind === "fix") return (
    <svg width={size} height={size} viewBox="0 0 512 512" style={st}>
      <path d={WRENCH_D} fill={color} />
    </svg>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={st}>
      <path d="M4.5 12.5L9.5 17.5L19.5 6.5" fill="none" stroke={color} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function AttribIcons({ kind, judges }) {
  const list = (judges || []).map((c) => JUDGE_BY_CANON[c]).filter(Boolean);
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }} title={list.map((j) => j.name).join(", ")}>
      {list.map((j) => <MiniIcon key={j.id} kind={kind} color={j.color} size={14} />)}
    </span>
  );
}
function Owl({ canon, size = 16 }) {
  const j = JUDGE_BY_CANON[canon];
  if (!j) return null;
  return <img src={j.avatar} alt={j.name} style={{ width: size, height: size, objectFit: "contain", flexShrink: 0, transform: j.avatarScale ? `scale(${j.avatarScale})` : undefined }} />;
}

export function WhatsWorkingFixes({ synthesis, duration }) {
  const [active, setActive] = useState(null);
  const [open, setOpen] = useState(() => new Set());
  const takeaways = (synthesis?.takeaways || []).filter((t) => t && t.text);
  if (takeaways.length === 0) return null;

  const indexed = takeaways.map((t, i) => ({ ...t, i }));
  const onTrack = indexed.filter((t) => Number.isFinite(Number(t.t_seconds)));
  const maxT = onTrack.reduce((m, t) => Math.max(m, t.t_seconds), 0);
  const trackMax = Math.max(Number(duration) || 0, maxT, 1);
  const xOf = (t, r) => Math.max(PAD + r, Math.min(VB_W - PAD - r, PAD + (t / trackMax) * (VB_W - PAD * 2)));
  // One icon per takeaway, on the line. When several land on (or very near) the
  // SAME point they'd overlap, so stack them VERTICALLY around the line by kind:
  // checkmark (strength) on/above, exclamation (watchout) on/below, wrench (fix)
  // in the middle — 1 on the line, 2 → above+below, 3 → above/on/below.
  const sortedMarks = onTrack.map((t) => ({ t, x0: xOf(t.t_seconds, 14) })).sort((a, b) => a.x0 - b.x0);
  const clusters = [];
  sortedMarks.forEach((m) => {
    const g = clusters[clusters.length - 1];
    if (g && m.x0 - g[g.length - 1].x0 < STACK_GAP) g.push(m);
    else clusters.push([m]);
  });
  const placed = [];
  clusters.forEach((g) => {
    const cx = g.reduce((s, m) => s + m.x0, 0) / g.length;
    // At most ONE mark per kind on the timeline (checkmark / wrench / exclamation) —
    // even if several takeaways of that kind share the point. The cards below list them all.
    const byKind = {};
    g.forEach((m) => { if (!byKind[m.t.kind]) byKind[m.t.kind] = m; });
    const ordered = Object.values(byKind).sort((a, b) => (KIND_TIER[a.t.kind] ?? 1) - (KIND_TIER[b.t.kind] ?? 1));
    const n = ordered.length;
    ordered.forEach((m, i) => placed.push({ t: m.t, x: cx, cy: BASE + (i - (n - 1) / 2) * STACK_OFF }));
  });
  const toggle = (i) => setOpen((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const endLabel = { position: "absolute", top: `${(BASE / VB_H) * 100}%`, transform: "translateY(-50%)",
    width: `${((PAD - 6) / VB_W) * 100}%`, fontFamily: "'Courier New', monospace", fontSize: 12, color: "#9C9281", lineHeight: 1 };

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ fontWeight: 800, fontSize: 16, color: B.body, margin: "0 2px 10px" }}>What's working &amp; what to fix</div>

      <div style={{ background: "#fff", border: `1px solid ${B.border}`, borderRadius: 20,
        boxShadow: "0 1px 2px rgba(60,40,20,.04), 0 6px 20px rgba(60,40,20,.05)", padding: "14px 16px 16px" }}>

        {/* timeline strip */}
        {onTrack.length > 0 && (
          <div style={{ position: "relative" }}>
            <svg viewBox={`0 0 ${VB_W} ${VB_H}`} style={{ width: "100%", height: "auto", display: "block" }}>
              <line x1={PAD} y1={BASE} x2={VB_W - PAD} y2={BASE} stroke={B.border} strokeWidth="2" />
              {placed.map(({ t, x, cy }) => {
                const Icon = ICON[t.kind] || Wrench;
                const S = t.kind === "watchout" ? 16 : t.kind === "fix" ? 20 : 19;
                const on = active === t.i;
                return (
                  <g key={t.i} style={{ cursor: "pointer" }} onMouseEnter={() => setActive(t.i)} onMouseLeave={() => setActive(null)} onClick={() => toggle(t.i)}>
                    {on && <circle cx={x} cy={cy} r="15" fill="#2a26200d" />}
                    <Icon cx={x} cy={cy} s={S} color="#1F1B16" />
                    <rect x={x - 12} y={cy - 13} width="24" height="26" fill="transparent" />
                  </g>
                );
              })}
            </svg>
            <span style={{ ...endLabel, left: 0, textAlign: "right" }}>{fmt(0)}</span>
            <span style={{ ...endLabel, right: 0, textAlign: "right" }}>{fmt(trackMax)}</span>
          </div>
        )}
        {onTrack.length > 0 && (
          <div style={{ fontSize: 10.5, color: B.grey, fontStyle: "italic", marginTop: -2, textAlign: "right" }}>Timestamps are approximate</div>
        )}

        {/* grouped lists */}
        {GROUP_ORDER.map((kind) => {
          // Within each category: timestamp asc → impact desc (high>medium>none)
          // → number of judges desc.
          const rank = (x) => (x === "high" ? 2 : x === "medium" ? 1 : 0);
          const rows = indexed.filter((t) => t.kind === kind).sort((a, b) => {
            const sa = Number.isFinite(Number(a.t_seconds)) ? a.t_seconds : Infinity;
            const sb = Number.isFinite(Number(b.t_seconds)) ? b.t_seconds : Infinity;
            if (sa !== sb) return sa - sb;
            const ir = rank(b.impact) - rank(a.impact);
            if (ir !== 0) return ir;
            return attrib(b).length - attrib(a).length;
          });
          if (rows.length === 0) return null;
          return (
            <div key={kind} style={{ marginTop: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                <MiniIcon kind={kind} color="#1F1B16" size={16} />
                <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: "#8a8178" }}>{GROUP_LABEL[kind]}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {rows.map((t) => {
                  const on = active === t.i;
                  const isOpen = open.has(t.i);
                  const judges = attrib(t);
                  const count = judges.length;
                  const imp = t.kind === "fix" && IMPACT[t.impact];
                  return (
                    <div key={t.i} onMouseEnter={() => setActive(t.i)} onMouseLeave={() => setActive(null)} onClick={() => toggle(t.i)}
                      style={{ border: `1px solid ${on ? "#cdbfae" : B.lightBrown}`, background: on ? "#fff" : B.bg, borderRadius: 11,
                        padding: "9px 11px", cursor: "pointer", transition: "background .15s, border-color .15s",
                        boxShadow: on ? "0 2px 12px rgba(60,40,20,.06)" : "none" }}>
                      <div style={{ fontSize: 12.5, lineHeight: 1.45, color: B.body }}>{t.text}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                        {Number.isFinite(Number(t.t_seconds)) && (
                          <span style={{ fontSize: 12.5, fontWeight: 700, color: "#9C9281" }}>{fmt(t.t_seconds)}</span>
                        )}
                        {imp && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: imp.c, background: imp.bg, padding: "2px 7px", borderRadius: 5 }}>{imp.label}</span>}
                        {count > 0 && <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 700, color: "#9C9281" }}>{isOpen ? "Hide" : `${count} ${count === 1 ? "judge" : "judges"}`}</span>}
                        <AttribIcons kind={t.kind} judges={t.judges} />
                      </div>
                      {isOpen && count > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
                          {judges.map((c) => {
                            const txt = takeText(t, c);
                            return (
                              <div key={c} style={{ display: "flex", gap: 7, alignItems: "flex-start", fontSize: 12, lineHeight: 1.4, color: "#5c544a" }}>
                                <Owl canon={c} size={16} />
                                <span style={txt ? undefined : { fontStyle: "italic", color: "#9C9281" }}>{txt || "flagged this moment"}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default WhatsWorkingFixes;
