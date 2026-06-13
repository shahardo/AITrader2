// Spinner.tsx — small rotating loading indicator for in-progress buttons.

interface SpinnerProps {
  className?: string
}

/** Inline rotating ring icon; inherits color via currentColor. */
export default function Spinner({ className }: SpinnerProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`animate-spin ${className ?? ''}`}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
