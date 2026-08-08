import { TFunction } from 'i18next'
import { LobbyJoinErrorCode } from '../../common/lobbies/lobby-network'
import { isFetchError } from '../network/fetch-errors'

/**
 * Returns the machine-readable code a failed lobby join carried, or undefined for a failure the
 * server didn't classify (a network error, a bug, an unexpected status).
 */
export function lobbyJoinErrorCode(err: unknown): LobbyJoinErrorCode | undefined {
  return isFetchError(err) ? (err.code as LobbyJoinErrorCode | undefined) : undefined
}

/**
 * Returns the user-facing message for a failed lobby join. Shared by every UI that dispatches
 * `joinLobby` so the same failure reads the same everywhere. Kept in its own module so eagerly
 * loaded callers (e.g. the lobby list) don't pull the code-split lobby view into their chunk.
 */
export function lobbyJoinErrorMessage(err: unknown, t: TFunction): string {
  switch (lobbyJoinErrorCode(err)) {
    case LobbyJoinErrorCode.NoLongerOpen:
      return t('lobbies.summary.noLongerOpen', 'This lobby is no longer open.')
    case LobbyJoinErrorCode.Full:
      return t('lobbies.joinLobby.errorFull', 'This lobby is full.')
    case LobbyJoinErrorCode.ObserversFull:
      return t(
        'lobbies.joinLobby.errorObserversFull',
        'This lobby has no observer slots open. Try joining as a player instead.',
      )
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
