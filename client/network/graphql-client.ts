import { Cache, cacheExchange, KeyingConfig, UpdatesConfig } from '@urql/exchange-graphcache'
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

// Publishing, unpublishing or deleting a post changes which lists it belongs to (home feed,
// archive, admin list). Those lists are cached under every argument combination they were
// queried with, so each variant is invalidated explicitly.
function invalidateNewsPostLists(cache: Cache) {
  for (const field of cache.inspectFields('Query')) {
    if (field.fieldName === 'newsPosts') {
      cache.invalidate('Query', field.fieldName, field.arguments ?? undefined)
    }
  }
}

/**
 * Query fields whose results depend on which files make up each map, or on which file each map
 * gives players: the catalog shows each map's current file, a map page id resolves through the
 * maps, and the reports and history are about them.
 */
const MAP_FAMILY_QUERY_FIELDS: ReadonlySet<string> = new Set([
  'maps',
  'mapFamily',
  'similarFiles',
  'mapFamilyReports',
  'mapFamilyReportCount',
  'mapFamilyHistory',
])

const MAP_FAMILY_REPORT_QUERY_FIELDS: ReadonlySet<string> = new Set([
  'mapFamilyReports',
  'mapFamilyReportCount',
  'mapFamilyHistory',
])

/** The current user's map listings, which show each favorite as its map's current file. */
const USER_MAP_LISTING_FIELDS: ReadonlySet<string> = new Set(['favoriteMaps', 'mapLibrary'])

/** Invalidates `fieldNames` of the root query under every argument combination they were cached with. */
function invalidateQueryFields(cache: Cache, fieldNames: ReadonlySet<string>) {
  for (const field of cache.inspectFields('Query')) {
    if (fieldNames.has(field.fieldName)) {
      cache.invalidate('Query', field.fieldName, field.arguments ?? undefined)
    }
  }
}

function invalidateUserMapListings(cache: Cache) {
  const userKey = cache.resolve('Query', 'currentUser')
  if (typeof userKey !== 'string') {
    return
  }
  for (const field of cache.inspectFields(userKey)) {
    if (USER_MAP_LISTING_FIELDS.has(field.fieldName)) {
      cache.invalidate(userKey, field.fieldName, field.arguments ?? undefined)
    }
  }
}

/**
 * Invalidates everything cached that a change to which files make up a map, or to which file a map
 * gives players, can affect. `familyIds` are maps whose files changed. `fileIds` are files that
 * changed maps without the mutation's result saying where to, so their map is stale too; files
 * that the result does place only have their favorite state invalidated, via `favoriteFileIds`.
 */
function invalidateMapFamilies(
  cache: Cache,
  {
    familyIds = [],
    fileIds = [],
    favoriteFileIds = [],
  }: { familyIds?: string[]; fileIds?: string[]; favoriteFileIds?: string[] } = {},
) {
  invalidateQueryFields(cache, MAP_FAMILY_QUERY_FIELDS)
  invalidateUserMapListings(cache)
  for (const id of fileIds) {
    cache.invalidate({ __typename: 'SbMap', id }, 'family')
  }
  // A favorite is of a map, so a file's favorite state follows the map it's in
  for (const id of [...fileIds, ...favoriteFileIds]) {
    cache.invalidate({ __typename: 'SbMap', id }, 'isFavorited')
    cache.invalidate({ __typename: 'SbMap', id }, 'favoriteCount')
  }
  for (const id of familyIds) {
    cache.invalidate({ __typename: 'MapFamily', id })
  }
}

/** The cached files of a map, read before a change moves them elsewhere. */
function cachedFamilyFileIds(cache: Cache, familyId: string): string[] {
  const files = cache.resolve({ __typename: 'MapFamily', id: familyId }, 'files')
  if (!Array.isArray(files)) {
    return []
  }
  return files.flatMap(key => {
    const id = typeof key === 'string' ? cache.resolve(key, 'id') : undefined
    return typeof id === 'string' ? [id] : []
  })
}

