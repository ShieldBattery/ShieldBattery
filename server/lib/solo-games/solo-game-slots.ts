import { GameConfigPlayer } from '../../../common/games/configuration'
import { PlayerInfo } from '../../../common/games/game-launch-config'
import { createUmsForceSlots } from '../../../common/lobbies'
import { createHuman, Slot, SlotType } from '../../../common/lobbies/slot'
import { MapInfo } from '../../../common/maps'
import { RaceChar } from '../../../common/races'
import { SoloGameServiceErrorCode } from '../../../common/solo-games'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { SoloGameServiceError } from './solo-game-service-error'

/** What a game one person plays alone on a UMS map is set up with. */
export interface SoloGameSlots {
  /** Every slot the game has, in the order and shape a lobby on the map would send them. */
  playerInfos: PlayerInfo[]
  /** The game config's teams: per force of the map, its human and computer players. */
  teams: GameConfigPlayer[][]
}

/**
 * Sets up the slots of a game that `userId` plays alone on a UMS map, exactly as a Use Map
 * Settings lobby on that map with only them in it would: they take one of the map's human slots,
 * every computer the map places plays, and the map's other human slots are left open.
 *
 * @param slot the map player slot (a force player's `id`) to play from. It has to be a human slot;
 *   defaults to the first one in force order, the slot a lobby seats its host in.
 * @param race the race to play. A slot whose race the map fixes only takes that race; a slot the
 *   map leaves free takes any, and defaults to random.
 *
 * @throws SoloGameServiceError if `slot` isn't one of the map's human slots, or `race` is one the
 *   slot can't have.
 */
export function buildSoloGameSlots({
  map,
  userId,
  slot,
  race,
}: {
  map: MapInfo
  userId: SbUserId
  slot?: number
  race?: RaceChar
}): SoloGameSlots {
  const forces = map.mapData.umsForces
  const humanPlayers = forces.flatMap(force => force.players).filter(p => !p.computer)
  const chosen =
    slot === undefined ? humanPlayers[0] : humanPlayers.find(player => player.id === slot)
  if (!chosen) {
    throw new SoloGameServiceError(
      SoloGameServiceErrorCode.InvalidSlot,
      'the map has no human slot to play from there',
    )
  }

  let chosenRace: RaceChar
  if (chosen.race === 'any') {
    chosenRace = race ?? 'r'
  } else if (race === undefined || race === chosen.race) {
    chosenRace = chosen.race
  } else {
    throw new SoloGameServiceError(
      SoloGameServiceErrorCode.InvalidRace,
      'the map fixes the race of that slot',
    )
  }

  const teams = forces.map(force => {
    const { slots, hiddenSlots } = createUmsForceSlots(force)
    return {
      teamId: force.teamId,
      slots: slots.map(s =>
        s.type === SlotType.Open && s.playerId === chosen.id
          ? createHuman(userId, chosenRace, s.hasForcedRace, s.playerId)
          : s,
      ),
      hiddenSlots,
    }
  })

  const toPlayerInfo = (s: Slot, teamId: number): PlayerInfo => ({
    id: s.id,
    userId: s.userId,
    race: s.race,
    playerId: s.playerId,
    type: s.type,
    typeId: s.typeId,
    teamId,
  })

  return {
    playerInfos: teams.flatMap(team =>
      team.slots.concat(team.hiddenSlots).map(s => toPlayerInfo(s, team.teamId)),
    ),
    // Open and hidden slots are left out, as a lobby's game config leaves them out
    teams: teams.map(team =>
      team.slots
        .filter(s => s.type === SlotType.Human || s.type === SlotType.UmsComputer)
        .map(s => ({
          id: s.userId ?? makeSbUserId(0),
          race: s.race,
          isComputer: s.type === SlotType.UmsComputer,
        })),
    ),
  }
}
