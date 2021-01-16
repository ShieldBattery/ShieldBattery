import { container } from 'tsyringe'
import { MATCHMAKING } from '../../../common/flags'
import MatchmakingStatus from './matchmaking-status'

let matchmakingStatus: MatchmakingStatus | null = null
if (MATCHMAKING) {
  matchmakingStatus = container.resolve(MatchmakingStatus)
}

export default matchmakingStatus
