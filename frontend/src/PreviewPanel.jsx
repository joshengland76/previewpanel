import { useState, useRef, useEffect } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "";

const B = {
  bg: "#FAFAFA", black: "#121212", body: "#212121",
  brown: "#795548", grey: "#90A4AE", beige: "#D7CCC8",
  action: "#4E342E", actionHover: "#3E2723",
  lightBrown: "#EFEBE9", midBrown: "#BCAAA4", border: "#E0D6D3",
};

const PLATFORMS = [
  { id: "youtube", label: "YouTube", pillLabel: "YouTube", icon: "▶", color: "#CC0000",
    hint: "TwelveLabs watches your full video — analyzing delivery, energy, pacing, and hook strength." },
  { id: "tiktok", label: "TikTok", pillLabel: "TikTok", icon: "♪", color: "#010101",
    hint: "Judges evaluate hook strength, loop-ability, audio sync, and scroll-stopping moments." },
  { id: "instagram", label: "Instagram Reels", pillLabel: "Reels", icon: "◉", color: "#C13584",
    hint: "Judges evaluate aesthetic cohesion, first frame, audio choice, and shareability." },
];

const JUDGES = [
  { id: "critic", name: "The Critic", color: B.brown, softBg: "#EFEBE9",
    tagline: "Hard to impress. Spots lazy editing immediately.", scoreLabel: "The Critic's Verdict",
    avatar: "/owl-critic.png" },
  { id: "cool", name: "The Trendsetter", color: "#546E7A", softBg: "#ECEFF1",
    tagline: "Platform-native, trend-aware, detached.", scoreLabel: "The Trendsetter's Take",
    avatar: "/owl-trendsetter.png" },
  { id: "dreamer", name: "The Dreamer", color: "#8D6E63", softBg: "#FBF8F7",
    tagline: "Emotionally intelligent. Asks: how does this feel?", scoreLabel: "The Dreamer's Feeling",
    avatar: "/owl-dreamer.png" },
];

function ScoreRing({ score, color, size = 52 }) {
  const r = (size - 8) / 2, circ = 2 * Math.PI * r, fill = ((score || 0) / 10) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={B.border} strokeWidth="4"/>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth="4"
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.16,1,0.3,1)" }}/>
      <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle"
        fontSize="13" fontWeight="800" fill={color} fontFamily="Montserrat, sans-serif">
        {score ?? "–"}
      </text>
    </svg>
  );
}

function TimestampPill({ ts, color }) {
  return (
    <span style={{
      display: "inline-block", background: color + "15", color,
      border: `1px solid ${color}35`, borderRadius: "4px",
      padding: "1px 7px", fontSize: "10px", fontWeight: "700",
      fontFamily: "'Courier New', monospace", letterSpacing: "0.04em",
      whiteSpace: "nowrap", flexShrink: 0,
    }}>{ts}</span>
  );
}

function momentTypeColor(type, judgeColor) {
  if (type === "drop") return "#E53935";
  if (type === "note") return "#FB8C00";
  return judgeColor;
}

function momentsToTimelinePoints(moments, totalSecs) {
  if (!moments?.length) return [];
  const toSecs = ts => { const [m, s = 0] = String(ts).split(":").map(Number); return m * 60 + s; };
  const times = moments.map(m => toSecs(m.timestamp));
  const duration = totalSecs || Math.max(...times, 1);
  return moments.map((m, i) => ({
    timestamp: m.timestamp,
    position: Math.min(99, Math.max(1, Math.round((toSecs(m.timestamp) / duration) * 100))),
    type: m.type || (i === 0 ? "peak" : "note"),
    note: m.note,
  }));
}

