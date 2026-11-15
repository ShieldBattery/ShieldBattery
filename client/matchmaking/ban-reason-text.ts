import { TFunction } from 'i18next'
import { assertUnreachable } from '../../common/assert-unreachable'
import { MatchmakingBanReason } from '../../common/matchmaking'

/** The text telling a player they received a matchmaking warning, and why. */
export function matchmakingWarningText(t: TFunction, reason: MatchmakingBanReason): string {
  switch (reason) {
    case 'notReady':
      return t(
        'matchmaking.banReason.warningNotReady',
        "You received a matchmaking warning for not readying up for a match in time. If a match fails to start because of you again soon, you'll be temporarily banned from matchmaking.",
      )
    case 'left':
      return t(
        'matchmaking.banReason.warningLeft',
        "You received a matchmaking warning for leaving a match before it started. Losing your connection to ShieldBattery counts as leaving. If a match fails to start because of you again soon, you'll be temporarily banned from matchmaking.",
      )
    case 'failedToLoad':
      return t(
        'matchmaking.banReason.warningFailedToLoad',
        "You received a matchmaking warning because your game failed to load into a match. If a match fails to start because of you again soon, you'll be temporarily banned from matchmaking.",
      )
    default:
      return assertUnreachable(reason)
  }
}

/** The text telling a player they were temporarily banned from matchmaking, and why. */
export function matchmakingBanText(t: TFunction, reason: MatchmakingBanReason): string {
  switch (reason) {
    case 'notReady':
      return t(
        'matchmaking.banReason.banNotReady',
        "You've been temporarily banned from matchmaking for not readying up for a match in time.",
      )
    case 'left':
      return t(
        'matchmaking.banReason.banLeft',
        "You've been temporarily banned from matchmaking for leaving a match before it started. Losing your connection to ShieldBattery counts as leaving.",
      )
    case 'failedToLoad':
      return t(
        'matchmaking.banReason.banFailedToLoad',
        "You've been temporarily banned from matchmaking because your game failed to load into a match.",
      )
    default:
      return assertUnreachable(reason)
  }
}
