import { nanoid } from 'nanoid'
import { useEffect, useRef } from 'react'
import { useQuery } from 'urql'
import { NotificationType, StreamLiveNotification } from '../../common/notifications'
import { SbUserId } from '../../common/users/sb-user-id'
import { addLocalNotification } from '../notifications/action-creators'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { LIVE_USER_IDS_POLL_INTERVAL_MS, LiveUserIdsQuery } from './live-state'

/**
 * LocalStorage key (per user) for the "notify me when a friend goes live" preference. Read here and
 * toggled from the Social settings page. Defaults to enabled.
 */
export const FRIEND_LIVE_NOTIFICATIONS_KEY = 'friendLiveNotifications'

/**
 * A headless watcher that adds a notification when one of your friends starts live-streaming. Mount
 * it once (while logged in). It diffs the app-wide live-user set between polls and announces only
 * fresh transitions into "live" -- friends already live when it mounts (or when your friends list
 * finishes loading) are seeded silently, so you're only told about streams that start while you're
 * here. Announcements can be turned off per user via {@link FRIEND_LIVE_NOTIFICATIONS_KEY}.
 *
 * This component also drives the app-wide live-user poll: urql won't re-run a stably-mounted query
 * on its own, so we re-execute `LiveUserIdsQuery` on an interval. urql shares that operation, so the
 * refreshed set also flows to every `useLiveUserIds()` / avatar badge.
 */
export function FriendLiveNotifications() {
  const dispatch = useAppDispatch()
  const friends = useAppSelector(s => s.relationships.friends)
  const [notificationsEnabled] = useUserLocalStorageValue(FRIEND_LIVE_NOTIFICATIONS_KEY, true)
  const [{ data }, reexecuteQuery] = useQuery({
    query: LiveUserIdsQuery,
    context: { suspense: false },
  })
  const liveIds = data?.liveStreamUserIds

  useEffect(() => {
    const interval = setInterval(
      () => reexecuteQuery({ requestPolicy: 'cache-and-network' }),
      LIVE_USER_IDS_POLL_INTERVAL_MS,
    )
    return () => clearInterval(interval)
  }, [reexecuteQuery])

  // The previous set of live user ids, so we can announce only ids that newly appear. Keyed on the
  // raw live set (not the intersection with friends) so that the friends list loading in *after* the
  // first live snapshot doesn't retroactively announce friends who were already live.
  const prevLiveIdsRef = useRef<ReadonlySet<SbUserId> | undefined>(undefined)

  useEffect(() => {
    if (!liveIds) {
      // Query hasn't returned yet -- nothing to compare against.
      return
    }

    const current = new Set<SbUserId>(liveIds)
    const prev = prevLiveIdsRef.current
    prevLiveIdsRef.current = current

    if (prev === undefined) {
      // First loaded snapshot: seed it without announcing anyone already live.
      return
    }
    if (!notificationsEnabled) {
      return
    }

    for (const id of current) {
      if (prev.has(id)) {
        // Already live on the previous tick -- not a fresh transition.
        continue
      }
      if (!friends.has(id)) {
        continue
      }
      dispatch(
        addLocalNotification<StreamLiveNotification>({
          id: nanoid(),
          type: NotificationType.StreamLive,
          with: id,
        }),
      )
    }
  }, [liveIds, friends, notificationsEnabled, dispatch])

  return null
}
