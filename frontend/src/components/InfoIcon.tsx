// InfoIcon.tsx — small "i in a circle" icon used to reveal supplementary
// explanations (e.g. the Strategy Lab's per-strategy info panel).

interface InfoIconProps {
  className?: string
}

/** Inline SVG info-circle icon; inherits color via currentColor. */
export default function InfoIcon({ className }: InfoIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <circle cx="12" cy="7.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  )
}
