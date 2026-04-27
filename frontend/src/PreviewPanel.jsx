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

// ── Issue #9: Local history helpers ──────────────────────────
const HISTORY_KEY = "pp_history_v1";
const MAX_HISTORY = 10;

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch { return []; }
}

function saveToHistory(entry) {
  try {
    const history = loadHistory();
    history.unshift(entry);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  } catch {}
}

// ── Elapsed time hook ─────────────────────────────────────────
function useElapsed(running) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(null);
  useEffect(() => {
    if (running) {
      startRef.current = Date.now();
      const iv = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
      return () => clearInterval(iv);
    } else {
      setElapsed(0);
    }
  }, [running]);
  return elapsed;
}

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
                ...(p.position < 30 ? { left: 0 } : p.position > 70 ? { right: 0 } : { left: "50%", transform: "translateX(-50%)" }),
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

// ── Issue #6: Animated status messages while waiting ─────────
const WAITING_MESSAGES = [
  { text: "Unlike other tools that just read a transcript, PreviewPanel actually watches your video — every frame, every expression, every cut.", highlight: true },
  { text: "Your judges are analyzing visuals, audio, pacing, and delivery simultaneously — the same way a real viewer experiences it.", highlight: false },
  { text: "Most AI video tools convert speech to text and analyze that. PreviewPanel sees what your audience sees.", highlight: true },
  { text: "Feel free to switch apps — you'll get a notification the moment your results are ready.", highlight: true },
  { text: "PreviewPanel is tracking energy levels, editing rhythm, and on-screen moments across your entire video right now.", highlight: false },
  { text: "This is worth the wait. Your judges are watching the full video, not skimming it.", highlight: false },
  { text: "You can put your phone down. We'll notify you when the panel has reached its verdict.", highlight: true },
  { text: "Three independent AI reviewers. One video. Zero shortcuts. That's why it takes a few minutes.", highlight: false },
  { text: "Still working — deep video analysis takes time. Your results will be thorough.", highlight: false },
  { text: "Judges are identifying specific timestamps where your video peaks and drops — frame by frame.", highlight: false },
  { text: "Go check your email, grab a coffee. We'll ping you when the verdict is in.", highlight: true },
  { text: "Audio quality, lighting, pacing, hook strength — it's all being evaluated right now.", highlight: false },
  { text: "Most AI feedback takes seconds because it's shallow. This takes minutes because it's real.", highlight: true },
  { text: "Your judges have watched more content than any human critic. They're applying that now.", highlight: false },
  { text: "You can leave this screen — the analysis runs in the background and we'll notify you.", highlight: true },
  { text: "Delivery, content, platform fit, timestamps — every dimension is being scored independently.", highlight: false },
  { text: "Still running. Complex video analysis is worth every second of this wait.", highlight: false },
  { text: "Hashtag suggestions coming…", highlight: false },
  { text: "Three judges, three perspectives, one video. Almost there.", highlight: false },
  { text: "Go live your life — PreviewPanel will find you when it's ready.", highlight: true },
];

function useWaitingMessage(isWaiting) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (!isWaiting) { setIdx(0); return; }
    const iv = setInterval(() => setIdx(i => (i + 1) % WAITING_MESSAGES.length), 10000);
    return () => clearInterval(iv);
  }, [isWaiting]);
  return WAITING_MESSAGES[idx];
}

