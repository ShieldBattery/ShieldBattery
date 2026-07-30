import { useEffect } from 'react'
import { useRoute } from 'wouter'
import { lobbySlug, urlForLobby } from '../../common/lobbies/lobby-url'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { push, replace } from '../navigation/routing'

/** Navigates to a particular lobby. */
export function navigateToLobby(id: SbLobbyId, name?: string, transitionFn = push): void {
  transitionFn(urlForLobby(id, name))
}

/**
 * Replaces the current history entry with the canonical slugged lobby URL whenever the route's
 * slug segment doesn't match the lobby's name (e.g. a stale or hand-edited link). Both the lobby
 * view and the logged-out landing page must agree with `lobbySlug` here, or a wrong-slug URL
 * could redirect in a loop.
 */
export function useCorrectLobbySlug(lobbyId: SbLobbyId, lobbyName: string | undefined): void {
  const [match, routeParams] = useRoute('/lobbies/:lobbyId/:slugStr?')
  useEffect(() => {
    if (match && lobbyName && lobbySlug(lobbyName) !== routeParams?.slugStr) {
      replace(urlForLobby(lobbyId, lobbyName))
    }
  }, [match, lobbyName, lobbyId, routeParams?.slugStr])
}
