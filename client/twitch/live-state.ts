import { useMemo } from 'react'
import { useQuery } from 'urql'
import { SbUserId } from '../../common/users/sb-user-id'
import { graphql } from '../gql'

const LiveUserIdsQuery = graphql(/* GraphQL */ `
  query LiveUserIds {
    liveStreamUserIds
  }
`)

/**
 * Returns the set of users who are currently live-streaming (any category). Backed by a single,
 * app-wide query (batched server-side) so any user list can badge "live" state without a per-user
 * lookup. Per-stream details are fetched lazily via `SbUser.liveStream` where a surface needs them.
 */
export function useLiveUserIds(): ReadonlySet<SbUserId> {
  const [{ data }] = useQuery({ query: LiveUserIdsQuery, context: { ttl: 30 * 1000 } })
  return useMemo(() => new Set(data?.liveStreamUserIds ?? []), [data?.liveStreamUserIds])
}

/** Whether a specific user is currently live-streaming (any category). */
export function useIsUserLive(userId: SbUserId): boolean {
  return useLiveUserIds().has(userId)
}