// ── Issue #4: Notification permission priming modal ───────────
function NotificationPrimer({ onAllow, onSkip }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 100, padding: "20px",
    }}>
      <div style={{
        background: "#fff", borderRadius: "18px", padding: "28px 24px",
        maxWidth: "340px", width: "100%", textAlign: "center",
        boxShadow: "0 8px 40px rgba(0,0,0,0.2)",
        animation: "pp-slide 0.25s ease",
      }}>
        <div style={{ fontSize: "48px", marginBottom: "12px" }}>🔔</div>
        <div style={{ fontWeight: "800", fontSize: "18px", color: B.black, marginBottom: "10px" }}>
          Don't miss your results
        </div>
        <div style={{ fontSize: "14px", color: "#666", lineHeight: "1.6", marginBottom: "20px" }}>
          AI analysis takes <strong>10–15 minutes</strong>. Since you probably won't stare at the screen the whole time, enable notifications so we can tell you the moment your panel is ready.
        </div>
        <button onClick={onAllow} style={{
          width: "100%", height: "50px", background: B.action, border: "none",
          borderRadius: "10px", color: "#fff", fontSize: "15px", fontWeight: "800",
          cursor: "pointer", fontFamily: "Montserrat, sans-serif", marginBottom: "10px",
        }}>
          Yes, notify me when it's ready
        </button>
        <button onClick={onSkip} style={{
          width: "100%", height: "40px", background: "transparent", border: "none",
          color: "#aaa", fontSize: "13px", cursor: "pointer", fontFamily: "Montserrat, sans-serif",
        }}>
          I'll wait and watch the screen
        </button>
      </div>
    </div>
  );
}

