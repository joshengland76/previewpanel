import { useState } from "react";
import { B, JUDGE_BY_ID } from "../brand.js";

// ─────────────────────────────────────────────────────────────────────────────
// Part B — "Ready to use" toolkit. Reads STRAIGHT from judge data (.results),
// NOT from synthesis:
//   Connector (connector)  -> data.captions: [{ tone, text }]
//   Trendsetter (cool)     -> data.hashtags: [string]  (bare, no '#')
//   Editor (critic)        -> data.clips:    [{ start, end, label, reason }]
//                             start/end are "MM:SS" strings.
//
//   • Captions / Hashtags cards are OMITTED when empty.
//   • Clips card ALWAYS renders (populated card OR empty state) so the capability
//     stays discoverable — but only when the section as a whole is shown.
//   • Whole section renders nothing only if ALL THREE are empty.
//   • Each card attributed to its judge (owl + left-border color via brand.js).
// ─────────────────────────────────────────────────────────────────────────────

const EDITOR = JUDGE_BY_ID.critic;
const TREND = JUDGE_BY_ID.cool;
const CONNECTOR = JUDGE_BY_ID.connector;

function toSecs(v) {
  if (typeof v === "number") return v;
  const p = String(v).split(":").map(Number);
  return p.length === 2 ? p[0] * 60 + p[1] : Number(v) || 0;
}
const clipRange = (v) => (typeof v === "string" && v.includes(":") ? v
  : `${Math.floor((Number(v) || 0) / 60)}:${String(Math.round((Number(v) || 0) % 60)).padStart(2, "0")}`);

function CopyButton({ text, variant = "icon" }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    try { navigator.clipboard && navigator.clipboard.writeText(text); } catch { /* noop */ }
    setDone(true); setTimeout(() => setDone(false), 900);
  };
  if (variant === "all") {
    return (
      <button type="button" onClick={copy}
        style={{ fontSize: 10.5, fontWeight: 700, color: TREND.color, background: TREND.color + "17",
          border: `1px solid ${TREND.color}40`, borderRadius: 999, padding: "5px 11px", cursor: "pointer",
          fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 5 }}>
        {done ? "Copied" : "Copy all"}
      </button>
    );
  }
  return (
    <button type="button" onClick={copy} title="Copy"
      style={{ flexShrink: 0, width: 26, height: 26, borderRadius: 7, border: `1px solid ${B.border}`,
        background: "#fff", color: done ? "#3F7049" : "#9C9281", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center" }}>
      {done ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="12" height="12" rx="2" /><rect x="8" y="8" width="12" height="12" rx="2" fill="#fff" /></svg>
      )}
    </button>
  );
}

