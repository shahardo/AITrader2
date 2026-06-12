// Settings.tsx — profile and platform settings: risk level / markets / strategy-
// switch mode, Telegram linking via one-time code, and the universe re-scan
// trigger (PRD "re-run the initial stocks scan").

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation('settings')
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

  if (!me.data) return <p className="p-6 text-ink-3">{t('loading')}</p>

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>

      <section className="space-y-3 rounded border border-edge bg-panel p-4">
        <h2 className="font-semibold">{t('profile.heading')}</h2>
        <label className="block text-sm">
          {t('profile.riskLevel')}
          <select
            value={me.data.risk_level}
            onChange={(e) => save.mutate({ risk_level: e.target.value })}
            className="mt-1 block w-56 rounded border border-edge-2 bg-panel-2 px-2 py-1.5"
          >
            <option value="conservative">{t('profile.riskOptions.conservative')}</option>
            <option value="balanced">{t('profile.riskOptions.balanced')}</option>
            <option value="aggressive">{t('profile.riskOptions.aggressive')}</option>
          </select>
        </label>
        <label className="block text-sm">
          {t('profile.markets')}
          <select
            value={me.data.markets}
            onChange={(e) => save.mutate({ markets: e.target.value })}
            className="mt-1 block w-56 rounded border border-edge-2 bg-panel-2 px-2 py-1.5"
          >
            <option value="us">{t('profile.marketsOptions.us')}</option>
            <option value="tase">{t('profile.marketsOptions.tase')}</option>
            <option value="both">{t('profile.marketsOptions.both')}</option>
          </select>
        </label>
        <label className="block text-sm">
          {t('profile.strategySwitchMode')}
          <select
            value={me.data.strategy_switch_mode}
            onChange={(e) => save.mutate({ strategy_switch_mode: e.target.value })}
            className="mt-1 block w-56 rounded border border-edge-2 bg-panel-2 px-2 py-1.5"
          >
            <option value="approve">{t('profile.strategySwitchOptions.approve')}</option>
            <option value="auto">{t('profile.strategySwitchOptions.auto')}</option>
          </select>
        </label>
      </section>

      <section className="space-y-3 rounded border border-edge bg-panel p-4">
        <h2 className="font-semibold">{t('telegram.heading')}</h2>
        {me.data.telegram_linked ? (
          <p className="text-sm text-positive">{t('telegram.linked')}</p>
        ) : linkCode ? (
          <div className="text-sm">
            <p>
              {t('telegram.instructions')}{' '}
              <code className="rounded bg-panel-2 px-2 py-0.5">
                {t('telegram.command', { code: linkCode })}
              </code>
            </p>
            <button
              onClick={() => checkLink.mutate()}
              disabled={checkLink.isPending}
              className="mt-2 rounded bg-panel-2 px-3 py-1 hover:bg-panel-3 disabled:opacity-50"
            >
              {t('telegram.checkLink')}
            </button>
            {checkLink.data && !checkLink.data.linked && (
              <p className="mt-1 text-warning">{t('telegram.notSeenYet')}</p>
            )}
          </div>
        ) : (
          <button
            onClick={() => startLink.mutate()}
            disabled={startLink.isPending}
            className="rounded bg-accent-button px-3 py-1.5 text-sm font-semibold hover:bg-accent-button-hover disabled:opacity-50"
          >
            {t('telegram.linkTelegram')}
          </button>
        )}
      </section>

      <section className="space-y-3 rounded border border-edge bg-panel p-4">
        <h2 className="font-semibold">{t('scan.heading')}</h2>
        <p className="text-sm text-ink-3">{t('scan.description')}</p>
        {scan.data && (
          <p className="text-sm text-ink-2">
            {t('scan.lastScan', { status: scan.data.status, stats: JSON.stringify(scan.data.stats) })}
          </p>
        )}
        <button
          onClick={() => rescan.mutate()}
          disabled={rescan.isPending}
          className="rounded bg-accent-button px-3 py-1.5 text-sm font-semibold hover:bg-accent-button-hover disabled:opacity-50"
        >
          {rescan.isPending ? t('scan.scanning') : t('scan.rerun')}
        </button>
        {rescan.error && (
          <p role="alert" className="text-sm text-negative">
            {t('scan.error')}
          </p>
        )}
      </section>
    </div>
  )
}