// ── Issue #9: History panel ───────────────────────────────────
function HistoryPanel({ history, onRestore, onClose }) {
  if (!history.length) return (
    <div style={{ padding: "24px", textAlign: "center", color: "#aaa", fontSize: "13px" }}>
      No previous results yet.
    </div>
  );
  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px" }}>
      {history.map((entry, i) => {
        const plat = PLATFORMS.find(p => p.id === entry.platform) || PLATFORMS[0];
        const date = new Date(entry.savedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        return (
          <div key={i} onClick={() => onRestore(entry)} style={{
            background: "#fff", border: `1.5px solid ${B.border}`, borderRadius: "12px",
            padding: "14px 16px", cursor: "pointer", transition: "border-color 0.15s",
          }}
            onMouseEnter={e => e.currentTarget.style.borderColor = B.brown}
            onMouseLeave={e => e.currentTarget.style.borderColor = B.border}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
              <span style={{ fontSize: "11px", fontWeight: "700", color: plat.color }}>{plat.icon} {plat.label}</span>
              <span style={{ fontSize: "10px", color: "#bbb", marginLeft: "auto" }}>{date}</span>
            </div>
            <div style={{ fontSize: "12px", color: "#888", marginBottom: "6px", fontFamily: "'Courier New', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {entry.fileName}
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              {entry.scores.map(s => (
                <span key={s.id} style={{ fontSize: "11px", fontWeight: "700", color: JUDGES.find(j=>j.id===s.id)?.color || B.brown }}>
                  {JUDGES.find(j=>j.id===s.id)?.name.split(" ")[1] || s.id}: {s.score}/10
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function JudgeCard({ judge, judgeResult, videoDurationSecs, platform }) {
  const [open, setOpen] = useState(false);
  const loading = judgeResult?.status === "pending";
  const result = judgeResult?.data;
  const has = !!result && judgeResult?.status === "done";
  const showHashtags = (platform === "tiktok" || platform === "instagram") && result?.hashtags?.length > 0;

  return (
    <div style={{
      border: `1.5px solid ${has ? judge.color+"45" : B.border}`,
      borderRadius: "14px", background: "#fff", overflow: "hidden",
      boxShadow: has ? `0 2px 18px ${judge.color}10` : "none", transition: "box-shadow 0.3s",
    }}>
      {/* ── Issue #8: More obvious expand affordance ── */}
      <div style={{
        background: judge.softBg, padding: "16px 18px",
        display: "flex", alignItems: "center", gap: "12px",
        cursor: has ? "pointer" : "default",
        borderBottom: `1px solid ${judge.color}18`, userSelect: "none",
      }} onClick={() => has && setOpen(o => !o)}>
        <div style={{ background: judge.softBg, borderRadius: "8px", flexShrink: 0 }}>
          <img src={judge.avatar} alt={judge.name}
            style={{ width: "52px", height: "52px", objectFit: "contain", display: "block", background: judge.softBg }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: "800", fontSize: "14px", color: has ? judge.color : "#bbb" }}>{judge.name}</div>
          <div style={{ fontSize: "11px", color: "#bbb", marginTop: "2px" }}>{judge.scoreLabel}</div>
          {has && open && (
            <div style={{ fontSize: "10px", color: "#aaa", marginTop: "3px", fontWeight: "700", letterSpacing: "0.04em" }}>
              TAP TO COLLAPSE ↑
            </div>
          )}
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
                {label:"Content — What's said or shown", val:result.content}].map(item => (
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

          {/* Issue #7: Hashtags */}
          {showHashtags && (
            <div style={{ background: judge.softBg, borderRadius: "8px", padding: "12px", marginBottom: "16px" }}>
              <div style={{ fontSize: "10px", color: "#aaa", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px", fontWeight: "700" }}>Suggested Hashtags</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                {result.hashtags.map((tag, i) => (
                  <span key={i} style={{
                    background: judge.color + "15", color: judge.color,
                    border: `1px solid ${judge.color}35`, borderRadius: "99px",
                    padding: "4px 12px", fontSize: "12px", fontWeight: "700",
                  }}>#{tag}</span>
                ))}
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

      {/* Issue #8: Bottom tap hint when collapsed and has results */}
      {has && !open && (
        <div onClick={() => setOpen(true)} style={{
          padding: "10px 18px", borderTop: `1px solid ${judge.color}18`,
          textAlign: "center", cursor: "pointer",
          fontSize: "11px", fontWeight: "700", color: judge.color,
          background: judge.softBg, letterSpacing: "0.04em",
        }}>
          TAP TO READ FULL FEEDBACK ↓
        </div>
      )}
    </div>
  );
}

// ── Issue #5 & #6: Big waiting banner ────────────────────────
function WaitingBanner({ elapsed, statusMessage, queuePosition, judgeResults, selectedJudges, jobStatus }) {
  const isWaiting = jobStatus === "analyzing" || jobStatus === "uploading" || jobStatus === "queued";
  const waitingMsg = useWaitingMessage(isWaiting);
  const isError = jobStatus === "error";

  const doneCount = Object.values(judgeResults).filter(r => r.status === "done").length;
  const totalCount = selectedJudges.length;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedStr = `${mins}:${secs.toString().padStart(2, "0")}`;

  if (isError) return null;

  // Queue waiting state
  if (queuePosition > 0) {
    return (
      <div style={{
        background: "#FFF8E1", border: "1.5px solid #FFD54F", borderRadius: "14px",
        padding: "20px 24px", marginBottom: "18px", textAlign: "center",
      }}>
        <div style={{ fontSize: "28px", marginBottom: "8px" }}>⏳</div>
        <div style={{ fontWeight: "800", fontSize: "16px", color: "#795548", marginBottom: "6px" }}>
          {queuePosition === 1
            ? "You're next in line — starting very soon!"
            : queuePosition <= 3
            ? "Other videos being processed. You're nearing the top of the queue!"
            : `Other videos being processed. You're #${queuePosition} in line.`}
        </div>
        <div style={{ fontSize: "13px", color: "#888", lineHeight: "1.6" }}>
          Your analysis will start automatically — no need to do anything.
        </div>
      </div>
    );
  }

  // Active processing state — always show this once queuePosition is 0
  return (
    <div style={{
      background: B.lightBrown, border: `1.5px solid ${B.brown}30`, borderRadius: "14px",
      padding: "20px 24px", marginBottom: "18px",
    }}>
      {/* Progress bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <div style={{ fontWeight: "800", fontSize: "15px", color: B.action }}>
          {jobStatus === "uploading" || jobStatus === "queued"
            ? "Uploading & converting…"
            : `${doneCount} of ${totalCount} judges done`}
        </div>
        <div style={{ fontSize: "13px", fontWeight: "700", color: B.brown, fontFamily: "'Courier New', monospace" }}>
          {elapsedStr}
        </div>
      </div>

      {/* Judge progress pills */}
      {jobStatus === "analyzing" && (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "14px" }}>
          {selectedJudges.map(jid => {
            const judge = JUDGES.find(j => j.id === jid);
            const res = judgeResults[jid];
            const done = res?.status === "done";
            return (
              <div key={jid} style={{
                display: "flex", alignItems: "center", gap: "6px",
                padding: "5px 10px", borderRadius: "99px",
                background: done ? judge.color + "20" : "#fff",
                border: `1.5px solid ${done ? judge.color : B.border}`,
                fontSize: "12px", fontWeight: "700", color: done ? judge.color : "#bbb",
              }}>
                <span>{done ? "✓" : "…"}</span>
                {judge.name}
              </div>
            );
          })}
        </div>
      )}

      {/* Rotating message */}
      <div style={{
        fontSize: waitingMsg.highlight ? "14px" : "13px",
        color: waitingMsg.highlight ? B.action : B.body,
        fontWeight: waitingMsg.highlight ? "700" : "400",
        fontStyle: waitingMsg.highlight ? "normal" : "italic",
        lineHeight: "1.6", transition: "opacity 0.5s",
        borderLeft: waitingMsg.highlight ? `3px solid ${B.brown}` : "none",
        paddingLeft: waitingMsg.highlight ? "12px" : "0",
      }}>
        {waitingMsg.text}
      </div>

      <div style={{ marginTop: "10px", fontSize: "11px", color: "#aaa" }}>
        Analysis typically takes 10–15 minutes. You can leave this screen — we'll notify you when it's ready.
      </div>
    </div>
  );
}

export default function PreviewPanel() {
  const [platform, setPlatform] = useState("youtube");
  const [videoFile, setVideoFile] = useState(null);
  const [targetAudience, setTargetAudience] = useState("");
  const [selectedJudges, setSelectedJudges] = useState(["critic","cool","dreamer"]);
  const [step, setStep] = useState(1);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [judgeResults, setJudgeResults] = useState({});
  const [statusMessage, setStatusMessage] = useState("");
  const [videoDurationSecs, setVideoDurationSecs] = useState(null);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showNotifPrimer, setShowNotifPrimer] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState(loadHistory);
  const [queuePosition, setQueuePosition] = useState(0);
  const pollRef = useRef(null);
  const fileInputRef = useRef(null);
  const notifiedRef = useRef(false);
  const savedRef = useRef(false);
  const plat = PLATFORMS.find(p => p.id === platform);
  const isFinished = jobStatus === "done" || jobStatus === "partial";
  const isProcessing = !isFinished && jobStatus !== "error" && jobStatus !== null;

  const elapsed = useElapsed(isProcessing);

  useEffect(() => {
    const handler = e => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

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
        if (typeof data.queuePosition === "number") setQueuePosition(data.queuePosition);

        if (data.status === "queued") {
          setStatusMessage(`Waiting in queue — position #${data.queuePosition}…`);
        } else if (data.status === "uploading") {
          setStatusMessage("Converting and uploading your video…");
        } else if (data.status === "analyzing") {
          const done = Object.values(data.results||{}).filter(r=>r.status==="done").length;
          const total = Object.keys(data.results||{}).length;
          setStatusMessage(`${done} of ${total} judges done…`);
        } else if (data.status === "done" || data.status === "partial" || data.status === "error") {
          clearInterval(pollRef.current);
          if (data.status === "done" || data.status === "partial") {
            const succeeded = Object.values(data.results||{}).filter(r=>r.status==="done").length;
            const total = Object.keys(data.results||{}).length;
            setStatusMessage(data.status === "done" ? "Analysis complete!" : `${succeeded} of ${total} judges completed.`);

            // Notification
            if (!notifiedRef.current && Notification?.permission === "granted") {
              notifiedRef.current = true;
              new Notification("PreviewPanel 🦉", { body: "Your results are ready!" });
            }

            // Issue #9: Auto-save to history
            if (!savedRef.current) {
              savedRef.current = true;
              const scores = Object.entries(data.results || {})
                .filter(([,v]) => v.status === "done")
                .map(([id, v]) => ({ id, score: v.data?.overall }));
              const entry = {
                platform,
                fileName: videoFile?.name || "video",
                savedAt: Date.now(),
                scores,
                results: data.results,
                videoDuration: data.duration,
                selectedJudges,
              };
              saveToHistory(entry);
              setHistory(loadHistory());
            }
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
    if (!videoFile || selectedJudges.length === 0) return;

    // Issue #4: Show notification primer before starting
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      setShowNotifPrimer(true);
      return;
    }
    startAnalysis();
  };

  const startAnalysis = async () => {
    setShowNotifPrimer(false);
    notifiedRef.current = false;
    savedRef.current = false;
    setStep(2);
    setJudgeResults({});
    setJobStatus("uploading");
    setQueuePosition(0);
    setStatusMessage("Uploading your video…");
    const pending = {};
    selectedJudges.forEach(id => { pending[id] = { status: "pending" }; });
    setJudgeResults(pending);
    try {
      const formData = new FormData();
      formData.append("platform", platform);
      formData.append("targetAudience", targetAudience);
      formData.append("judges", JSON.stringify(selectedJudges));
      formData.append("video", videoFile);
      const res = await fetch(`${API_BASE}/api/analyze`, { method: "POST", body: formData });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setJobId(data.jobId);
      if (data.queuePosition > 0) {
        setJobStatus("queued");
        setQueuePosition(data.queuePosition);
      }
    } catch (err) {
      setJobStatus("error");
      setStatusMessage(`Failed: ${err.message}`);
    }
  };

  const handleAllowNotifications = async () => {
    await Notification.requestPermission();
    startAnalysis();
  };

  const reset = () => {
    clearInterval(pollRef.current);
    setStep(1); setJobId(null); setJobStatus(null);
    setJudgeResults({}); setVideoFile(null); setStatusMessage("");
    setVideoDurationSecs(null); setQueuePosition(0);
    notifiedRef.current = false; savedRef.current = false;
  };

  // Issue #9: Restore from history
  const restoreFromHistory = (entry) => {
    setShowHistory(false);
    setPlatform(entry.platform);
    setSelectedJudges(entry.selectedJudges || ["critic","cool","dreamer"]);
    setJudgeResults(entry.results || {});
    if (entry.videoDuration) setVideoDurationSecs(entry.videoDuration);
    setJobStatus("done");
    setStatusMessage("Restored from history.");
    setStep(2);
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
          .pp-main { padding: 0 14px 0 !important; }
          .pp-section-gap { margin-bottom: 8px !important; }
          .pp-judge-list { gap: 4px !important; }
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

      {/* Issue #4: Notification primer modal */}
      {showNotifPrimer && (
        <NotificationPrimer
          onAllow={handleAllowNotifications}
          onSkip={startAnalysis}
        />
      )}

      <main className="pp-main" style={{ maxWidth: "740px", margin: "0 auto", padding: "32px 20px 60px" }}>

        {/* ── INPUT SCREEN ── */}
        {step === 1 && (
          <div className="pp-content-pad" style={{ animation: "pp-slide 0.35s ease" }}>

            {/* Logo + BETA + History button */}
            <div style={{ textAlign: "center", paddingTop: "10px", paddingBottom: "8px", position: "relative" }}>
              <img src="/owl-logo.png" alt="PreviewPanel"
                style={{ height: "98px", width: "auto", display: "block", margin: "0 auto" }} />
              <div style={{ marginTop: "4px" }}>
                <span style={{ fontSize: "10px", fontWeight: "700", background: B.action, color: "#fff", padding: "3px 8px", borderRadius: "4px", letterSpacing: "0.06em" }}>BETA</span>
              </div>
              {/* Issue #9: History button */}
              {history.length > 0 && (
                <button onClick={() => setShowHistory(v => !v)} style={{
                  position: "absolute", top: "10px", right: "0",
                  background: "#fff", border: `1.5px solid ${B.border}`,
                  borderRadius: "8px", padding: "6px 10px",
                  fontSize: "11px", fontWeight: "700", color: B.brown,
                  cursor: "pointer", fontFamily: "Montserrat, sans-serif",
                }}>
                  📋 History ({history.length})
                </button>
              )}
            </div>

            {/* History panel */}
            {showHistory && (
              <div style={{
                border: `1.5px solid ${B.border}`, borderRadius: "14px",
                background: "#fff", marginBottom: "16px",
                animation: "pp-fade 0.2s ease",
              }}>
                <div style={{
                  padding: "14px 16px", borderBottom: `1px solid ${B.border}`,
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                }}>
                  <div style={{ fontWeight: "800", fontSize: "14px", color: B.black }}>Recent Results</div>
                  <button onClick={() => setShowHistory(false)} style={{ background: "none", border: "none", fontSize: "18px", color: "#aaa", cursor: "pointer" }}>×</button>
                </div>
                <HistoryPanel history={history} onRestore={restoreFromHistory} onClose={() => setShowHistory(false)} />
              </div>
            )}

            {/* 1 — Video upload */}
            <div className="pp-section-gap" style={{ marginBottom: "10px" }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: "#aaa", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "6px" }}>Your Video</div>
              <div className="drop-zone" onClick={() => fileInputRef.current.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setVideoFile(f); }}
                style={{
                  border: `2px dashed ${videoFile ? B.brown : B.border}`,
                  borderRadius: "12px", textAlign: "center",
                  cursor: "pointer", background: videoFile ? B.lightBrown : "#fff",
                  transition: "all 0.2s ease",
                  minHeight: "140px", display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                {videoFile ? (
                  <div style={{ padding: "12px 20px" }}>
                    <div style={{ fontSize: "20px", marginBottom: "4px" }}>🎬</div>
                    <div style={{ fontWeight: "700", fontSize: "13px", color: B.brown }}>{videoFile.name}</div>
                    <div style={{ fontSize: "11px", color: "#aaa", marginTop: "3px" }}>
                      {(videoFile.size/1024/1024).toFixed(1)} MB ·{" "}
                      <span onClick={e => { e.stopPropagation(); setVideoFile(null); }}
                        style={{ color: B.brown, cursor: "pointer", textDecoration: "underline" }}>Remove</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: "12px 20px" }}>
                    <div style={{ fontSize: "26px", marginBottom: "4px" }}>⬆</div>
                    <div style={{ fontWeight: "700", fontSize: "13px", color: "#888" }}>Tap to upload · MP4, MOV, WebM</div>
                    {/* Issue #3: Show limit in UI */}
                    <div style={{ fontSize: "11px", color: "#bbb", marginTop: "2px", lineHeight: "1.4" }}>Maximum 3 minutes · {plat.hint}</div>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="video/*"
                onChange={e => { const f = e.target.files[0]; if (f) setVideoFile(f); }}
                style={{ display: "none" }}/>
            </div>

            {/* 2 — Platform pills */}
            <div className="pp-section-gap" style={{ marginBottom: "10px" }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: "#aaa", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "6px" }}>Platform</div>
              <div style={{ display: "flex", gap: "6px" }}>
                {PLATFORMS.map(p => (
                  <button key={p.id} onClick={() => setPlatform(p.id)} style={{
                    flex: 1, height: "48px", borderRadius: "99px",
                    border: `2px solid ${platform === p.id ? p.color : B.border}`,
                    background: platform === p.id ? p.color+"10" : "#fff",
                    color: platform === p.id ? p.color : "#aaa",
                    fontSize: "13px", fontWeight: "700", cursor: "pointer",
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
            <div className="pp-section-gap" style={{ marginBottom: "10px" }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: "#aaa", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "6px" }}>
                Audience <span style={{ fontWeight: "400", textTransform: "none", color: "#ccc" }}>(optional)</span>
              </div>
              <input value={targetAudience} onChange={e => setTargetAudience(e.target.value)}
                placeholder="e.g. First-time investors, 25–35, financially curious"
                style={{ width: "100%", padding: "13px", height: "48px", background: "#fff", border: `1.5px solid ${B.border}`, borderRadius: "10px", color: B.body, fontSize: "14px", fontFamily: "Montserrat, sans-serif" }}/>
            </div>

            {/* 4 — Judge selector */}
            <div className="pp-section-gap" style={{ marginBottom: "12px" }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: "#aaa", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "6px" }}>Your Panel</div>
              <div className="pp-judge-list" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {JUDGES.map(j => {
                  const active = selectedJudges.includes(j.id);
                  return (
                    <div key={j.id} onClick={() => toggleJudge(j.id)} style={{
                      display: "flex", alignItems: "center", gap: "12px",
                      padding: "14px 14px", borderRadius: "10px",
                      border: `1.5px solid ${active ? j.color+"50" : B.border}`,
                      background: active ? j.softBg : "#fff",
                      cursor: "pointer", transition: "all 0.15s ease",
                    }}>
                      <div style={{ background: active ? j.softBg : "#F5F5F5", borderRadius: "6px", flexShrink: 0 }}>
                        <img src={j.avatar} alt={j.name}
                          style={{ width: "44px", height: "44px", objectFit: "contain", display: "block", background: active ? j.softBg : "#F5F5F5" }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: "800", fontSize: "14px", color: active ? j.color : "#bbb" }}>{j.name}</div>
                        <div style={{ fontSize: "12px", color: "#bbb", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{j.tagline}</div>
                      </div>
                      <div style={{ width: "20px", height: "20px", borderRadius: "4px", border: `2px solid ${active ? j.color : B.border}`, background: active ? j.color : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
                        {active && <span style={{ color: "#fff", fontSize: "11px", fontWeight: "800", lineHeight: 1 }}>✓</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 5 — CTA */}
            <div className="pp-sticky-wrap">
              <button className="pp-btn" onClick={handleSubmit}
                disabled={!videoFile || selectedJudges.length === 0}
                style={{ width: "100%", height: "56px", background: B.action, border: "none", borderRadius: "12px", color: "#fff", fontSize: "16px", fontWeight: "800", cursor: "pointer", fontFamily: "Montserrat, sans-serif", letterSpacing: "0.02em", transition: "all 0.18s ease", boxShadow: "0 2px 10px rgba(78,52,46,0.25)" }}>
                Convene the Panel · {selectedJudges.length} Judge{selectedJudges.length !== 1 ? "s" : ""}
              </button>
              {videoFile && (
                <div style={{ textAlign: "center", marginTop: "8px", fontSize: "11px", color: "#aaa" }}>
                  ⏱ Analysis takes 10–15 minutes — we'll notify you when it's ready
                </div>
              )}
            </div>

            {/* Add to Home Screen prompt */}
            {deferredPrompt && (
              <div style={{ marginTop: "12px", padding: "10px 14px", background: "#fff", border: `1px solid ${B.border}`, borderRadius: "10px", display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "18px" }}>📱</span>
                <span style={{ fontSize: "12px", color: B.body, flex: 1 }}>Add PreviewPanel to your home screen for quick access.</span>
                <button onClick={async () => {
                  deferredPrompt.prompt();
                  const { outcome } = await deferredPrompt.userChoice;
                  if (outcome === "accepted") setDeferredPrompt(null);
                }} style={{ background: B.action, color: "#fff", border: "none", borderRadius: "6px", padding: "6px 12px", fontSize: "11px", fontWeight: "700", cursor: "pointer", fontFamily: "Montserrat, sans-serif", whiteSpace: "nowrap" }}>
                  Add
                </button>
                <button onClick={() => setDeferredPrompt(null)}
                  style={{ background: "transparent", border: "none", color: "#bbb", cursor: "pointer", fontSize: "18px", padding: "0 4px", lineHeight: 1 }}>×</button>
              </div>
            )}
          </div>
        )}

        {/* ── RESULTS SCREEN ── */}
        {step === 2 && (
          <div style={{ animation: "pp-slide 0.3s ease" }}>

            {/* Top bar */}
            <div style={{ textAlign: "center", paddingTop: "10px", paddingBottom: "8px", position: "relative" }}>
              <img src="/owl-logo.png" alt="PreviewPanel"
                style={{ height: "98px", width: "auto", display: "block", margin: "0 auto" }} />
              {(isFinished || jobStatus === "error") && (
                <button onClick={reset} style={{
                  position: "absolute", top: "10px", right: "0",
                  background: "transparent",
                  border: `1.5px solid ${B.border}`, borderRadius: "8px",
                  padding: "6px 12px", fontSize: "12px", fontWeight: "700",
                  color: B.brown, cursor: "pointer", fontFamily: "Montserrat, sans-serif",
                }}>← New Video</button>
              )}
            </div>

            {/* Issue #5 & #6: Prominent waiting banner */}
            {isProcessing && (
              <WaitingBanner
                elapsed={elapsed}
                statusMessage={statusMessage}
                queuePosition={queuePosition}
                judgeResults={judgeResults}
                selectedJudges={selectedJudges}
                jobStatus={jobStatus}
              />
            )}

            {/* Issue #6: Error state — clear message */}
            {jobStatus === "error" && (
              <div style={{
                background: "#FFEBEE", border: "1.5px solid #EF9A9A", borderRadius: "14px",
                padding: "20px 24px", marginBottom: "18px",
              }}>
                <div style={{ fontWeight: "800", fontSize: "15px", color: "#C62828", marginBottom: "6px" }}>
                  ⚠️ Something went wrong
                </div>
                <div style={{ fontSize: "13px", color: "#B71C1C", lineHeight: "1.6" }}>
                  {statusMessage.replace("Error: ", "")}
                </div>
                <button onClick={reset} style={{
                  marginTop: "14px", background: "#C62828", color: "#fff", border: "none",
                  borderRadius: "8px", padding: "10px 20px", fontSize: "13px", fontWeight: "700",
                  cursor: "pointer", fontFamily: "Montserrat, sans-serif",
                }}>
                  ← Try Again
                </button>
              </div>
            )}

            {/* Platform + file tags (only when finished) */}
            {isFinished && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "18px", flexWrap: "wrap" }}>
                <div style={{ padding: "5px 13px", background: plat.color+"10", border: `1.5px solid ${plat.color}35`, borderRadius: "99px", fontSize: "12px", fontWeight: "700", color: plat.color, flexShrink: 0 }}>
                  {plat.icon} {plat.label}
                </div>
                {videoFile && (
                  <div style={{ padding: "5px 13px", background: "#fff", border: `1.5px solid ${B.border}`, borderRadius: "99px", fontSize: "11px", color: "#888", fontFamily: "'Courier New', monospace" }}>
                    {videoFile.name}
                  </div>
                )}
                <span style={{ fontSize: "12px", color: "#888", fontStyle: "italic" }}>{statusMessage}</span>
              </div>
            )}

            {/* TwelveLabs attribution */}
            <div style={{ background: "#fff", border: `1px solid ${B.border}`, borderRadius: "8px", padding: "10px 16px", fontSize: "11px", color: "#aaa", display: "flex", alignItems: "center", gap: "8px", marginBottom: "18px" }}>
              <span style={{ fontSize: "16px" }}>👁</span>
              <span>Powered by <strong style={{ color: B.body }}>TwelveLabs Pegasus</strong> — the AI watches your full video, analyzing visuals, delivery, audio, and pacing together.</span>
            </div>

            {/* Panel Verdict */}
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
                <JudgeCard key={jid} judge={JUDGES.find(j=>j.id===jid)} judgeResult={judgeResults[jid]} videoDurationSecs={videoDurationSecs} platform={platform}/>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
