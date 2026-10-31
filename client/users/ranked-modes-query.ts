import { graphql } from '../gql'

/**
 * Which matchmaking modes a player has a ranked history in, and their record in each.
 *
 * Shared by the Stats and Matchups tabs rather than declared in each: both need the same
 * "modes this player has actually played" list, and one document means urql serves the second
 * tab from cache instead of asking again.
 */
export const UserRankedModesQuery = graphql(/* GraphQL */ `
  query UserRankedModes($userId: SbUserId!) {
    userRankedModes(userId: $userId) {
      matchmakingType
      totalGames
      wins
      losses
      rating
      delta
    }
  }
`)
