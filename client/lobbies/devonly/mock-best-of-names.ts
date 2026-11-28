import { BestOfDisplayName, LobbyBestOfJson } from '../../../common/lobbies/lobby-best-of'
import { SbUserId } from '../../../common/users/sb-user-id'
import { StartBestOfParams, UpdateBestOfParams } from '../action-creators'

/**
 * Applies the side names and display names of a start or save request to a mock series the way the
 * server does: a start replaces them all, a save keeps whatever it doesn't mention, an empty or
 * `null` name is none, and only people on a side keep a display name.
 */
export function applyMockBestOfNames(
  bestOf: LobbyBestOfJson,
  request: Pick<StartBestOfParams | UpdateBestOfParams, 'sideNames' | 'displayNames'>,
  kind: 'start' | 'update',
): LobbyBestOfJson {
  const { sideNames: _sideNames, displayNames: _displayNames, ...rest } = bestOf
  const result: LobbyBestOfJson = rest

  const requestedSideNames = request.sideNames?.map(name => name?.trim() || null) as
    | [string | null, string | null]
    | undefined
  const sideNames =
    kind === 'update' && requestedSideNames === undefined ? bestOf.sideNames : requestedSideNames
  if (sideNames && (sideNames[0] || sideNames[1])) {
    result.sideNames = sideNames
  }

  const names = new Map<SbUserId, string>(
    kind === 'update' ? (bestOf.displayNames ?? []).map(entry => [entry.userId, entry.name]) : [],
  )
  for (const { userId, name } of request.displayNames ?? []) {
    const trimmed = name?.trim()
    if (trimmed) {
      names.set(userId, trimmed)
    } else {
      names.delete(userId)
    }
  }
  const displayNames = bestOf.sides.flat().flatMap((userId): BestOfDisplayName[] => {
    const name = names.get(userId)
    return name ? [{ userId, name }] : []
  })
  if (displayNames.length) {
    result.displayNames = displayNames
  }

  return result
}
