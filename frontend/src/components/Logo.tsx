// Logo.tsx — app logo: a candlestick chart with ups and downs (stock trading)
// topped with a gold AI "sparkle" glyph. The candlesticks render in the
// current text color so they follow the per-section accent theme set on
// <html data-section>; the sparkle is always gold, regardless of theme.

interface LogoProps {
  className?: string
}

/** Inline SVG logo combining an up-and-down candlestick chart with a gold AI sparkle accent. */
export default function Logo({ className }: LogoProps) {
  return (
    <svg viewBox="0 0 46 40" fill="none" aria-hidden="true" className={className}>
      <rect x="1" y="26" width="6" height="8" rx="1.5" fill="currentColor" opacity="0.4" />
      <line
        x1="4"
        y1="23"
        x2="4"
        y2="37"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.4"
      />
      <rect x="10" y="18" width="6" height="14" rx="1.5" fill="currentColor" opacity="0.6" />
      <line
        x1="13"
        y1="15"
        x2="13"
        y2="35"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.6"
      />
      <rect x="19" y="6" width="6" height="22" rx="1.5" fill="currentColor" opacity="0.8" />
      <line
        x1="22"
        y1="3"
        x2="22"
        y2="31"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.8"
      />
      <rect x="28" y="14" width="6" height="16" rx="1.5" fill="currentColor" />
      <line
        x1="31"
        y1="11"
        x2="31"
        y2="33"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M36 1 38.1 6.9 44 9 38.1 11.1 36 17 33.9 11.1 28 9 33.9 6.9Z" fill="#fbbf24" />
    </svg>
  )
}
