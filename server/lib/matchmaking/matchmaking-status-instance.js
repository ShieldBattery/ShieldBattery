import { MATCHMAKING } from '../../../common/flags'

let matchmakingStatus
if (MATCHMAKING) {
  const MatchmakingStatus = require('./matchmaking-status').default

  matchmakingStatus = new MatchmakingStatus()
}

export default matchmakingStatus
