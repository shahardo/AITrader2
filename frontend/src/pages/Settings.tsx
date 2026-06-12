// Settings.tsx — profile and platform settings: risk level / markets / strategy-
// switch mode, Telegram linking via one-time code, and the universe re-scan
// trigger (PRD "re-run the initial stocks scan").

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  checkTelegramLink,
  getLatestScan,
  getMe,
  startTelegramLink,
  triggerScan,
  updateMe,
} from '../api/client'

/** Settings page at /settings. */
export default function SettingsPage() {
  const queryClient = useQueryClient()
  const me = useQuery({ queryKey: ['me'], queryFn: getMe })
  const scan = useQuery({ queryKey: ['scan-latest'], queryFn: getLatestScan })
  const [linkCode, setLinkCode] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: updateMe,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
  })
  const startLink = useMutation({
    mutationFn: startTelegramLink,
    onSuccess: (r) => setLinkCode(r.code),
  })
  const checkLink = useMutation({
    mutationFn: checkTelegramLink,
    onSuccess: (r) => {
      if (r.linked) {
        setLinkCode(null)
        queryClient.invalidateQueries({ queryKey: ['me'] })
      }
    },
  })
  const rescan = useMutation({
    mutationFn: triggerScan,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scan-latest'] }),
  })

  if (!me.data) return <p className="p-6 text-slate-400">Loading…</p>

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="space-y-3 rounded border border-slate-800 bg-slate-900 p-4">
        <h2 className="font-semibold">Profile</h2>
        <label className="block text-sm">
          Risk level
          <select
            value={me.data.risk_level}
            onChange={(e) => save.mutate({ risk_level: e.target.value })}
            className="mt-1 block w-56 rounded border border-slate-700 bg-slate-800 px-2 py-1.5"
          >
            <option value="conservative">Conservative</option>
            <option value="balanced">Balanced</option>
            <option value="aggressive">Aggressive</option>
          </select>
        </label>
        <label className="block text-sm">
          Markets
          <select
            value={me.data.markets}
            onChange={(e) => save.mutate({ markets: e.target.value })}
            className="mt-1 block w-56 rounded border border-slate-700 bg-slate-800 px-2 py-1.5"
          >
            <option value="us">US only</option>
            <option value="tase">TASE only</option>
            <option value="both">US + TASE</option>
          </select>
        </label>
        <label className="block text-sm">
          Weekly strategy switches
          <select
            value={me.data.strategy_switch_mode}
            onChange={(e) => save.mutate({ strategy_switch_mode: e.target.value })}
            className="mt-1 block w-56 rounded border border-slate-700 bg-slate-800 px-2 py-1.5"
          >
            <option value="approve">Ask for my approval</option>
            <option value="auto">Apply automatically</option>
          </select>
        </label>
      </section>

      <section className="space-y-3 rounded border border-slate-800 bg-slate-900 p-4">
        <h2 className="font-semibold">Telegram notifications</h2>
        {me.data.telegram_linked ? (
          <p className="text-sm text-emerald-400">Linked ✓ — daily digests enabled.</p>
        ) : linkCode ? (
          <div className="text-sm">
            <p>
              Open the bot in Telegram and send:{' '}
              <code className="rounded bg-slate-800 px-2 py-0.5">/start {linkCode}</code>
            </p>
            <button
              onClick={() => checkLink.mutate()}
              disabled={checkLink.isPending}
              className="mt-2 rounded bg-slate-800 px-3 py-1 hover:bg-slate-700 disabled:opacity-50"
            >
              I sent it — check link
            </button>
            {checkLink.data && !checkLink.data.linked && (
              <p className="mt-1 text-amber-400">Not seen yet — try again in a few seconds.</p>
            )}
          </div>
        ) : (
          <button
            onClick={() => startLink.mutate()}
            disabled={startLink.isPending}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
          >
            Link Telegram
          </button>
        )}
      </section>

      <section className="space-y-3 rounded border border-slate-800 bg-slate-900 p-4">
        <h2 className="font-semibold">Universe scan</h2>
        <p className="text-sm text-slate-400">
          Re-runs the full scan: index constituents, discovery screeners, and price history
          for new names. Slow on free data — minutes, not seconds.
        </p>
        {scan.data && (
          <p className="text-sm text-slate-300">
            Last scan: {scan.data.status} · {JSON.stringify(scan.data.stats)}
          </p>
        )}
        <button
          onClick={() => rescan.mutate()}
          disabled={rescan.isPending}
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
        >
          {rescan.isPending ? 'Scanning…' : 'Re-run universe scan'}
        </button>
        {rescan.error && (
          <p role="alert" className="text-sm text-red-400">
            Scan failed — check API logs
          </p>
        )}
      </section>
    </div>
  )
}
