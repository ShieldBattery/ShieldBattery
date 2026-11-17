import { GameType } from '../../../common/games/game-type'
import { MapInfoKind } from '../../../common/maps'

/**
 * Returns the game type a lobby has once a map of `mapKind` is selected for it. A UMS-kind map is
 * made to be played with Use Map Settings, so selecting one switches to it; a melee-kind map plays
 * under any game type, so it leaves the current one alone.
 */
export function gameTypeForSelectedMap(currentGameType: GameType, mapKind: MapInfoKind): GameType {
  return mapKind === 'ums' ? GameType.UseMapSettings : currentGameType
}
