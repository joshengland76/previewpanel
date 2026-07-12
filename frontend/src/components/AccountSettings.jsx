import { useEffect, useState } from "react";
import { B } from "../brand.js";

// Phase C, Task 1 -- "Connect your accounts." None of the three platforms
// is mandatory to connect (Sweep D removed the earlier TikTok-required
// gate, both here and in POST /api/user/connect) -- TikTok is just the
// only one the Mac-side validation worker (Task 4) currently scans, so
// it's the one that actually feeds the prediction-vs-real-outcome
// comparison this phase. Instagram/YouTube are stored for a future
// platform validation pass -- no scanning code exists for them yet.
// Bio-code verification is generated/displayed/stored here, but the actual
// verification CHECK (confirming the code really is in the user's bio)
// stays a dormant stub -- nothing reads real bio content in this pass.

const API_BASE = import.meta.env.VITE_API_URL || "";

function AccountSettingsModal({ userId, onClose }) {
  const [tiktokHandle, setTiktokHandle] = useState("");
  const [instagramHandle, setInstagramHandle] = useState("");
  const [youtubeHandle, setYoutubeHandle] = useState("");
  const [connected, setConnected] = useState(null); // server row once connected
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/user/${encodeURIComponent(userId)}`);
        if (res.ok) {
          const data = await res.json();
          setConnected(data);
          setTiktokHandle(data.tiktok_handle || "");
          setInstagramHandle(data.instagram_handle || "");
          setYoutubeHandle(data.youtube_handle || "");
        }
      } catch { /* not connected yet -- fine, form starts empty */ }
      setLoading(false);
    })();
  }, [userId]);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/user/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, tiktokHandle, instagramHandle, youtubeHandle }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong — please try again.");
      } else {
        setConnected(data);
      }
    } catch {
      setError("Couldn't reach the server — please try again.");
    }
    setSaving(false);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(20,15,10,.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 20, maxWidth: 420, width: "100%",
          maxHeight: "85vh", overflowY: "auto",
          padding: "24px 22px", boxShadow: "0 12px 40px rgba(0,0,0,.25)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: B.body }}>Connect your accounts</div>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 18, color: "#aaa", cursor: "pointer" }}>×</button>
        </div>

        {loading ? (
          <div style={{ fontSize: 13, color: B.grey }}>Loading…</div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: B.grey, marginBottom: 10 }}>
              Connecting your TikTok lets us check our predictions against what actually happens
              when your videos go live — that's how we validate (and keep improving) the model.
              We're not scanning Instagram or YouTube yet, but connecting now means you're ready
              when we do.
            </div>

            <div style={{ fontSize: 11.5, lineHeight: 1.5, color: B.grey, background: B.lightBrown, borderRadius: 10, padding: "9px 12px", marginBottom: 16 }}>
              Your handle is only used to compare this prediction against your video's real
              30-day results — nothing is posted publicly. Details at{" "}
              <a href="/methodology" style={{ color: B.brown }}>previewpanel.vercel.app/methodology</a>.
            </div>

            <label style={{ fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              TikTok handle
            </label>
            <input
              value={tiktokHandle}
              onChange={(e) => setTiktokHandle(e.target.value)}
              placeholder="@yourhandle"
              style={{
                display: "block", width: "100%", marginTop: 6, marginBottom: 14,
                padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${B.border}`,
                fontSize: 14, fontFamily: "inherit", boxSizing: "border-box",
              }}
            />

            <label style={{ fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              Instagram handle
            </label>
            <input
              value={instagramHandle}
              onChange={(e) => setInstagramHandle(e.target.value)}
              placeholder="@yourhandle"
              style={{
                display: "block", width: "100%", marginTop: 6, marginBottom: 14,
                padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${B.border}`,
                fontSize: 14, fontFamily: "inherit", boxSizing: "border-box",
              }}
            />

            <label style={{ fontSize: 11, fontWeight: 700, color: "#aaa", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              YouTube handle or channel URL
            </label>
            <input
              value={youtubeHandle}
              onChange={(e) => setYoutubeHandle(e.target.value)}
              placeholder="@yourhandle or channel URL"
              style={{
                display: "block", width: "100%", marginTop: 6, marginBottom: 14,
                padding: "10px 12px", borderRadius: 10, border: `1.5px solid ${B.border}`,
                fontSize: 14, fontFamily: "inherit", boxSizing: "border-box",
              }}
            />

            {error && (
              <div style={{ fontSize: 12, color: "#C62828", marginBottom: 12 }}>{error}</div>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              style={{
                width: "100%", padding: "12px", borderRadius: 12, border: "none",
                background: B.action, color: "#fff", fontWeight: 700, fontSize: 14,
                cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1,
                fontFamily: "inherit",
              }}
            >
              {saving ? "Saving…" : connected ? "Update" : "Connect"}
            </button>

            {connected?.bio_code && (
              <div style={{
                marginTop: 16, padding: "12px 14px", background: B.lightBrown,
                borderRadius: 12, fontSize: 12.5, color: B.body, lineHeight: 1.5,
              }}>
                Your verification code: <b style={{ fontFamily: "monospace", fontSize: 13 }}>{connected.bio_code}</b>
                <div style={{ marginTop: 4, color: B.grey }}>
                  We'll ask you to add this to your TikTok bio in a future update — nothing to do with it yet.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function AccountSettingsTrigger({ userId, open: openProp, onOpenChange }) {
  const [openState, setOpenState] = useState(false);
  const open = openProp !== undefined ? openProp : openState;
  const setOpen = onOpenChange || setOpenState;
  return (
    <>
      <button onClick={() => setOpen(true)} style={{
        background: "#fff", border: `1.5px solid ${B.border}`,
        borderRadius: "8px", padding: "6px 10px",
        fontSize: "11px", fontWeight: "700", color: B.brown,
        cursor: "pointer", fontFamily: "Montserrat, sans-serif",
      }}>
        👤 Accounts
      </button>
      {open && <AccountSettingsModal userId={userId} onClose={() => setOpen(false)} />}
    </>
  );
}
