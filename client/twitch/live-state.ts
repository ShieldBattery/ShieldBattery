import { createContext, useEffect, useMemo, useRef } from 'react'
import { useQuery, UseQueryExecute } from 'urql'
import { SbUserId } from '../../common/users/sb-user-id'
import { useIsDocumentVisible } from '../dom/document-visibility'
import { graphql } from '../gql'

export const LiveUserIdsQuery = graphql(/* GraphQL */ `
  query LiveUserIds {
    liveStreamUserIds
  }
`)

/**
 * How often the app-wide live-user set is refreshed. urql won't re-run a stably-mounted query on
 * its own, so the always-mounted `LiveUsersContext` provider re-executes the shared `LiveUserIds`
 * operation on this interval (via `useLiveUserIds({ poll: true })`); because urql shares that
 * operation across consumers, every `useLiveUserIds()` badge picks up the refreshed result too.
 */
export const LIVE_USER_IDS_POLL_INTERVAL_MS = 2 * 60 * 1000

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
 * Exactly one always-mounted caller (the `LiveUsersContext` provider) should pass `poll: true` to
 * drive the periodic refresh (see {@link LIVE_USER_IDS_POLL_INTERVAL_MS}); everywhere else this is
 * a passive reader whose `ttl` only upgrades a fresh mount to refetch if the shared result is
 * already stale.
 */
export function useLiveUserIds({ poll = false }: { poll?: boolean } = {}): ReadonlySet<SbUserId> {
  const [{ data }, reexecuteQuery] = useQuery({
    query: LiveUserIdsQuery,
    // Never suspend: this feeds ubiquitous, always-mounted consumers (every avatar, via the context
    // provider), where suspending on a first fetch would blank large parts of the app.
    context: { ttl: LIVE_USER_IDS_POLL_INTERVAL_MS, suspense: false },
  })
  useQueryPolling(reexecuteQuery, LIVE_USER_IDS_POLL_INTERVAL_MS, poll)
  return useMemo(() => new Set(data?.liveStreamUserIds ?? []), [data?.liveStreamUserIds])
}

/**
 * How often detail-level live-stream surfaces (the home/live-streams feeds and the profile
 * banner) are refreshed while mounted. Stream details (titles, viewer counts) change slowly, and
 * Twitch itself only updates viewer counts about once a minute, so there's little to gain from
 * polling faster than this.
 */
export const LIVE_STREAMS_POLL_INTERVAL_MS = 2 * 60 * 1000

/**
 * Re-executes an urql query on an interval while the caller is mounted. urql never re-runs a
 * stably-mounted query on its own (`context.ttl` only upgrades the request policy if the
 * operation happens to execute again), so surfaces that must stay fresh drive their own
 * re-execution with this. Pass `enabled: false` to turn the polling off without violating the
 * rules of hooks.
 *
 * Polling pauses while the document is hidden (minimized or fully occluded, e.g. by the game) --
 * nobody can see the results, so the requests would be pure waste. If the document was hidden for
 * longer than `intervalMs`, becoming visible again refreshes immediately to catch up.
 */
export function useQueryPolling(
  reexecuteQuery: UseQueryExecute,
  intervalMs: number,
  enabled = true,
) {
  const isVisible = useIsDocumentVisible()
  const lastRunRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    // Treat mount time as the last execution: the query fetches on mount anyway, so the first
    // interval tick (or a later return from hidden) is measured against that.
    lastRunRef.current ??= performance.now()
    if (!enabled || !isVisible) {
      return undefined
    }

    const run = () => {
      lastRunRef.current = performance.now()
      reexecuteQuery({ requestPolicy: 'cache-and-network' })
    }

    if (performance.now() - lastRunRef.current >= intervalMs) {
      run()
    }
    const interval = setInterval(run, intervalMs)
    return () => clearInterval(interval)
  }, [reexecuteQuery, intervalMs, enabled, isVisible])
}
