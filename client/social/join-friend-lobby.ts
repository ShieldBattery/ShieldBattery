import { FriendActivityLobby, FriendActivityStatus } from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user-id'
import { isInLobby } from '../lobbies/lobby-reducer'
import { useJoinLobbyAction } from '../lobbies/use-join-lobby-action'
import { useIsNavigationAvailable } from '../navigation/navigation-available'
import { useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'

export interface JoinFriendLobby {
  /** The lobby the friend is in. */
  lobby: FriendActivityLobby
  /**
   * Joins the lobby. A failure (a full or closed lobby, say) is reported in a snackbar and nothing
   * navigates. The join and its failure report don't depend on the calling component staying
   * mounted, so it's safe to dismiss an overlay or menu in the same handler.
   */
  join: () => void
  /** Whether a join request is in flight, during which further joins should be disabled. */
  isPending: boolean
}

/**
 * Returns what's needed to join the lobby a friend is currently in, or `undefined` if there's
 * nothing to offer: the user isn't a friend, isn't in a lobby, or the viewer is already seated in
 * that very lobby, or the current screen doesn't allow navigating away (a join ends with a
 * navigation to the lobby).
 */
export function useJoinFriendLobby(userId: SbUserId): JoinFriendLobby | undefined {
  const status = useAppSelector(s => s.relationships.friendActivityStatus.get(userId))
  const lobby = useAppSelector(s => s.relationships.friendActivityLobby.get(userId))
  const isInSameLobby = useAppSelector(
    s =>
      isInLobby(s.lobby) && s.lobby.info.id === s.relationships.friendActivityLobby.get(userId)?.id,
  )
  const isNavigationAvailable = useIsNavigationAvailable()
  const snackbarController = useSnackbarController()
  const [joinLobby, isPending] = useJoinLobbyAction()

  if (
    !isNavigationAvailable ||
    status !== FriendActivityStatus.InLobby ||
    !lobby ||
    isInSameLobby
  ) {
    return undefined
  }

  return {
    lobby,
    isPending,
    join: () =>
      joinLobby(lobby.id, {
        name: lobby.name,
        onJoinFailed: message => snackbarController.showSnackbar(message),
      }),
  }
}
