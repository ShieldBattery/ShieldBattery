import { container } from 'tsyringe'
import MatchmakingStatus from './matchmaking-status'
import { MATCHMAKING } from '../../../common/flags'

let matchmakingStatus: MatchmakingStatus | null = null
if (MATCHMAKING) {
  matchmakingStatus = container.resolve(MatchmakingStatus)
}

export default matchmakingStatus
