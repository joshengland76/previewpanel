import { useState, useRef, useEffect } from "react";
import TikTokLogo from "./components/TikTokLogo";
import InstagramLogo from "./components/InstagramLogo";
import YouTubeLogo from "./components/YouTubeLogo";
import { B, JUDGES } from "./brand.js";
import { VerdictPanel } from "./components/VerdictHero.jsx";
import { WhatsWorkingFixes } from "./components/WhatsWorkingFixes.jsx";
import { DisagreementCard } from "./components/DisagreementCard.jsx";
import { PerformanceRadar } from "./components/PerformanceRadar.jsx";
import { ToolkitSection } from "./components/ToolkitSection.jsx";
import { JudgeDeepDives } from "./components/JudgeDeepDives.jsx";
import { AccountSettingsTrigger } from "./components/AccountSettings.jsx";
import { ObjectiveGuardModal } from "./components/ObjectiveGuardModal.jsx";

const PLATFORM_LOGOS = { youtube: YouTubeLogo, tiktok: TikTokLogo, instagram: InstagramLogo };
function PlatformIcon({ id, size }) {
  const Logo = PLATFORM_LOGOS[id];
  return Logo ? <Logo size={size} /> : null;
}

const API_BASE = import.meta.env.VITE_API_URL || "";

// PushManager.subscribe() wants the VAPID key as a Uint8Array, not the
// base64url string the server hands back.
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// Real Web Push subscribe, scoped to one job_id (see server.js's
// push_subscriptions table comment -- there's no user-identity system yet,
// so "notify me" is per-submission). Reuses an existing browser subscription
// if one's already active; only hits the network for a fresh VAPID key /
// subscribe call the first time. Silently no-ops on anything unsupported
// (no permission, no SW, no PushManager, no VAPID key configured server-side)
// -- this is a progressive enhancement, never a hard requirement to submit.
async function subscribeForPush(jobId) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const keyRes = await fetch(`${API_BASE}/api/vapid-public-key`);
      const { publicKey } = await keyRes.json();
      if (!publicKey) return;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }
    await fetch(`${API_BASE}/api/push-subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, subscription: sub.toJSON() }),
    });
  } catch (err) {
    console.log("[push] subscribe failed:", err.message);
  }
}

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

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch { return []; }
}

// Unlimited by count, but localStorage has a hard per-origin byte quota --
// with no cap, a long enough history (each entry carries a thumbnail data
// URL) can eventually overflow it. Rather than truncating up front or
// silently dropping the save on a quota error, drop the oldest entries one
// at a time and retry until it fits.
function saveToHistory(entry) {
  const history = loadHistory();
  history.unshift(entry);
  while (history.length) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      return;
    } catch {
      history.pop();
    }
  }
}

// ── Phase C, Task 1: identity-lite ────────────────────────────
// A persistent, client-generated UUID -- NOT a login/account system. Created
// once on first load, reused forever from localStorage, sent with every
// submission so a user's own history can be queried back out server-side.
// Clearing browser storage or switching devices/browsers starts a new
// identity -- there is no cross-device linking in this phase.
const USER_ID_KEY = "pp_user_id";

function getOrCreateUserId() {
  try {
    let id = localStorage.getItem(USER_ID_KEY);
    if (!id) {
      id = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : `pp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(USER_ID_KEY, id);
    }
    return id;
  } catch {
    return null; // localStorage unavailable (private browsing, etc.) -- submissions proceed unidentified
  }
}

// ── Sweep D: one-time TikTok connect nudge ───────────────────
// Shown after the first score card ever, only if TikTok isn't connected.
// Marked seen the first time it's eligible to render, so it never
// reappears on later results even if the user ignores/dismisses it.
const TIKTOK_NUDGE_SEEN_KEY = "pp_tiktok_nudge_seen_v1";

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

