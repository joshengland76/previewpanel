// Official Instagram camera glyph with gradient fill
// Gradient: #FCB045 (orange-yellow) → #FD1D1D (red) → #833AB4 (purple)
export default function InstagramLogo({ size = 24, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, ...style }}>
      <defs>
        <linearGradient id="pp-ig-grad" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#FCB045" />
          <stop offset="50%" stopColor="#FD1D1D" />
          <stop offset="100%" stopColor="#833AB4" />
        </linearGradient>
      </defs>
      <rect x="1.5" y="1.5" width="21" height="21" rx="5.5" ry="5.5" fill="url(#pp-ig-grad)" />
      <circle cx="12" cy="12" r="5" fill="none" stroke="white" strokeWidth="2" />
      <circle cx="17.5" cy="6.5" r="1.3" fill="white" />
    </svg>
  );
}
