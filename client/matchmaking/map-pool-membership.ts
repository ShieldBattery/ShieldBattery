import { SbMapId } from '../../common/maps'
import { ALL_MATCHMAKING_TYPES, MatchmakingType } from '../../common/matchmaking'
import { useAppSelector } from '../redux-hooks'

/**
 * Returns the matchmaking types whose current map pool (as loaded into the store) contains
 * `mapId`, in canonical matchmaking type order.
 */
export function useCurrentMapPoolTypes(mapId: SbMapId): MatchmakingType[] {
  const mapPoolsByType = useAppSelector(s => s.mapPools.byType)
  return ALL_MATCHMAKING_TYPES.filter(type => mapPoolsByType.get(type)?.maps.includes(mapId))
}
