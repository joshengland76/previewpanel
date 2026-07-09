import { useState } from "react";
import { B } from "../brand.js";
import { METHODOLOGY_MODAL_TEXT, METHODOLOGY_LINK_TEXT, METHODOLOGY_URL } from "../studyCopy.js";

// "How this score works" -- a small trigger + modal, and a link out to the
// full /methodology one-pager. Copy is verbatim from studyCopy.js; nothing
// here should restate numbers independently.

export function MethodologyTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          background: "none", border: "none", padding: 0, marginTop: 10,
          fontSize: 12, color: B.grey, textDecoration: "underline", cursor: "pointer",
        }}
      >
        How this score works
      </button>
      {open && <MethodologyModal onClose={() => setOpen(false)} />}
    </>
  );
}

function MethodologyModal({ onClose }) {
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
          background: "#fff", borderRadius: 20, maxWidth: 440, width: "100%",
          padding: "24px 22px", boxShadow: "0 12px 40px rgba(0,0,0,.25)",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 16, color: B.body, marginBottom: 12 }}>
          How this score works
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.55, color: B.body, whiteSpace: "pre-line" }}>
          {METHODOLOGY_MODAL_TEXT.replace(" See how we validated it →", "")}
        </div>
        <a
          href={METHODOLOGY_URL}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "inline-block", marginTop: 14, fontSize: 13, fontWeight: 700, color: B.action }}
        >
          {METHODOLOGY_LINK_TEXT} →
        </a>
        <button
          onClick={onClose}
          style={{
            display: "block", marginTop: 18, marginLeft: "auto", background: B.lightBrown,
            border: "none", borderRadius: 999, padding: "8px 16px", fontSize: 12,
            fontWeight: 700, color: B.body, cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

export default MethodologyTrigger;
