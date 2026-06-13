// LogOutIcon.tsx — door-with-arrow "log out" icon. Mirrors horizontally in
// RTL layouts so the arrow keeps pointing in the reading direction.

interface LogOutIconProps {
  className?: string
}

/** Inline SVG door-and-arrow icon for the logout button, RTL-aware. */
export default function LogOutIcon({ className }: LogOutIconProps) {
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
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  )
}
