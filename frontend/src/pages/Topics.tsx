// Topics.tsx — investment-themes page: the hot-topics radar (LLM-clustered from
// recent news), a deep-dive trigger for listed or free-text themes, and the
// resulting reports with validated, ranked stock candidates.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listHotTopics,
  listTopicReports,
  runDeepDive,
  type TopicReportOut,
} from '../api/client'

/** One deep-dive report rendered with its ranked candidates. */
function Report({ report }: { report: TopicReportOut }) {
  const { t } = useTranslation('topics')
  return (
    <div className="rounded border border-edge bg-panel p-4">
      <div className="flex items-baseline gap-3">
        <h3 className="font-semibold">{report.topic_name}</h3>
        <span className="text-xs text-ink-4">
          {new Date(report.created_at).toLocaleString()}
        </span>
      </div>
      <p className="mt-1 text-sm text-ink-2">{report.summary}</p>
      <table className="mt-3 w-full text-start text-sm">
        <thead>
          <tr className="border-b border-edge-2 text-ink-3">
            <th className="py-1">{t('reports.table.symbol')}</th>
            <th>{t('reports.table.name')}</th>
            <th className="text-end">{t('reports.table.score')}</th>
            <th>{t('reports.table.why')}</th>
          </tr>
        </thead>
        <tbody>
          {report.candidates.map((c) => (
            <tr key={c.symbol} className="border-b border-edge">
              <td className="py-1.5">
                <Link
                  to={`/stocks/${encodeURIComponent(c.symbol)}`}
                  className="font-mono text-accent-link hover:underline"
                >
                  {c.symbol}
                </Link>
              </td>
              <td>{c.name}</td>
              <td className="text-end">
                {c.combined_score != null ? c.combined_score.toFixed(1) : '—'}
              </td>
              <td className="text-ink-3">{c.rationale}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Topics page at /topics. */
export default function TopicsPage() {
  const { t } = useTranslation(['topics', 'common'])
  const queryClient = useQueryClient()
  const [freeText, setFreeText] = useState('')
  const topics = useQuery({ queryKey: ['topics'], queryFn: () => listHotTopics() })
  const reports = useQuery({ queryKey: ['topic-reports'], queryFn: listTopicReports })

  const refreshRadar = useMutation({
    mutationFn: () => listHotTopics(true),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['topics'] }),
  })
  const dive = useMutation({
    mutationFn: (topic: string) => runDeepDive(topic),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['topic-reports'] }),
  })

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-4 flex items-center">
        <h1 className="text-2xl font-bold text-accent">{t('title')}</h1>
        <button
          onClick={() => refreshRadar.mutate()}
          disabled={refreshRadar.isPending}
          className="ms-auto rounded bg-panel-2 px-3 py-1.5 text-sm hover:bg-panel-3 disabled:opacity-50"
        >
          {refreshRadar.isPending ? t('actions.scanning') : t('actions.refreshRadar')}
        </button>
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">{t('hotNow.heading')}</h2>
        {topics.data && topics.data.length === 0 && (
          <p className="text-ink-3">{t('hotNow.empty')}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {topics.data?.map((topic) => (
            <button
              key={topic.id}
              onClick={() => dive.mutate(topic.name)}
              disabled={dive.isPending}
              title={topic.summary}
              className="rounded-full border border-accent-pill-border bg-accent-pill px-3 py-1 text-sm text-accent-link hover:bg-accent-badge disabled:opacity-50"
            >
              {t('hotNow.pill', { name: topic.name, buzz: (topic.buzz_score * 100).toFixed(0) })}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">{t('deepDiveSection.heading')}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (freeText.trim()) dive.mutate(freeText.trim())
          }}
          className="flex gap-2"
        >
          <input
            placeholder={t('deepDiveSection.placeholder')}
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            className="w-72 rounded border border-edge-2 bg-panel-2 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={dive.isPending}
            className="rounded bg-accent-button px-4 py-1.5 text-sm font-semibold hover:bg-accent-button-hover disabled:opacity-50"
          >
            {dive.isPending ? t('actions.diving') : t('actions.deepDive')}
          </button>
        </form>
        {dive.error && (
          <p role="alert" className="mt-2 text-sm text-negative">
            {t('errors.deepDiveFailed')}
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">{t('reports.heading')}</h2>
        {reports.data && reports.data.length === 0 && (
          <p className="text-ink-3">{t('reports.empty')}</p>
        )}
        <div className="space-y-4">
          {reports.data?.map((r) => <Report key={r.id} report={r} />)}
        </div>
      </section>
      <p className="mt-6 text-xs text-ink-5">{t('common:disclaimerShort')}</p>
    </div>
  )
}
