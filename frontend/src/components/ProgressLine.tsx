// ProgressLine.tsx — renders a one-line live-status message from a ProgressInfo
// payload (e.g. "Reading article for AAPL (3/12)"), looked up via the
// `<keyPrefix>.<stage>` i18n key in the caller's namespace.

import { useTranslation } from 'react-i18next'
import type { ProgressInfo } from '../api/client'

/** Status line for an in-flight scan/deep-dive; renders nothing when idle. */
export default function ProgressLine({
  progress,
  ns,
  keyPrefix = 'progress',
}: {
  progress: ProgressInfo | null | undefined
  ns: string
  keyPrefix?: string
}) {
  const { t } = useTranslation(ns)
  if (!progress) return null
  return (
    <p className="mt-2 text-sm text-ink-3">
      {t(`${keyPrefix}.${progress.stage}`, {
        symbol: progress.symbol,
        topic: progress.topic,
        current: progress.current,
        total: progress.total,
        defaultValue: progress.stage,
      })}
    </p>
  )
}
