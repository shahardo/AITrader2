// BackIcon.tsx — left-pointing arrow icon for "go back" navigation. Mirrors
// horizontally in RTL layouts so the arrow keeps pointing toward the
// reading-order "previous" direction.

interface BackIconProps {
  className?: string
}

/** Inline SVG left-arrow icon for back-navigation buttons, RTL-aware. */
export default function BackIcon({ className }: BackIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`rtl:-scale-x-100 ${className ?? ''}`}
    >
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}
