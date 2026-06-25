import { useState } from "react";
import { B, JUDGES } from "../brand.js";

// ─────────────────────────────────────────────────────────────────────────────
// Part B — Performance radar (one hexagon, six axes). Replaces the old per-judge
// signal bar charts (do NOT render those bars alongside this).
//
// Axes = 3 universal dims + the 2 platform-specific dims actually present in the
// judge data + Objective Fit. Field names are the REAL ones from .results[id].data
// (confirmed against live judge output):
//   hook_strength, completion_likelihood, share_save_worthiness,
//   {rewatch_potential|seo_strength} (TikTok) / {watch_time_potential|
//   swipe_resistance} (YouTube) / {dm_share_potential|originality} (Instagram),
//   objective_fit.score
//
//   • Bold panel-AVERAGE polygon (present judges only) — ALWAYS prominent, no fill.
//   • Per-judge thin color lines — GHOSTED by default (the judges nearly coincide
//     on real data, so the average is the clean default signal). Tap a legend chip
//     to bring that judge to full strength; tap again to re-ghost. No fill, no dots.
//   • Partial: average from present judges only; missing judge absent from the
//     chart and greyed/struck in the legend.
//   • Graceful: no per-judge dimension data -> renders nothing.
// ─────────────────────────────────────────────────────────────────────────────

const UNIVERSAL = [
  { key: "hook_strength", label: "Hook" },
  { key: "completion_likelihood", label: "Completion" },
  { key: "share_save_worthiness", label: "Share/Save" },
];
const PLATFORM_DIMS = [
  { key: "rewatch_potential", label: "Rewatch" },
  { key: "seo_strength", label: "SEO" },
  { key: "watch_time_potential", label: "Watch Time" },
  { key: "swipe_resistance", label: "Swipe Resist" },
  { key: "dm_share_potential", label: "DM Share" },
  { key: "originality", label: "Originality" },
];

