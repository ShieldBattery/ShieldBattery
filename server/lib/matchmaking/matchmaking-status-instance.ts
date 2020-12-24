import MatchmakingStatus from './matchmaking-status'
import { MATCHMAKING } from '../../../common/flags'

let matchmakingStatus: MatchmakingStatus | null = null
if (MATCHMAKING) {
  matchmakingStatus = new MatchmakingStatus()
}

export default matchmakingStatus
