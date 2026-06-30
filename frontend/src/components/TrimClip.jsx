import { useEffect, useRef, useState } from "react";
import { B, JUDGE_BY_ID } from "../brand.js";

// ─────────────────────────────────────────────────────────────────────────────
// Per-clip "Trim & download" affordance for the Editor's suggested segments.
//
// LIVE-SESSION ONLY. Scrubbing is client-side against the original `videoFile`
// still in memory (createObjectURL → <video>). A combined two-handle bar (handles
// can't cross) plus ±0.1s steppers set start/end, each within ±3s of the Editor's
// suggestion. A persistent time readout + "Preview selection" play the exact cut.
// On confirm we POST {jobId,start,end,mode:"reencode"} to /api/trim → full-res,
// post-quality H.264 clip → download. Hidden without a videoFile (restored history).
// ─────────────────────────────────────────────────────────────────────────────

const EDITOR = JUDGE_BY_ID.critic;
const NUDGE = 3;     // seconds each handle may move from the suggestion
const STEP = 0.1;    // stepper increment
const GAP = 0.3;     // minimum clip length

const toSecs = (v) => {
  if (typeof v === "number") return v;
  const p = String(v).split(":").map(Number);
  return p.length === 2 ? p[0] * 60 + p[1] : Number(v) || 0;
};
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fmtMs = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((Math.max(0, s) % 1) * 10)}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;

