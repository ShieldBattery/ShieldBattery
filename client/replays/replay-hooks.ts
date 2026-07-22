import { useEffect } from 'react'
import { ReadonlyDeep } from 'type-fest'
import { MapInfoJson } from '../../common/maps'
import { viewGame } from '../games/action-creators'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch, useAppSelector } from '../redux-hooks'

/** Game ids we've already tried to fetch this session, so unmount/remount cycles from the
 * virtualized list (and genuine 404s for games the server no longer knows) don't refetch.
 * Non-4xx failures (network blips, 5xx) are evicted on error so a later mount can retry them. */
const requestedGameIds = new Set<string>()

export function useSbGameMap(gameId: string | undefined): ReadonlyDeep<MapInfoJson> | undefined {
  const dispatch = useAppDispatch()
  const game = useAppSelector(s => (gameId ? s.games.byId.get(gameId) : undefined))
  const map = useAppSelector(s => (game?.mapId ? s.maps.byId.get(game.mapId) : undefined))

  useEffect(() => {
    if (!gameId || game || requestedGameIds.has(gameId)) return
    requestedGameIds.add(gameId)
    // Deliberately no abort on unmount: the response is tiny and caching it in the store is the
    // point. Errors fall back to the placeholder tile.
    dispatch(
      viewGame(gameId, {
        onSuccess: () => {},
        onError: err => {
          if (!isFetchError(err) || err.status < 400 || err.status >= 500) {
            requestedGameIds.delete(gameId)
          }
        },
      }),
    )
  }, [gameId, game, dispatch])

  return map
}
