import { useEffect, useRef, useState } from "react";
import { B, JUDGE_BY_ID } from "../brand.js";

// ─────────────────────────────────────────────────────────────────────────────
// Per-clip "Trim & download" affordance for the Editor's suggested segments.
//
// LIVE-SESSION ONLY. Scrubbing is client-side against the original `videoFile`
// still held in memory (createObjectURL → <video>, seek on nudge). The cut itself
// is server-side: on confirm we POST {jobId, start, end, mode:"copy"} to /api/trim
// and download the returned mp4. Renders nothing without a videoFile (e.g. restored
// from history) — trim-from-history is intentionally not supported.
// ─────────────────────────────────────────────────────────────────────────────

const EDITOR = JUDGE_BY_ID.critic;
const NUDGE = 3; // seconds the user may move each end from the Editor's suggestion

const toSecs = (v) => {
  if (typeof v === "number") return v;
  const p = String(v).split(":").map(Number);
  return p.length === 2 ? p[0] * 60 + p[1] : Number(v) || 0;
};
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export default function TrimClip({ clip, trim }) {
  const { videoFile, jobId, apiBase = "", durationSecs } = trim || {};
  const hasDur = Number.isFinite(durationSecs) && durationSecs > 0;
  const cap = hasDur ? durationSecs : 1e9;

  const sugStart = clamp(toSecs(clip.start), 0, cap);
  const sugEnd = clamp(toSecs(clip.end), sugStart + 0.5, cap);
  // ±NUDGE around each suggested end, clamped to the video bounds.
  const sLo = Math.max(0, sugStart - NUDGE), sHi = Math.min(cap, sugStart + NUDGE);
  const eLo = Math.max(0, sugEnd - NUDGE), eHi = Math.min(cap, sugEnd + NUDGE);

  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(sugStart);
  const [end, setEnd] = useState(sugEnd);
  const [status, setStatus] = useState("idle"); // idle | working | error | done
  const [msg, setMsg] = useState("");
  const videoRef = useRef(null);

  useEffect(() => {
    if (!open || !videoFile) return;
    const url = URL.createObjectURL(videoFile);
    const v = videoRef.current;
    if (v) { v.src = url; v.currentTime = start; }
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, videoFile]);

  const seek = (t) => { const v = videoRef.current; if (v && Number.isFinite(t)) { try { v.currentTime = t; } catch { /* iOS may reject mid-load */ } } };
  const onStart = (e) => { const v = clamp(Number(e.target.value), sLo, Math.min(sHi, end - 0.1)); setStart(v); seek(v); };
  const onEnd = (e) => { const v = clamp(Number(e.target.value), Math.max(eLo, start + 0.1), eHi); setEnd(v); seek(v); };

  const download = async () => {
    if (!(end > start)) { setStatus("error"); setMsg("Start must be before end."); return; }
    setStatus("working"); setMsg("");
    const body = JSON.stringify({ jobId, start: Number(start.toFixed(2)), end: Number(end.toFixed(2)), mode: "copy" });
    const hit = () => fetch(`${apiBase}/api/trim`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    try {
      let res = await hit();
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500)); res = await hit(); } // one brief retry
      if (res.status === 429) { setStatus("error"); setMsg("Server busy — try again in a moment."); return; }
      if (res.status === 404) { setStatus("error"); setMsg("This clip is no longer available. Analysis results older than 30 minutes can't be trimmed — please re-run the analysis."); return; }
      if (!res.ok) { setStatus("error"); setMsg("Trim failed. Please try again."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "clip.mp4";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      setStatus("done"); setMsg("Clip downloaded.");
    } catch {
      setStatus("error"); setMsg("Network error. Please try again.");
    }
  };

  if (!videoFile) return null; // live session only

  const len = Math.max(0, end - start);
  const ctrl = (val, lo, hi, on, label) => (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 700, color: B.grey, marginBottom: 3 }}>
        <span>{label}</span><span style={{ fontFamily: "'Courier New', monospace", color: EDITOR.color }}>{fmt(val)}</span>
      </div>
      <input type="range" min={lo} max={hi} step={0.1} value={val} onChange={on}
        style={{ width: "100%", accentColor: EDITOR.color }} />
    </div>
  );

  return (
    <div style={{ marginTop: 9 }}>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700,
            color: EDITOR.color, background: EDITOR.color + "12", border: `1px solid ${EDITOR.color}40`,
            borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" /></svg>
          Trim &amp; download
        </button>
      ) : (
        <div style={{ background: "#fff", border: `1px solid ${B.border}`, borderRadius: 12, padding: 12, marginTop: 2 }}>
          <video ref={videoRef} controls playsInline muted preload="metadata"
            onLoadedMetadata={() => seek(start)}
            style={{ width: "100%", maxHeight: 240, background: "#000", borderRadius: 8, display: "block" }} />
          {ctrl(start, sLo, sHi, onStart, "Start")}
          {ctrl(end, eLo, eHi, onEnd, "End")}
          <div style={{ fontSize: 11, color: B.grey, marginTop: 6, textAlign: "center" }}>
            Clip length <b style={{ color: B.body }}>{len.toFixed(1)}s</b> · nudge each end up to {NUDGE}s
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center" }}>
            <button type="button" onClick={download} disabled={status === "working" || !(end > start)}
              style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "#fff", background: EDITOR.color,
                border: "none", borderRadius: 8, padding: "10px 12px", cursor: "pointer", fontFamily: "inherit",
                opacity: status === "working" || !(end > start) ? 0.55 : 1 }}>
              {status === "working" ? "Trimming…" : "Download clip"}
            </button>
            <button type="button" onClick={() => { setOpen(false); setStatus("idle"); setMsg(""); }}
              style={{ fontSize: 12, fontWeight: 700, color: B.grey, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
              Cancel
            </button>
          </div>
          {msg && (
            <div style={{ fontSize: 11.5, lineHeight: 1.4, marginTop: 8,
              color: status === "done" ? "#3F7049" : status === "error" ? "#C0392B" : B.grey }}>{msg}</div>
          )}
          <div style={{ fontSize: 10, color: "#b3a99c", marginTop: 6 }}>
            On iPhone the clip may open in a new tab — tap Share → Save Video to keep it.
          </div>
        </div>
      )}
    </div>
  );
}