export default function TrimClip({ clip, trim }) {
  const { videoFile, jobId, apiBase = "", durationSecs } = trim || {};
  const cap = Number.isFinite(durationSecs) && durationSecs > 0 ? durationSecs : 1e9;
  const sugStart = clamp(toSecs(clip.start), 0, cap);
  const sugEnd = clamp(toSecs(clip.end), sugStart + 0.5, cap);
  const startMin = Math.max(0, sugStart - NUDGE), startMax = Math.min(cap, sugStart + NUDGE);
  const endMin = Math.max(0, sugEnd - NUDGE), endMax = Math.min(cap, sugEnd + NUDGE);
  const winLo = Math.max(0, sugStart - NUDGE), winHi = Math.min(cap, sugEnd + NUDGE);

  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(round1(sugStart));
  const [end, setEnd] = useState(round1(sugEnd));
  const [cur, setCur] = useState(sugStart);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | working | error | done
  const [msg, setMsg] = useState("");

  const videoRef = useRef(null);
  const trackRef = useRef(null);
  const dragRef = useRef(null);   // "start" | "end" | null
  const startRef = useRef(start); startRef.current = start;
  const endRef = useRef(end); endRef.current = end;
  const playingRef = useRef(playing); playingRef.current = playing;

  useEffect(() => {
    if (!open || !videoFile) return;
    const url = URL.createObjectURL(videoFile);
    const v = videoRef.current; if (v) v.src = url;
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, videoFile]);

  const seek = (t) => { const v = videoRef.current; if (v && Number.isFinite(t)) { try { v.currentTime = t; setCur(t); } catch { /* iOS pre-metadata */ } } };
  const applyStart = (t) => { const v = clamp(round1(t), startMin, Math.min(startMax, endRef.current - GAP)); setStart(v); return v; };
  const applyEnd = (t) => { const v = clamp(round1(t), Math.max(endMin, startRef.current + GAP), endMax); setEnd(v); return v; };

  // Combined two-handle bar — drag handlers (pointer events; iOS-safe).
  const timeFromX = (clientX) => {
    const tr = trackRef.current; if (!tr) return null;
    const r = tr.getBoundingClientRect();
    return winLo + clamp((clientX - r.left) / r.width, 0, 1) * (winHi - winLo);
  };
  useEffect(() => {
    const move = (e) => {
      if (!dragRef.current) return;
      const t = timeFromX(e.clientX); if (t == null) return;
      if (dragRef.current === "start") seek(applyStart(t));
      else if (dragRef.current === "end") seek(applyEnd(t));
      else seek(clamp(t, startRef.current, endRef.current)); // playhead, locked to selection
      e.preventDefault();
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Playback is locked to the selection: it never plays past `end`, and pressing
  // play from outside the window restarts at `start`. (No native controls, so the
  // viewer can't scrub/skip beyond what's selected.)
  const onTime = () => {
    const v = videoRef.current; if (!v) return;
    setCur(v.currentTime);
    if (!v.paused && v.currentTime >= endRef.current - 0.03) { v.pause(); setPlaying(false); }
  };
  const play = () => {
    const v = videoRef.current; if (!v) return;
    if (v.currentTime < startRef.current || v.currentTime >= endRef.current - 0.03) { v.currentTime = startRef.current; setCur(startRef.current); }
    v.play().then(() => setPlaying(true)).catch(() => {});
  };
  const pause = () => { const v = videoRef.current; if (v) v.pause(); setPlaying(false); };
  const togglePlay = () => { const v = videoRef.current; if (v) (v.paused ? play() : pause()); };
  const restart = () => { const v = videoRef.current; if (!v) return; v.currentTime = startRef.current; setCur(startRef.current); v.play().then(() => setPlaying(true)).catch(() => {}); };

  const download = async () => {
    if (!(end > start)) { setStatus("error"); setMsg("Start must be before end."); return; }
    const v = videoRef.current; if (v) { v.pause(); setPlaying(false); }
    setStatus("working"); setMsg("");
    const body = JSON.stringify({ jobId, start: Number(start.toFixed(2)), end: Number(end.toFixed(2)), mode: "reencode" });
    const hit = () => fetch(`${apiBase}/api/trim`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    try {
      let res = await hit();
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500)); res = await hit(); }
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
  const pct = (t) => `${((t - winLo) / (winHi - winLo)) * 100}%`;
  const thumb = (which, val, onDown) => (
    <div onPointerDown={onDown} role="slider" aria-valuenow={val}
      style={{ position: "absolute", left: pct(val), top: "50%", transform: "translate(-50%,-50%)",
        width: 20, height: 20, borderRadius: "50%", background: "#fff", border: `3px solid ${EDITOR.color}`,
        boxShadow: "0 1px 3px rgba(0,0,0,.25)", cursor: "grab", touchAction: "none", zIndex: 2 }}
      title={which} />
  );
  const stepper = (label, val, onMinus, onPlus, lo, hi) => (
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: B.body, marginBottom: 4, textAlign: "center" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button type="button" onClick={onMinus} disabled={val <= lo + 1e-6} style={stepBtn}>−</button>
        <span style={{ fontFamily: "'Courier New', monospace", fontSize: 13, fontWeight: 700, color: EDITOR.color, minWidth: 56, textAlign: "center" }}>{fmtMs(val)}</span>
        <button type="button" onClick={onPlus} disabled={val >= hi - 1e-6} style={stepBtn}>+</button>
      </div>
    </div>
  );

  return (
    <div style={{ marginTop: 9 }}>
      {!open ? (
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button type="button" onClick={() => setOpen(true)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700,
              color: EDITOR.color, background: EDITOR.color + "12", border: `1px solid ${EDITOR.color}40`,
              borderRadius: 999, padding: "6px 12px", cursor: "pointer", fontFamily: "inherit" }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><line x1="20" y1="4" x2="8.12" y2="15.88" /><line x1="14.47" y1="14.48" x2="20" y2="20" /><line x1="8.12" y1="8.12" x2="12" y2="12" /></svg>
            Trim &amp; download
          </button>
        </div>
      ) : (
        <div style={{ background: "#fff", border: `1px solid ${B.border}`, borderRadius: 12, padding: 12, marginTop: 2 }}>
          <video ref={videoRef} playsInline preload="metadata"
            onLoadedMetadata={() => seek(start)} onTimeUpdate={onTime}
            onClick={togglePlay} onEnded={() => setPlaying(false)}
            style={{ width: "100%", maxHeight: 240, background: "#000", borderRadius: 8, display: "block", cursor: "pointer" }} />

          {/* Persistent time readout — always visible (native controls auto-hide). */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8,
            fontFamily: "'Courier New', monospace", fontSize: 12.5, fontWeight: 700 }}>
            <span style={{ color: playing ? EDITOR.color : B.grey }}>⏱ {fmtMs(cur)}</span>
            <span style={{ color: B.body }}>{fmtMs(start)} – {fmtMs(end)} · {len.toFixed(1)}s</span>
          </div>

          {/* Combined two-handle bar — handles cannot cross. */}
          <div ref={trackRef} style={{ position: "relative", height: 28, margin: "10px 8px 2px", touchAction: "none" }}>
            <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 5, transform: "translateY(-50%)", background: B.lightBrown, borderRadius: 99 }} />
            <div style={{ position: "absolute", top: "50%", height: 5, transform: "translateY(-50%)", left: pct(start), width: `${((end - start) / (winHi - winLo)) * 100}%`, background: EDITOR.color, borderRadius: 99 }} />
            {/* Playhead — current position; draggable to set the resume point. Near
                a handle it yields (pointer-events off) so the handle stays grabbable. */}
            {(() => {
              const span = winHi - winLo || 1;
              const nearHandle = (cur - start) / span < 0.1 || (end - cur) / span < 0.1;
              return (
                <div
                  onPointerDown={nearHandle ? undefined : (e) => { pause(); dragRef.current = "playhead"; e.preventDefault(); }}
                  style={{ position: "absolute", top: 0, bottom: 0, left: pct(clamp(cur, start, end)), width: 22,
                    transform: "translateX(-50%)", zIndex: 1, display: "flex", justifyContent: "center",
                    touchAction: "none", pointerEvents: nearHandle ? "none" : "auto", cursor: nearHandle ? "default" : "grab" }}>
                  <div style={{ width: 3, height: "100%", background: "#1F1B16", borderRadius: 2 }} />
                </div>
              );
            })()}
            {thumb("start", start, (e) => { dragRef.current = "start"; e.preventDefault(); })}
            {thumb("end", end, (e) => { dragRef.current = "end"; e.preventDefault(); })}
          </div>

          {/* Fine steppers */}
          <div style={{ display: "flex", gap: 14, marginTop: 8 }}>
            {stepper("Start", start, () => seek(applyStart(start - STEP)), () => seek(applyStart(start + STEP)), startMin, Math.min(startMax, end - GAP))}
            {stepper("End", end, () => seek(applyEnd(end - STEP)), () => seek(applyEnd(end + STEP)), Math.max(endMin, start + GAP), endMax)}
          </div>

          {/* Playback locked to the selection — play/pause + restart (no skip). */}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" onClick={togglePlay} style={playBtn}>
              {playing ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
              )}
              {playing ? "Pause" : "Play"}
            </button>
            <button type="button" onClick={restart} style={playBtn} title="Back to start">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>
              Restart
            </button>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
            <button type="button" onClick={download} disabled={status === "working" || !(end > start)}
              style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "#fff", background: EDITOR.color,
                border: "none", borderRadius: 8, padding: "10px 12px", cursor: "pointer", fontFamily: "inherit",
                opacity: status === "working" || !(end > start) ? 0.55 : 1 }}>
              {status === "working" ? (
                <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                  <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,.45)", borderTopColor: "#fff", borderRadius: "50%", animation: "pp-spin 0.8s linear infinite", display: "inline-block" }} />
                  Trimming…
                </span>
              ) : "Download clip"}
            </button>
            <button type="button" onClick={() => { const v = videoRef.current; if (v) v.pause(); setOpen(false); setPlaying(false); setStatus("idle"); setMsg(""); }}
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

const stepBtn = {
  width: 30, height: 30, borderRadius: 7, border: `1px solid ${EDITOR.color}55`, background: EDITOR.color + "10",
  color: EDITOR.color, fontSize: 18, fontWeight: 800, lineHeight: 1, cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
};
const playBtn = {
  flex: 1, fontSize: 12.5, fontWeight: 700, color: EDITOR.color, background: EDITOR.color + "12",
  border: `1px solid ${EDITOR.color}40`, borderRadius: 8, padding: "9px", cursor: "pointer", fontFamily: "inherit",
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
};
