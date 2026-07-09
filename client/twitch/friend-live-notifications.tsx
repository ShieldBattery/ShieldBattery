import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from 'urql'
import { SbUserId } from '../../common/users/sb-user-id'
import { useAppSelector } from '../redux-hooks'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { navigateToUserProfile } from '../users/action-creators'
import { LIVE_USER_IDS_POLL_INTERVAL_MS, LiveUserIdsQuery } from './live-state'

/**
 * A headless watcher that shows a snackbar when one of your friends starts live-streaming. Mount it
 * once (while logged in). It diffs the app-wide live-user set between polls, so it announces only
 * fresh transitions -- friends already live when it mounts are recorded silently.
 *
 * This component also drives the app-wide live-user poll: urql won't re-run a stably-mounted query
 * on its own, so we re-execute `LiveUserIdsQuery` on an interval. urql shares that operation, so the
 * refreshed set also flows to every `useLiveUserIds()` badge.
 */
export function FriendLiveNotifications() {
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()
  const friends = useAppSelector(s => s.relationships.friends)
  const usersById = useAppSelector(s => s.users.byId)
  const [{ data }, reexecuteQuery] = useQuery({ query: LiveUserIdsQuery })
  const liveIds = data?.liveStreamUserIds

  useEffect(() => {
    const interval = setInterval(
      () => reexecuteQuery({ requestPolicy: 'cache-and-network' }),
      LIVE_USER_IDS_POLL_INTERVAL_MS,
    )
    return () => clearInterval(interval)
  }, [reexecuteQuery])

  const prevLiveFriendsRef = useRef<ReadonlySet<SbUserId> | undefined>(undefined)

  useEffect(() => {
    if (!liveIds) {
      // Query hasn't returned yet -- nothing to compare against.
      return
    }

    const liveFriends = new Set<SbUserId>(liveIds.filter(id => friends.has(id)))
    const prev = prevLiveFriendsRef.current
    prevLiveFriendsRef.current = liveFriends

    if (prev === undefined) {
      // First loaded snapshot: seed it without announcing friends who were already live.
      return
    }

    for (const id of liveFriends) {
      if (prev.has(id)) {
        continue
      }
      const name = usersById.get(id)?.name
      if (!name) {
        continue
      }
      snackbarController.showSnackbar(
        t('twitch.live.friendLiveSnackbar', '{{user}} is now live on Twitch', { user: name }),
        DURATION_LONG,
        {
          action: {
            label: t('twitch.live.friendLiveWatch', 'Watch'),
            onClick: () => navigateToUserProfile(id, name),
          },
        },
      )
    }
  }, [liveIds, friends, usersById, snackbarController, t])

  return null
}
