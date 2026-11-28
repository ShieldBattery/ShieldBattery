import { TFunction } from 'i18next'
import { useEffect } from 'react'
import { LobbyBestOfJson } from '../../../common/lobbies/lobby-best-of'
import { SbUserId } from '../../../common/users/sb-user-id'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { getBatchUserInfo } from '../../users/action-creators'

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

/** Names one side of a best-of series the way the room writes it everywhere: its players' names. */
export function useBestOfSideLabel(side: ReadonlyArray<SbUserId>): string {
  return useUserNames(side).join(', ')
}

/** Heads a best-of series wherever the room shows it, e.g. "Grand Final · Best of 3". */
export function bestOfLabel(
  bestOf: Pick<LobbyBestOfJson, 'title' | 'length'>,
  t: TFunction,
): string {
  return bestOf.title
    ? t('lobbies.room.bestOf.labelTitled', {
        defaultValue: '{{title}} · Best of {{length}}',
        title: bestOf.title,
        length: bestOf.length,
      })
    : t('lobbies.room.bestOf.label', {
        defaultValue: 'Series · Best of {{length}}',
        length: bestOf.length,
      })
}
