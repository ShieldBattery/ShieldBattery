import { SetRequired } from 'type-fest'
import { MatchmakingEntity, MatchmakingQueueData } from './matchmaking-entity'

/**
 * A MatchmakingEntity that has had its matchmaking data filled out by the Matchmaker.
 */
export type QueuedMatchmakingEntity = SetRequired<MatchmakingEntity, keyof MatchmakingQueueData>
