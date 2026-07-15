import { useState } from "react";
import { B, VALENCE } from "../brand.js";

// Spider v3 -- "Detected signals," rendered by PerformanceRadar.jsx at the
// end of its own card div (Spider v3.1 moved this on-card; it used to be a
// separate block below the card). Curiosity and Inspiration used to be
// radar AXES (Sweep C); a zero-rate analysis found they sat at a
// near-certain 0 vertex on ~99% of videos (mostly rows C_dims simply never
// ran on -- see SPIDER_V3_READOUT.md), which read as broken even where it
// was accurate. Demoted to presence chips instead: a binary "detected in
// this video, yes or no" read is a much better fit for a signal that's
// genuinely absent most of the time than a chart vertex that spends nearly
// all its life at the origin.
//
// Spider v3.1 split the row into two labeled sub-rows and added six more
// presence signals beyond Curiosity/Inspiration/Save-CTA, each backed by a
// real (and correctly-signed) scoring_spec_v2.json coefficient:
//   POSITIVE  cta_type_follow          +0.0368
//             caption_tone_educational +0.0293
//   NEGATIVE  is_sponsored_int         -0.0746
//             caption_tone_promotional -0.0911
//             hook_style_question      -0.0906
//             cta_type_buy             -0.0572
//             cta_type_link            -0.0362
//             text_overlay_density_heavy -0.0257
// "Negative" here means "correlates with underperformance in our data," not
// "bad content" -- sponsored content in particular gets an expectation-
// setting tooltip rather than a punitive one (a creator's sponsored posts
// underperforming their own average is expected, not a verdict on quality).
//
// contentReadAxes/signalFields are the SAME "current submission only"
// values PerformanceRadar's trendAxes prop uses -- see server.js's
// runShadowScoringForJob: never pool/corpus data, never averaged across
// other submissions of the same video.
//
// No empty state by design -- the whole block (and each sub-row within it)
// renders nothing at all when empty, rather than explaining what didn't fire.

const CHIP_INFO = {
  // Pre-existing (Spider v3) -- tooltip unchanged.
  inspiration: `A content read (not a judge score): this video leans on aspiration, transformation, or "you can do this too" framing. In our data, inspiration is one of the more consistently positive signals across niches.`,
  combo: `Curiosity and Inspiration both detected in the same video — the strongest positive pattern in our study data.`,
  // Chips v2, Task 3 note: save/follow CTA chips are structurally caption-
  // dependent -- the model has no reliable way to see "save this" or "follow
  // me" language from video/audio alone, so these only fire when a caption
  // is actually present (link-fetch, validation rescores, or an optional
  // planned-caption file upload). Keeping them in the roster anyway since
  // they're real, correctly-signed model features, not dead weight.
  save: `This video includes a "save"-oriented call to action. In our data, save-prompting videos show one of the stronger positive associations with performance among the signals we track.`,
  // New (Spider v3.1) -- house pattern: positives "tend to outperform the
  // creator's typical video," negatives "tend to underperform" it.
  follow: `In our data, videos with a follow-prompting call to action tend to outperform the creator's typical video.`,
  educational: `In our data, videos with an educational caption tone tend to outperform the creator's typical video.`,
  sponsored: `This video reads as sponsored or branded content. In our data, sponsored videos tend to underperform a creator's typical video — useful to know when comparing this result against your usual numbers, not a mark against the video itself.`,
  promotional: `In our data, videos with a promotional caption tone tend to underperform the creator's typical video.`,
  question_hook: `In our data, videos that open with a question-style hook tend to underperform the creator's typical video.`,
  buy: `In our data, videos with a buy-oriented call to action tend to underperform the creator's typical video.`,
  link: `In our data, videos with a link-oriented call to action tend to underperform the creator's typical video.`,
  heavy_text: `In our data, videos with heavy on-screen text overlays tend to underperform the creator's typical video.`,
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

function SignalRow({ title, chips, open, onToggle }) {
  if (chips.length === 0) return null;
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 800, color: "#8a8178", textTransform: "uppercase",
        letterSpacing: 0.4, textAlign: "center", marginBottom: 6 }}>
        {title}
      </div>
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {chips.map((c) => <Chip key={c.id} {...c} open={open} onToggle={onToggle} />)}
      </div>
    </div>
  );
}