function Card({ judge, title, by, badge, children }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${B.border}`, borderLeft: `4px solid ${judge.color}`,
      borderRadius: 16, boxShadow: "0 1px 2px rgba(60,40,20,.04), 0 6px 20px rgba(60,40,20,.05)", padding: "14px 15px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 11 }}>
        <img src={judge.avatar} alt={judge.name} style={{ width: 26, height: 26, objectFit: "contain", flexShrink: 0,
          transform: judge.avatarScale ? `scale(${judge.avatarScale})` : undefined }} />
        <span style={{ fontWeight: 800, fontSize: 14.5, color: B.body }}>{title}</span>
        {badge != null ? (
          <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
            color: judge.color, background: judge.color + "1c", borderRadius: 999, padding: "3px 9px" }}>{badge}</span>
        ) : (
          <span style={{ marginLeft: "auto", fontSize: 10.5, color: B.grey, fontWeight: 600 }}>{by}</span>
        )}
      </div>
      {children}
    </div>
  );
}

export function ToolkitSection({ results }) {
  const captions = results?.connector?.data?.captions || [];
  const hashtags = results?.cool?.data?.hashtags || [];
  const clips = results?.critic?.data?.clips || [];

  if (captions.length === 0 && hashtags.length === 0 && clips.length === 0) return null;

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ fontWeight: 800, fontSize: 16, color: B.body, margin: "0 2px 10px" }}>Ready to use</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>

        {captions.length > 0 && (
          <Card judge={CONNECTOR} title="Caption ideas" by="from The Connector">
            {captions.map((c, i) => (
              <div key={i} style={{ background: B.bg, border: `1px solid ${B.lightBrown}`, borderRadius: 11,
                padding: "9px 11px", marginTop: i === 0 ? 0 : 7, display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <div>
                  {c.tone && <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".1em", textTransform: "uppercase", color: "#9C9281", marginBottom: 3 }}>{c.tone}</div>}
                  <div style={{ fontSize: 12, lineHeight: 1.4, color: B.body }}>{c.text}</div>
                </div>
                <CopyButton text={c.text} />
              </div>
            ))}
          </Card>
        )}

        {hashtags.length > 0 && (
          <Card judge={TREND} title="Hashtags" by="from The Trendsetter">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {hashtags.map((t, i) => (
                <span key={i} style={{ fontSize: 11, fontWeight: 600, color: "#8C6710", background: TREND.color + "1f",
                  borderRadius: 999, padding: "4px 10px", maxWidth: "100%", overflowWrap: "anywhere" }}>#{t}</span>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 11 }}>
              <CopyButton variant="all" text={hashtags.map((t) => `#${t}`).join(" ")} />
            </div>
          </Card>
        )}

        {/* Clips — Editor-only, conditional; always shown (populated or empty). */}
        <Card judge={EDITOR} title="Shorts candidates" by="from The Editor">
          {clips.length > 0 ? (
            <>
              <div style={{ fontSize: 10.5, color: B.grey, fontStyle: "italic", margin: "-12px 0 8px", textAlign: "right" }}>Timestamps are approximate</div>
              {clips.map((c, i) => {
                const dur = Math.max(0, Math.round(toSecs(c.end) - toSecs(c.start)));
                return (
                  <div key={i} style={{ border: `1px solid ${B.lightBrown}`, background: B.bg, borderRadius: 13,
                    padding: "11px 13px", marginTop: i === 0 ? 0 : 9 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                      <span style={{ color: EDITOR.color, display: "flex", flexShrink: 0 }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" /></svg>
                      </span>
                      <span style={{ fontFamily: "'Courier New', monospace", fontSize: 13, fontWeight: 700, color: EDITOR.color, whiteSpace: "nowrap" }}>
                        {clipRange(c.start)}<span style={{ margin: "0 3px", color: B.grey }}>–</span>{clipRange(c.end)}
                      </span>
                      <span style={{ fontFamily: "'Courier New', monospace", fontSize: 10, color: B.grey, background: "#fff",
                        border: `1px solid ${B.border}`, borderRadius: 5, padding: "1px 5px", flexShrink: 0 }}>{dur}s</span>
                      {c.label && <span style={{ fontWeight: 700, fontSize: 13.5, color: B.body }}>{c.label}</span>}
                    </div>
                    {c.reason && <div style={{ fontSize: 12, lineHeight: 1.45, color: "#5c544a", marginTop: 6 }}>{c.reason}</div>}
                  </div>
                );
              })}
            </>
          ) : (
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", background: B.bg,
              border: `1px dashed ${B.border}`, borderRadius: 12, padding: "11px 13px" }}>
              <span style={{ color: "#9C9281", flexShrink: 0, marginTop: 1 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" /><path d="M9.5 9.5l5 5M14.5 9.5l-5 5" /></svg>
              </span>
              <span style={{ fontSize: 12, lineHeight: 1.45, color: "#5c544a" }}>
                <b style={{ color: B.body }}>No strong Short in this one.</b> The Editor only suggests clip segments when there's a genuinely self-contained moment worth cutting — it didn't find one here.
              </span>
            </div>
          )}
        </Card>
      </div>
    </section>
  );
}

export default ToolkitSection;
