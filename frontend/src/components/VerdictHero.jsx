import { B, ACTION } from "../brand.js";
import { MethodologyDropdown } from "./MethodologyModal.jsx";
import { AutoFitText } from "./AutoFitText.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// Part B — Verdict hero.
//
// Consumes the real synthesis contract from /api/status:
//   .synthesis = { verdict:{headline_score,action,gist}, panel:{judges_present,
//                  judges_missing}, ... }
//   .scoreDisplay = the capstone-v2 percentile payload (null if DISPLAY_SCORE
//                is off, or not ready yet, or an older submission predates it)
//
// The condensed sticky bar that used to appear here once the hero scrolled
// out of view was removed outright (not just fixed) -- it rendered the
// pre-percentile-overhaul UI (raw "X/10 · Polish first" + per-judge 0-10
// score pills), which had drifted out of sync with the hero it was meant to
// condense and was surfacing as a confusing "old UI" flash while scrolling.
// See git history for the sticky-bar implementation if it's ever revisited
// -- any reintroduction should render the SAME percentile-based content the
// hero itself shows, not the legacy judge-score gauge.
//
// The hero's main circle used to show the combined judge score (0-10), then
// (a later revision) the niche percentile. Score display UI overhaul: it now
// shows the OVERALL-APP percentile (vs the last 1,000 videos scored) -- the
// largest, most stable pool, so it's the most representative single number
// for the main circle. Niche and personal percentiles are still shown, as
// more prominent secondary stats (see SecondaryStat below) rather than
// blended into small fine print. Falls back to the old judge-score gauge
// when scoreDisplay is absent, so the hero never looks broken for
// submissions without it. Renders nothing when synthesis is absent, same as
// before.
// ─────────────────────────────────────────────────────────────────────────────

// Defensive: derive action from score if the model returns an unexpected value
// (backend overwrites action deterministically, but the UI must never crash).
// Still used for the no-scoreDisplay fallback gauge's color; the "POLISH
// FIRST"/etc. label itself was removed from the hero (score display UI
// overhaul) -- the percentile stats carry that signal now.
function actionFor(verdict) {
  if (verdict?.action && ACTION[verdict.action]) return ACTION[verdict.action];
  const s = Number(verdict?.headline_score) || 0;
  return s >= 8 ? ACTION.post : s >= 5 ? ACTION.polish : ACTION.rework;
}

// Percentile -> color, same 3-color scale as the judge-score action colors
// (green/amber/red). Thresholds: >=50 green, 25-49 amber, <25 red.
function percentileColor(p) {
  if (p == null) return B.grey;
  if (p >= 50) return ACTION.post.color;
  if (p >= 25) return ACTION.polish.color;
  return ACTION.rework.color;
}

// At overallAppPercentile >= 90 the gist's trailing "held back by" clause
// (the negative half of its documented "[strength], but [weakness]"
// structure -- synthesisSystemPrompt.txt RULE 3 / synthesisV25Addendum.txt)
// reads as noise on an already-excellent video. The percentile comparison
// runs after the gist is generated with no shared timing guarantee (separate
// pipelines -- see runSynthesisForJob vs the shadow-scoring path in
// server.js), so this trims the clause at render time instead of re-prompting
// the model. Splits on the LAST comma-introduced contrast conjunction, which
// is how the gist always introduces that clause in practice (see the
// addendum's own calibration example); if none is found the gist is left
// untouched rather than risk mangling a sentence that doesn't fit the pattern.
function trimHeldBackClause(gist) {
  const s = String(gist || "");
  const re = /,\s*(?:but|though|although|while|yet|however)\b/gi;
  let last = null, m;
  while ((m = re.exec(s))) last = m;
  if (!last) return s;
  const head = s.slice(0, last.index).trimEnd();
  return /[.!?]$/.test(head) ? head : `${head}.`;
}

