import { useState } from "react";
import { B, VALENCE } from "../brand.js";

// Spider v3 -- "Detected signals" chip row, rendered directly beneath
// PerformanceRadar. Curiosity and Inspiration used to be radar AXES (Sweep
// C); a zero-rate analysis found they sat at a near-certain 0 vertex on
// ~99% of videos (mostly rows C_dims simply never ran on -- see
// SPIDER_V3_READOUT.md), which read as broken even where it was accurate.
// Demoted here to presence chips instead: a binary "detected in this video,
// yes or no" read is a much better fit for a signal that's genuinely absent
// most of the time than a chart vertex that spends nearly all its life at
// the origin.
//
// contentReadAxes/ctaType are the SAME "current submission only" values
// PerformanceRadar's trendAxes prop uses -- see server.js's
// runShadowScoringForJob (Spider v3, point 4): never pool/corpus data, never
// averaged across other submissions of the same video.
//
// No empty state by design -- renders null outright when zero chips are
// earned, rather than a row explaining what didn't happen.

const CHIP_INFO = {
  curiosity: `A content read (not a judge score): this video leans on open questions, reveals, or "wait, what?" moments to pull viewers in. In our data, curiosity paired with a payoff is one of the strongest patterns behind above-average performance.`,
  inspiration: `A content read (not a judge score): this video leans on aspiration, transformation, or "you can do this too" framing. In our data, inspiration is one of the more consistently positive signals across niches.`,
  combo: `Curiosity and Inspiration both detected in the same video — the strongest positive pattern in our study data.`,
  save: `This video includes a "save"-oriented call to action. In our data, save-prompting videos show one of the stronger positive associations with performance among the signals we track.`,
};

function Chip({ id, label, icon, accent, open, onToggle }) {
  const isOpen = open === id;
  return (
    <button type="button" onClick={() => onToggle(id)}
      style={{ display: "flex", alignItems: "center", gap: 5, height: 28, boxSizing: "border-box", flexShrink: 0,
        background: isOpen ? "#fff" : B.bg, border: `1px solid ${isOpen ? accent : B.border}`, borderRadius: 999,
        padding: "0 10px", cursor: "pointer", fontFamily: "inherit",
        boxShadow: isOpen ? `0 0 0 2px ${accent}30` : "none" }}>
      <span style={{ fontSize: 12, lineHeight: 1 }}>{icon}</span>
      <span style={{ fontSize: 10, fontWeight: 700, color: accent }}>{label}</span>
    </button>
  );
}

export function DetectedSignals({ contentReadAxes, ctaType }) {
  const [open, setOpen] = useState(null);

  const curiosityDetected = (contentReadAxes?.curiosity ?? 0) > 0;
  const inspirationDetected = (contentReadAxes?.inspiration ?? 0) > 0;
  const bothDetected = curiosityDetected && inspirationDetected;
  const saveDetected = ctaType === "save";

  if (!curiosityDetected && !inspirationDetected && !saveDetected) return null;

  const toggle = (id) => setOpen((cur) => (cur === id ? null : id));
  const comboAccent = VALENCE.split; // warm gold -- distinct from the brown/grey chip palette elsewhere

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {curiosityDetected && (
          <Chip id="curiosity" label="Curiosity" icon="✨" accent={B.brown} open={open} onToggle={toggle} />
        )}
        {inspirationDetected && (
          <Chip id="inspiration" label="Inspiration" icon="💡" accent={B.brown} open={open} onToggle={toggle} />
        )}
        {bothDetected && (
          <Chip id="combo" label="Curiosity + Inspiration" icon="⭐" accent={comboAccent} open={open} onToggle={toggle} />
        )}
        {saveDetected && (
          <Chip id="save" label="Save-prompt CTA" icon="🔖" accent={B.brown} open={open} onToggle={toggle} />
        )}
      </div>
      {open && (
        <div style={{ marginTop: 8, fontSize: 11, lineHeight: 1.45, color: "#5c544a", textAlign: "center",
          padding: "0 6px" }}>
          {CHIP_INFO[open]}
        </div>
      )}
    </div>
  );
}

export default DetectedSignals;