// Dimension explanations (verbatim from PreviewPanel.jsx DIMENSION_META). Keyed by
// dimension key; the active 6 axes vary by platform, so the info panel shows
// whichever axes are currently plotted.
const DIMENSION_INFO = {
  hook_strength: `Research across TikTok, Instagram, and YouTube consistently identifies the first 3 seconds as the single most predictive factor for video performance. Platform algorithms measure what percentage of viewers continue past this threshold — on TikTok, videos need ~70% of viewers to pass the 3-second mark to receive broad distribution. A strong hook uses a pattern interrupt, curiosity gap, bold claim, direct question, or immediate visual action to prevent the scroll reflex. Videos that open with slow builds, logos, or greetings are algorithmically penalized before the content even begins.`,
  completion_likelihood: `Completion rate — the percentage of viewers who watch to the end — is weighted at 40-50% of TikTok's ranking algorithm and is the #1 confirmed factor for Instagram Reels distribution. Platforms use completion as a proxy for content quality: if people finish watching, the content delivered on its promise. Completion is driven by consistent pacing (no dead air or slow sections), a clear value proposition established in the hook, and an ending that feels earned rather than abrupt. Editing with a "value-per-second" mindset — ensuring each 5-8 second block delivers new information, emotion, or visual novelty — is the most reliable method for improving completion.`,
  share_save_worthiness: `Shares and saves are the deepest engagement signals available to platform algorithms — they indicate that content delivered enough value for a viewer to act beyond passive watching. On Instagram, DM shares (sending a Reel to a friend) are weighted 3-5x higher than likes by the ranking algorithm. On TikTok, saves and shares now outrank likes as distribution signals. Content gets shared when it triggers a "I need to send this to someone" reaction — usually through humor, surprise, emotional resonance, or highly practical value. Content gets saved when it is reference-worthy — a tutorial, a recipe, an insight someone wants to return to.`,
  rewatch_potential: `TikTok's algorithm heavily weights re-watch events — when a user watches a video multiple times in succession, it registers as one of the strongest possible signals of genuine engagement. The platform interprets re-watches as evidence that the content is either entertaining enough to experience again or complex enough to require a second viewing. Videos that loop seamlessly (where the end connects naturally back to the beginning, making the restart unnoticeable) capture re-watches passively without requiring the viewer to consciously choose to replay. Re-watch rate is particularly impactful because it is a subconscious behavior that the algorithm treats as a high-confidence quality signal.`,
  seo_strength: `TikTok has functioned increasingly as a search engine since 2024, with approximately 40% of Gen Z preferring TikTok over Google for certain searches. The platform's algorithm scans captions, on-screen text overlays, and spoken audio (via automatic transcription) for keyword relevance, matching content to user search queries. Videos optimized for TikTok SEO — using searchable keywords naturally in all three locations — receive both algorithmic distribution via the For You Page and direct search traffic. This dual distribution channel makes keyword presence a compounding advantage: the same video benefits from recommendation and search simultaneously.`,
  dm_share_potential: `Direct message shares — when a viewer sends a Reel to someone via Instagram DM — are the single strongest signal in Instagram's ranking algorithm for reaching new audiences. The algorithm weights DM shares at 3-5x the value of a like because they represent a deliberate, high-intent action: the viewer saw enough value in the content to personally recommend it to someone they know. Content that triggers the "I need to send this to [specific person]" reaction — through humor, relatability, practical value, or emotional resonance — consistently outperforms content that earns passive likes.`,
  originality: `In December 2025, Instagram made its largest algorithmic shift in years: original content creators saw 40-60% increases in reach while accounts reposting or aggregating content from other platforms saw 60-80% reach collapses. The platform's AI now actively identifies and penalizes watermarked content (videos downloaded from TikTok or other platforms and re-uploaded) and rewards content that appears to be filmed and produced natively. Beyond watermarks, the algorithm uses visual and audio fingerprinting to identify repurposed content. Originality is scored here based on visual and production cues that suggest native creation versus content that appears derivative or recycled.`,
  watch_time_potential: `YouTube's algorithm prioritizes two distinct watch time metrics: relative watch time (the percentage of a video watched) and absolute watch time (the total minutes spent watching). Both are used because they capture different quality signals — relative watch time rewards content that retains viewers proportionally, while absolute watch time rewards content that keeps viewers engaged for longer total durations. Research shows that 2-3 minute YouTube Shorts achieve the strongest combined performance across both metrics. The algorithm also measures session depth — whether a viewer continues watching additional videos after yours — rewarding content that creates momentum rather than ending a viewing session.`,
  swipe_resistance: `YouTube Shorts viewers decide within the first 0.5–1 seconds whether to swipe past. Swipe Resistance scores how well this video holds attention in that critical window — based on opening-frame visual hook strength, sound or music impact in the first second, motion or movement that immediately captures attention, clarity of subject (the viewer instantly understands what they're watching), and the absence of slow-build openings that bleed viewers before the content begins.`,
  objective_fit: `Objective Fit measures how well this video succeeds at the specific goal you selected (e.g., comedy, education, brand awareness). Each judge evaluates this through their own lens — The Editor on craft execution, The Trendsetter on platform-native delivery, The Connector on emotional resonance. A high score means the video clearly delivers on its stated objective; a low score means it misses the mark.`,
};

const CX = 160, CY = 150, R = 88;
const AVG = "#1F1B16"; // bold near-black for the panel average

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function judgeAxisValue(data, axis) {
  if (axis.key === "__objfit") return num(data?.objective_fit?.score);
  return num(data?.dimensions?.[axis.key]);
}