// Chips v2, Task 4 -- roster policy: every chip here is a real,
// correctly-signed scoring_spec_v2.json coefficient with a corpus base rate
// under ~35% (see CHIPS_V2_READOUT.md's base-rate table) and a raw feature
// the model can structurally fire on given what's actually available at
// scoring time (video+audio only, or video+audio+caption when one exists).
// The generic Curiosity chip was removed entirely: its "detected" read (any
// primary/secondary/combination-label match) is nearly a coin flip in real
// submissions and carries no dedicated model weight of its own -- curiosity
// only earns a badge here as half of the Curiosity+Inspiration combo, never
// standalone. Likewise there's no chip for curiosity_delight/delight-variant
// combination labels: +0.017 at a ~52% base rate in live app data is below
// the bar on both signal strength and rarity.
export function DetectedSignals({ contentReadAxes, signalFields }) {
  const [open, setOpen] = useState(null);
  const sf = signalFields || {};

  // Broad definition (primary/secondary/combination-substring) -- kept ONLY
  // to decide when the combo chip fires, matching its unchanged behavior;
  // never rendered as its own chip (see roster-policy comment above).
  const curiosityDetected = (contentReadAxes?.curiosity ?? 0) > 0;
  // Strict definition for the standalone chip -- emotion_primary_inspiration
  // OR emotion_targeted_inspiration only (see buildSignalFields's comment).
  const inspirationDetected = sf.inspirationStrict === true;
  const bothDetected = curiosityDetected && inspirationDetected;
  const saveDetected = sf.ctaType === "save";
  const followDetected = sf.ctaType === "follow";
  const educationalDetected = sf.captionTone === "educational";

  const sponsoredDetected = sf.isSponsored === true;
  const promotionalDetected = sf.captionTone === "promotional";
  const questionHookDetected = sf.hookStyle === "question";
  const buyDetected = sf.ctaType === "buy";
  const linkDetected = sf.ctaType === "link";
  const heavyTextDetected = sf.textOverlayDensity === "heavy";

  const comboAccent = VALENCE.split; // warm gold -- distinct from the brown positive chips
  const negativeAccent = B.grey; // muted blue-grey -- visually distinct from positives, deliberately not alarming red

  const positiveChips = [
    // Combo supersedes the standalone Inspiration chip when both fire --
    // never show both at once.
    bothDetected && { id: "combo", label: "Curiosity + Inspiration", icon: "⭐", accent: comboAccent },
    (inspirationDetected && !bothDetected) && { id: "inspiration", label: "Inspiration", icon: "💡", accent: B.brown },
    saveDetected && { id: "save", label: "Save-prompt CTA", icon: "🔖", accent: B.brown },
    followDetected && { id: "follow", label: "Follow CTA", icon: "➕", accent: B.brown },
    educationalDetected && { id: "educational", label: "Educational tone", icon: "🎓", accent: B.brown },
  ].filter(Boolean);

  const negativeChips = [
    sponsoredDetected && { id: "sponsored", label: "Sponsored content", icon: "🏷️", accent: negativeAccent },
    promotionalDetected && { id: "promotional", label: "Promotional tone", icon: "📢", accent: negativeAccent },
    questionHookDetected && { id: "question_hook", label: "Question-style hook", icon: "❓", accent: negativeAccent },
    buyDetected && { id: "buy", label: "Buy CTA", icon: "🛒", accent: negativeAccent },
    linkDetected && { id: "link", label: "Link CTA", icon: "🔗", accent: negativeAccent },
    heavyTextDetected && { id: "heavy_text", label: "Heavy text overlays", icon: "🔤", accent: negativeAccent },
  ].filter(Boolean);

  if (positiveChips.length === 0 && negativeChips.length === 0) return null;

  const toggle = (id) => setOpen((cur) => (cur === id ? null : id));

  return (
    <div style={{ marginTop: 2, marginBottom: 16,
      display: "flex", flexDirection: "column", gap: 10 }}>
      <SignalRow title="Other positive signals" chips={positiveChips} open={open} onToggle={toggle} />
      <SignalRow title="Negative signals" chips={negativeChips} open={open} onToggle={toggle} />
      {open && (
        <div style={{ fontSize: 11, lineHeight: 1.45, color: "#5c544a", textAlign: "center", padding: "0 6px" }}>
          {CHIP_INFO[open]}
        </div>
      )}
    </div>
  );
}

export default DetectedSignals;
