import { createContext, useEffect, useMemo } from 'react'
import { useQuery, UseQueryExecute } from 'urql'
import { SbUserId } from '../../common/users/sb-user-id'
import { graphql } from '../gql'

export const LiveUserIdsQuery = graphql(/* GraphQL */ `
  query LiveUserIds {
    liveStreamUserIds
  }
`)

/**
 * How often the app-wide live-user set is refreshed. urql won't re-run a stably-mounted query on
 * its own, so `FriendLiveNotifications` re-executes the shared `LiveUserIds` operation on this
 * interval; because urql shares that operation across consumers, every `useLiveUserIds()` badge
 * picks up the refreshed result too.
 */
export const LIVE_USER_IDS_POLL_INTERVAL_MS = 30 * 1000

/**
 * Context carrying the app-wide set of currently-live users, so shared components (notably
 * `ConnectedAvatar`) can badge "live" state everywhere without each one running its own query.
 * Provided near the app root from {@link useLiveUserIds}; defaults to an empty set when no provider
 * is present (e.g. isolated tests), so consumers degrade to "nobody is live" rather than requiring
 * the GraphQL client in context.
 */
export const LiveUsersContext = createContext<ReadonlySet<SbUserId>>(new Set())

/**
 * Returns the set of users who are currently live-streaming (any category). Backed by a single,
 * app-wide query (batched server-side) so any user list can badge "live" state without a per-user
 * lookup. Per-stream details are fetched lazily via `SbUser.liveStream` where a surface needs them.
 *
 * This is a passive reader: the periodic refresh is driven once by `FriendLiveNotifications` (see
 * {@link LIVE_USER_IDS_POLL_INTERVAL_MS}); the `ttl` here only upgrades a fresh mount to refetch if
 * the shared result is already stale.
 */
export function useLiveUserIds(): ReadonlySet<SbUserId> {
  const [{ data }] = useQuery({
    query: LiveUserIdsQuery,
    // Never suspend: this feeds ubiquitous, always-mounted consumers (every avatar, via the context
    // provider), where suspending on a first fetch would blank large parts of the app.
    context: { ttl: LIVE_USER_IDS_POLL_INTERVAL_MS, suspense: false },
  })
  return useMemo(() => new Set(data?.liveStreamUserIds ?? []), [data?.liveStreamUserIds])
}

/**
 * How often detail-level live-stream surfaces (the home/live-streams feeds and the profile
 * banner) are refreshed while mounted. Less frequent than the id-set poll: stream details
 * (titles, viewer counts) change slowly, and Twitch itself only updates viewer counts about
 * once a minute.
 */
export const LIVE_STREAMS_POLL_INTERVAL_MS = 60 * 1000

/**
 * Re-executes an urql query on an interval while the caller is mounted. urql never re-runs a
 * stably-mounted query on its own (`context.ttl` only upgrades the request policy if the
 * operation happens to execute again), so surfaces that must stay fresh drive their own
 * re-execution with this.
 */
export function useQueryPolling(reexecuteQuery: UseQueryExecute, intervalMs: number) {
  useEffect(() => {
    const interval = setInterval(
      () => reexecuteQuery({ requestPolicy: 'cache-and-network' }),
      intervalMs,
    )
    return () => clearInterval(interval)
  }, [reexecuteQuery, intervalMs])
}
