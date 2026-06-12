// NotificationBell.tsx — nav-bar bell: unread count badge and a dropdown feed
// mirroring Telegram notifications; clicking an item marks it read.

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listNotifications, markNotificationRead } from '../api/client'

/** Bell button + dropdown notification feed. */
export default function NotificationBell() {
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
        aria-label="Notifications"
        onClick={() => setOpen(!open)}
        className="relative rounded bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700"
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 rounded-full bg-red-500 px-1.5 text-xs font-bold">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 max-h-96 w-96 overflow-y-auto rounded border border-slate-700 bg-slate-900 shadow-xl">
          {(notifications.data?.length ?? 0) === 0 && (
            <p className="p-3 text-sm text-slate-400">No notifications yet.</p>
          )}
          {notifications.data?.map((n) => (
            <button
              key={n.id}
              onClick={() => !n.read && markRead.mutate(n.id)}
              className={`block w-full border-b border-slate-800 p-3 text-left text-sm hover:bg-slate-800 ${
                n.read ? 'opacity-60' : ''
              }`}
            >
              <p className="font-semibold">{n.title}</p>
              {n.body && <p className="mt-1 whitespace-pre-line text-xs text-slate-400">{n.body}</p>}
              <p className="mt-1 text-xs text-slate-600">
                {new Date(n.created_at).toLocaleString()}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
