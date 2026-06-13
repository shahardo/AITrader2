// NotificationBell.tsx — nav-bar bell: unread count badge and a dropdown feed
// mirroring Telegram notifications; clicking an item marks it read.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { listNotifications, markNotificationRead } from '../api/client'

/** Bell button + dropdown notification feed. */
export default function NotificationBell() {
  const { t } = useTranslation('common')
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const notifications = useQuery({
    queryKey: ['notifications'],
    queryFn: listNotifications,
    refetchInterval: 60_000,
  })
  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })

  const unread = notifications.data?.filter((n) => !n.read).length ?? 0

  return (
    <div className="relative">
      <button
        aria-label={t('notifications.ariaLabel')}
        onClick={() => setOpen(!open)}
        className="relative rounded bg-panel-2 px-3 py-1 text-sm hover:bg-panel-3"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -end-1 -top-1 rounded-full bg-red-500 px-1.5 text-xs font-bold">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute end-0 z-10 mt-2 max-h-96 w-96 overflow-y-auto rounded border border-edge-2 bg-panel shadow-xl">
          {(notifications.data?.length ?? 0) === 0 && (
            <p className="p-3 text-sm text-ink-3">{t('notifications.empty')}</p>
          )}
          {notifications.data?.map((n) => (
            <button
              key={n.id}
              onClick={() => !n.read && markRead.mutate(n.id)}
              className={`block w-full border-b border-edge p-3 text-start text-sm hover:bg-panel-2 ${
                n.read ? 'opacity-60' : ''
              }`}
            >
              <p className="font-semibold">{n.title}</p>
              {n.body && <p className="mt-1 whitespace-pre-line text-xs text-ink-3">{n.body}</p>}
              <p className="mt-1 text-xs text-ink-5">
                {new Date(n.created_at).toLocaleString()}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
