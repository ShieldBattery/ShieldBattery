import { MatchmakingInterval, MatchmakingPlayer } from './matchmaking-player'

/**
 * A MatchmakingPlayer that has had its matchmaking data filled out by the Matchmaker.
 */
export interface QueuedMatchmakingPlayer extends MatchmakingPlayer {
  startingInterval: MatchmakingInterval
  maxInterval: MatchmakingInterval
}