// ── Beta metering, Task 1: invite gate ─────────────────────────
// Full-screen overlay, same fixed/inset/centered-card pattern as
// NotificationPrimer above -- blocks interaction with the app underneath
// without needing to restructure the rest of this component's render tree.
// Enforced server-side too (checkBetaGate in server.js) -- this screen is
// the UX front door, not the actual gate.
function InviteGateScreen({ userId, onBound }) {
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  // Beta gate follow-up, Task 2 -- set only for a pre-linked code (the
  // server's needsConfirm response), which switches this screen from
  // code-entry to the "that's me?" confirm step. An ordinary code never
  // sets this -- submit() below calls onBound() directly on its first
  // response, byte-identical to the original metering-build single-step flow.
  const [confirmInfo, setConfirmInfo] = useState(null);

  const submit = async () => {
    const trimmed = code.trim();
    if (!trimmed) { setErrorMsg("Enter your invite code."); return; }
    setWorking(true); setErrorMsg("");
    try {
      const res = await fetch(`${API_BASE}/api/invite/redeem`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, code: trimmed }),
      });
      const body = await res.json();
      if (!res.ok || (!body.ok && !body.needsConfirm)) {
        setErrorMsg(body.error || "That code didn't work — double-check it and try again.");
        setWorking(false);
        return;
      }
      if (body.needsConfirm) {
        setConfirmInfo({
          tiktokHandle: body.tiktokHandle, instagramHandle: body.instagramHandle, youtubeHandle: body.youtubeHandle,
        });
        setWorking(false);
        return;
      }
      onBound();
    } catch {
      setErrorMsg("Couldn't reach the server — check your connection and try again.");
      setWorking(false);
    }
  };

  const decide = async (claimIdentity) => {
    setWorking(true); setErrorMsg("");
    try {
      const res = await fetch(`${API_BASE}/api/invite/redeem`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, code: code.trim(), claimIdentity }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setErrorMsg(body.error || "Something went wrong — try again.");
        setWorking(false);
        return;
      }
      onBound();
    } catch {
      setErrorMsg("Couldn't reach the server — check your connection and try again.");
      setWorking(false);
    }
  };

  const confirmHandle = confirmInfo && (confirmInfo.tiktokHandle || confirmInfo.instagramHandle || confirmInfo.youtubeHandle);

  return (
    <div style={{
      position: "fixed", inset: 0, background: B.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 200, padding: "20px",
    }}>
      <div style={{
        background: "#fff", borderRadius: "18px", padding: "32px 26px",
        maxWidth: "380px", width: "100%", textAlign: "center",
        boxShadow: "0 8px 40px rgba(0,0,0,0.12)", border: `1px solid ${B.border}`,
        animation: "pp-slide 0.25s ease",
      }}>
        <img src="/owl-logo.png?v=3" alt="PreviewPanel"
          style={{ height: "64px", width: "auto", margin: "0 auto 18px", display: "block" }} />
        {confirmInfo ? (
          <>
            <div style={{ fontWeight: "800", fontSize: "18px", color: B.black, marginBottom: "10px" }}>
              This invite is set up for @{confirmHandle}
            </div>
            <div style={{ fontSize: "13.5px", color: "#666", lineHeight: "1.6", marginBottom: "22px", textAlign: "left" }}>
              That's you? We'll connect the account automatically and pull in
              any track record we already have for it — no need to connect it
              yourself later.
            </div>
            {errorMsg && (
              <div style={{ fontSize: "12.5px", color: "#C0392B", marginBottom: "12px" }}>{errorMsg}</div>
            )}
            <button onClick={() => decide(true)} disabled={working} style={{
              width: "100%", height: "50px", background: B.action, border: "none",
              borderRadius: "10px", color: "#fff", fontSize: "15px", fontWeight: "800",
              cursor: working ? "default" : "pointer", fontFamily: "Montserrat, sans-serif",
              opacity: working ? 0.7 : 1, marginBottom: "10px",
            }}>
              {working ? "One sec…" : "That's me"}
            </button>
            <button onClick={() => decide(false)} disabled={working} style={{
              width: "100%", height: "50px", background: "#fff", border: `1.5px solid ${B.border}`,
              borderRadius: "10px", color: B.brown, fontSize: "15px", fontWeight: "800",
              cursor: working ? "default" : "pointer", fontFamily: "Montserrat, sans-serif",
              opacity: working ? 0.7 : 1,
            }}>
              Not me
            </button>
          </>
        ) : (
          <>
            <div style={{ fontWeight: "800", fontSize: "18px", color: B.black, marginBottom: "10px" }}>
              You're invited to the private beta
            </div>
            <div style={{ fontSize: "13.5px", color: "#666", lineHeight: "1.6", marginBottom: "22px", textAlign: "left" }}>
              PreviewPanel is free while we're testing it — your invite code gets
              you in. It'll be a paid product at launch; testers get founding
              terms for helping us get there.
            </div>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              placeholder="Invite code"
              disabled={working}
              style={{
                width: "100%", height: "48px", borderRadius: "10px",
                border: `1.5px solid ${B.border}`, padding: "0 14px",
                fontSize: "16px", fontFamily: "inherit", marginBottom: "12px",
                textAlign: "center", color: B.black,
              }}
            />
            {errorMsg && (
              <div style={{ fontSize: "12.5px", color: "#C0392B", marginBottom: "12px" }}>{errorMsg}</div>
            )}
            <button onClick={submit} disabled={working} style={{
              width: "100%", height: "50px", background: B.action, border: "none",
              borderRadius: "10px", color: "#fff", fontSize: "15px", fontWeight: "800",
              cursor: working ? "default" : "pointer", fontFamily: "Montserrat, sans-serif",
              opacity: working ? 0.7 : 1,
            }}>
              {working ? "Checking…" : "Enter beta"}
            </button>
          </>
        )}
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
  } else if (doneCount === totalCount && totalCount > 0) {
    // All judges done but still isProcessing means synthesis/scoreDisplay
    // are still being assembled (see the merged-wait fix in the poll
    // effect) -- match Josh's requested copy for this phase rather than
    // repeating the "judges have reached their verdict" message, which
    // otherwise sits there unchanged for up to the combined ~132s wait.
    statusText = "Assembling your panel results…";
  } else {
    statusText = `${doneCount} of ${totalCount} judges have reached their verdict`;
  }

  return (
    <div style={{
      background: B.lightBrown, border: `1.5px solid ${B.brown}30`, borderRadius: "14px",
      padding: "20px 24px", marginTop: "18px", marginBottom: "18px",
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
  const [userId] = useState(getOrCreateUserId); // Phase C, Task 1 -- generated once, stable for component lifetime
  const [showAccountSettings, setShowAccountSettings] = useState(false);
  const [tiktokConnected, setTiktokConnected] = useState(null); // Sweep D -- null = not yet checked
  // Beta metering, Task 1 -- null = not yet checked (blocks render behind a
  // blank cover so an unbound user never sees a flash of the real UI before
  // the gate screen appears). {bound:false} or {bound:true, code, used,
  // allowance} once resolved.
  const [inviteStatus, setInviteStatus] = useState(null);
  const [tiktokNudgeDismissed, setTiktokNudgeDismissed] = useState(false);
  const [platform, setPlatform] = useState("youtube");
  const [videoFile, setVideoFile] = useState(null);
  const [detectedFileDurationSecs, setDetectedFileDurationSecs] = useState(null);
  // Chips v2, Task 3c -- optional caption for file uploads (the only
  // submission path with no real caption source at all). Never required,
  // never nagged; only shown once a file is picked so the initial screen is
  // unchanged. Passed to C_dims when present so caption-dependent chips
  // (educational/promotional tone, save/follow/buy/link CTA, question hook)
  // can fire the same way they would if this had been a real posted caption.
  const [plannedCaption, setPlannedCaption] = useState("");
  const [objective, setObjective] = useState("");
  const [restoredFileName, setRestoredFileName] = useState(null);
  // Readout-screen polish, point 1 -- link-fetch runs only; null for a file
  // upload. linkDisplayUrl/linkSourceUrl populate during a live run (from
  // /api/status polling); restoredSourceUrl is the equivalent for a
  // restored History entry (restoredFileName already holds the cleaned URL
  // string in that case -- see restoreFromHistory).
  const [linkDisplayUrl, setLinkDisplayUrl] = useState(null);
  const [linkSourceUrl, setLinkSourceUrl] = useState(null);
  const [restoredSourceUrl, setRestoredSourceUrl] = useState(null);
  const [objDropOpen, setObjDropOpen] = useState(false);
  const [objFilter, setObjFilter] = useState("");
  const [objDropAbove, setObjDropAbove] = useState(false);
  // Objective guard -- second-chance selector shown when Convene/link-fetch
  // is tapped with no objective set (see handleSubmit).
  const [showObjectiveGuard, setShowObjectiveGuard] = useState(false);
  const [selectedJudges, setSelectedJudges] = useState(["critic","cool","connector"]);
  const [step, setStep] = useState(1);
  const [jobId, setJobId] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);
  const [judgeResults, setJudgeResults] = useState({});
  const [synthesis, setSynthesis] = useState(null);
  const [synthesisStatus, setSynthesisStatus] = useState(null);
  const [scoreDisplay, setScoreDisplay] = useState(null); // populated when the server's DISPLAY_SCORE flag is on
  const [contentReadAxes, setContentReadAxes] = useState(null); // Curiosity/Inspiration -- Spider v3: no longer radar axes, now backs DetectedSignals chips only (rendered on-card by PerformanceRadar as of Spider v3.1)
  const [trendAxes, setTrendAxes] = useState(null); // Spider v3 -- Trend Alignment/Trending Topic, the panel-only radar axes that replaced Curiosity/Inspiration
  const [signalFields, setSignalFields] = useState(null); // Spider v3.1 -- backs the full "Detected signals" positive/negative chip row
  const [groupMeanBigPicture, setGroupMeanBigPicture] = useState(null); // group-mean (or own) values for the spider chart's other 6 judge-scored axes
  const [groupMeanTrendAxes, setGroupMeanTrendAxes] = useState(null); // same group-mean treatment for the radar's remaining 2 axes (Trend Alignment, Trending Topic)
  const [axisDeciles, setAxisDeciles] = useState(null); // radar rolling-decile normalization -- deciles 1-10 (or null) per axis, vs the rolling 1,000-row windows
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
  // Paste-a-link submissions (radar/links prompt, Part B) -- lives inside
  // the same upload box as a secondary affordance, not a new field elsewhere
  // on the screen. showLinkInput swaps the box from file-picker mode to a
  // plain URL input + Go (no <label>/hidden-file-input association while in
  // this mode, so typing/clicking the input never opens the file picker).
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [videoLinkUrl, setVideoLinkUrl] = useState("");
  const [linkFetchError, setLinkFetchError] = useState(null);

  // Auto-focus the link input the moment the box switches into paste mode --
  // without this, the field starts unfocused, so the user's first tap only
  // focuses it (no selection yet) and a SECOND tap is what actually engages
  // the caret and surfaces the OS's native paste suggestion. Focusing here
  // means that first tap lands on an already-focused field, so it's the tap
  // that shows the paste bubble instead of a "just give it focus" throwaway
  // tap. inputMode="none" on the field keeps the keyboard from appearing
  // even though it's now focused programmatically.
  useEffect(() => {
    if (showLinkInput) linkInputRef.current?.focus();
  }, [showLinkInput]);
  const pollRef = useRef(null);
  const synthWaitRef = useRef(0);
  // Pre-launch fix, Task 2 -- chains a second capped wait onto the same
  // "assembling" screen for scoreDisplay, right after the synthesis wait
  // (mirrors synthWaitRef's pattern). Keeps the reveal to a single, final
  // view instead of showing bare judges scores and upgrading in place.
  const scoreWaitRef = useRef(0);
  const objDropRef = useRef(null);
  const objInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const linkInputRef = useRef(null);
  const xhrRef = useRef(null);
  const savedRef = useRef(false);
  const plat = PLATFORMS.find(p => p.id === platform);
  const isFinished = jobStatus === "done" || jobStatus === "partial";
  const isProcessing = !isFinished && jobStatus !== "error" && jobStatus !== "timeout" && jobStatus !== null;

  // Sweep D -- one-time TikTok connect nudge, first score card only.
  const scoreCardShowing = isFinished && synthesisStatus === "ready" && !!synthesis;
  let tiktokNudgeAlreadySeen = false;
  try { tiktokNudgeAlreadySeen = !!localStorage.getItem(TIKTOK_NUDGE_SEEN_KEY); } catch {}
  const showTiktokNudge = scoreCardShowing && tiktokConnected === false && !tiktokNudgeDismissed && !tiktokNudgeAlreadySeen;

  useEffect(() => {
    if (!showTiktokNudge) return;
    try { localStorage.setItem(TIKTOK_NUDGE_SEEN_KEY, "1"); } catch {}
  }, [showTiktokNudge]);

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

  // Sweep D -- check connect status so the post-score-card nudge knows
  // whether to offer connecting TikTok.
  const refreshTiktokConnected = async () => {
    if (!userId) { setTiktokConnected(false); return; }
    try {
      const res = await fetch(`${API_BASE}/api/user/${encodeURIComponent(userId)}`);
      setTiktokConnected(res.ok ? !!(await res.json()).tiktok_handle : false);
    } catch {
      setTiktokConnected(false);
    }
  };
  useEffect(() => { refreshTiktokConnected(); }, [userId]);

  // Beta metering, Task 1 -- one round-trip on load resolves both whether
  // to show the gate screen (bound) and the allowance counter (used/
  // allowance). Re-run after a successful redemption (InviteGateScreen's
  // onBound) to pick up the fresh binding immediately.
  const refreshInviteStatus = async () => {
    if (!userId) { setInviteStatus({ bound: false }); return; }
    try {
      const res = await fetch(`${API_BASE}/api/invite/status?userId=${encodeURIComponent(userId)}`);
      setInviteStatus(res.ok ? await res.json() : { bound: false });
    } catch {
      setInviteStatus({ bound: false });
    }
  };
  useEffect(() => { refreshInviteStatus(); }, [userId]);

  // Re-check after the connect modal closes -- catches a handle the user
  // just added, so an already-shown nudge won't outlive a real connection.
  const handleAccountSettingsOpenChange = (v) => {
    setShowAccountSettings(v);
    if (!v) refreshTiktokConnected();
  };

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
  useEffect(() => {
    if (!jobId) return;
    subscribeForPush(jobId);
    synthWaitRef.current = 0;
    scoreWaitRef.current = 0;
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
        setJudgeResults(data.results || {});
        if (data.duration) setVideoDurationSecs(data.duration);
        setSynthesis(data.synthesis ?? null);
        setSynthesisStatus(data.synthesisStatus ?? null);
        setScoreDisplay(data.scoreDisplay ?? null);
        setContentReadAxes(data.contentReadAxes ?? null);
        setTrendAxes(data.trendAxes ?? null);
        setSignalFields(data.signalFields ?? null);
        setGroupMeanBigPicture(data.groupMeanBigPicture ?? null);
        setGroupMeanTrendAxes(data.groupMeanTrendAxes ?? null);
        setAxisDeciles(data.axisDeciles ?? null);
        setLinkDisplayUrl(data.linkDisplayUrl ?? null);
        setLinkSourceUrl(data.sourceUrl ?? null);
        setTrimAvailable(!!data.trimAvailable);

        const jobDone = data.status === "done" || data.status === "partial";
        const jobErrored = data.status === "error" || data.status === "timeout";
        // App submissions get a fire-and-forget synthesis that lands shortly AFTER
        // the judges finish. Keep polling while it's still "pending" (capped ~180s)
        // so the "assembling" state can swap to the real overview when it arrives.
        // null status on a just-finished job = the brief gap before the backend
        // marks synthesis "pending"; treat it as pending so we don't flash the
        // fallback. Either way it's bounded by the wait cap.
        // Cap history: 14 polls (42s) -> 30 polls (90s) -> 60 polls (180s).
        // The SAME large 131.6MB/73s test file has now synthesized in 51s and
        // 68.5s on two separate real runs (typical jobs land at 20-26s) -- both
        // genuine Claude latency on a bigger synthesis input, confirmed via
        // exactly one pp_synthesis row each time, never a double-fire. 90s
        // margin (1.3x over the 68.5s case) was still uncomfortably tight;
        // 180s matches the "1-2 minutes" analysis-time framing shown elsewhere
        // in this screen, so a slow-but-successful synthesis reads as "still
        // working" rather than degrading to the fallback moments too early.
        const synthPending = data.synthesisStatus === "pending" || data.synthesisStatus == null;
        if (jobDone && synthPending) synthWaitRef.current++;
        const waitingForSynth = jobDone && synthPending && synthWaitRef.current < 60;

        // Judges + synthesis phase fully resolved (arrived, or gave up waiting).
        const synthResolved = jobDone && !waitingForSynth;

        // Pre-launch fix, Task 2 -- scoreDisplay comes from a separately-timed
        // shadow-scoring pipeline that can finish after judges+synthesis (the
        // shadow-vs-synthesis race -- see LAUNCH_READINESS_READOUT.md). First
        // version of this fix revealed results immediately and upgraded the
        // score in place once scoreDisplay landed -- correct on the backend,
        // but confusing in the browser (a visible flip from judges score to
        // percentile after the page already looked "done"). Chaining this
        // wait onto the same "assembling" screen instead means the user only
        // ever sees ONE view: the complete one, or (if scoreDisplay never
        // shows up within its own cap) the honest bare-score degrade -- never
        // a value that changes out from under them.
        const scorePending = data.scoreDisplay == null;
        if (synthResolved && scorePending) scoreWaitRef.current++;
        const waitingForScore = synthResolved && scorePending && scoreWaitRef.current < 30;

        if (waitingForSynth || waitingForScore) setStatusMessage("Assembling your panel results…");

        // BUG FIX (found via Josh's real-world repro after the first merged-wait
        // deploy still showed the flip): isFinished/isProcessing -- which gate
        // EVERY results-vs-processing render decision in the JSX below -- are
        // derived from the jobStatus REACT STATE, not from mainResultsReady.
        // The old unconditional `setJobStatus(data.status)` here updated that
        // state (and hence flipped isFinished true, revealing the bare-score
        // view) the instant the backend said "done", regardless of whether
        // scoreDisplay had arrived -- completely bypassing the wait logic above,
        // which only ever controlled the status *message* and the poll
        // interval, never the actual render gate. Withhold the terminal
        // done/partial value from jobStatus until mainResultsReady so the
        // processing view (and "Assembling…" message) stays up for the WHOLE
        // combined wait; non-terminal statuses still update immediately so the
        // judge-by-judge progress UI keeps working during that wait.
        if (!jobDone || (!waitingForSynth && !waitingForScore)) {
          setJobStatus(data.status);
        }

        const mainResultsReady = jobDone && !waitingForSynth && !waitingForScore;

        if (mainResultsReady || jobErrored) {
          clearInterval(pollRef.current);
        }

        if (mainResultsReady) {
          // Synthesis never resolved within the cap → degrade to the fallback view.
          if (synthPending) setSynthesisStatus("failed");
          const succeeded = Object.values(data.results||{}).filter(r=>r.status==="done").length;
          const total = Object.keys(data.results||{}).length;
          setStatusMessage(data.status === "done" ? "Analysis complete!" : `${succeeded} of ${total} judges completed.`);

          // Issue #9: Auto-save to history. mainResultsReady only fires once
          // scoreDisplay has arrived or its own wait has been exhausted, so
          // whatever's in data.scoreDisplay here is final for this session.
          if (!savedRef.current) {
            savedRef.current = true;
            const scores = Object.entries(data.results || {})
              .filter(([,v]) => v.status === "done")
              .map(([id, v]) => ({ id, score: v.data?.overall }));
            const entry = {
              jobId,
              platform,
              objective,
              // Readout-screen polish, point 1 -- link runs show the cleaned
              // URL in place of the internal downloaded-file name; sourceUrl
              // preserved separately so a restored entry can still link out.
              // Read straight off `data`, not the linkDisplayUrl/linkSourceUrl
              // state: this poll() closure was created once when the effect
              // started (before any tick had set that state), so the state
              // variables here are permanently stale -- `data` is this tick's
              // fresh response and is what actually reflects the link.
              fileName: data.linkDisplayUrl || videoFile?.name || "video",
              sourceUrl: data.sourceUrl || null,
              savedAt: Date.now(),
              scores,
              results: data.results,
              synthesis: data.synthesis ?? null,
              synthesisStatus: synthPending ? "failed" : data.synthesisStatus,
              scoreDisplay: data.scoreDisplay ?? null,
              videoDuration: data.duration,
              selectedJudges,
              thumbnailDataUrl: data.thumbnailDataUrl || null,
            };
            saveToHistory(entry);
            setHistory(loadHistory());
          }
        } else if (jobErrored) {
          if (data.status === "timeout") {
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

  // The actual submission action, split out from handleSubmit's validation so
  // the objective guard modal can invoke it directly once a category is
  // chosen (or explicitly skipped) -- passing objectiveOverride rather than
  // relying on the `objective` state landing before this runs, since a modal
  // button click that both sets state and submits in the same tick would
  // otherwise read the stale (pre-update) value.
  const proceedSubmit = (objectiveOverride) => {
    // Readout polish round 2 -- one shared CTA for both submission modes now
    // (the link box's own "Go" button was removed). Link mode has no upload
    // byte-progress to show, so it skips the notification-primer detour
    // file uploads use and goes straight to handleLinkFetch, same as before.
    if (showLinkInput && !videoFile) {
      handleLinkFetch(objectiveOverride);
      return;
    }

    // Issue #4: Show notification primer before starting
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      setShowNotifPrimer(true);
      return;
    }
    startAnalysis(objectiveOverride);
  };

  const handleSubmit = () => {
    if (showLinkInput && !videoFile) {
      if (!videoLinkUrl.trim() || selectedJudges.length === 0) return;
    } else {
      if (!videoFile || selectedJudges.length === 0) return;
    }

    // Objective guard -- moment-of-action check, fires every time the
    // objective field is empty (custom-typed values are non-empty and skip
    // this). Canonical objective already set → unchanged flow, no modal.
    if (!objective.trim()) {
      setShowObjectiveGuard(true);
      return;
    }
    proceedSubmit();
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
  const startAnalysis = (objectiveOverride) => {
    if (uploadZoneError) return;
    doStartAnalysis(objectiveOverride);
  };

  const doStartAnalysis = (objectiveOverride) => {
    // typeof guard, not just ??  -- a caller bound directly to onClick (e.g.
    // NotificationPrimer's onSkip) would otherwise leak the DOM event object
    // in as objectiveOverride and get FormData-stringified to "[object Object]".
    const activeObjective = typeof objectiveOverride === "string" ? objectiveOverride : objective;
    setShowNotifPrimer(false);
    savedRef.current = false;
    setStep(2);
    setJudgeResults({});
    setSynthesis(null); setSynthesisStatus(null); setTrimAvailable(false); setOpenJudgeIds(new Set());
    setScoreDisplay(null); synthWaitRef.current = 0; scoreWaitRef.current = 0;
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
    formData.append("objective", activeObjective);
    formData.append("judges", JSON.stringify(selectedJudges));
    if (userId) formData.append("userId", userId); // Phase C, Task 1
    if (plannedCaption.trim()) formData.append("caption", plannedCaption.trim()); // Chips v2, Task 3c
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
        refreshInviteStatus(); // server already recorded the beta submission event -- reflect the new count
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

  // Paste-a-link submissions (radar/links prompt, Part B) -- server does the
  // "uploading" (yt-dlp fetch) instead of the browser, so there's no byte
  // progress to show; reuses the SAME indeterminate-progress visual the file
  // path already falls back to when no progress event fires in time. Once
  // /api/fetch-video returns a jobId, this is 100% the same downstream flow
  // as a file upload (same useEffect([jobId]) polling loop, same rendering).
  const handleLinkFetch = async (objectiveOverride) => {
    const url = videoLinkUrl.trim();
    if (!url) return;
    const activeObjective = typeof objectiveOverride === "string" ? objectiveOverride : objective;
    setLinkFetchError(null);
    setShowNotifPrimer(false);
    savedRef.current = false;
    setStep(2);
    setJudgeResults({});
    setSynthesis(null); setSynthesisStatus(null); setTrimAvailable(false); setOpenJudgeIds(new Set());
    setScoreDisplay(null); synthWaitRef.current = 0; scoreWaitRef.current = 0;
    setRestoredFileName(null);
    setJobStatus("uploading");
    setUploadProgress(0);
    setUploadProgressIndeterminate(true);
    setUploadedMB(0);
    setUploadSpeedMBps(0);
    setStatusMessage("Fetching your video…");
    const pending = {};
    selectedJudges.forEach(id => { pending[id] = { status: "pending" }; });
    setJudgeResults(pending);

    try {
      const res = await fetch(`${API_BASE}/api/fetch-video`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, objective: activeObjective, judges: JSON.stringify(selectedJudges), userId: userId || null }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Couldn't fetch that link — download the file and upload it instead.");
      setUploadProgress(100);
      setUploadProgressIndeterminate(false);
      setJobStatus("uploading");
      setJobId(data.jobId);
      refreshInviteStatus(); // server already recorded the beta submission event -- reflect the new count
    } catch (err) {
      setStep(1);
      setJobStatus(null);
      setLinkFetchError(err.message);
    }
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
    setScoreDisplay(null); scoreWaitRef.current = 0;
    setVideoFile(null); setDetectedFileDurationSecs(null); setStatusMessage("");
    setPlannedCaption("");
    setRestoredFileName(null);
    setVideoDurationSecs(null);
    setUploadProgress(0); setUploadProgressIndeterminate(false); setUploadedMB(0); setUploadSpeedMBps(0);
    setShowSlowConnWarning(false); setLargeFileWarning(null); setLargeSizeRiskWarning(false); setUploadZoneError(null);
    savedRef.current = false;
    setObjective("");
    // Readout-screen polish, point 2 -- the upload box must never return in
    // "paste a link" mode; every path back to the submit screen goes through
    // this one reset(), so clearing it here covers all of them.
    setShowLinkInput(false); setVideoLinkUrl(""); setLinkFetchError(null);
    // Readout-screen polish, point 1 -- clear link display metadata too, so
    // a stale URL from the previous run can never bleed into the next one.
    setLinkDisplayUrl(null); setLinkSourceUrl(null); setRestoredSourceUrl(null);
  };

  // Issue #9: Restore from history
  const restoreFromHistory = (entry) => {
    setShowHistory(false);
    // Readout-screen polish, point 2 -- defensive, same as reset() above:
    // the upload box (not visible at step 2, but state persists across the
    // SPA's step transitions) must never carry link-mode into whatever
    // submit-screen view comes next.
    setShowLinkInput(false); setVideoLinkUrl(""); setLinkFetchError(null);
    setPlatform(entry.platform);
    setObjective(entry.objective || "");
    setRestoredFileName(entry.fileName || null);
    // Readout-screen polish, point 1 -- entry.fileName already holds the
    // cleaned display URL for a link run (see saveToHistory); this is the
    // raw original, for the "tap to open" link on the restored view.
    setRestoredSourceUrl(entry.sourceUrl || null);
    setLinkDisplayUrl(null); setLinkSourceUrl(null); // this is a restored view, not a live link-fetch run
    setSelectedJudges(entry.selectedJudges || ["critic","cool","connector"]);
    setJudgeResults(entry.results || {});
    // Older entries predate synthesis → no synthesis means the fallback view.
    setSynthesis(entry.synthesis ?? null);
    setSynthesisStatus(entry.synthesisStatus ?? (entry.synthesis ? "ready" : "failed"));
    // Pre-launch fix, Task 2 -- entries predating this fix (or ones saved
    // before scoreDisplay's late-arrival patch caught up) have no
    // scoreDisplay field at all; ?? null degrades to the same bare
    // judge-score view as before, not a crash.
    setScoreDisplay(entry.scoreDisplay ?? null);
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
    <div className="pp-root" style={{ background: B.bg, fontFamily: "Montserrat, sans-serif", color: B.body }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,400;0,600;0,700;0,800;1,400&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        /* iOS Safari resizes the visual viewport (address bar show/hide) as
           scrolling starts/stops; 100vh is fixed to the largest state, so a
           100vh-tall root combined with the fixed-position CTA footer below
           visibly wobbles as the toolbar collapses/expands. 100dvh tracks the
           real visible viewport instead -- second declaration wins in
           browsers that support it, first is the fallback everywhere else. */
        .pp-root { min-height: 100vh; min-height: 100dvh; }
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
          .pp-section-gap.pp-judge-section-gap { margin-bottom: 16px !important; }
          .pp-judge-list { gap: 4px !important; }
          /* Must clear .pp-sticky-wrap's own real height (10px top pad + 56px
             button + its bottom pad, which grows with the home-indicator
             safe-area inset below) or the fixed footer overlaps the last
             scrollable item on any notched phone -- a flat 100px only ever
             matched the zero-safe-area case exactly, with no headroom, which
             is why the Connector row started clipping under the button the
             moment anything upstream pushed content down (the caption field).
             Root-caused and fixed here instead of just freeing space above. */
          .pp-content-pad { padding-bottom: calc(82px + max(34px, 14px + env(safe-area-inset-bottom))); }
          .pp-sticky-wrap {
            position: fixed; bottom: 0; left: 0; right: 0;
            padding: 10px 14px max(34px, calc(14px + env(safe-area-inset-bottom)));
            background: linear-gradient(to bottom, rgba(250,250,250,0) 0%, rgba(250,250,250,1) 38%);
            z-index: 50;
            margin-top: 0;
            pointer-events: none;
          }
          .pp-sticky-wrap > * { pointer-events: auto; }
        }
      `}</style>

      {/* Beta metering, Task 1 -- invite gate. A blank cover while the
          status check is in flight (inviteStatus === null) prevents a
          flash of the real UI before an unbound user sees the gate;
          resolves to either nothing (bound) or the gate screen. */}
      {inviteStatus === null && (
        <div style={{ position: "fixed", inset: 0, background: B.bg, zIndex: 200 }} />
      )}
      {inviteStatus && !inviteStatus.bound && (
        <InviteGateScreen userId={userId} onBound={() => { refreshInviteStatus(); refreshTiktokConnected(); }} />
      )}

      {/* Issue #4: Notification primer modal */}
      {showNotifPrimer && (
        <NotificationPrimer
          onAllow={handleAllowNotifications}
          onSkip={() => startAnalysis()}
          timeEstimate={timeEstimate}
        />
      )}

      {/* Objective guard -- second-chance category selector, see handleSubmit */}
      <ObjectiveGuardModal
        open={showObjectiveGuard}
        options={OBJECTIVE_OPTIONS}
        onScore={(picked) => {
          setObjective(picked);
          setShowObjectiveGuard(false);
          proceedSubmit(picked);
        }}
        onContinueWithoutScore={() => {
          setShowObjectiveGuard(false);
          proceedSubmit();
        }}
        onClose={() => setShowObjectiveGuard(false)}
      />

      <main className="pp-main" style={{ maxWidth: "740px", margin: "0 auto", padding: "32px 20px 60px" }}>

        {/* ── INPUT SCREEN ── */}
        {step === 1 && (
          <div className="pp-content-pad" style={{ animation: "pp-slide 0.35s ease" }}>

            {/* Logo + History button */}
            <div style={{ textAlign: "center", paddingTop: "4px", paddingBottom: "0", position: "relative" }}>
              {/* owl-logo.png has ~20px of transparent padding baked in below the
                  wordmark at this render height (measured: 19.8% of the source
                  image's height) -- negative margin pulls real content up into
                  that dead space instead of stacking more space on top of it. */}
              <img src="/owl-logo.png?v=3" alt="PreviewPanel"
                style={{ height: "98px", width: "auto", display: "block", margin: "0 auto -18px" }} />
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
              {/* Phase C, Task 1: Connect-accounts trigger */}
              <div style={{ position: "absolute", top: "10px", left: "0" }}>
                <AccountSettingsTrigger userId={userId} open={showAccountSettings} onOpenChange={handleAccountSettingsOpenChange} />
              </div>
            </div>
            {inviteStatus?.bound && inviteStatus.allowance != null && (
              <div style={{ textAlign: "center", fontSize: "11px", color: B.grey, marginTop: "9px" }}>
                Beta allowance: {Math.max(0, inviteStatus.allowance - inviteStatus.used)} of {inviteStatus.allowance} left this month
              </div>
            )}

            {/* History panel */}
            {showHistory && (
              <div style={{
                border: `1.5px solid ${B.border}`, borderRadius: "14px",
                background: "#fff", marginTop: "9px", marginBottom: "16px",
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

            {/* Order form (upload through CTA) — hidden while History is open,
                so it doesn't sit stacked below the history list. */}
            {!showHistory && <>
            {/* 1 — Video upload */}
            <div className="pp-section-gap" style={{ marginBottom: "10px" }}>
              <div style={{ fontSize: "12px", fontWeight: "700", color: "#aaa", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "6px" }}>Your Video</div>
              {(!videoFile && showLinkInput) ? (
                // Paste-a-link mode -- a plain div, deliberately NOT the
                // <label>/hidden-file-input pairing below, so typing or
                // clicking the URL input can never accidentally pop the file
                // picker. Readout polish round 2 -- dropped the inline "Go"
                // button; "Convene the Panel" (the one shared CTA below) now
                // submits either mode, so there's no second submit action to
                // keep in sync. fontSize bumped 12->16px: anything under 16px
                // makes iOS Safari auto-zoom the whole page on focus, which
                // was hiding the rest of the screen the moment you tapped in.
                <div style={{
                  border: `2px dashed ${B.border}`, borderRadius: "12px", textAlign: "center",
                  background: "#fff", minHeight: "110px", display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", padding: "14px 16px",
                }}>
                  <div style={{ fontWeight: "700", fontSize: "13px", color: "#888", marginBottom: "8px" }}>Paste a TikTok link</div>
                  {/* inputMode="none" suppresses the on-screen keyboard on tap
                      (there's nothing to type here, only paste). A first tap
                      alone only places a cursor -- iOS/Android only summon the
                      paste bubble once there's an active SELECTION, which
                      normally takes a second tap on the caret. Calling
                      select() the moment the field gains focus forces that
                      selection state immediately, so the paste suggestion
                      shows on the very first tap instead of the second. */}
                  <input ref={linkInputRef} type="url" inputMode="none" placeholder="https://…" value={videoLinkUrl}
                    onChange={e => setVideoLinkUrl(e.target.value)}
                    onFocus={e => e.target.select()}
                    onKeyDown={e => { if (e.key === "Enter") handleSubmit(); }}
                    style={{ width: "100%", maxWidth: "320px", padding: "8px 10px", borderRadius: "8px", border: `1.5px solid ${B.border}`, fontSize: "16px", fontFamily: "inherit" }} />
                  <span onClick={() => { setShowLinkInput(false); setVideoLinkUrl(""); setLinkFetchError(null); }}
                    style={{ marginTop: "10px", fontSize: "11px", color: "#aaa", textDecoration: "underline", cursor: "pointer" }}>
                    ← Upload a file instead
                  </span>
                </div>
              ) : (
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
                      // Stops 44px short of the bottom -- exactly the "or paste a
                      // video link" row's own enlarged tap height below -- so
                      // that row has zero spatial overlap with this file input.
                      // Belt-and-suspenders alongside the z-index layering: with
                      // no overlap at all, there's no ambiguity for the browser
                      // to resolve between this <label>'s own file-input click
                      // and the link row's onClick, regardless of browser.
                      : { position: "absolute", top: 0, left: 0, right: 0, bottom: "44px", opacity: 0, cursor: "pointer", width: "100%" }
                    }/>
                  {videoFile ? (
                    <div style={{ padding: "12px 20px" }}>
                      <div style={{ fontSize: "20px", marginBottom: "4px" }}>🎬</div>
                      <div style={{ fontWeight: "700", fontSize: "13px", color: B.brown }}>{videoFile.name}</div>
                      <div style={{ fontSize: "11px", color: "#aaa", marginTop: "3px" }}>
                        {(videoFile.size/1024/1024).toFixed(1)} MB ·{" "}
                        <span onClick={e => { e.preventDefault(); e.stopPropagation(); setVideoFile(null); setDetectedFileDurationSecs(null); setLargeFileWarning(null); setLargeSizeRiskWarning(false); setUploadZoneError(null); setPlannedCaption(""); }}
                          style={{ color: B.brown, cursor: "pointer", textDecoration: "underline" }}>Remove</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: "8px 20px" }}>
                      <div style={{ fontSize: "20px", marginBottom: "2px" }}>⬆</div>
                      <div style={{ fontWeight: "700", fontSize: "13px", color: "#888" }}>Tap to upload · MP4, MOV, WebM</div>
                      <div style={{ fontSize: "11px", color: "#bbb", marginTop: "2px", lineHeight: "1.3" }}>Our AI-powered panel previews your video before posting</div>
                      <div onClick={e => { e.preventDefault(); e.stopPropagation(); setShowLinkInput(true); }}
                        style={{ fontSize: "11px", color: B.brown, textDecoration: "underline", cursor: "pointer",
                          position: "relative", zIndex: 1,
                          // Enlarges the tap target via padding, then cancels the
                          // padding's document-flow growth with equal negative
                          // margin -- the visible text (and everything below it)
                          // lands in exactly the same place as the original
                          // marginTop:6px/no-padding version, but the clickable
                          // box is ~45px tall instead of ~14px. Paired with the
                          // file input's shortened "bottom: 44px" above, so this
                          // row has zero spatial overlap with it.
                          marginTop: "-10px", marginBottom: "-16px", padding: "16px 8px" }}>
                        or paste a video link
                      </div>
                    </div>
                  )}
                </label>
              )}
              {/* Chips v2, Task 3c -- revealed only after a file is picked, so
                  the initial screen is unchanged. A plain sibling of the
                  <label>, not nested inside it, so typing here never bubbles
                  into the file-input's own click/focus behavior. */}
              {videoFile && (
                // Wrapper applies a visual scale so the text reads at the same
                // size as the Objective placeholder (14px) without touching the
                // input's own fontSize, which must stay >=16px -- iOS Safari
                // auto-zooms the page on focus for any input below that (the
                // earlier reported zoom bug). transform:scale is a paint-time
                // effect the zoom heuristic doesn't see, so this satisfies both
                // constraints at once. Width is inversely compensated (100/0.875)
                // so the scaled-down box still spans the full row.
                <div style={{ marginTop: "8px", width: `${100/0.875}%`, transform: "scale(0.875)", transformOrigin: "left top" }}>
                  <input type="text" value={plannedCaption} onChange={e => setPlannedCaption(e.target.value)}
                    placeholder="Planned caption (optional)" maxLength={2000}
                    style={{ width: "100%", padding: "8px 10px", borderRadius: "8px", border: `1.5px solid ${B.border}`, fontSize: "16px", fontFamily: "inherit", color: B.body }} />
                </div>
              )}
              {linkFetchError && (
                <div style={{ marginTop: "8px", padding: "10px 14px", background: "#FFEBEE", border: "1.5px solid #EF9A9A", borderRadius: "10px", fontSize: "12px", color: "#C62828", lineHeight: "1.5" }}>
                  ⛔ {linkFetchError}
                </div>
              )}
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
                Objective <span style={{ fontWeight: "400", textTransform: "none", color: "#ccc" }}>(needed for your score)</span>
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
                  {objective || "Select a content category"}
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
            <div className="pp-section-gap pp-judge-section-gap" style={{ marginBottom: "16px" }}>
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
              {/* Text is absolutely positioned so it never adds flow height to
                  this wrapper -- on mobile .pp-sticky-wrap is position:fixed/
                  bottom:0, so any flow-height change here shoves the button
                  above it up or down. Anchoring the text to the button via an
                  absolute overlay keeps the button glued to its original spot
                  in every state (no file, file selected, text hidden/shown). */}
              <div style={{ position: "relative" }}>
                <button className="pp-btn" onClick={handleSubmit}
                  disabled={(!videoFile && !(showLinkInput && videoLinkUrl.trim())) || selectedJudges.length === 0 || !!uploadZoneError}
                  style={{ width: "100%", height: "56px", background: B.action, border: "none", borderRadius: "12px", color: "#fff", fontSize: "16px", fontWeight: "800", cursor: "pointer", fontFamily: "Montserrat, sans-serif", letterSpacing: "0.02em", transition: "all 0.18s ease", boxShadow: "0 2px 10px rgba(78,52,46,0.25)" }}>
                  Convene the Panel · {selectedJudges.length} Judge{selectedJudges.length !== 1 ? "s" : ""}
                </button>
                <div style={{ position: "absolute", top: "100%", left: 0, right: 0, marginTop: "8px", textAlign: "center", fontSize: "11px", color: "#aaa",
                  visibility: videoFile ? "visible" : "hidden", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>
                  ⏱ Analysis usually takes {timeEstimate} for a file this size
                </div>
              </div>
            </div>

            {/* Add to Home Screen prompt */}
            {deferredPrompt && (
              <div style={{ marginTop: "36px", padding: "10px 14px", background: "#fff", border: `1px solid ${B.border}`, borderRadius: "10px", display: "flex", alignItems: "center", gap: "10px" }}>
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
            </>}
          </div>
        )}

        {/* ── RESULTS SCREEN ── */}
        {step === 2 && (
          <div style={{ animation: "pp-slide 0.3s ease", paddingBottom: "max(40px, calc(env(safe-area-inset-bottom) + 24px))" }}>

            {/* Top bar */}
            <div style={{ textAlign: "center", paddingTop: "4px", paddingBottom: "0", position: "relative" }}>
              <img src="/owl-logo.png?v=3" alt="PreviewPanel"
                style={{ height: "98px", width: "auto", display: "block", margin: "0 auto -18px" }} />
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
            {inviteStatus?.bound && inviteStatus.allowance != null && (
              <div style={{ textAlign: "center", fontSize: "11px", color: B.grey, marginTop: "9px" }}>
                Beta allowance: {Math.max(0, inviteStatus.allowance - inviteStatus.used)} of {inviteStatus.allowance} left this month
              </div>
            )}

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
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "9px", marginBottom: "9px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "5px", padding: "5px 13px", background: plat.color+"10", border: `1.5px solid ${plat.color}35`, borderRadius: "99px", fontSize: "12px", fontWeight: "700", lineHeight: "1.2", color: plat.color, flexShrink: 0 }}>
                  <PlatformIcon id={plat.id} size={15} />
                  {plat.label}
                </div>
                {objective && (
                  <div style={{ display: "flex", alignItems: "center", padding: "5px 13px", background: B.lightBrown, border: `1.5px solid ${B.beige}`, borderRadius: "99px", fontSize: "12px", fontWeight: "700", lineHeight: "1.2", color: B.action, flexShrink: 0 }}>
                    🎯 {objective}
                  </div>
                )}
                {/* Readout-screen polish, point 1 -- same slot a file's name
                    occupies; a link run instead shows the cleaned URL,
                    tappable to open the original post in a new tab. */}
                {(() => {
                  const displayName = linkDisplayUrl || videoFile?.name || restoredFileName;
                  const displayUrl = linkSourceUrl || restoredSourceUrl || null;
                  if (!displayName) return null;
                  return displayUrl ? (
                    <a href={displayUrl} target="_blank" rel="noopener noreferrer"
                      style={{ display: "flex", alignItems: "center", gap: "4px", padding: "5px 13px", background: "#fff", border: `1.5px solid ${B.border}`, borderRadius: "99px", fontSize: "11px", color: B.brown, fontFamily: "'Courier New', monospace", textDecoration: "underline", cursor: "pointer" }}>
                      🔗 {displayName}
                    </a>
                  ) : (
                    <div style={{ padding: "5px 13px", background: "#fff", border: `1.5px solid ${B.border}`, borderRadius: "99px", fontSize: "11px", color: "#888", fontFamily: "'Courier New', monospace" }}>
                      {displayName}
                    </div>
                  );
                })()}
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
                <VerdictPanel synthesis={synthesis} scoreDisplay={scoreDisplay} platform={platform} />
                {showTiktokNudge && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10,
                    background: B.lightBrown, border: `1px solid ${B.border}`,
                    borderRadius: 12, padding: "10px 12px", marginBottom: 18,
                  }}>
                    <span style={{ fontSize: 12.5, color: B.body, lineHeight: 1.4, flex: 1 }}>
                      Connect TikTok to see how this prediction compares to what actually happens when it goes live.
                    </span>
                    <button onClick={() => setShowAccountSettings(true)} style={{
                      background: B.action, color: "#fff", border: "none", borderRadius: 8,
                      padding: "6px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                      fontFamily: "inherit", whiteSpace: "nowrap",
                    }}>
                      Connect
                    </button>
                    <button onClick={() => setTiktokNudgeDismissed(true)} aria-label="Dismiss" style={{
                      background: "none", border: "none", fontSize: 16, color: "#aaa", cursor: "pointer", padding: 0,
                    }}>
                      ×
                    </button>
                  </div>
                )}
                <PerformanceRadar results={judgeResults} trendAxes={trendAxes} groupMeanBigPicture={groupMeanBigPicture} groupMeanTrendAxes={groupMeanTrendAxes}
                  contentReadAxes={contentReadAxes} signalFields={signalFields} axisDeciles={axisDeciles}
                  skipObjectiveFit={!OBJECTIVE_OPTIONS.includes(objective)} />
                <WhatsWorkingFixes synthesis={synthesis} duration={videoDurationSecs} />
                <DisagreementCard synthesis={synthesis} />
                <ToolkitSection results={judgeResults} trim={trimCtx} />
                <JudgeDeepDives results={judgeResults} duration={videoDurationSecs} openIds={openJudgeIds} onToggle={toggleJudgeCard} />
              </>
            )}

            {/* Graceful fallback — synthesis failed/unavailable: show what the judges
                still produced via the new components (no synthesis overview). */}
            {isFinished && synthesisStatus !== "ready" && synthesisStatus !== "pending" && (
              <>
                <PerformanceRadar results={judgeResults} trendAxes={trendAxes} groupMeanBigPicture={groupMeanBigPicture} groupMeanTrendAxes={groupMeanTrendAxes}
                  contentReadAxes={contentReadAxes} signalFields={signalFields} axisDeciles={axisDeciles}
                  skipObjectiveFit={!OBJECTIVE_OPTIONS.includes(objective)} />
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
