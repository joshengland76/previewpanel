// Shared brand tokens — single source of truth for PreviewPanel.jsx and the
// Part B synthesis components. B and JUDGES are IDENTICAL to the values that were
// previously defined inline in PreviewPanel.jsx (a source-of-truth move, not a
// restyle). ACTION/VALENCE/JUDGE_BY_* are additive helpers for the synthesis UI.

export const B = {
  bg: "#FAFAFA", black: "#121212", body: "#212121",
  brown: "#795548", grey: "#90A4AE", beige: "#D7CCC8",
  action: "#4E342E", actionHover: "#3E2723",
  lightBrown: "#EFEBE9", midBrown: "#BCAAA4", border: "#E0D6D3",
};

export const JUDGES = [
  { id: "critic", name: "The Editor", color: B.brown, softBg: "#EFEBE9",
    tagline: "Sharp-eyed. Focused on craft, cuts, and execution.", scoreLabel: "The Editor's Cut",
    avatar: "/owl-editor.png?v=2", avatarScale: 1.1, canon: "editor" },
  { id: "cool", name: "The Trendsetter", color: "#546E7A", softBg: "#ECEFF1",
    tagline: "Platform-native, trend-aware, discerning.", scoreLabel: "The Trendsetter's Take",
    avatar: "/owl-trendsetter.png?v=3", avatarScale: 1.1, canon: "trendsetter" },
  { id: "connector", name: "The Connector", color: "#8D6E63", softBg: "#FBF8F7",
    tagline: "Human-first. Finds the moments that make people share.", scoreLabel: "The Connector's Take",
    avatar: "/owl-connector.png?v=1", canon: "connector" },
];

// Lookup maps. Synthesis uses canonical names (editor/trendsetter/connector);
// /api/status results use ids (critic/cool/connector).
export const JUDGE_BY_ID = Object.fromEntries(JUDGES.map((j) => [j.id, j]));
export const JUDGE_BY_CANON = Object.fromEntries(JUDGES.map((j) => [j.canon, j]));

// Verdict action -> label + color.
export const ACTION = {
  post:   { label: "Post it",      color: "#43A047" },
  polish: { label: "Polish first", color: "#FB8C00" },
  rework: { label: "Rework",       color: "#E53935" },
};

// Moment valence -> color for the diverging-marker timeline. strength/risk reuse
// the app's existing green/red score colors; split is a new amber consistent with
// the warm palette (no existing token for it).
export const VALENCE = {
  strength: "#43A047",
  risk:     "#E53935",
  split:    "#B5871C",
};
