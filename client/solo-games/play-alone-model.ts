import { ReadonlyDeep } from 'type-fest'
import { isHiddenUmsSlot } from '../../common/lobbies'
import { MapForce, MapForcePlayerRace } from '../../common/maps'
import { RaceChar } from '../../common/races'
import { canPlayMapAlone } from '../../common/solo-games'
import { MapKind } from '../gql/graphql'

/** A human slot of a map that a person playing it alone can take. */
export interface PlayAloneSlot {
  /** The map player slot (the force player's `id`), which a launch request names. */
  id: number
  /** The position of the slot's force among the map's forces. */
  forceIndex: number
  forceName: string
  /** The slot's position among the human slots of its force. */
  indexInForce: number
  /** The race the map gives the slot, or `'any'` when it leaves the choice free. */
  race: MapForcePlayerRace
}

/** The map's human slots in force order, which is the order a lobby seats its players in. */
export function getPlayAloneSlots(forces: ReadonlyDeep<MapForce[]>): PlayAloneSlot[] {
  return forces.flatMap((force, forceIndex) =>
    force.players
      .filter(player => !player.computer)
      .map((player, indexInForce) => ({
        id: player.id,
        forceIndex,
        forceName: force.name,
        indexInForce,
        race: player.race,
      })),
  )
}

/**
 * The slot to play from: the one picked, if it's still one of `slots`, else the first, which is
 * also the slot the server plays from when the request names none.
 */
export function resolvePlayAloneSlot(
  slots: ReadonlyArray<PlayAloneSlot>,
  pickedId: number | undefined,
): PlayAloneSlot | undefined {
  return slots.find(slot => slot.id === pickedId) ?? slots[0]
}

/** The race the map gives whoever plays from `slot`, or `undefined` if it lets them pick one. */
export function slotFixedRace(slot: PlayAloneSlot): RaceChar | undefined {
  return slot.race === 'any' ? undefined : slot.race
}

/** How many computers play in one force of a map. */
export interface ComputerForceSummary {
  forceIndex: number
  forceName: string
  computers: number
}

/**
 * The computers each force of the map puts in the game, for the forces that have any. Slots the
 * map's triggers use without them appearing in a lobby (rescuable, neutral and the like) aren't
 * counted.
 */
export function getComputerSummary(forces: ReadonlyDeep<MapForce[]>): ComputerForceSummary[] {
  return forces
    .map((force, forceIndex) => ({
      forceIndex,
      forceName: force.name,
      computers: force.players.filter(player => player.computer && !isHiddenUmsSlot(player)).length,
    }))
    .filter(summary => summary.computers > 0)
}

/** A map file's forces as its GraphQL type gives them, as far as playing it alone goes. */
export interface GqlPlayAloneForce {
  readonly players: ReadonlyArray<{ readonly isComputer: boolean; readonly typeId: number }>
}

/** Whether a map file, as GraphQL describes it, can be played alone (see `canPlayMapAlone`). */
export function canPlayFileAlone(kind: MapKind, forces: ReadonlyArray<GqlPlayAloneForce>): boolean {
  return canPlayMapAlone(
    kind === MapKind.Ums ? 'ums' : 'melee',
    forces.map(force => ({
      players: force.players.map(p => ({ computer: p.isComputer, typeId: p.typeId })),
    })),
  )
}

/**
 * Whether playing alone is the main way to play a map file, rather than hosting a lobby with it:
 * only when the map has a single human slot, so there's no one a lobby could bring along.
 */
export function playAloneLeads(forces: ReadonlyArray<GqlPlayAloneForce>): boolean {
  return forces.flatMap(force => force.players).filter(p => !p.isComputer).length === 1
}
