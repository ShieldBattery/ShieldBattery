/**
 * Pages within a game's results. The values for these match the path in the route as well.
 */
export enum ResultsSubPage {
  /**
   * A summary page, displaying an overview of the match, who was in it, and what their results
   * were.
   */
  Summary = 'summary',
  /**
   * A page displaying detailed statistics for the players during the match.
   */
  Stats = 'stats',
  /**
   * A page displaying the build orders of each player in the match.
   */
  BuildOrders = 'build-orders',
}
