import { cacheExchange, KeyingConfig, UpdatesConfig } from '@urql/exchange-graphcache'
import { Client, fetchExchange } from 'urql'
import { ServerConfig } from '../../common/server-config'
import { SbUserId } from '../../common/users/sb-user-id'
import schema from '../gql/schema.json'
import { CREDENTIAL_STORAGE } from './fetch'
import { requestPolicyExchange } from './improved-request-policy-exchange'

export function createGraphqlClient(
  serverConfig: ServerConfig,
  // NOTE(tec27): We don't technically need this for this code, but it is implicitly depended on
  // because we want a cache per user, so we require this such that any `useMemo`/`useEffect` that
  // calls this will re-run
  currentUserId: SbUserId | undefined,
) {
  const url = new URL(serverConfig.graphqlOrigin)
  url.pathname = '/gql'

  return new Client({
    url: url.toString(),
    exchanges: [
      requestPolicyExchange({
        ttl: 60 * 1000,
        shouldUpgrade: operation => operation.context.requestPolicy !== 'cache-only',
      }),
      cacheExchange({ schema, updates: cacheUpdates, keys: cacheKeys }),
      fetchExchange,
    ],
    suspense: true,
    fetchOptions: () => {
      const jwt = CREDENTIAL_STORAGE.get()
      return jwt
        ? {
            headers: {
              Authorization: `Bearer ${jwt}`,
            },
          }
        : {}
    },
  })
}

// TODO(tec27): Devise a way to split this between the different feature areas
const cacheUpdates: UpdatesConfig = {
  Mutation: {
    userDeleteRestrictedName: (result, args, cache) => {
      if (result.userDeleteRestrictedName) {
        cache.invalidate({
          __typename: 'NameRestriction',
          id: args.id as any,
        })
      }
    },
    // Blocking/unblocking a stream changes both the live-streams feed and the admin blocked-streams
    // list, which are otherwise served cache-first for up to the request-policy TTL and would go
    // stale. Invalidating here refreshes every surface uniformly (home feed, `/live`, admin page).
    blockStream: (_result, _args, cache) => {
      cache.invalidate('Query', 'liveStreams')
      cache.invalidate('Query', 'blockedStreams')
    },
    unblockStream: (_result, _args, cache) => {
      cache.invalidate('Query', 'liveStreams')
      cache.invalidate('Query', 'blockedStreams')
    },
  },
}

const NON_KEYED_EMBEDDED = () => null

// TODO(tec27): Devise a way to split this between the different feature areas
const cacheKeys: KeyingConfig = {
  // NOTE(tec27): In general this should just be for disabling keying for types that are embedded,
  // prefer creating "real" `id` fields in the GraphQL API (e.g. for things with composite keys,
  // make a field that combines those fields into something unique)
  GameConfigDataLobby: NON_KEYED_EMBEDDED,
  GameConfigDataMatchmaking: NON_KEYED_EMBEDDED,
  GamePlayer: NON_KEYED_EMBEDDED,
  GameReportReplay: NON_KEYED_EMBEDDED,
  GameReportUserStats: NON_KEYED_EMBEDDED,
  MapForce: NON_KEYED_EMBEDDED,
  MapForcePlayer: NON_KEYED_EMBEDDED,
  MatchmakerConfigDefaults: NON_KEYED_EMBEDDED,
  MatchmakerConfigView: NON_KEYED_EMBEDDED,
  MatchmakerModeConfigOverrides: NON_KEYED_EMBEDDED,
  MatchmakerPerModeOverride: NON_KEYED_EMBEDDED,
  MatchmakingExtra1V1Data: NON_KEYED_EMBEDDED,
  MatchmakingExtra1V1FastestData: NON_KEYED_EMBEDDED,
  MatchmakingExtra2V2Data: NON_KEYED_EMBEDDED,
  ReconciledPlayerResultEntry: NON_KEYED_EMBEDDED,
}