function TimelineDots({ points, color }) {
  const [hovered, setHovered] = useState(null);
  if (!points?.length) return null;
  return (
    <div style={{ marginTop: "16px" }}>
      <div style={{ fontSize: "10px", color: "#aaa", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "8px", fontWeight: "700" }}>
        Attention Map
      </div>
      <div style={{ position: "relative", height: "8px", background: B.border, borderRadius: "99px", marginBottom: "6px" }}>
        {points.map((p, i) => (
          <div key={i}
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
            style={{
              position: "absolute", left: `${Math.min(Math.max(p.position, 2), 96)}%`,
              top: "-4px", width: "16px", height: "16px", borderRadius: "50%",
              background: p.type === "peak" ? color : p.type === "drop" ? "#E53935" : "#FB8C00",
              border: "2px solid white", transform: "translateX(-50%)",
              boxShadow: "0 1px 4px rgba(0,0,0,0.15)", cursor: "pointer",
            }}>
            {hovered === i && (
              <div style={{
                position: "absolute", bottom: "22px",
                ...(p.position < 30
                  ? { left: 0 }
                  : p.position > 70
                  ? { right: 0 }
                  : { left: "50%", transform: "translateX(-50%)" }),
                background: "#212121", color: "#fff", borderRadius: "6px",
                padding: "5px 10px", fontSize: "11px", lineHeight: "1.4",
                whiteSpace: "nowrap", pointerEvents: "none", zIndex: 20,
                boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
              }}>
                <span style={{ fontWeight: "700", fontFamily: "'Courier New', monospace", marginRight: "6px" }}>{p.timestamp}</span>
                {p.note}
              </div>
            )}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "9px", color: "#bbb", marginBottom: "8px" }}>
        <span>0:00</span><span>end</span>
      </div>
      <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
        {[{label:"peak",col:color},{label:"drop risk",col:"#E53935"},{label:"note",col:"#FB8C00"}].map(l => (
          <span key={l.label} style={{ fontSize: "10px", color: "#aaa", display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: l.col, display: "inline-block" }}/>
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function JudgeCard({ judge, judgeResult, videoDurationSecs }) {
  const [open, setOpen] = useState(false);
  const loading = judgeResult?.status === "pending";
  const result = judgeResult?.data;
  const has = !!result && judgeResult?.status === "done";

  return (
    <div style={{
      border: `1.5px solid ${has ? judge.color+"45" : B.border}`,
      borderRadius: "14px", background: "#fff", overflow: "hidden",
      boxShadow: has ? `0 2px 18px ${judge.color}10` : "none", transition: "box-shadow 0.3s",
    }}>
      <div style={{
        background: judge.softBg, padding: "16px 18px",
        display: "flex", alignItems: "center", gap: "12px",
        cursor: has ? "pointer" : "default",
        borderBottom: `1px solid ${judge.color}18`, userSelect: "none",
      }} onClick={() => has && setOpen(o => !o)}>
        <img src={judge.avatar} alt={judge.name} style={{ width: "52px", height: "52px", objectFit: "contain", flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: "800", fontSize: "14px", color: has ? judge.color : "#bbb" }}>{judge.name}</div>
          <div style={{ fontSize: "11px", color: "#bbb", marginTop: "2px" }}>{judge.scoreLabel}</div>
        </div>
        {loading && (
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            {[0,1,2].map(i => (
              <div key={i} style={{
                width: "6px", height: "6px", borderRadius: "50%", background: judge.color,
                animation: `pp-pulse 1.1s ease-in-out ${i*0.18}s infinite`,
              }}/>
            ))}
          </div>
        )}
        {has && <ScoreRing score={result.overall} color={judge.color} size={52}/>}
        {has && <span style={{ fontSize: "11px", color: "#ccc" }}>{open ? "▲" : "▼"}</span>}
      </div>

      {has && (
        <div style={{ padding: "14px 18px 0", display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{
            background: judge.softBg, borderLeft: `3px solid ${judge.color}`,
            borderRadius: "0 8px 8px 0", padding: "11px 14px",
            fontSize: "13px", color: B.body, lineHeight: "1.6", fontStyle: "italic",
          }}>"{result.reaction}"</div>
          {result.positives && (
            <div style={{
              background: "#F1F8F1", border: "1px solid #C8E6C9",
              borderRadius: "8px", padding: "10px 14px",
              display: "flex", gap: "9px", alignItems: "flex-start",
            }}>
              <span style={{ fontSize: "13px", flexShrink: 0, marginTop: "1px" }}>✓</span>
              <span style={{ fontSize: "12px", color: "#2E7D32", lineHeight: "1.55" }}>{result.positives}</span>
            </div>
          )}
        </div>
      )}

      {has && open && (
        <div style={{ padding: "16px 18px 20px", animation: "pp-fade 0.22s ease" }}>
          {(result.delivery || result.content) && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "16px" }}>
              {[{label:"Delivery — How it's presented", val:result.delivery},
                {label:"Content — What's said", val:result.content}].map(item => (
                <div key={item.label} style={{ background: judge.softBg, borderRadius: "8px", padding: "12px" }}>
                  <div style={{ fontSize: "10px", color: "#aaa", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", fontWeight: "700" }}>
                    {item.label}
                  </div>
                  <div style={{ fontSize: "12px", color: B.body, lineHeight: "1.55" }}>{item.val}</div>
                </div>
              ))}
            </div>
          )}
          {result.platformFit && (
            <div style={{ background: judge.softBg, borderRadius: "8px", padding: "12px", marginBottom: "16px" }}>
              <div style={{ fontSize: "10px", color: "#aaa", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px", fontWeight: "700" }}>Platform Fit</div>
              <div style={{ fontSize: "12px", color: B.body, lineHeight: "1.55" }}>{result.platformFit}</div>
            </div>
          )}
          {result.relativeInsight && (
            <div style={{ background: judge.color + "0c", border: `1px solid ${judge.color}25`, borderRadius: "8px", padding: "12px 14px", marginBottom: "16px", display: "flex", gap: "10px", alignItems: "flex-start" }}>
              <span style={{ fontSize: "14px", flexShrink: 0, marginTop: "1px" }}>📊</span>
              <div>
                <div style={{ fontSize: "10px", color: judge.color, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "5px", fontWeight: "700" }}>Compared to Creators Like You</div>
                <div style={{ fontSize: "12px", color: B.body, lineHeight: "1.55" }}>{result.relativeInsight}</div>
              </div>
            </div>
          )}
          {result.moments?.length > 0 && (
            <div style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "10px", color: "#aaa", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px", fontWeight: "700" }}>
                Timestamped Notes — from watching your video
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {result.moments.map((m, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
                    <TimestampPill ts={m.timestamp} color={momentTypeColor(m.type, judge.color)}/>
                    <span style={{ fontSize: "12px", color: B.body, lineHeight: "1.5", paddingTop: "1px" }}>{m.note}</span>
                  </div>
                ))}
              </div>
              <TimelineDots points={momentsToTimelinePoints(result.moments, videoDurationSecs)} color={judge.color}/>
            </div>
          )}
          {result.suggestions?.length > 0 && (
            <div>
              <div style={{ fontSize: "10px", color: "#aaa", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px", fontWeight: "700" }}>Suggestions</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {result.suggestions.map((s, i) => (
                  <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
                    <div style={{
                      width: "20px", height: "20px", borderRadius: "50%",
                      background: judge.color, color: "#fff", fontSize: "10px", fontWeight: "800",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, marginTop: "1px",
                    }}>{i+1}</div>
                    <span style={{ fontSize: "12px", color: B.body, lineHeight: "1.55" }}>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PreviewPanel() {
  const [platform, setPlatform] = useState("youtube");
  const [videoFile, setVideoFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [selectedJudges, setSelectedJudges] = useState(["critic","cool","dreamer"]);
  const [step, setStep] = useState(1);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [judgeResults, setJudgeResults] = useState({});
  const [statusMessage, setStatusMessage] = useState("");
  const [videoDurationSecs, setVideoDurationSecs] = useState(null);
  const pollRef = useRef(null);
  const fileInputRef = useRef(null);
  const plat = PLATFORMS.find(p => p.id === platform);

  const toggleJudge = id => setSelectedJudges(p => p.includes(id) ? p.filter(j => j !== id) : [...p, id]);

  useEffect(() => {
    if (!jobId) return;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/status/${jobId}`);
        const data = await res.json();
        setJobStatus(data.status);
        setJudgeResults(data.results || {});
        if (data.duration) setVideoDurationSecs(data.duration);
        if (data.status === "uploading") setStatusMessage("Uploading to TwelveLabs…");
        else if (data.status === "analyzing") {
          const done = Object.values(data.results||{}).filter(r=>r.status==="done").length;
          setStatusMessage(`Judges watching your video… ${done}/${selectedJudges.length} complete`);
        } else if (data.status === "done" || data.status === "partial" || data.status === "error") {
          clearInterval(pollRef.current);
          if (data.status === "done") {
            setStatusMessage("Analysis complete.");
          } else if (data.status === "partial") {
            const succeeded = Object.values(data.results || {}).filter(r => r.status === "done").length;
            const total = Object.keys(data.results || {}).length;
            setStatusMessage(`${succeeded} of ${total} judges completed — some analyses failed.`);
          } else {
            setStatusMessage(`Error: ${data.error}`);
          }
        }
      } catch { setStatusMessage("Retrying connection…"); }
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => clearInterval(pollRef.current);
  }, [jobId]);

  const handleSubmit = async () => {
    if ((!videoFile && !videoUrl.trim()) || selectedJudges.length === 0) return;
    setStep(2);
    setJudgeResults({});
    setJobStatus("uploading");
    setStatusMessage("Uploading video…");
    const pending = {};
    selectedJudges.forEach(id => pending[id] = { status: "pending" });
    setJudgeResults(pending);
    try {
      const formData = new FormData();
      formData.append("platform", platform);
      formData.append("targetAudience", targetAudience);
      formData.append("judges", JSON.stringify(selectedJudges));
      if (videoFile) formData.append("video", videoFile);
      else formData.append("videoUrl", videoUrl);
      const res = await fetch(`${API_BASE}/api/analyze`, { method: "POST", body: formData });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setJobId(data.jobId);
    } catch (err) {
      setJobStatus("error");
      setStatusMessage(`Failed: ${err.message}`);
    }
  };

  const reset = () => {
    clearInterval(pollRef.current);
    setStep(1); setJobId(null); setJobStatus(null);
    setJudgeResults({}); setVideoFile(null); setVideoUrl(""); setStatusMessage(""); setVideoDurationSecs(null);
  };

  const doneResults = Object.values(judgeResults).filter(r => r.status === "done" && r.data?.overall);
  const avgScore = doneResults.length > 0
    ? Math.round(doneResults.reduce((s,r) => s + r.data.overall, 0) / doneResults.length) : null;

  return (
    <div style={{ minHeight: "100vh", background: B.bg, fontFamily: "Montserrat, sans-serif", color: B.body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,400;0,600;0,700;0,800;1,400&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes pp-pulse { 0%,100%{opacity:.2;transform:scale(.75)} 50%{opacity:1;transform:scale(1.2)} }
        @keyframes pp-fade { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pp-slide { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        .pp-btn:hover:not(:disabled) { background: ${B.actionHover} !important; transform: translateY(-1px); }
        .pp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .drop-zone:hover { border-color: ${B.brown} !important; background: ${B.lightBrown} !important; }
        textarea:focus, input:focus { outline: none; border-color: ${B.brown} !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: ${B.beige}; border-radius: 99px; }
        .pp-sticky-wrap { margin-top: 4px; }
        @media (max-width: 480px) {
          .pp-header { height: 46px !important; padding: 0 14px !important; }
          .pp-logo { height: 42px !important; }
          .pp-main { padding: 14px 14px 0 !important; }
          .pp-hero { margin-bottom: 18px !important; }
          .pp-hero-sub { display: none; }
          .pp-section-gap { margin-bottom: 12px !important; }
          .pp-judge-list { gap: 5px !important; }
          .pp-content-pad { padding-bottom: 80px; }
          .pp-sticky-wrap {
            position: fixed; bottom: 0; left: 0; right: 0;
            padding: 10px 14px max(20px, env(safe-area-inset-bottom));
            background: linear-gradient(to bottom, rgba(250,250,250,0) 0%, rgba(250,250,250,1) 38%);
            z-index: 50;
            margin-top: 0;
          }
        }
      `}</style>

      <header className="pp-header" style={{
        background: "#fff", borderBottom: `1px solid ${B.border}`,
        padding: "0 24px", height: "56px",
        display: "flex", alignItems: "center", gap: "10px",
        position: "sticky", top: 0, zIndex: 100,
        boxShadow: "0 1px 10px rgba(0,0,0,0.05)",
      }}>
        <img className="pp-logo" src="/owl-logo.png" alt="PreviewPanel" style={{ height: "52px", width: "auto", flexShrink: 0 }} />
        <span style={{ fontSize: "10px", fontWeight: "700", background: B.action, color: "#fff", padding: "3px 8px", borderRadius: "4px", letterSpacing: "0.06em" }}>BETA</span>
        {step === 2 && (
          <button onClick={reset} style={{
            marginLeft: "auto", background: "transparent",
            border: `1.5px solid ${B.border}`, borderRadius: "8px",
            padding: "6px 12px", fontSize: "12px", fontWeight: "700",
            color: B.brown, cursor: "pointer", fontFamily: "Montserrat, sans-serif",
          }}>← New Video</button>
        )}
      </header>

      <main className="pp-main" style={{ maxWidth: "740px", margin: "0 auto", padding: "32px 20px 60px" }}>

        {step === 1 && (
          <div className="pp-content-pad" style={{ animation: "pp-slide 0.35s ease" }}>

            {/* Hero */}
            <div className="pp-hero" style={{ textAlign: "center", marginBottom: "28px" }}>
              <h1 style={{ fontWeight: "800", fontSize: "clamp(20px,5.5vw,38px)", color: B.black, letterSpacing: "-0.03em", lineHeight: 1.15, marginBottom: "8px" }}>
                Know how your video lands<br/><span style={{ color: B.brown }}>before you post it.</span>
              </h1>
              <p className="pp-hero-sub" style={{ color: "#aaa", fontSize: "13px", lineHeight: "1.55" }}>
                Three AI judges actually watch your video — analyzing delivery, energy, editing, and pacing.
              </p>
            </div>

            {/* 1 — Video upload */}
            <div className="pp-section-gap" style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: "700", color: "#aaa", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>Your Video</div>
              <div className="drop-zone" onClick={() => fileInputRef.current.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if(f){setVideoFile(f);setVideoUrl("");} }}
                style={{
                  border: `2px dashed ${videoFile ? B.brown : B.border}`,
                  borderRadius: "12px", textAlign: "center",
                  cursor: "pointer", background: videoFile ? B.lightBrown : "#fff",
                  transition: "all 0.2s ease", marginBottom: "10px",
                  minHeight: "118px", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                {videoFile ? (
                  <div style={{ padding: "14px 20px" }}>
                    <div style={{ fontSize: "20px", marginBottom: "4px" }}>🎬</div>
                    <div style={{ fontWeight: "700", fontSize: "13px", color: B.brown }}>{videoFile.name}</div>
                    <div style={{ fontSize: "11px", color: "#aaa", marginTop: "3px" }}>
                      {(videoFile.size/1024/1024).toFixed(1)} MB ·{" "}
                      <span onClick={e=>{e.stopPropagation();setVideoFile(null);}} style={{ color: B.brown, cursor: "pointer", textDecoration: "underline" }}>Remove</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: "14px 20px" }}>
                    <div style={{ fontSize: "26px", marginBottom: "5px" }}>⬆</div>
                    <div style={{ fontWeight: "700", fontSize: "13px", color: "#888" }}>Tap to upload · MP4, MOV, WebM</div>
                    <div style={{ fontSize: "11px", color: "#bbb", marginTop: "3px", lineHeight: "1.4" }}>{plat.hint}</div>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="video/*"
                onChange={e=>{const f=e.target.files[0];if(f){setVideoFile(f);setVideoUrl("");}}}
                style={{ display: "none" }}/>
              {!videoFile && (
                <>
                  <div style={{ textAlign: "center", fontSize: "11px", color: "#bbb", marginBottom: "8px" }}>— or paste a direct .mp4 URL —</div>
                  <input value={videoUrl} onChange={e=>setVideoUrl(e.target.value)}
                    placeholder="https://example.com/your-video.mp4"
                    style={{ width: "100%", padding: "10px 13px", background: "#fff", border: `1.5px solid ${B.border}`, borderRadius: "10px", color: B.body, fontSize: "13px", fontFamily: "Montserrat, sans-serif" }}/>
                </>
              )}
            </div>

            {/* 2 — Platform pills */}
            <div className="pp-section-gap" style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: "700", color: "#aaa", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>Platform</div>
              <div style={{ display: "flex", gap: "6px" }}>
                {PLATFORMS.map(p => (
                  <button key={p.id} onClick={() => setPlatform(p.id)} style={{
                    flex: 1, height: "38px", borderRadius: "99px",
                    border: `2px solid ${platform === p.id ? p.color : B.border}`,
                    background: platform === p.id ? p.color+"10" : "#fff",
                    color: platform === p.id ? p.color : "#aaa",
                    fontSize: "12px", fontWeight: "700", cursor: "pointer",
                    fontFamily: "Montserrat, sans-serif", transition: "all 0.15s ease",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: "5px",
                    padding: "0 6px", whiteSpace: "nowrap",
                  }}>
                    <span style={{ fontSize: "12px", lineHeight: 1 }}>{p.icon}</span>
                    {p.pillLabel}
                  </button>
                ))}
              </div>
            </div>

            {/* 3 — Target audience */}
            <div className="pp-section-gap" style={{ marginBottom: "16px" }}>
              <div style={{ fontSize: "11px", fontWeight: "700", color: "#aaa", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>
                Audience <span style={{ fontWeight: "400", textTransform: "none", color: "#ccc" }}>(optional)</span>
              </div>
              <input value={targetAudience} onChange={e=>setTargetAudience(e.target.value)}
                placeholder="e.g. First-time investors, 25–35, financially curious"
                style={{ width: "100%", padding: "10px 13px", background: "#fff", border: `1.5px solid ${B.border}`, borderRadius: "10px", color: B.body, fontSize: "13px", fontFamily: "Montserrat, sans-serif" }}/>
            </div>

            {/* 4 — Judge selector */}
            <div className="pp-section-gap" style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "11px", fontWeight: "700", color: "#aaa", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "8px" }}>Your Panel</div>
              <div className="pp-judge-list" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {JUDGES.map(j => {
                  const active = selectedJudges.includes(j.id);
                  return (
                    <div key={j.id} onClick={() => toggleJudge(j.id)} style={{
                      display: "flex", alignItems: "center", gap: "10px",
                      padding: "8px 14px", borderRadius: "10px",
                      border: `1.5px solid ${active ? j.color+"50" : B.border}`,
                      background: active ? j.softBg : "#fff",
                      cursor: "pointer", transition: "all 0.15s ease",
                    }}>
                      <img src={j.avatar} alt={j.name} style={{ width: "28px", height: "28px", objectFit: "contain", flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: "800", fontSize: "12px", color: active ? j.color : "#bbb" }}>{j.name}</div>
                        <div style={{ fontSize: "10px", color: "#bbb", marginTop: "1px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.tagline}</div>
                      </div>
                      <div style={{ width: "18px", height: "18px", borderRadius: "4px", border: `2px solid ${active ? j.color : B.border}`, background: active ? j.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
                        {active && <span style={{ color: "#fff", fontSize: "10px", fontWeight: "800", lineHeight: 1 }}>✓</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 5 — CTA (sticky on mobile) */}
            <div className="pp-sticky-wrap">
              <button className="pp-btn" onClick={handleSubmit}
                disabled={(!videoFile && !videoUrl.trim()) || selectedJudges.length === 0}
                style={{ width: "100%", padding: "15px", background: B.action, border: "none", borderRadius: "12px", color: "#fff", fontSize: "15px", fontWeight: "800", cursor: "pointer", fontFamily: "Montserrat, sans-serif", letterSpacing: "0.02em", transition: "all 0.18s ease", boxShadow: "0 2px 10px rgba(78,52,46,0.25)" }}>
                Convene the Panel · {selectedJudges.length} Judge{selectedJudges.length !== 1 ? "s" : ""}
              </button>
            </div>

          </div>
        )}

        {step === 2 && (
          <div style={{ animation: "pp-slide 0.3s ease" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "18px", flexWrap: "wrap" }}>
              <div style={{ padding: "5px 13px", background: plat.color+"10", border: `1.5px solid ${plat.color}35`, borderRadius: "99px", fontSize: "12px", fontWeight: "700", color: plat.color }}>
                {plat.icon} {plat.label}
              </div>
              {videoFile && (
                <div style={{ padding: "5px 13px", background: "#fff", border: `1.5px solid ${B.border}`, borderRadius: "99px", fontSize: "11px", color: "#888", fontFamily: "'Courier New', monospace" }}>
                  {videoFile.name}
                </div>
              )}
              <span style={{ fontSize: "12px", color: jobStatus === "error" ? "#E53935" : "#bbb", fontStyle: "italic" }}>
                {statusMessage}
              </span>
            </div>

            {/* TwelveLabs attribution */}
            <div style={{ background: "#fff", border: `1px solid ${B.border}`, borderRadius: "8px", padding: "10px 16px", fontSize: "11px", color: "#aaa", display: "flex", alignItems: "center", gap: "8px", marginBottom: "18px" }}>
              <span style={{ fontSize: "16px" }}>👁</span>
              <span>Powered by <strong style={{ color: B.body }}>TwelveLabs Pegasus</strong> — the AI watches your full video, analyzing visuals, delivery, audio, and pacing together.</span>
            </div>

            {/* Consensus */}
            {avgScore !== null && (
              <div style={{ background: "#fff", border: `1.5px solid ${B.border}`, borderRadius: "14px", padding: "20px 24px", marginBottom: "18px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 2px 14px rgba(0,0,0,0.04)" }}>
                <div>
                  <div style={{ fontWeight: "800", fontSize: "15px", color: B.black }}>Panel Verdict</div>
                  <div style={{ fontSize: "12px", color: "#bbb", marginTop: "3px" }}>{doneResults.length} of {selectedJudges.length} judges complete</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  {JUDGES.filter(j => selectedJudges.includes(j.id) && judgeResults[j.id]?.status==="done").map(j => (
                    <ScoreRing key={j.id} score={judgeResults[j.id].data.overall} color={j.color} size={44}/>
                  ))}
                  <div style={{ fontSize: "50px", fontWeight: "800", letterSpacing: "-0.03em", lineHeight: 1, color: avgScore >= 7 ? "#43A047" : avgScore >= 5 ? "#FB8C00" : "#E53935" }}>
                    {avgScore}<span style={{ fontSize: "20px", color: "#ccc", fontWeight: "400" }}>/10</span>
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {selectedJudges.map(jid => (
                <JudgeCard key={jid} judge={JUDGES.find(j=>j.id===jid)} judgeResult={judgeResults[jid]} videoDurationSecs={videoDurationSecs}/>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