export function PerformanceRadar({ results }) {
  const [focus, setFocus] = useState("avg"); // "avg" shows all four; a judge id isolates that judge
  const [showInfo, setShowInfo] = useState(false);

  const present = JUDGES
    .map((j) => ({ judge: j, data: results?.[j.id]?.status === "done" ? results[j.id].data : null }))
    .filter((x) => x.data && (x.data.dimensions || x.data.objective_fit));
  const presentIds = new Set(present.map((x) => x.judge.id));
  if (present.length === 0) return null;

  const platform = PLATFORM_DIMS.filter((pd) =>
    present.some((x) => num(x.data?.dimensions?.[pd.key]) != null)
  ).slice(0, 2);
  const axes = [...UNIVERSAL, ...platform, { key: "__objfit", label: "Objective Fit" }];

  if (!present.some((x) => axes.some((a) => judgeAxisValue(x.data, a) != null))) return null;

  const ang = (i) => (-90 + i * (360 / axes.length)) * Math.PI / 180;
  const pt = (i, v) => {
    const rr = (Math.max(0, Math.min(10, v)) / 10) * R;
    return [CX + rr * Math.cos(ang(i)), CY + rr * Math.sin(ang(i))];
  };
  const polyPoints = (vals) => vals.map((v, i) => pt(i, v ?? 0).map((n) => n.toFixed(1)).join(",")).join(" ");

  const judgeVals = present.map((x) => ({ judge: x.judge, vals: axes.map((a) => judgeAxisValue(x.data, a)) }));
  const avgVals = axes.map((_, i) => {
    const xs = judgeVals.map((jv) => jv.vals[i]).filter((v) => v != null);
    return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
  });

  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ fontWeight: 800, fontSize: 16, color: B.body, margin: "0 2px 10px" }}>Scorecard</div>

      <div style={{ background: "#fff", border: `1px solid ${B.border}`, borderRadius: 20,
        boxShadow: "0 1px 2px rgba(60,40,20,.04), 0 6px 20px rgba(60,40,20,.05)", padding: "12px 16px 12px" }}>
        <div style={{ fontSize: 11, color: B.grey }}>Each judge across six signals, 0–10.</div>

        <svg viewBox="0 28 320 246" style={{ width: "100%", maxWidth: 330, height: "auto", display: "block", margin: "0 auto" }}>
          {[2, 4, 6, 8, 10].map((g) => (
            <polygon key={g} points={axes.map((_, i) => pt(i, g).map((n) => n.toFixed(1)).join(",")).join(" ")}
              fill="none" stroke={B.border} strokeWidth={g === 10 ? 1.4 : 1} />
          ))}
          {axes.map((a, i) => {
            const sp = pt(i, 10), lp = pt(i, 12.2);
            const anchor = Math.abs(lp[0] - CX) < 6 ? "middle" : lp[0] > CX ? "start" : "end";
            const dy = lp[1] < CY - 10 ? -2 : lp[1] > CY + 10 ? 9 : 3;
            return (
              <g key={a.key}>
                <line x1={CX} y1={CY} x2={sp[0]} y2={sp[1]} stroke={B.border} strokeWidth="1" />
                <text x={lp[0].toFixed(1)} y={(lp[1] + dy).toFixed(1)} fontFamily="Montserrat, sans-serif"
                  fontSize="9.5" fontWeight="700" fill="#8a8178" textAnchor={anchor}>{a.label}</text>
              </g>
            );
          })}

          {/* per-judge lines — all shown in the avg view; tapping a judge isolates only its line */}
          {judgeVals.map(({ judge, vals }) => {
            if (focus !== "avg" && focus !== judge.id) return null;
            const solo = focus === judge.id;
            return (
              <polygon key={judge.id} points={polyPoints(vals)} fill="none" stroke={judge.color}
                strokeWidth={solo ? 3 : 2} strokeOpacity={1} strokeLinejoin="round" />
            );
          })}

          {/* bold panel-average — only in the default (avg) view */}
          {focus === "avg" && (
            <>
              <polygon points={polyPoints(avgVals)} fill="none" stroke={AVG} strokeWidth="4" strokeLinejoin="round" />
              {avgVals.map((v, i) => { const [x, y] = pt(i, v); return (
                <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="4.5" fill={AVG} stroke="#fff" strokeWidth="1.8" />
              ); })}
            </>
          )}

          {/* numeric value at each vertex — avg values by default, the isolated judge's otherwise */}
          {(() => {
            const fj = focus === "avg" ? null : judgeVals.find((jv) => jv.judge.id === focus);
            const vals = fj ? fj.vals.map((v) => Number(v) || 0) : avgVals;
            const col = fj ? fj.judge.color : AVG;
            return vals.map((v, i) => {
              const [nx, ny] = pt(i, v);
              const ux = Math.cos(ang(i)), uy = Math.sin(ang(i));
              // offset INWARD (toward center) so the value never overlaps the rim axis label
              const lx = nx - ux * 15, ly = ny - uy * 15;
              return (
                <text key={"n" + i} x={lx.toFixed(1)} y={(ly + 3.5).toFixed(1)} fontFamily="Montserrat, sans-serif"
                  fontSize="10.5" fontWeight="800" fill={col} stroke="#fff" strokeWidth="3" paintOrder="stroke" textAnchor="middle">
                  {v.toFixed(1)}
                </text>
              );
            });
          })()}
        </svg>

        <div style={{ textAlign: "center", fontSize: 10, color: B.grey, margin: "4px 0 7px" }}>Tap a judge to isolate their line</div>

        {/* legend — one row, all chips equal height; Avg restores the default view, a judge isolates its line */}
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 4, flexWrap: "nowrap" }}>
          <button type="button" onClick={() => setFocus("avg")}
            style={{ display: "flex", alignItems: "center", gap: 5, height: 28, boxSizing: "border-box", flexShrink: 0,
              background: focus === "avg" ? "#fff" : B.bg, border: `1px solid ${focus === "avg" ? AVG : B.border}`, borderRadius: 999,
              padding: "0 9px 0 6px", cursor: "pointer", fontFamily: "inherit",
              boxShadow: focus === "avg" ? `0 0 0 2px ${AVG}22` : "none" }}>
            <span style={{ width: 16, height: 10, borderRadius: 3, background: AVG, flexShrink: 0 }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: B.body }}>Avg</span>
          </button>
          {JUDGES.filter((j) => results && results[j.id]).map((j) => {
            const missing = !presentIds.has(j.id);
            const on = focus === j.id;
            return (
              <button key={j.id} type="button" disabled={missing} onClick={() => !missing && setFocus(j.id)}
                style={{ display: "flex", alignItems: "center", gap: 4, height: 28, boxSizing: "border-box", flexShrink: 0,
                  background: on ? "#fff" : B.bg, border: `1px solid ${on ? j.color : B.border}`, borderRadius: 999,
                  padding: "0 9px 0 4px", cursor: missing ? "default" : "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                  boxShadow: on ? `0 0 0 2px ${j.color}30` : "none", opacity: missing ? 0.5 : 1 }}>
                <img src={j.avatar} alt={j.name} style={{ width: 20, height: 20, objectFit: "contain", flexShrink: 0,
                  transform: j.avatarScale ? `scale(${j.avatarScale})` : undefined, filter: missing ? "grayscale(1)" : undefined }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: "#8a8178",
                  textDecoration: missing ? "line-through" : "none" }}>{j.name.replace("The ", "")}</span>
              </button>
            );
          })}
        </div>

        {/* one tappable explainer for ALL six signals (the active axes vary by platform) */}
        <button type="button" onClick={() => setShowInfo((s) => !s)}
          style={{ display: "flex", alignItems: "center", gap: 6, margin: "10px auto 0", background: B.bg,
            border: `1px solid ${B.border}`, borderRadius: 999, padding: "6px 12px", cursor: "pointer",
            fontFamily: "inherit", fontSize: 11, fontWeight: 700, color: "#8a8178" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" strokeLinecap="round" /></svg>
          What do these signals mean?
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: showInfo ? "rotate(180deg)" : "none", transition: "transform .2s" }}><path d="m6 9 6 6 6-6" /></svg>
        </button>
        {showInfo && (
          <div style={{ marginTop: 11, display: "flex", flexDirection: "column", gap: 10, borderTop: `1px solid ${B.lightBrown}`, paddingTop: 12 }}>
            {axes.map((a) => (
              <div key={a.key}>
                <div style={{ fontSize: 11.5, fontWeight: 800, color: B.body }}>{a.label}</div>
                <div style={{ fontSize: 11, lineHeight: 1.45, color: "#5c544a", marginTop: 2 }}>
                  {DIMENSION_INFO[a.key === "__objfit" ? "objective_fit" : a.key] || ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default PerformanceRadar;
