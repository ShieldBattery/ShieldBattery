import { SbUserId } from '../../../common/users/sb-user'

/**
 * Utility for checking if a user is currently in a party.
 *
 * This class mostly exists to solve a cyclical dependency between the Party service and
 * Matchmaking.
 */
export interface InPartyChecker {
  isInParty(userId: SbUserId): boolean
}

export const IN_PARTY_CHECKER = Symbol('InPartyChecker')
