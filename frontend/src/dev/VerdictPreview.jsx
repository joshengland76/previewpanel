import { useState } from "react";
import { VerdictPanel } from "../components/VerdictHero.jsx";
import { WhatsWorkingFixes } from "../components/WhatsWorkingFixes.jsx";
import { DisagreementCard } from "../components/DisagreementCard.jsx";
import { PerformanceRadar } from "../components/PerformanceRadar.jsx";
import { ToolkitSection } from "../components/ToolkitSection.jsx";
import { JudgeDeepDives } from "../components/JudgeDeepDives.jsx";
import { STATUS_FULL, STATUS_WITH_SPLITS, STATUS_NO_CLIPS, STATUS_PARTIAL, STATUS_DESELECTED, STATUS_NULL_SYNTHESIS } from "./statusFixture.js";

// Dev-only preview for Part B. View at:
//   npm run dev  →  http://localhost:5173/?preview=verdict
// Assembles the consolidated overview (6 tiles → 4) in order:
//   Verdict hero → "What's working & what to fix" → [Where they disagree, only
//   when splits exist] → Scorecard (radar) → Ready to use → [collapsed] full panel.
// Rendered against recorded /api/status fixtures (Full = real crookie v2.2).

const CASES = {
  full: { label: "Full (real crookie)", data: STATUS_FULL },
  with_splits: { label: "With a split", data: STATUS_WITH_SPLITS },
  no_clips: { label: "Editor: no clips", data: STATUS_NO_CLIPS },
  partial: { label: "Partial (Connector failed)", data: STATUS_PARTIAL },
  deselected: { label: "Connector deselected", data: STATUS_DESELECTED },
  fallback: { label: "Fallback (synthesis null)", data: STATUS_NULL_SYNTHESIS },
};

export default function VerdictPreview() {
  const [key, setKey] = useState("full");
  const [openJudges, setOpenJudges] = useState(() => new Set());
  const status = CASES[key].data;
  const synthReady = status.synthesisStatus === "ready" && status.synthesis;

  const toggleJudge = (id) =>
    setOpenJudges((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // verdict mini-scores / sticky chips jump to + expand the matching judge card.
  const jumpToJudge = (id) => {
    setOpenJudges((prev) => new Set(prev).add(id));
    setTimeout(() => {
      const el = document.getElementById(`judge-${id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#FAFAFA", padding: "16px",
      fontFamily: "Montserrat, system-ui, sans-serif", color: "#212121" }}>
      <div style={{ maxWidth: 430, margin: "0 auto" }}>
        {/* dev toggle (not part of the components) */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          {Object.entries(CASES).map(([k, c]) => (
            <button key={k} onClick={() => setKey(k)}
              style={{ fontSize: 12, fontWeight: 700, padding: "7px 11px", borderRadius: 999,
                cursor: "pointer", fontFamily: "inherit",
                border: `1px solid ${k === key ? "#212121" : "#E0D6D3"}`,
                background: k === key ? "#212121" : "#fff", color: k === key ? "#fff" : "#555" }}>
              {c.label}
            </button>
          ))}
        </div>

        {synthReady ? (
          // Consolidated overview, in order. DisagreementCard self-hides when splits is empty.
          <>
            <VerdictPanel synthesis={status.synthesis} results={status.results} onJumpToJudge={jumpToJudge} />
            <WhatsWorkingFixes synthesis={status.synthesis} duration={status.duration} />
            <DisagreementCard synthesis={status.synthesis} />
            <PerformanceRadar results={status.results} />
            <ToolkitSection results={status.results} />
            <JudgeDeepDives results={status.results} openIds={openJudges} onToggle={toggleJudge} />
          </>
        ) : (
          // Graceful fallback: synthesis null/failed → no synthesis overview; show
          // the raw-data sections the judges still produced (today's-view essence).
          // Graceful fallback: synthesis null/failed → no synthesis overview; the
          // Scorecard leads, then the raw-data sections (toolkit + full panel).
          <>
            <PerformanceRadar results={status.results} />
            <ToolkitSection results={status.results} />
            <JudgeDeepDives results={status.results} openIds={openJudges} onToggle={toggleJudge} />
          </>
        )}

        <div style={{ height: "40vh" }} />
      </div>
    </div>
  );
}
