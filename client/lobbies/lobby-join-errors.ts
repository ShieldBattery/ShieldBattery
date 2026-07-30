import { TFunction } from 'i18next'
import { InvokeError } from 'nydus-client'
import { LobbyJoinErrorCode } from '../../common/lobbies/lobby-network'

/**
 * Returns the user-facing message for a failed lobby join. Shared by every UI that dispatches
 * `joinLobby` so the same failure reads the same everywhere. Kept in its own module so eagerly
 * loaded callers (e.g. the lobby list) don't pull the code-split lobby view into their chunk.
 */
export function lobbyJoinErrorMessage(err: unknown, t: TFunction): string {
  const code = err instanceof InvokeError ? err.body?.code : undefined
  switch (code) {
    case LobbyJoinErrorCode.NoLongerOpen:
      return t('lobbies.summary.noLongerOpen', 'This lobby is no longer open.')
    case LobbyJoinErrorCode.Full:
      return t('lobbies.joinLobby.errorFull', 'This lobby is full.')
    case LobbyJoinErrorCode.Banned:
      return t('lobbies.joinLobby.errorBanned', "You've been banned from this lobby.")
    case LobbyJoinErrorCode.AlreadyStarted:
      return t('lobbies.state.started', 'This lobby has already started and cannot be joined.')
    case LobbyJoinErrorCode.AlreadyInActivity:
      return t(
        'lobbies.joinLobby.errorAlreadyInActivity',
        'You are already in a game, searching for a match, or in another lobby.',
      )
    default:
      return t(
        'lobbies.joinLobby.errorGeneric',
        'Something went wrong while joining the lobby. Please try again.',
      )
  }
}
