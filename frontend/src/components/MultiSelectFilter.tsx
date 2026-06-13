// MultiSelectFilter.tsx — small dropdown of checkboxes for filtering a table
// column by zero or more values. An empty selection means "no filter" (every
// row passes). Used by the Universe page's Exchange and Sector columns.

import { useEffect, useRef, useState } from 'react'

export interface MultiSelectOption {
  value: string
  label: string
}

interface Props {
  label: string
  options: MultiSelectOption[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  clearLabel: string
}

/** Dropdown checkbox list that toggles membership in a `Set` filter. */
export default function MultiSelectFilter({ label, options, selected, onChange, clearLabel }: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(next)
  }

  return (
    <div ref={containerRef} className="relative inline-block font-normal normal-case">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-panel-2"
      >
        {label}
        {selected.size > 0 && (
          <span className="rounded-full bg-accent-badge px-1.5 text-xs text-accent-link">
            {selected.size}
          </span>
        )}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute start-0 z-10 mt-1 max-h-60 min-w-40 overflow-auto rounded border border-edge-2 bg-panel-2 p-2 text-sm shadow-lg"
        >
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => onChange(new Set())}
              className="mb-1 block text-xs text-accent-link hover:underline"
            >
              {clearLabel}
            </button>
          )}
          {options.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 whitespace-nowrap py-0.5">
              <input
                type="checkbox"
                checked={selected.has(opt.value)}
                onChange={() => toggle(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