// TODO(tec27): Devise a way to split this between the different feature areas
const cacheUpdates: UpdatesConfig = {
  Mutation: {
    newsSetUrgentMessage: (result, _args, cache) => {
      if (result.newsSetUrgentMessage) {
        cache.invalidate('Query', 'urgentMessage')
      }
    },
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
    // A report removes the reported player's commend and report options for that game.
    reportGame: (_result, args, cache) => {
      cache.invalidate({ __typename: 'GameFeedback', id: (args.input as any).gameId })
    },
    newsUpdatePost: (_result, _args, cache) => invalidateNewsPostLists(cache),
    // A favorite is of a map, shown in the favorites listing as the map's current file. The
    // mutation's result carries the new state of each of the map's files.
    mapAddFavorite: (_result, _args, cache) => invalidateUserMapListings(cache),
    mapRemoveFavorite: (_result, _args, cache) => invalidateUserMapListings(cache),
    mapFamilySetDefault: (_result, _args, cache) => invalidateMapFamilies(cache),
    mapFamilyClearDefault: (_result, _args, cache) => invalidateMapFamilies(cache),
    mapFamilyMoveFile: (result, args, cache) => {
      const move = result.mapFamilyMoveFile as
        | { previousFamily?: { id: string } | null; family?: { id: string } }
        | undefined
      invalidateMapFamilies(cache, {
        familyIds: [move?.previousFamily?.id, move?.family?.id].filter((id): id is string => !!id),
        favoriteFileIds: [args.fileId as string],
      })
    },
    mapFamilySplitFile: (result, args, cache) => {
      const move = result.mapFamilySplitFile as
        | { previousFamily?: { id: string } | null }
        | undefined
      invalidateMapFamilies(cache, {
        familyIds: move?.previousFamily ? [move.previousFamily.id] : [],
        favoriteFileIds: [args.fileId as string],
      })
    },
    mapFamilyMerge: (_result, args, cache) => {
      const mergedId = args.familyId as string
      invalidateMapFamilies(cache, {
        familyIds: [mergedId, args.intoFamilyId as string],
        fileIds: cachedFamilyFileIds(cache, mergedId),
      })
    },
    mapFamilyReport: (_result, _args, cache) =>
      invalidateQueryFields(cache, MAP_FAMILY_REPORT_QUERY_FIELDS),
    mapFamilyReportSetStatus: (_result, _args, cache) =>
      invalidateQueryFields(cache, MAP_FAMILY_REPORT_QUERY_FIELDS),
    newsDeletePost: (result, args, cache) => {
      if (result.newsDeletePost) {
        cache.invalidate({ __typename: 'NewsPost', id: args.id as string })
        invalidateNewsPostLists(cache)
      }
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
  LeagueTranslation: NON_KEYED_EMBEDDED,
  MapForce: NON_KEYED_EMBEDDED,
  MapForcePlayer: NON_KEYED_EMBEDDED,
  MatchmakerConfigDefaults: NON_KEYED_EMBEDDED,
  NewsPostTranslation: NON_KEYED_EMBEDDED,
  MatchmakerConfigView: NON_KEYED_EMBEDDED,
  MatchmakerModeConfigOverrides: NON_KEYED_EMBEDDED,
  MatchmakerPerModeOverride: NON_KEYED_EMBEDDED,
  MatchmakingExtra1V1Data: NON_KEYED_EMBEDDED,
  MatchmakingExtra1V1FastestData: NON_KEYED_EMBEDDED,
  MatchmakingExtra2V2Data: NON_KEYED_EMBEDDED,
  // A one-shot payload carrying the OAuth URL to send the user to. It describes an action about to
  // happen rather than a thing that persists, so there is nothing to identify it by.
  TwitchLinkStart: NON_KEYED_EMBEDDED,
  // Rating history is a per-user, per-mode series: the points have no identity of their own
  // and the containers are only meaningful under the query that asked for them. Without
  // this the cache warns once per point, which is hundreds of warnings for one chart.
  RatingHistory: NON_KEYED_EMBEDDED,
  RatingHistoryPoint: NON_KEYED_EMBEDDED,
  UserRankedMode: NON_KEYED_EMBEDDED,
  UrgentMessageTranslation: NON_KEYED_EMBEDDED,
  ReconciledPlayerResultEntry: NON_KEYED_EMBEDDED,
  // Pieces of a game's commend/report state, only ever read through their (keyed) GameFeedback or
  // the mutation result that carries one.
  CommendPlayerPayload: NON_KEYED_EMBEDDED,
  GivenGameFeedback: NON_KEYED_EMBEDDED,
  RecentCommend: NON_KEYED_EMBEDDED,
}
