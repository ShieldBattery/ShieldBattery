import { TFunction } from 'i18next'
import { LobbyServiceErrorCode } from '../../common/lobbies/lobby-network'
import { isFetchError } from '../network/fetch-errors'

/**
 * Returns the user-facing message for a lobby action the server refused: readying up, rearranging
 * the seats, starting or calling off the countdown, the host's slot surgery, and running a best-of
 * series. Shared by every surface that dispatches one so the same refusal reads the same everywhere.
 *
 * These are the refusals normal use reaches, where the lobby moved on between the click and the
 * request landing, or where its layout can't support what was asked. Anything else is a bug or a
 * network failure and gets the generic message.
 */
export function lobbyActionErrorMessage(err: unknown, t: TFunction): string {
  if (!isFetchError(err)) {
    return genericMessage(t)
  }

  if (err.status === 429) {
    return t('lobbies.actionErrors.throttled', 'Too many requests, try again in a moment')
  }

  switch (err.code as LobbyServiceErrorCode | undefined) {
    case LobbyServiceErrorCode.NotEveryoneReady:
      return t('lobbies.actionErrors.notEveryoneReady', 'Not everyone is ready yet')
    case LobbyServiceErrorCode.MapNotDownloaded:
      return t('lobbies.actionErrors.mapNotDownloaded', 'Not everyone has the map yet')
    case LobbyServiceErrorCode.NotEnoughSides:
      return t(
        'lobbies.actionErrors.notEnoughSides',
        'The game needs players on at least two sides',
      )
    case LobbyServiceErrorCode.CountingDown:
      return t('lobbies.actionErrors.countingDown', 'The lobby is already counting down')
    case LobbyServiceErrorCode.GameInProgress:
      return t('lobbies.actionErrors.gameInProgress', 'The lobby is in a game right now')
    case LobbyServiceErrorCode.InvalidTeamLayout:
      return t(
        'lobbies.actionErrors.invalidTeamLayout',
        'The teams cannot be rearranged in this layout',
      )
    case LobbyServiceErrorCode.NotHost:
      return t('lobbies.actionErrors.notHost', 'Only the host can do that')
    case LobbyServiceErrorCode.InvalidSlotOperation:
      return t('lobbies.actionErrors.invalidSlotOperation', 'That seat cannot be changed right now')
    case LobbyServiceErrorCode.BestOfAlreadyRunning:
      return t('lobbies.actionErrors.bestOfAlreadyRunning', 'A series is already running')
    case LobbyServiceErrorCode.NoBestOfRunning:
      return t('lobbies.actionErrors.noBestOfRunning', 'No series is running')
    case LobbyServiceErrorCode.InvalidBestOf:
      return t(
        'lobbies.actionErrors.invalidBestOf',
        'The series needs an odd number of games and players who are in the lobby',
      )
    case LobbyServiceErrorCode.BestOfGamePending:
      return t(
        'lobbies.actionErrors.bestOfGamePending',
        "The series' last game doesn't have a result yet",
      )
    case LobbyServiceErrorCode.BestOfRosterMismatch:
      return t(
        'lobbies.actionErrors.bestOfRosterMismatch',
        "The seated players don't match the series' sides",
      )
    case LobbyServiceErrorCode.BestOfGameNotPending:
      return t(
        'lobbies.actionErrors.bestOfGameNotPending',
        'That game is no longer waiting for a result',
      )
    default:
      return genericMessage(t)
  }
}

function genericMessage(t: TFunction): string {
  return t('lobbies.actionErrors.generic', 'Something went wrong. Please try again.')
}
