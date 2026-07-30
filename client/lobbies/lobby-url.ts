import { lobbySlug, urlForLobby } from '../../common/lobbies/lobby-url'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { push } from '../navigation/routing'

export { lobbySlug, urlForLobby }

/** Navigates to a particular lobby. */
export function navigateToLobby(id: SbLobbyId, name?: string, transitionFn = push): void {
  transitionFn(urlForLobby(id, name))
}
