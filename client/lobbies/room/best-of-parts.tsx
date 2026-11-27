import { TFunction } from 'i18next'
import { useEffect } from 'react'
import { LobbyBestOfJson } from '../../../common/lobbies/lobby-best-of'
import { SbUserId } from '../../../common/users/sb-user-id'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { getBatchUserInfo } from '../../users/action-creators'

/** Nobody, shared so a hook given it sees the same list on every render. */
const NO_USERS: ReadonlyArray<SbUserId> = Object.freeze([])

/**
 * Names the given users, in order. A best-of series can name people who have since left the lobby,
 * whom nothing else in the room has any reason to have loaded, so missing names are fetched on
 * demand and read as an ellipsis until they arrive.
 */
export function useUserNames(userIds: ReadonlyArray<SbUserId>): string[] {
  const dispatch = useAppDispatch()
  const usersById = useAppSelector(s => s.users.byId)

  useEffect(() => {
    for (const userId of userIds) {
      dispatch(getBatchUserInfo(userId))
    }
  }, [dispatch, userIds])

  return userIds.map(userId => usersById.get(userId)?.name ?? '…')
}

/**
 * Names one side of a best-of series the way the room writes it everywhere: by the side's name when
 * it has one, and otherwise by its members' account names.
 */
export function useBestOfSideLabel(members: ReadonlyArray<SbUserId>, name?: string): string {
  const names = useUserNames(name !== undefined ? NO_USERS : members)
  return name ?? names.join(', ')
}

/**
 * Returns the lobby's best-of series with the given id, as it stands now, if the lobby still has it.
 * Things written about a series earlier (such as the chat lines for its start and end) read its
 * current state through this, so they follow changes the host made since.
 */
export function useLobbyBestOf(bestOfId: string): LobbyBestOfJson | undefined {
  return useAppSelector(s => s.lobby.bestOfs.find(bestOf => bestOf.id === bestOfId))
}

/**
 * Words a best-of series' format the way the room writes it everywhere: "Best of 3" for a series
 * that ends once a side has a majority, or "4 games" for one played to its full length.
 */
export function bestOfFormatLabel(
  bestOf: Pick<LobbyBestOfJson, 'length' | 'playAll'>,
  t: TFunction,
): string {
  return bestOf.playAll
    ? t('lobbies.room.bestOf.formatPlayAll', {
        defaultValue_one: '{{count}} game',
        defaultValue_other: '{{count}} games',
        count: bestOf.length,
      })
    : t('lobbies.room.bestOf.formatBestOf', {
        defaultValue: 'Best of {{length}}',
        length: bestOf.length,
      })
}

/** Heads a best-of series wherever the room shows it, e.g. "Grand Final · Best of 3". */
export function bestOfLabel(
  bestOf: Pick<LobbyBestOfJson, 'title' | 'length' | 'playAll'>,
  t: TFunction,
): string {
  const seriesFormat = bestOfFormatLabel(bestOf, t)
  return bestOf.title
    ? t('lobbies.room.bestOf.formatLabelTitled', {
        defaultValue: '{{title}} · {{seriesFormat}}',
        title: bestOf.title,
        seriesFormat,
      })
    : t('lobbies.room.bestOf.formatLabel', {
        defaultValue: 'Series · {{seriesFormat}}',
        seriesFormat,
      })
}
