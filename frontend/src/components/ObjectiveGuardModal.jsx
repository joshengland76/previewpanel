import { useEffect, useRef, useState } from "react";
import { B } from "../brand.js";

// Objective guard -- second-chance selector shown when "Convene the Panel"
// (or the link-fetch path, which shares the same handleSubmit) is tapped with
// NO objective selected. Deliberately offers only the canonical OBJECTIVE_OPTIONS
// list, not the main selector's free-type escape hatch: a custom-typed
// objective doesn't clear tiers_v2_2.json's showPercentile gate either (see
// scoreDisplay.js), so it can't actually deliver on this modal's "Score with
// this category" promise -- only a canonical category can.
export function ObjectiveGuardModal({ open, options, onScore, onContinueWithoutScore, onClose }) {
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setSelected("");
    setFilter("");
    // Pre-focused per spec -- a short delay lets the modal's mount/transition
    // settle first so mobile browsers reliably raise the keyboard on the
    // first tap-equivalent instead of swallowing an autofocus during layout.
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const filtered = options.filter((opt) => opt.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(20,15,10,.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 20, zIndex: 1200,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 20, maxWidth: 420, width: "100%",
          maxHeight: "85vh", display: "flex", flexDirection: "column",
          boxShadow: "0 12px 40px rgba(0,0,0,.25)", overflow: "hidden",
        }}
      >
        <div style={{ padding: "22px 22px 14px" }}>
          <div style={{ fontWeight: 800, fontSize: 17, color: B.body, marginBottom: 6 }}>
            Pick a category to get your score
          </div>
          <div style={{ fontSize: 12.5, color: B.grey, lineHeight: 1.5 }}>
            Your panel will review the video either way — but without a content
            category, we can't score it or show percentiles.
          </div>
        </div>

        <div style={{ padding: "0 22px 10px" }}>
          <input
            ref={inputRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search categories…"
            style={{
              width: "100%", boxSizing: "border-box", padding: "10px 13px",
              borderRadius: 10, border: `1.5px solid ${B.border}`, fontSize: 16,
              fontFamily: "inherit", color: B.body, outline: "none",
            }}
          />
        </div>

        <div style={{ overflowY: "auto", flex: 1, borderTop: `1px solid ${B.border}`, borderBottom: `1px solid ${B.border}` }}>
          {filtered.length === 0 && (
            <div style={{ padding: "16px 22px", fontSize: 13, color: B.grey }}>No matching categories.</div>
          )}
          {filtered.map((opt, i) => (
            <div
              key={opt}
              onClick={() => setSelected(opt)}
              style={{
                padding: "0 22px", minHeight: 46, display: "flex", alignItems: "center",
                fontSize: 14, fontFamily: "Montserrat, sans-serif",
                color: selected === opt ? B.brown : B.body,
                fontWeight: selected === opt ? 700 : 400,
                background: selected === opt ? B.lightBrown : "transparent",
                cursor: "pointer",
                borderBottom: i < filtered.length - 1 ? `1px solid ${B.border}` : "none",
              }}
            >
              {opt}
            </div>
          ))}
        </div>

        <div style={{ padding: "16px 22px 22px", display: "flex", flexDirection: "column", gap: 10 }}>
          <button
            type="button"
            disabled={!selected}
            onClick={() => onScore(selected)}
            style={{
              width: "100%", height: 48, borderRadius: 12, border: "none",
              background: selected ? B.action : B.border, color: "#fff",
              fontSize: 15, fontWeight: 800, fontFamily: "Montserrat, sans-serif",
              cursor: selected ? "pointer" : "not-allowed", letterSpacing: "0.02em",
            }}
          >
            Score with this category
          </button>
          <button
            type="button"
            onClick={onContinueWithoutScore}
            style={{
              width: "100%", height: 40, borderRadius: 12, border: "none",
              background: "transparent", color: B.grey,
              fontSize: 13, fontWeight: 700, fontFamily: "Montserrat, sans-serif",
              cursor: "pointer",
            }}
          >
            Continue without a score
          </button>
        </div>
      </div>
    </div>
  );
}

export default ObjectiveGuardModal;
