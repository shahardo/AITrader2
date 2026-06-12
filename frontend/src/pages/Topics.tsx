// Topics.tsx — investment-themes page: the hot-topics radar (LLM-clustered from
// recent news), a deep-dive trigger for listed or free-text themes, and the
// resulting reports with validated, ranked stock candidates.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listHotTopics,
  listTopicReports,
  runDeepDive,
  type TopicReportOut,
} from '../api/client'

/** One deep-dive report rendered with its ranked candidates. */
function Report({ report }: { report: TopicReportOut }) {
  return (
    <div className="rounded border border-slate-800 bg-slate-900 p-4">
      <div className="flex items-baseline gap-3">
        <h3 className="font-semibold">{report.topic_name}</h3>
        <span className="text-xs text-slate-500">
          {new Date(report.created_at).toLocaleString()}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-300">{report.summary}</p>
      <table className="mt-3 w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-700 text-slate-400">
            <th className="py-1">Symbol</th>
            <th>Name</th>
            <th className="text-right">Score</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {report.candidates.map((c) => (
            <tr key={c.symbol} className="border-b border-slate-800">
              <td className="py-1.5">
                <Link
                  to={`/stocks/${encodeURIComponent(c.symbol)}`}
                  className="font-mono text-emerald-300 hover:underline"
                >
                  {c.symbol}
                </Link>
              </td>
              <td>{c.name}</td>
              <td className="text-right">
                {c.combined_score != null ? c.combined_score.toFixed(1) : '—'}
              </td>
              <td className="text-slate-400">{c.rationale}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Topics page at /topics. */
export default function TopicsPage() {
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
        <h1 className="text-2xl font-bold">Topics</h1>
        <button
          onClick={() => refreshRadar.mutate()}
          disabled={refreshRadar.isPending}
          className="ml-auto rounded bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700 disabled:opacity-50"
        >
          {refreshRadar.isPending ? 'Scanning news…' : 'Refresh radar'}
        </button>
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">Hot now</h2>
        {topics.data && topics.data.length === 0 && (
          <p className="text-slate-400">
            No topics yet — refresh the radar after the sentiment pipeline has run.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {topics.data?.map((t) => (
            <button
              key={t.id}
              onClick={() => dive.mutate(t.name)}
              disabled={dive.isPending}
              title={t.summary}
              className="rounded-full border border-emerald-700 bg-emerald-950 px-3 py-1 text-sm text-emerald-300 hover:bg-emerald-900 disabled:opacity-50"
            >
              {t.name} · {(t.buzz_score * 100).toFixed(0)}
            </button>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-semibold">Deep dive</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (freeText.trim()) dive.mutate(freeText.trim())
          }}
          className="flex gap-2"
        >
          <input
            placeholder="Any theme, e.g. nuclear fusion"
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            className="w-72 rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={dive.isPending}
            className="rounded bg-emerald-600 px-4 py-1.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
          >
            {dive.isPending ? 'Diving… (this can take a minute)' : 'Deep dive'}
          </button>
        </form>
        {dive.error && (
          <p role="alert" className="mt-2 text-sm text-red-400">
            Deep dive failed — it needs the LLM configured (GROQ_API_KEY)
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Reports</h2>
        {reports.data && reports.data.length === 0 && (
          <p className="text-slate-400">No deep-dive reports yet.</p>
        )}
        <div className="space-y-4">
          {reports.data?.map((r) => <Report key={r.id} report={r} />)}
        </div>
      </section>
      <p className="mt-6 text-xs text-slate-600">Not financial advice.</p>
    </div>
  )
}
