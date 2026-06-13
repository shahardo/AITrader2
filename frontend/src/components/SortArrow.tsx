// SortArrow.tsx — small up/down arrow shown on a sortable table column
// header when that column is the active sort key (Universe and Scores pages).

export type SortDirection = 'asc' | 'desc'

interface SortArrowProps {
  active: boolean
  direction: SortDirection
}

/** Up/down arrow shown on the active sort column's header. */
export default function SortArrow({ active, direction }: SortArrowProps) {
  if (!active) return null
  return <span className="ms-1 inline-block">{direction === 'asc' ? '▲' : '▼'}</span>
}
