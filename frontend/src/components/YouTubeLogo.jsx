// Official YouTube play button — red rounded rectangle, white triangle
// Aspect ratio ~1.42:1 (wider than tall), matching YouTube brand proportions
export default function YouTubeLogo({ size = 24, style }) {
  const w = Math.round(size * 1.42);
  return (
    <svg width={w} height={size} viewBox="0 0 28 20" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, ...style }}>
      <rect width="28" height="20" rx="4.5" ry="4.5" fill="#FF0000" />
      <polygon points="11,4 11,16 21,10" fill="white" />
    </svg>
  );
}
