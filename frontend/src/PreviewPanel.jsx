import { useState, useRef, useEffect } from "react";
import TikTokLogo from "./components/TikTokLogo";
import InstagramLogo from "./components/InstagramLogo";
import YouTubeLogo from "./components/YouTubeLogo";
import { B, JUDGES } from "./brand.js";
import { VerdictPanel } from "./components/VerdictHero.jsx";
import { WhatsWorkingFixes } from "./components/WhatsWorkingFixes.jsx";
import { DisagreementCard } from "./components/DisagreementCard.jsx";
import { ScoreDisplay } from "./components/ScoreDisplay.jsx";
import { PerformanceRadar } from "./components/PerformanceRadar.jsx";
import { ToolkitSection } from "./components/ToolkitSection.jsx";
import { JudgeDeepDives } from "./components/JudgeDeepDives.jsx";

const PLATFORM_LOGOS = { youtube: YouTubeLogo, tiktok: TikTokLogo, instagram: InstagramLogo };
function PlatformIcon({ id, size }) {
  const Logo = PLATFORM_LOGOS[id];
  return Logo ? <Logo size={size} /> : null;
}

const API_BASE = import.meta.env.VITE_API_URL || "";

const PLATFORMS = [
  { id: "youtube", label: "Shorts", pillLabel: "Shorts", color: "#CC0000",
    hint: "TwelveLabs watches your full video — analyzing delivery, energy, pacing, and hook strength." },
  { id: "tiktok", label: "TikTok", pillLabel: "TikTok", color: "#010101",
    hint: "Judges evaluate hook strength, loop-ability, audio sync, and scroll-stopping moments." },
  { id: "instagram", label: "Reels", pillLabel: "Reels", color: "#C13584",
    hint: "Judges evaluate aesthetic cohesion, first frame, audio choice, and shareability." },
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



// ── Issue #6: Animated status messages while waiting ─────────
const WAITING_MESSAGES = [
  { text: "Unlike other tools that just read a transcript, PreviewPanel actually watches your video — every frame, every expression, every cut.", highlight: true },
  { text: "Your judges are analyzing visuals, audio, pacing, and delivery simultaneously — the same way a real viewer experiences it.", highlight: false },
  { text: "Most AI video tools convert speech to text and analyze that. PreviewPanel sees what your audience sees.", highlight: true },
  { text: "Feel free to switch apps — you'll get a notification the moment your results are ready.", highlight: true },
  { text: "The Trendsetter is sourcing your hashtags — finding the tags that get you discovered.", highlight: false },
  { text: "PreviewPanel is tracking energy levels, editing rhythm, and on-screen moments across your entire video right now.", highlight: false },
  { text: "This is worth the wait. Your judges are watching the full video, not skimming it.", highlight: false },
  { text: "You can put your phone down. We'll notify you when the panel has reached its verdict.", highlight: true },
  { text: "The Editor is hunting for your standout scene — looking for moments worth clipping.", highlight: false },
  { text: "Three independent AI reviewers. One video. Zero shortcuts. That's why it takes a few minutes.", highlight: false },
  { text: "Still working — deep video analysis takes time. Your results will be thorough.", highlight: false },
  { text: "Judges are identifying specific timestamps where your video peaks and drops — frame by frame.", highlight: false },
  { text: "Go check your email, grab a coffee. We'll ping you when the verdict is in.", highlight: true },
  { text: "Audio quality, lighting, pacing, hook strength — it's all being evaluated right now.", highlight: false },
  { text: "Most AI feedback takes seconds because it's shallow. This takes minutes because it's real.", highlight: true },
  { text: "The Connector is finding your human moment — crafting captions that make people feel seen.", highlight: false },
  { text: "Your judges have watched more content than any human critic. They're applying that now.", highlight: false },
  { text: "You can leave this screen — the analysis runs in the background and we'll notify you.", highlight: true },
  { text: "Delivery, content, platform fit, timestamps — every dimension is being scored independently.", highlight: false },
  { text: "Still running. Complex video analysis is worth every second of this wait.", highlight: false },
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
function NotificationPrimer({ onAllow, onSkip, timeEstimate }) {
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
          Analysis usually takes <strong>{timeEstimate}</strong> for a file this size. Enable notifications so we can tell you the moment your panel is ready.
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
            padding: "12px", cursor: "pointer", transition: "border-color 0.15s",
            display: "flex", gap: "12px", alignItems: "center",
          }}
            onMouseEnter={e => e.currentTarget.style.borderColor = B.brown}
            onMouseLeave={e => e.currentTarget.style.borderColor = B.border}
          >
            {entry.thumbnailDataUrl
              ? <img src={entry.thumbnailDataUrl} alt="" style={{ width: "80px", height: "52px", objectFit: "cover", borderRadius: "6px", flexShrink: 0 }} />
              : <div style={{ width: "80px", height: "52px", background: "#f0ece6", borderRadius: "6px", flexShrink: 0 }} />
            }
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <span style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: "700", color: plat.color }}><PlatformIcon id={plat.id} size={13} />{plat.label}</span>
                <span style={{ fontSize: "10px", color: "#bbb", marginLeft: "auto" }}>{date}</span>
              </div>
              <div style={{ fontSize: "12px", color: "#888", marginBottom: "6px", fontFamily: "'Courier New', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {entry.fileName}
              </div>
              {(() => {
                const validScores = (entry.scores || []).filter(s => s.score != null);
                if (!validScores.length) return null;
                const avg = validScores.reduce((sum, s) => sum + s.score, 0) / validScores.length;
                const avgRounded = Math.round(avg * 10) / 10;
                const scoreColor = avg >= 7 ? "#43A047" : avg >= 5 ? "#FB8C00" : "#E53935";
                return (
                  <span style={{ fontSize: "12px", fontWeight: "700", color: scoreColor }}>
                    {avgRounded}/10 avg
                  </span>
                );
              })()}
            </div>
          </div>
        );
      })}
    </div>
  );
}



