import { useState } from "react";
import { B, VALENCE, JUDGE_BY_CANON } from "../brand.js";

// ─────────────────────────────────────────────────────────────────────────────
// Part B — merged "What's working & what to fix" block.
//
// Timeline + grouped lists from synthesis.takeaways: [{ kind:"strength"|
// "watchout"|"fix", text, judges:[canon], t_seconds, impact, takes:[{judge,text}] }].
//
//   • timeline marks = one plain dot per DISTINCT timestamp, at its true
//     position -- dots may visually overlap rather than merge. Only
//     takeaways sharing the exact same t_seconds collapse into one dot --
//     no stacking, no per-kind icon, no count -- the kind/judge/impact
//     detail lives in the grouped lists below, not the timeline.
//   • grouped lists below — What's working / Watch-outs / Fixes — each row's text
//     + per-judge attribution icons (same metaphor) + (fixes) impact chip.
//   • tap a row (or its dot) to reveal a line per attributed judge; a dot
//     covering several takeaways toggles all of them together.
// ─────────────────────────────────────────────────────────────────────────────

const GROUP_ORDER = ["strength", "watchout", "fix"];
const GROUP_LABEL = { strength: "What's working", watchout: "Watch-outs", fix: "Fixes" };
const IMPACT = {
  high: { c: "#A23B29", bg: VALENCE.risk + "18", label: "High impact" },
  medium: { c: "#B05E14", bg: "#FB8C0020", label: "Medium" },
};

const VB_W = 600, VB_H = 88, PAD = 56, BASE = 44;
const WRENCH_D = "M507.73 109.1c-2.24-9.03-13.54-12.09-20.12-5.51l-74.36 74.36-67.88-11.31-11.31-67.88 74.36-74.36c6.62-6.62 3.43-17.9-5.66-20.16-47.38-11.74-99.55.91-136.58 37.93-39.64 39.64-50.55 97.1-34.05 147.2L18.74 402.76c-24.99 24.99-24.99 65.51 0 90.5 24.99 24.99 65.51 24.99 90.5 0l213.21-213.21c50.12 16.71 107.47 5.68 147.37-34.22 37.07-37.07 49.7-89.32 37.91-136.73z";

