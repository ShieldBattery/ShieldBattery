import { TFunction } from 'i18next'
import { InviteToLobbyErrorCode } from '../../common/lobbies/lobby-network'
import { isFetchError } from '../network/fetch-errors'

/**
 * Returns the machine-readable code a failed lobby invite carried, or undefined for a failure the
 * server didn't classify (a network error, a bug, an unexpected status).
 */
export function lobbyInviteErrorCode(err: unknown): InviteToLobbyErrorCode | undefined {
  return isFetchError(err) ? (err.code as InviteToLobbyErrorCode | undefined) : undefined
}

/**
 * Returns the user-facing message for a failed lobby invite. Shared by every UI that dispatches
 * `inviteToLobby` so the same failure reads the same everywhere. Kept in its own module so eagerly
 * loaded callers don't pull the lobby view into their chunk.
 */
export function lobbyInviteErrorMessage(err: unknown, t: TFunction): string {
  switch (lobbyInviteErrorCode(err)) {
    case InviteToLobbyErrorCode.AlreadyInvited:
      return t(
        'lobbies.inviteToLobby.errorAlreadyInvited',
        'That user already has an invite to this lobby.',
      )
    case InviteToLobbyErrorCode.AlreadyInLobby:
      return t('lobbies.inviteToLobby.errorAlreadyInLobby', 'That user is already in this lobby.')
    case InviteToLobbyErrorCode.BannedFromLobby:
      return t(
        'lobbies.inviteToLobby.errorBannedFromLobby',
        'That user has been banned from this lobby.',
      )
    default:
      return t('lobbies.inviteToLobby.defaultError', 'Error inviting user to lobby')
  }
}
