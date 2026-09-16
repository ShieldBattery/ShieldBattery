import { GameType } from '../../../common/games/game-type'
import { hasControlledOpens, isSlotUnoccupied, Team } from '../../../common/lobbies'
import { Slot, SlotType } from '../../../common/lobbies/slot'

/**
 * Returns whether a host can move or swap the occupant of `fromSlot` into `destSlot`.
 *
 * This covers slot-operation legality only. Callers must separately ensure that the lobby is in a
 * state where it can be changed and that the current user is its host.
 */
export function canMoveSlot(
  gameType: GameType,
  fromTeam: Team,
  fromSlot: Slot,
  destTeam: Team,
  destSlot: Slot,
): boolean {
  if (fromSlot.id === destSlot.id) {
    return false
  }

  if (
    fromSlot.type !== SlotType.Human &&
    fromSlot.type !== SlotType.Observer &&
    fromSlot.type !== SlotType.Computer
  ) {
    return false
  }

  if (destSlot.type === SlotType.UmsComputer) {
    return false
  }

  if (
    (destTeam.isObserver && fromSlot.type === SlotType.Computer) ||
    (fromTeam.isObserver && destSlot.type === SlotType.Computer)
  ) {
    return false
  }

  if (
    hasControlledOpens(gameType) &&
    ((!isSlotUnoccupied(destSlot) && (!holdsPerson(fromSlot) || !holdsPerson(destSlot))) ||
      ((destSlot.type === SlotType.ControlledOpen || destSlot.type === SlotType.ControlledClosed) &&
        !holdsPerson(fromSlot)))
  ) {
    return false
  }

  return true
}

function holdsPerson(slot: Slot): boolean {
  return slot.type === SlotType.Human || slot.type === SlotType.Observer
}
