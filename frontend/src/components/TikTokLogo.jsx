// Official TikTok "d" shape with chromatic offset layers
// Cyan (#25F4EE) + Magenta (#FE2C55) offset behind Black foreground
export default function TikTokLogo({ size = 24, style }) {
  const d = "M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34l.02-10.93a8.16 8.16 0 0 0 4.77 1.52V7.34a4.85 4.85 0 0 1-1-.65z";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0, ...style }}>
      <path d={d} fill="#25F4EE" transform="translate(-0.8,0.8)" />
      <path d={d} fill="#FE2C55" transform="translate(0.8,-0.8)" />
      <path d={d} fill="#000000" />
    </svg>
  );
}