function fmt(sec) { const s = Math.max(0, Math.round(Number(sec) || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
const attrib = (t) => (t.judges || []).filter((c) => JUDGE_BY_CANON[c]);
const takeText = (t, canon) => ((t.takes || []).find((x) => x.judge === canon && x.text) || {}).text || null;

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
// Collapsed-row summary: up to and including the first sentence-ending
// punctuation (., !, or ?) followed by whitespace or end-of-string. CSS
// text-overflow:ellipsis (on the row's own span) handles "as much as fits,
// with a …" from there -- no manual character-counting needed, and it
// degrades gracefully at any viewport width.
function firstSentence(text) {
  const s = String(text || "");
  const m = s.match(/^.*?[.!?](?=\s|$)/);
  return m ? m[0] : s;
}

function Owl({ canon, size = 16 }) {
  const j = JUDGE_BY_CANON[canon];
  if (!j) return null;
  return <img src={j.avatar} alt={j.name} style={{ width: size, height: size, objectFit: "contain", flexShrink: 0, transform: j.avatarScale ? `scale(${j.avatarScale})` : undefined }} />;
}

export function WhatsWorkingFixes({ synthesis, duration }) {
  const [active, setActive] = useState(null); // null | array of takeaway indices under the hovered dot
  const [open, setOpen] = useState(() => new Set());
  const takeaways = (synthesis?.takeaways || []).filter((t) => t && t.text);
  if (takeaways.length === 0) return null;

  const indexed = takeaways.map((t, i) => ({ ...t, i }));
  const onTrack = indexed.filter((t) => Number.isFinite(Number(t.t_seconds)));
  const maxT = onTrack.reduce((m, t) => Math.max(m, t.t_seconds), 0);
  const trackMax = Math.max(Number(duration) || 0, maxT, 1);
  const xOf = (t, r) => Math.max(PAD + r, Math.min(VB_W - PAD - r, PAD + (t / trackMax) * (VB_W - PAD * 2)));
  // One dot per DISTINCT timestamp, placed at its true position on the
  // timeline -- even if that means two dots visually overlap. Only
  // takeaways sharing the EXACT same t_seconds collapse into one dot;
  // proximity alone is no longer grounds to merge (that used to average
  // nearby-but-different timestamps into a single misleading position).
  const groups = new Map(); // t_seconds -> { x, ids }
  onTrack.forEach((t) => {
    const key = t.t_seconds;
    if (!groups.has(key)) groups.set(key, { x: xOf(t.t_seconds, 5), ids: [] });
    groups.get(key).ids.push(t.i);
  });
  const placed = [...groups.values()];
  const toggle = (i) => setOpen((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  // A dot may cover several takeaways -- toggle them as a group: open every
  // one that isn't already open, or (if all are already open) close them all.
  const toggleGroup = (ids) => setOpen((s) => {
    const n = new Set(s);
    const allOpen = ids.every((id) => n.has(id));
    ids.forEach((id) => (allOpen ? n.delete(id) : n.add(id)));
    return n;
  });
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
              {placed.map(({ x, ids }) => {
                const on = Array.isArray(active) && ids.some((id) => active.includes(id));
                return (
                  <g key={ids.join(",")} style={{ cursor: "pointer" }}
                    onMouseEnter={() => setActive(ids)} onMouseLeave={() => setActive(null)} onClick={() => toggleGroup(ids)}>
                    {on && <circle cx={x} cy={BASE} r="9" fill="#2a26200d" />}
                    <circle cx={x} cy={BASE} r="5" fill="#1F1B16" />
                    <rect x={x - 12} y={BASE - 13} width="24" height="26" fill="transparent" />
                  </g>
                );
              })}
            </svg>
            <span style={{ ...endLabel, left: 0, textAlign: "right" }}>{fmt(0)}</span>
            <span style={{ ...endLabel, right: 0, textAlign: "right" }}>{fmt(trackMax)}</span>
          </div>
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
                  const on = Array.isArray(active) && active.includes(t.i);
                  const isOpen = open.has(t.i);
                  const judges = attrib(t);
                  const count = judges.length;
                  const imp = t.kind === "fix" && IMPACT[t.impact];
                  const hasTime = Number.isFinite(Number(t.t_seconds));
                  return (
                    <div key={t.i} onMouseEnter={() => setActive([t.i])} onMouseLeave={() => setActive(null)}
                      style={{ border: `1px solid ${on ? "#cdbfae" : B.lightBrown}`, background: on ? "#fff" : B.bg, borderRadius: 11,
                        overflow: "hidden", transition: "background .15s, border-color .15s",
                        boxShadow: on ? "0 2px 12px rgba(60,40,20,.06)" : "none" }}>
                      {/* Collapsed: timestamp + as much of the first sentence as
                          fits (CSS ellipsis) + the same down-arrow chevron the
                          individual judge cards use. Expanded: the SAME span
                          switches to the full text, unclipped -- it continues
                          from that same first line rather than repeating it
                          in a second block below. */}
                      <button type="button" onClick={() => toggle(t.i)} aria-expanded={isOpen}
                        style={{ width: "100%", textAlign: "left", background: "none", border: "none", cursor: "pointer",
                          padding: "9px 11px", display: "flex", alignItems: isOpen ? "flex-start" : "center", gap: 8, fontFamily: "inherit" }}>
                        {hasTime && <span style={{ fontSize: 12.5, fontWeight: 700, color: "#9C9281", flexShrink: 0, marginTop: isOpen ? 1 : 0 }}>{fmt(t.t_seconds)}</span>}
                        <span style={{ fontSize: 12.5, lineHeight: isOpen ? 1.45 : 1.3, color: B.body, flex: 1, minWidth: 0,
                          overflow: isOpen ? "visible" : "hidden", textOverflow: isOpen ? "clip" : "ellipsis",
                          whiteSpace: isOpen ? "normal" : "nowrap" }}>{isOpen ? t.text : firstSentence(t.text)}</span>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9C9281" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                          style={{ flexShrink: 0, marginTop: isOpen ? 2 : 0, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .25s" }}><path d="m6 9 6 6 6-6" /></svg>
                      </button>
                      {isOpen && (
                        <div style={{ padding: "0 11px 11px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            {imp && <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: imp.c, background: imp.bg, padding: "2px 7px", borderRadius: 5 }}>{imp.label}</span>}
                            {count > 0 && <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 700, color: "#9C9281" }}>{count} {count === 1 ? "judge" : "judges"}</span>}
                            <AttribIcons kind={t.kind} judges={t.judges} />
                          </div>
                          {count > 0 && (
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