// Secondary percentile stat (niche, personal) -- score display UI overhaul:
// previously 12px grey text that read as fine print; now a bordered stat
// pill with real weight, so these don't get lost next to the main gauge.
// flex: "1 1 0" (rather than each sizing to its own content) so the niche
// and personal boxes always match width, whichever has more/less text.
function SecondaryStat({ label, sub }) {
  return (
    <div style={{
      flex: "1 1 0", background: B.bg, border: `1px solid ${B.border}`, borderRadius: 12,
      padding: "8px 12px", textAlign: "center", minWidth: 0,
    }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: B.body, lineHeight: 1.3 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: B.grey, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ── Gauge (same SVG idiom throughout -- value/max generalized so it can show
//    either a percentile (0-100) or the legacy judge score (0-10)) ──
function Gauge({ value, max, unitLabel, color, size = 132 }) {
  const stroke = 11;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(max, Number(value) || 0));
  const fill = (clamped / max) * circ;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={B.lightBrown} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${fill} ${circ}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.16,1,0.3,1)" }} />
      <text x="50%" y="47%" dominantBaseline="middle" textAnchor="middle"
        fontSize="46" fontWeight="800" fill={B.body} fontFamily="Montserrat, sans-serif">{value}</text>
      <text x="50%" y="66%" dominantBaseline="middle" textAnchor="middle"
        fontSize="12" fontWeight="700" fill={B.grey} fontFamily="Montserrat, sans-serif">{unitLabel}</text>
    </svg>
  );
}

function VerdictHero({ synthesis, scoreDisplay, platform }) {
  const verdict = synthesis.verdict || {};
  const act = actionFor(verdict);
  const present = synthesis.panel?.judges_present || [];
  const missing = synthesis.panel?.judges_missing || [];
  const partial = missing.length > 0;

  const hasPercentile = !!(scoreDisplay && scoreDisplay.showPercentile);
  const isAbstain = !!(scoreDisplay && !scoreDisplay.showPercentile);
  const heroGist = hasPercentile && scoreDisplay.overallAppPercentile >= 90
    ? trimHeldBackClause(verdict.gist)
    : verdict.gist;

  return (
    <div style={{
      background: "#fff", border: `1px solid ${B.border}`, borderRadius: 20,
      boxShadow: "0 1px 2px rgba(60,40,20,.04), 0 6px 20px rgba(60,40,20,.05)",
      padding: "24px 20px 18px", textAlign: "center", position: "relative", overflow: "hidden",
    }}>
      <p style={{ fontSize: 16, lineHeight: 1.5, color: B.body, fontWeight: 500,
        margin: "0 auto 16px", maxWidth: "34ch" }}>{heroGist}</p>

      {!isAbstain && (
        <div style={{ width: 132, height: 132, margin: "2px auto 4px" }}>
          {hasPercentile ? (
            <Gauge value={scoreDisplay.overallAppPercentile} max={100} unitLabel="percentile" color={percentileColor(scoreDisplay.overallAppPercentile)} />
          ) : (
            <Gauge value={verdict.headline_score} max={10} unitLabel="/ 10" color={act.color} />
          )}
        </div>
      )}

      {hasPercentile && (
        <div style={{ marginTop: 4 }}>
          {scoreDisplay.overallAppHeadline && (
            <AutoFitText maxSize={15} minSize={10} style={{ fontWeight: 800, color: B.body }}>
              {scoreDisplay.overallAppHeadline}
            </AutoFitText>
          )}
          <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "center" }}>
            {scoreDisplay.headline && (
              <SecondaryStat label={scoreDisplay.headline} sub={scoreDisplay.sub} />
            )}
            {/* Personal box always renders, even below the 5-video floor --
                falls back client-side to the placeholder text for any
                scoreDisplay computed/stored before this box became
                unconditional (older submissions' personalHeadline is null,
                not the placeholder, since it was persisted at scoring time). */}
            <SecondaryStat label={scoreDisplay.personalHeadline || "Rank among your videos when >4"} />
          </div>
          {scoreDisplay.precisionCaveatLine && (
            <div style={{ fontSize: 11, color: B.grey, marginTop: 8, maxWidth: 320, marginLeft: "auto", marginRight: "auto" }}>
              {scoreDisplay.precisionCaveatLine}
            </div>
          )}
        </div>
      )}

      {isAbstain && (
        <div style={{ fontSize: 13, lineHeight: 1.4, color: B.grey, marginTop: 6, maxWidth: 280, marginLeft: "auto", marginRight: "auto" }}>
          {scoreDisplay.honestLine}
        </div>
      )}

      {partial && (
        <div style={{ fontSize: 11, color: B.grey, fontWeight: 700, marginTop: 14 }}>
          Based on {present.length} of {present.length + missing.length} judges
        </div>
      )}

      {scoreDisplay?.groupAverageNote && (
        <div style={{ fontSize: 11, color: B.grey, marginTop: 8, maxWidth: 320, marginLeft: "auto", marginRight: "auto" }}>
          {scoreDisplay.groupAverageNote}
        </div>
      )}

      <MethodologyDropdown platform={platform} poolInfoTooltip={scoreDisplay?.poolInfoTooltip} />
    </div>
  );
}

// Render only when synthesis is ready; otherwise the parent shows the raw
// judge view.
export function VerdictPanel({ synthesis, scoreDisplay, platform }) {
  if (!synthesis || !synthesis.verdict) return null;

  return <VerdictHero synthesis={synthesis} scoreDisplay={scoreDisplay} platform={platform} />;
}

export default VerdictPanel;
