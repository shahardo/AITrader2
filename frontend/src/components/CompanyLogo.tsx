// CompanyLogo.tsx — company logo for the stock-detail page. Tries Clearbit's
// logo service, falls back to Google's favicon service, and finally renders
// an initials placeholder so a logo is always shown even when both image
// sources fail to load.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  website: string | null
  name: string
  className?: string
}

/** Build the ordered list of logo image URLs to try for a company website. */
function logoSources(website: string | null): string[] {
  if (!website) return []
  try {
    const host = new URL(website).hostname.replace(/^www\./, '')
    return [
      `https://logo.clearbit.com/${host}`,
      `https://www.google.com/s2/favicons?domain=${host}&sz=64`,
    ]
  } catch {
    return []
  }
}

/** Uppercase first letter of the company name, for the placeholder avatar. */
function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?'
}

/**
 * Company logo with automatic fallback to a favicon service, then initials.
 *
 * Pass `website` as part of the component's `key` from the caller so a
 * change of company (and thus logo sources) resets the fallback index.
 */
export default function CompanyLogo({ website, name, className = 'h-10 w-10' }: Props) {
  const { t } = useTranslation('stockDetail')
  const sources = logoSources(website)
  const [index, setIndex] = useState(0)

  if (index >= sources.length) {
    return (
      <div
        className={`${className} flex shrink-0 items-center justify-center rounded bg-panel-2 text-sm font-semibold text-ink-3`}
        aria-hidden="true"
      >
        {initial(name)}
      </div>
    )
  }

  return (
    <img
      src={sources[index]}
      alt={t('company.logoAlt', { name })}
      className={`${className} shrink-0 rounded bg-white object-contain p-1`}
      onError={() => setIndex((i) => i + 1)}
    />
  )
}
