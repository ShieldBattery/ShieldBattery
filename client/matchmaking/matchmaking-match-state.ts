import { MapInfoJson } from '../../common/maps'
import { MatchmakingPlayer, MatchmakingType } from '../../common/matchmaking'

export interface MatchmakingMatch {
  numPlayers: number
  acceptedPlayers: number
  type: MatchmakingType
  players?: MatchmakingPlayer[]
  chosenMap?: MapInfoJson
}