// ── Issue #5 & #6: Big waiting banner ────────────────────────
function WaitingBanner({ elapsed, judgeResults, selectedJudges, jobStatus, uploadComplete, timeEstimate }) {
  const isWaiting = jobStatus === "analyzing" || jobStatus === "uploading" || jobStatus === "queued";
  const waitingMsg = useWaitingMessage(isWaiting);

  const doneCount = Object.values(judgeResults).filter(r => r.status === "done").length;
  const totalCount = selectedJudges.length;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedStr = `${mins}:${secs.toString().padStart(2, "0")}`;

  let statusText;
  if (jobStatus === "uploading" || jobStatus === "queued") {
    statusText = uploadComplete ? "Preparing your case file…" : "Uploading & converting…";
  } else if (doneCount === 0) {
    statusText = "The panel is reviewing the evidence…";
  } else if (doneCount === 1) {
    statusText = "1 of 3 judges has reached their verdict";
  } else if (doneCount === 2) {
    statusText = "2 of 3 judges have reached their verdict";
  } else {
    statusText = `${doneCount} of ${totalCount} judges have reached their verdict`;
  }

  return (
    <div style={{
      background: B.lightBrown, border: `1.5px solid ${B.brown}30`, borderRadius: "14px",
      padding: "20px 24px", marginBottom: "18px",
    }}>
      {/* Progress bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <div style={{ fontWeight: "800", fontSize: "15px", color: B.action }}>
          {statusText}
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
        Analysis usually takes {timeEstimate} for a file this size. You can leave this screen — we'll notify you when it's ready.
      </div>
    </div>
  );
}

const OBJECTIVE_OPTIONS = [
  "Funny Videos/Comedy", "Food & Drinks/Cooking", "Travel", "Fashion",
  "Makeup/Beauty", "Pets/Animals", "Fitness/Wellness", "Dancing", "Gaming",
  "Storytelling", "Life Hacks", "Fun Facts", "Shopping", "Cars/Automotive",
  "ASMR", "Myth Busting", "Educational/How-To", "Aesthetic/Vibes", "Business/Finance",
];

export default function PreviewPanel() {
  const [platform, setPlatform] = useState("youtube");
  const [videoFile, setVideoFile] = useState(null);
  const [detectedFileDurationSecs, setDetectedFileDurationSecs] = useState(null);
  const [objective, setObjective] = useState("");
  const [restoredFileName, setRestoredFileName] = useState(null);
  const [objDropOpen, setObjDropOpen] = useState(false);
  const [objFilter, setObjFilter] = useState("");
  const [objDropAbove, setObjDropAbove] = useState(false);
  const [selectedJudges, setSelectedJudges] = useState(["critic","cool","connector"]);
  const [step, setStep] = useState(1);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [judgeResults, setJudgeResults] = useState({});
  const [synthesis, setSynthesis] = useState(null);
  const [synthesisStatus, setSynthesisStatus] = useState(null);
  const [scoreDisplay, setScoreDisplay] = useState(null); // dark-launched (Phase B3, Task 5); always null unless DISPLAY_SCORE_ENABLED
  const [trimAvailable, setTrimAvailable] = useState(false);
  const [openJudgeIds, setOpenJudgeIds] = useState(() => new Set());
  const [statusMessage, setStatusMessage] = useState("");
  const [videoDurationSecs, setVideoDurationSecs] = useState(null);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showNotifPrimer, setShowNotifPrimer] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState(loadHistory);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadProgressIndeterminate, setUploadProgressIndeterminate] = useState(false);
  const [uploadedMB, setUploadedMB] = useState(0);
  const [uploadSpeedMBps, setUploadSpeedMBps] = useState(0);
  const [showSlowConnWarning, setShowSlowConnWarning] = useState(false);
  const [largeFileWarning, setLargeFileWarning] = useState(null);
  const [largeSizeRiskWarning, setLargeSizeRiskWarning] = useState(false);
  const [uploadZoneError, setUploadZoneError] = useState(null);
  const pollRef = useRef(null);
  const synthWaitRef = useRef(0);
  const objDropRef = useRef(null);
  const objInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const xhrRef = useRef(null);
  const notifiedRef = useRef(false);
  const savedRef = useRef(false);
  const plat = PLATFORMS.find(p => p.id === platform);
  const isFinished = jobStatus === "done" || jobStatus === "partial";
  const isProcessing = !isFinished && jobStatus !== "error" && jobStatus !== "timeout" && jobStatus !== null;

  const elapsed = useElapsed(isProcessing);

  const fileSizeMBForEstimate = videoFile ? videoFile.size / 1024 / 1024 : null;
  const timeEstimate = fileSizeMBForEstimate !== null && fileSizeMBForEstimate < 100 && detectedFileDurationSecs !== null && detectedFileDurationSecs < 120
    ? "1–2 minutes"
    : "2–4 minutes";

  useEffect(() => {
    const handler = e => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    if (!objDropOpen) {
      document.activeElement?.blur();
      return;
    }
    function handleOutside(e) {
      if (objDropRef.current && !objDropRef.current.contains(e.target)) {
        setObjDropOpen(false);
        setObjFilter("");
      }
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [objDropOpen]);

  const toggleJudge = id => setSelectedJudges(p => p.includes(id) ? p.filter(j => j !== id) : [...p, id]);

  // Deep-dive card open/close (results view) — independent of judge selection.
  const toggleJudgeCard = (id) => setOpenJudgeIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  // verdict mini-scores / sticky chips jump to + expand the matching judge card.
  const jumpToJudge = (id) => {
    setOpenJudgeIds(prev => new Set(prev).add(id));
    setTimeout(() => {
      const el = document.getElementById(`judge-${id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  useEffect(() => {
    if (!jobId) return;
    synthWaitRef.current = 0;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/status/${jobId}`);
        const data = await res.json();
        if (res.status === 404 || data.error === "Job not found") {
          clearInterval(pollRef.current);
          setJobStatus("error");
          setStatusMessage("The server restarted during analysis. Please submit your video again.");
          return;
        }
        setJobStatus(data.status);
        setJudgeResults(data.results || {});
        if (data.duration) setVideoDurationSecs(data.duration);
        setSynthesis(data.synthesis ?? null);
        setSynthesisStatus(data.synthesisStatus ?? null);
        setScoreDisplay(data.scoreDisplay ?? null);
        setTrimAvailable(!!data.trimAvailable);

        const jobDone = data.status === "done" || data.status === "partial";
        const jobErrored = data.status === "error" || data.status === "timeout";
        // App submissions get a fire-and-forget synthesis that lands shortly AFTER
        // the judges finish. Keep polling while it's still "pending" (capped ~40s)
        // so the "assembling" state can swap to the real overview when it arrives.
        // null status on a just-finished job = the brief gap before the backend
        // marks synthesis "pending"; treat it as pending so we don't flash the
        // fallback. Either way it's bounded by the wait cap.
        const synthPending = data.synthesisStatus === "pending" || data.synthesisStatus == null;
        if (jobDone && synthPending) synthWaitRef.current++;
        const waitingForSynth = jobDone && synthPending && synthWaitRef.current < 14;
        if (waitingForSynth) setStatusMessage("Assembling your panel results…");

        if ((jobDone && !waitingForSynth) || jobErrored) {
          clearInterval(pollRef.current);
          // Synthesis never resolved within the cap → degrade to the fallback view.
          if (jobDone && synthPending) setSynthesisStatus("failed");
          if (jobDone) {
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
                objective,
                fileName: videoFile?.name || "video",
                savedAt: Date.now(),
                scores,
                results: data.results,
                synthesis: data.synthesis ?? null,
                synthesisStatus: synthPending ? "failed" : data.synthesisStatus,
                videoDuration: data.duration,
                selectedJudges,
                thumbnailDataUrl: data.thumbnailDataUrl || null,
              };
              saveToHistory(entry);
              setHistory(loadHistory());
            }
          } else if (data.status === "timeout") {
            setStatusMessage(data.error || "The panel took too long to reach a verdict.");
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

  // Runs immediately after the user picks a file — never blocks the file picker opening.
  const handleFileSelect = (f) => {
    setVideoFile(f);
    setDetectedFileDurationSecs(null);
    setLargeFileWarning(null);
    setLargeSizeRiskWarning(false);
    setUploadZoneError(null);
    const sizeMB = f.size / 1024 / 1024;

    const clearFile = () => {
      setVideoFile(null);
      setDetectedFileDurationSecs(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    };

    const url = URL.createObjectURL(f);
    const vid = document.createElement("video");
    vid.preload = "metadata";
    let settled = false;

    // 3-second timeout — MacBook Chrome sometimes never fires onloadedmetadata for .mov
    const metadataTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      console.log(`[PreviewPanel] Metadata load timed out — file: "${f.name}", size: ${sizeMB.toFixed(1)}MB`);
      if (sizeMB > 1024) {
        clearFile();
        setUploadZoneError(`File too large (${Math.round(sizeMB)}MB). Please use a video under 1GB.`);
      } else if (sizeMB > 150) {
        setLargeFileWarning(`${Math.round(sizeMB)}MB`);
      }
    }, 3000);

    vid.onloadedmetadata = () => {
      if (settled) return;
      settled = true;
      clearTimeout(metadataTimeout);
      URL.revokeObjectURL(url);
      if (vid.duration > 300) {
        clearFile();
        setUploadZoneError("Video is over 5 minutes long. Please trim it and try again.");
      } else if (sizeMB > 1024) {
        clearFile();
        setUploadZoneError(`File too large (${Math.round(sizeMB)}MB). Please use a video under 1GB.`);
      } else {
        setDetectedFileDurationSecs(vid.duration);
        if (sizeMB > 300 && vid.duration > 90) {
          setLargeSizeRiskWarning(true);
          if (sizeMB > 150) setLargeFileWarning(`${Math.round(sizeMB)}MB`);
        } else if (sizeMB > 150) {
          setLargeFileWarning(`${Math.round(sizeMB)}MB`);
        }
      }
    };

    vid.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(metadataTimeout);
      URL.revokeObjectURL(url);
      if (sizeMB > 1024) {
        clearFile();
        setUploadZoneError(`File too large (${Math.round(sizeMB)}MB). Please use a video under 1GB.`);
      } else if (sizeMB > 150) {
        setLargeFileWarning(`${Math.round(sizeMB)}MB`);
      }
    };

    vid.src = url;
  };

  // Validation already completed in handleFileSelect — just check stored state, then go.
  const startAnalysis = () => {
    if (uploadZoneError) return;
    doStartAnalysis();
  };

  const doStartAnalysis = () => {
    setShowNotifPrimer(false);
    notifiedRef.current = false;
    savedRef.current = false;
    setStep(2);
    setJudgeResults({});
    setSynthesis(null); setSynthesisStatus(null); setTrimAvailable(false); setOpenJudgeIds(new Set());
    setRestoredFileName(null);
    setJobStatus("uploading");
    setUploadProgress(0);
    setUploadProgressIndeterminate(false);
    setUploadedMB(0);
    setUploadSpeedMBps(0);
    setShowSlowConnWarning(false);
    setStatusMessage("Uploading your video…");
    const pending = {};
    selectedJudges.forEach(id => { pending[id] = { status: "pending" }; });
    setJudgeResults(pending);

    const formData = new FormData();
    formData.append("platform", platform);
    formData.append("objective", objective);
    formData.append("judges", JSON.stringify(selectedJudges));
    formData.append("video", videoFile);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    const uploadStart = Date.now();
    let slowConnStart = null;

    const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
    const timeoutHandle = setTimeout(() => {
      xhr.abort();
      setJobStatus("error");
      setStatusMessage("Upload timed out. Please try on a stronger WiFi connection or reduce your video file size.");
    }, UPLOAD_TIMEOUT_MS);

    // Show pulsing indeterminate bar if no progress event fires within 5 seconds
    let noProgressTimer = setTimeout(() => {
      setUploadProgressIndeterminate(true);
    }, 5000);

    xhr.upload.onprogress = (e) => {
      clearTimeout(noProgressTimer);
      noProgressTimer = null;
      setUploadProgressIndeterminate(false);
      if (!e.lengthComputable) return;
      const loaded = e.loaded / 1024 / 1024;
      const elapsedSecs = (Date.now() - uploadStart) / 1000;
      const speed = elapsedSecs > 0 ? loaded / elapsedSecs : 0;
      setUploadedMB(loaded);
      setUploadProgress((e.loaded / e.total) * 100);
      setUploadSpeedMBps(speed);
      if (speed < 0.5 && speed > 0) {
        if (slowConnStart === null) slowConnStart = Date.now();
        else if (Date.now() - slowConnStart > 10_000) setShowSlowConnWarning(true);
      } else {
        slowConnStart = null;
        setShowSlowConnWarning(false);
      }
    };

    xhr.onload = () => {
      clearTimeout(timeoutHandle);
      clearTimeout(noProgressTimer);
      try {
        const data = JSON.parse(xhr.responseText);
        if (data.error) throw new Error(data.error);
        setUploadProgress(100);
        setUploadProgressIndeterminate(false);
        setJobStatus("uploading");
        setJobId(data.jobId);
      } catch (err) {
        setJobStatus("error");
        setStatusMessage(`Failed: ${err.message}`);
      }
    };

    xhr.onerror = () => {
      clearTimeout(timeoutHandle);
      clearTimeout(noProgressTimer);
      setJobStatus("error");
      setStatusMessage("Upload failed. Please check your connection and try again.");
    };

    xhr.onabort = () => {
      clearTimeout(timeoutHandle);
      clearTimeout(noProgressTimer);
    };

    xhr.open("POST", `${API_BASE}/api/analyze`);
    xhr.send(formData);
  };

  const handleAllowNotifications = async () => {
    await Notification.requestPermission();
    startAnalysis();
  };

  const reset = () => {
    clearInterval(pollRef.current);
    if (xhrRef.current) { xhrRef.current.abort(); xhrRef.current = null; }
    setStep(1); setJobId(null); setJobStatus(null);
    setJudgeResults({});
    setSynthesis(null); setSynthesisStatus(null); setTrimAvailable(false); setOpenJudgeIds(new Set()); synthWaitRef.current = 0;
    setVideoFile(null); setDetectedFileDurationSecs(null); setStatusMessage("");
    setRestoredFileName(null);
    setVideoDurationSecs(null);
    setUploadProgress(0); setUploadProgressIndeterminate(false); setUploadedMB(0); setUploadSpeedMBps(0);
    setShowSlowConnWarning(false); setLargeFileWarning(null); setLargeSizeRiskWarning(false); setUploadZoneError(null);
    notifiedRef.current = false; savedRef.current = false;
    setObjective("");
  };

  // Issue #9: Restore from history
  const restoreFromHistory = (entry) => {
    setShowHistory(false);
    setPlatform(entry.platform);
    setObjective(entry.objective || "");
    setRestoredFileName(entry.fileName || null);
    setSelectedJudges(entry.selectedJudges || ["critic","cool","connector"]);
    setJudgeResults(entry.results || {});
    // Older entries predate synthesis → no synthesis means the fallback view.
    setSynthesis(entry.synthesis ?? null);
    setSynthesisStatus(entry.synthesisStatus ?? (entry.synthesis ? "ready" : "failed"));
    setOpenJudgeIds(new Set());
    if (entry.videoDuration) setVideoDurationSecs(entry.videoDuration);
    setTrimAvailable(false); // history restore has no in-memory file → no trim
    setJobStatus("done");
    setStatusMessage("Restored from history.");
    setStep(2);
  };

  // Live-session trim context for the Editor's clip cards. TrimClip self-hides
  // when videoFile is absent (e.g. restored history); available reflects the
  // server's 30-min retention window via /api/status.
  const trimCtx = { available: trimAvailable, videoFile, jobId, apiBase: API_BASE, durationSecs: videoDurationSecs };

  return (
    <div style={{ minHeight: "100vh", background: B.bg, fontFamily: "Montserrat, sans-serif", color: B.body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,400;0,600;0,700;0,800;1,400&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes pp-pulse { 0%,100%{opacity:.2;transform:scale(.75)} 50%{opacity:1;transform:scale(1.2)} }
        @keyframes pp-fade { from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pp-slide { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pp-indeterminate { 0%{transform:translateX(-250%)} 100%{transform:translateX(600%)} }
        @keyframes pp-spin { to { transform: rotate(360deg) } }
        .pp-btn:hover:not(:disabled) { background: ${B.actionHover} !important; transform: translateY(-1px); }
        .pp-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .drop-zone:hover { border-color: ${B.brown} !important; background: ${B.lightBrown} !important; }
        textarea:focus, input:focus { outline: none; border-color: ${B.brown} !important; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: ${B.beige}; border-radius: 99px; }
        .pp-sticky-wrap { margin-top: 4px; }
        @media (max-width: 480px) {
          .pp-main { padding: 0 14px 0 !important; }
          .pp-section-gap { margin-bottom: 6px !important; }
          .pp-judge-list { gap: 4px !important; }
          .pp-content-pad { padding-bottom: 100px; }
          .pp-sticky-wrap {
            position: fixed; bottom: 0; left: 0; right: 0;
            padding: 10px 14px max(20px, env(safe-area-inset-bottom));
            background: linear-gradient(to bottom, rgba(250,250,250,0) 0%, rgba(250,250,250,1) 38%);
            z-index: 50;
            margin-top: 0;
            pointer-events: none;
          }
          .pp-sticky-wrap > * { pointer-events: auto; }
        }
      `}</style>

      {/* Issue #4: Notification primer modal */}
      {showNotifPrimer && (
        <NotificationPrimer
          onAllow={handleAllowNotifications}
          onSkip={startAnalysis}
          timeEstimate={timeEstimate}
        />
      )}

      <main className="pp-main" style={{ maxWidth: "740px", margin: "0 auto", padding: "32px 20px 60px" }}>

        {/* ── INPUT SCREEN ── */}
        {step === 1 && (
          <div className="pp-content-pad" style={{ animation: "pp-slide 0.35s ease" }}>

            {/* Logo + BETA + History button */}
            <div style={{ textAlign: "center", paddingTop: "4px", paddingBottom: "4px", position: "relative" }}>
              <img src="/owl-logo.png?v=3" alt="PreviewPanel"
                style={{ height: "98px", width: "auto", display: "block", margin: "0 auto" }} />
              <div style={{ marginTop: "-12px", marginBottom: "8px" }}>
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
              <label className="drop-zone"
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileSelect(f); }}
                style={{
                  border: `2px dashed ${videoFile ? B.brown : B.border}`,
                  borderRadius: "12px", textAlign: "center",
                  cursor: "pointer", background: videoFile ? B.lightBrown : "#fff",
                  transition: "all 0.2s ease",
                  minHeight: "110px", display: "flex", alignItems: "center", justifyContent: "center",
                  position: "relative",
                }}>
                <input ref={fileInputRef} type="file" accept="video/*"
                  onChange={e => { const f = e.target.files[0]; if (f) handleFileSelect(f); }}
                  style={videoFile
                    ? { position: "absolute", opacity: 0, width: 0, height: 0 }
                    : { position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }
                  }/>
                {videoFile ? (
                  <div style={{ padding: "12px 20px" }}>
                    <div style={{ fontSize: "20px", marginBottom: "4px" }}>🎬</div>
                    <div style={{ fontWeight: "700", fontSize: "13px", color: B.brown }}>{videoFile.name}</div>
                    <div style={{ fontSize: "11px", color: "#aaa", marginTop: "3px" }}>
                      {(videoFile.size/1024/1024).toFixed(1)} MB ·{" "}
                      <span onClick={e => { e.preventDefault(); e.stopPropagation(); setVideoFile(null); setDetectedFileDurationSecs(null); setLargeFileWarning(null); setLargeSizeRiskWarning(false); setUploadZoneError(null); }}
                        style={{ color: B.brown, cursor: "pointer", textDecoration: "underline" }}>Remove</span>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: "12px 20px" }}>
                    <div style={{ fontSize: "26px", marginBottom: "4px" }}>⬆</div>
                    <div style={{ fontWeight: "700", fontSize: "13px", color: "#888" }}>Tap to upload · MP4, MOV, WebM</div>
                    <div style={{ fontSize: "11px", color: "#bbb", marginTop: "2px", lineHeight: "1.4" }}>Maximum 5 minutes · TwelveLabs watches your full video, analyzing delivery, energy, pacing, and hook strength.</div>
                  </div>
                )}
              </label>
              {uploadZoneError && (
                <div style={{ marginTop: "8px", padding: "10px 14px", background: "#FFEBEE", border: "1.5px solid #EF9A9A", borderRadius: "10px", fontSize: "12px", color: "#C62828", lineHeight: "1.5" }}>
                  ⛔ {uploadZoneError}
                </div>
              )}
              {largeSizeRiskWarning && (
                <div style={{ marginTop: "8px", padding: "10px 14px", background: "#FFF8E1", border: "1.5px solid #FFD54F", borderRadius: "10px", fontSize: "12px", color: "#E65100", lineHeight: "1.5" }}>
                  ⚠️ <strong>Large file detected ({largeFileWarning})</strong> — this file may be too large after processing. Consider trimming your video to under 90 seconds or compressing before uploading.
                </div>
              )}
              {!largeSizeRiskWarning && largeFileWarning && (
                <div style={{ marginTop: "8px", padding: "10px 14px", background: "#FFF8E1", border: "1.5px solid #FFD54F", borderRadius: "10px", fontSize: "12px", color: "#E65100", lineHeight: "1.5" }}>
                  ⚠️ <strong>Large file detected ({largeFileWarning})</strong> — upload may take several minutes on slower connections. Consider trimming or compressing your video first.
                </div>
              )}
            </div>

            {/* 2 — Platform pills */}
            <div className="pp-section-gap" style={{ marginBottom: "8px" }}>
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
                    <PlatformIcon id={p.id} size={20} />
                    {p.pillLabel}
                  </button>
                ))}
              </div>
            </div>

            {/* 3 — Objective */}
            <div className="pp-section-gap" style={{ marginBottom: "8px", position: "relative" }} ref={objDropRef}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: "#aaa", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "6px" }}>
                Objective <span style={{ fontWeight: "400", textTransform: "none", color: "#ccc" }}>(optional)</span>
              </div>
              {/* Trigger row */}
              <div
                onClick={() => {
                  const rect = objDropRef.current?.getBoundingClientRect();
                  setObjDropAbove(rect ? window.innerHeight - rect.bottom < 320 : false);
                  setObjDropOpen(o => !o);
                  setObjFilter("");
                }}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "0 13px", height: "48px",
                  background: "#fff", border: `1.5px solid ${objDropOpen ? B.brown : B.border}`,
                  borderRadius: "10px", cursor: "pointer", userSelect: "none",
                  boxSizing: "border-box",
                }}
              >
                <span style={{ flex: 1, fontSize: "14px", fontFamily: "Montserrat, sans-serif", color: objective ? B.body : "#bbb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {objective || "Select a content category (optional)"}
                </span>
                {objective ? (
                  <span
                    onClick={e => { e.stopPropagation(); setObjective(""); setObjDropOpen(false); }}
                    style={{ fontSize: "22px", fontWeight: "700", color: B.body, lineHeight: 1, cursor: "pointer", flexShrink: 0, touchAction: "manipulation", display: "flex", alignItems: "center", justifyContent: "center", width: "44px", height: "44px", marginRight: "-8px" }}
                  >×</span>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, transform: objDropOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.15s" }}>
                    <path d="M3 5.5L8 10.5L13 5.5" stroke={B.brown} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
              {/* Dropdown panel */}
              {objDropOpen && (
                <div style={{
                  position: "absolute", left: 0, right: 0, zIndex: 1000,
                  background: "#fff", border: `1.5px solid ${B.border}`,
                  borderRadius: "10px", boxShadow: "0 4px 24px rgba(0,0,0,0.13)",
                  overflow: "hidden",
                  ...(objDropAbove ? { bottom: "calc(100% + 4px)" } : { top: "calc(100% + 4px)" }),
                }}>
                  {/* Filter input — not autofocused; keyboard only appears when user taps here or the custom CTA */}
                  <div style={{ padding: "10px 13px", borderBottom: `1px solid ${B.border}` }}>
                    <input
                      ref={objInputRef}
                      value={objFilter}
                      onChange={e => setObjFilter(e.target.value)}
                      placeholder="Search or type custom..."
                      style={{ width: "100%", border: "none", outline: "none", fontSize: "16px", fontFamily: "Montserrat, sans-serif", color: B.body, background: "transparent", touchAction: "manipulation" }}
                    />
                  </div>
                  {/* Options */}
                  <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
                    {OBJECTIVE_OPTIONS.filter(opt => opt.toLowerCase().includes(objFilter.toLowerCase())).map((opt, i, arr) => (
                      <div
                        key={opt}
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { objInputRef.current?.blur(); setObjective(opt); setObjDropOpen(false); setObjFilter(""); }}
                        style={{
                          padding: "0 16px", minHeight: "44px", display: "flex", alignItems: "center",
                          fontSize: "14px", fontFamily: "Montserrat, sans-serif",
                          color: objective === opt ? B.brown : B.body,
                          fontWeight: objective === opt ? "700" : "400",
                          background: objective === opt ? B.lightBrown : "transparent",
                          cursor: "pointer",
                          borderBottom: i < arr.length - 1 ? `1px solid ${B.border}` : "none",
                        }}
                        onMouseEnter={e => { if (objective !== opt) e.currentTarget.style.background = "#FAF7F5"; }}
                        onMouseLeave={e => { if (objective !== opt) e.currentTarget.style.background = "transparent"; }}
                      >
                        {opt}
                      </div>
                    ))}
                    {/* "Use: xyz" — appears only when user has typed a value not in the list */}
                    {objFilter.trim() && !OBJECTIVE_OPTIONS.some(o => o.toLowerCase() === objFilter.trim().toLowerCase()) && (
                      <div
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => { objInputRef.current?.blur(); setObjective(objFilter.trim()); setObjDropOpen(false); setObjFilter(""); }}
                        style={{
                          padding: "0 16px", minHeight: "44px", display: "flex", alignItems: "center", gap: "6px",
                          fontSize: "14px", fontFamily: "Montserrat, sans-serif", color: B.brown, fontWeight: "600",
                          cursor: "pointer", borderTop: `1px solid ${B.border}`,
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = B.lightBrown}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        <span style={{ fontSize: "11px", color: "#aaa", fontWeight: "400" }}>Use:</span>
                        "{objFilter.trim()}"
                      </div>
                    )}
                    {/* "Type a custom objective" CTA — appears when not typing; focuses the search input to trigger keyboard */}
                    {!objFilter.trim() && (
                      <div
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => objInputRef.current?.focus()}
                        style={{
                          padding: "0 16px", minHeight: "44px", display: "flex", alignItems: "center", gap: "8px",
                          fontSize: "13px", fontFamily: "Montserrat, sans-serif", color: "#bbb", fontWeight: "400",
                          cursor: "pointer", borderTop: `1px solid ${B.border}`,
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = "#FAF7F5"}
                        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                      >
                        ✏️ Type a custom objective
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 4 — Judge selector */}
            <div className="pp-section-gap" style={{ marginBottom: "8px" }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: "#aaa", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "6px" }}>Your Panel</div>
              <div className="pp-judge-list" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                {JUDGES.map(j => {
                  const active = selectedJudges.includes(j.id);
                  return (
                    <div key={j.id} onClick={() => toggleJudge(j.id)} style={{
                      display: "flex", alignItems: "center", gap: "12px",
                      padding: "10px 14px", borderRadius: "10px",
                      border: `1.5px solid ${active ? j.color+"50" : B.border}`,
                      background: active ? j.softBg : "#fff",
                      cursor: "pointer", transition: "all 0.15s ease",
                    }}>
                      <div style={{ background: active ? j.softBg : "#F5F5F5", borderRadius: "6px", flexShrink: 0 }}>
                        <img src={j.avatar} alt={j.name}
                          style={{ width: "44px", height: "44px", objectFit: "contain", display: "block", background: active ? j.softBg : "#F5F5F5", transform: j.avatarScale ? `scale(${j.avatarScale})` : undefined }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: "800", fontSize: "14px", color: active ? j.color : "#bbb" }}>{j.name}</div>
                        <div style={{ fontSize: "12px", color: "#bbb", marginTop: "2px", lineHeight: "1.4" }}>{j.tagline}</div>
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
                disabled={!videoFile || selectedJudges.length === 0 || !!uploadZoneError}
                style={{ width: "100%", height: "56px", background: B.action, border: "none", borderRadius: "12px", color: "#fff", fontSize: "16px", fontWeight: "800", cursor: "pointer", fontFamily: "Montserrat, sans-serif", letterSpacing: "0.02em", transition: "all 0.18s ease", boxShadow: "0 2px 10px rgba(78,52,46,0.25)" }}>
                Convene the Panel · {selectedJudges.length} Judge{selectedJudges.length !== 1 ? "s" : ""}
              </button>
              {videoFile && (
                <div style={{ textAlign: "center", marginTop: "8px", fontSize: "11px", color: "#aaa" }}>
                  ⏱ Analysis usually takes {timeEstimate} for a file this size — we'll notify you when it's ready
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
          <div style={{ animation: "pp-slide 0.3s ease", paddingBottom: "max(40px, calc(env(safe-area-inset-bottom) + 24px))" }}>

            {/* Top bar */}
            <div style={{ textAlign: "center", paddingTop: "4px", paddingBottom: "4px", position: "relative" }}>
              <img src="/owl-logo.png?v=3" alt="PreviewPanel"
                style={{ height: "98px", width: "auto", display: "block", margin: "0 auto" }} />
              <div style={{ marginTop: "-12px", marginBottom: "12px" }}>
                <span style={{ fontSize: "10px", fontWeight: "700", background: "#4E342E", color: "#fff", padding: "3px 8px", borderRadius: "4px", letterSpacing: "0.06em" }}>BETA</span>
              </div>
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

            {/* Upload progress bar — shown while XHR is in flight (before jobId received) */}
            {isProcessing && !jobId && jobStatus === "uploading" && (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "#888", marginBottom: "6px" }}>
                  <span>Uploading… {uploadProgressIndeterminate ? "connecting…" : `${uploadedMB.toFixed(1)} of ${videoFile ? (videoFile.size/1024/1024).toFixed(1) : "?"} MB`}</span>
                  <span>{uploadSpeedMBps > 0 ? `${uploadSpeedMBps.toFixed(2)} MB/s` : ""}</span>
                </div>
                <div style={{ height: "6px", background: B.border, borderRadius: "99px", overflow: "hidden" }}>
                  {uploadProgressIndeterminate ? (
                    <div style={{ height: "100%", width: "30%", background: `linear-gradient(90deg, transparent, ${B.action}, transparent)`, borderRadius: "99px", animation: "pp-indeterminate 1.4s ease-in-out infinite" }}/>
                  ) : (
                    <div style={{ height: "100%", width: `${uploadProgress}%`, background: B.action, borderRadius: "99px", transition: "width 0.5s ease" }}/>
                  )}
                </div>
              </div>
            )}

            {/* Slow connection warning */}
            {showSlowConnWarning && !jobId && (
              <div style={{ marginBottom: "16px", padding: "12px 16px", background: "#FFF8E1", border: "1.5px solid #FFD54F", borderRadius: "12px", fontSize: "12px", color: "#E65100", lineHeight: "1.6" }}>
                🐢 <strong>Slow connection detected</strong> — upload may take longer than usual. You can leave this screen and we'll notify you when done.
              </div>
            )}

            {/* Issue #5 & #6: Prominent waiting banner */}
            {isProcessing && (
              <WaitingBanner
                elapsed={elapsed}
                judgeResults={judgeResults}
                selectedJudges={selectedJudges}
                jobStatus={jobStatus}
                uploadComplete={jobId !== null}
                timeEstimate={timeEstimate}
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

            {/* Timeout state — amber, with Try Again */}
            {jobStatus === "timeout" && (
              <div style={{
                background: "#FFF3E0", border: "1.5px solid #FFB74D", borderRadius: "14px",
                padding: "20px 24px", marginBottom: "18px",
              }}>
                <div style={{ fontWeight: "800", fontSize: "15px", color: "#E65100", marginBottom: "6px" }}>
                  ⏱ Panel timeout
                </div>
                <div style={{ fontSize: "13px", color: "#BF360C", lineHeight: "1.6" }}>
                  {statusMessage || "The panel took too long to reach a verdict — this can happen during busy periods. Your video has been submitted and you can try again for a fresh panel."}
                </div>
                <button onClick={reset} style={{
                  marginTop: "14px", background: "#E65100", color: "#fff", border: "none",
                  borderRadius: "8px", padding: "10px 20px", fontSize: "13px", fontWeight: "700",
                  cursor: "pointer", fontFamily: "Montserrat, sans-serif",
                }}>
                  Try Again
                </button>
              </div>
            )}

            {/* Platform + file tags (only when finished) */}
            {isFinished && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "18px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "5px", padding: "5px 13px", background: plat.color+"10", border: `1.5px solid ${plat.color}35`, borderRadius: "99px", fontSize: "12px", fontWeight: "700", lineHeight: "1.2", color: plat.color, flexShrink: 0 }}>
                  <PlatformIcon id={plat.id} size={15} />
                  {plat.label}
                </div>
                {objective && (
                  <div style={{ display: "flex", alignItems: "center", padding: "5px 13px", background: B.lightBrown, border: `1.5px solid ${B.beige}`, borderRadius: "99px", fontSize: "12px", fontWeight: "700", lineHeight: "1.2", color: B.action, flexShrink: 0 }}>
                    🎯 {objective}
                  </div>
                )}
                {(videoFile?.name || restoredFileName) && (
                  <div style={{ padding: "5px 13px", background: "#fff", border: `1.5px solid ${B.border}`, borderRadius: "99px", fontSize: "11px", color: "#888", fontFamily: "'Courier New', monospace" }}>
                    {videoFile?.name || restoredFileName}
                  </div>
                )}
                <span style={{ fontSize: "12px", color: "#888", fontStyle: "italic" }}>{statusMessage}</span>
              </div>
            )}

            {/* Synthesis still generating (judges done, fire-and-forget pending). */}
            {isFinished && synthesisStatus === "pending" && (
              <div style={{ background: "#fff", border: `1px solid ${B.border}`, borderRadius: "16px", padding: "30px 24px", marginBottom: "18px", textAlign: "center", boxShadow: "0 1px 2px rgba(60,40,20,.04)" }}>
                <div style={{ width: "30px", height: "30px", margin: "0 auto 14px", border: `3px solid ${B.border}`, borderTopColor: B.brown, borderRadius: "50%", animation: "pp-spin 0.9s linear infinite" }} />
                <div style={{ fontWeight: "800", fontSize: "15px", color: B.body }}>Assembling your panel results</div>
                <div style={{ fontSize: "12.5px", color: B.grey, marginTop: "5px", lineHeight: 1.5 }}>The judges are in — we're pulling their reads into one verdict. Just a moment…</div>
              </div>
            )}

            {/* Results — consolidated panel synthesis (Part B). Renders only once
                the job is finished; this overview replaces the old per-judge tiles
                + signal bars entirely. */}
            {isFinished && synthesisStatus === "ready" && synthesis && (
              <>
                <VerdictPanel synthesis={synthesis} results={judgeResults} onJumpToJudge={jumpToJudge} />
                <WhatsWorkingFixes synthesis={synthesis} duration={videoDurationSecs} />
                <DisagreementCard synthesis={synthesis} />
                <ScoreDisplay scoreDisplay={scoreDisplay} />
                <PerformanceRadar results={judgeResults} />
                <ToolkitSection results={judgeResults} trim={trimCtx} />
                <JudgeDeepDives results={judgeResults} duration={videoDurationSecs} openIds={openJudgeIds} onToggle={toggleJudgeCard} />
              </>
            )}

            {/* Graceful fallback — synthesis failed/unavailable: show what the judges
                still produced via the new components (no synthesis overview). */}
            {isFinished && synthesisStatus !== "ready" && synthesisStatus !== "pending" && (
              <>
                <PerformanceRadar results={judgeResults} />
                <ToolkitSection results={judgeResults} trim={trimCtx} />
                <JudgeDeepDives results={judgeResults} duration={videoDurationSecs} openIds={openJudgeIds} onToggle={toggleJudgeCard} />
              </>
            )}

            {/* TwelveLabs attribution — at the bottom (identical for live results + history). */}
            <div style={{ background: "#fff", border: `1px solid ${B.border}`, borderRadius: "8px", padding: "10px 16px", fontSize: "11px", color: "#aaa", display: "flex", alignItems: "center", gap: "8px", marginTop: "18px" }}>
              <span style={{ fontSize: "16px" }}>👁</span>
              <span>Powered by <strong style={{ color: B.body }}>TwelveLabs Pegasus</strong> — the AI watches your full video, analyzing visuals, delivery, audio, and pacing together.</span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
