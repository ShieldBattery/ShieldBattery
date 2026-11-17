import { TFunction } from 'i18next'
import { assertUnreachable } from '../../common/assert-unreachable'
import { SoloGameLaunchFailure, SoloGameServiceErrorCode } from '../../common/solo-games'
import { isFetchError } from '../network/fetch-errors'

/** The message for a solo game launch the server refused with `code`. */
export function soloGameServiceErrorMessage(code: SoloGameServiceErrorCode, t: TFunction): string {
  switch (code) {
    case SoloGameServiceErrorCode.NoActiveClient:
      return t(
        'soloGames.errors.noActiveClient',
        "Couldn't reach the server from the app. Check your connection and try again.",
      )
    case SoloGameServiceErrorCode.MapNotFound:
      return t('soloGames.errors.mapNotFound', 'This map could not be found.')
    case SoloGameServiceErrorCode.MapNotPlayableAlone:
      return t('soloGames.errors.mapNotPlayableAlone', "This map can't be played alone.")
    case SoloGameServiceErrorCode.InvalidSlot:
      return t(
        'soloGames.errors.invalidSlot',
        "That slot can't be played from. The map may have changed, so try opening it again.",
      )
    case SoloGameServiceErrorCode.InvalidRace:
      return t(
        'soloGames.errors.invalidRace',
        "The map doesn't let that slot pick its race. The map may have changed, so try opening " +
          'it again.',
      )
    case SoloGameServiceErrorCode.AlreadyInActivity:
      return t(
        'soloGames.errors.alreadyInActivity',
        "You're already in a lobby, searching for a match, or starting another game.",
      )
    case SoloGameServiceErrorCode.AlreadyInGame:
      return t('soloGames.errors.alreadyInGame', "You're already playing a game.")
    default:
      return assertUnreachable(code)
  }
}

/** The message for a solo game launch request that failed, whether the server refused it or not. */
export function soloGameRequestErrorMessage(err: unknown, t: TFunction): string {
  if (isFetchError(err)) {
    if (err.status === 429) {
      return t('soloGames.errors.throttled', 'Too many requests, try again in a moment.')
    }
    const code = err.code as SoloGameServiceErrorCode | undefined
    if (code && Object.values(SoloGameServiceErrorCode).includes(code)) {
      return soloGameServiceErrorMessage(code, t)
    }
  }

  return soloGameGenericErrorMessage(t)
}

/** The message for a solo game that began loading but didn't start. */
export function soloGameLaunchFailureMessage(reason: SoloGameLaunchFailure, t: TFunction): string {
  switch (reason) {
    case SoloGameLaunchFailure.Timeout:
      return t('soloGames.launchFailed.timeout', 'The game took too long to start.')
    case SoloGameLaunchFailure.ClientFailed:
      return t('soloGames.launchFailed.clientFailed', 'The game failed to load.')
    case SoloGameLaunchFailure.Internal:
      return t(
        'soloGames.launchFailed.internal',
        'Something went wrong on the server while starting the game.',
      )
    default:
      // The reason arrives over the socket, so a newer server can send one this client predates
      reason satisfies never
      return soloGameGenericErrorMessage(t)
  }
}

export function soloGameGenericErrorMessage(t: TFunction): string {
  return t('soloGames.errors.generic', "Couldn't start the game. Please try again.")
}
