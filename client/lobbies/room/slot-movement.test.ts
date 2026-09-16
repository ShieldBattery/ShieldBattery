import { describe, expect, test } from 'vitest'
import { GameType } from '../../../common/games/game-type'
import { Team } from '../../../common/lobbies'
import { Slot, SlotType } from '../../../common/lobbies/slot'
import { canMoveSlot } from './slot-movement'

function slot(type: SlotType, id: string = type): Slot {
  return {
    type,
    race: 'r',
    id,
    joinedAt: 0,
    hasForcedRace: false,
    playerId: 0,
    typeId: 0,
  }
}

function team(isObserver = false): Team {
  return {
    name: isObserver ? 'Observers' : 'Players',
    teamId: isObserver ? 1 : 0,
    isObserver,
    slots: [],
    hiddenSlots: [],
  }
}

const PLAYER_TEAM = team()
const OBSERVER_TEAM = team(true)

describe('client/lobbies/room/slot-movement', () => {
  test('rejects moves onto the source slot and from unoccupied or UMS-computer slots', () => {
    const human = slot(SlotType.Human, 'human')

    expect(canMoveSlot(GameType.Melee, PLAYER_TEAM, human, PLAYER_TEAM, human)).toBe(false)

    for (const sourceType of [
      SlotType.Open,
      SlotType.Closed,
      SlotType.ControlledOpen,
      SlotType.ControlledClosed,
      SlotType.UmsComputer,
    ]) {
      expect(
        canMoveSlot(
          GameType.Melee,
          PLAYER_TEAM,
          slot(sourceType),
          PLAYER_TEAM,
          slot(SlotType.Open, 'destination'),
        ),
      ).toBe(false)
    }
  })

  test('allows hosts to move people and computers onto ordinary closed seats', () => {
    expect(
      canMoveSlot(
        GameType.Melee,
        PLAYER_TEAM,
        slot(SlotType.Human, 'source'),
        PLAYER_TEAM,
        slot(SlotType.Closed, 'destination'),
      ),
    ).toBe(true)
    expect(
      canMoveSlot(
        GameType.Melee,
        PLAYER_TEAM,
        slot(SlotType.Computer, 'source'),
        PLAYER_TEAM,
        slot(SlotType.Closed, 'destination'),
      ),
    ).toBe(true)
  })

  test('allows UMS human swaps but preserves map-owned computer slots', () => {
    expect(
      canMoveSlot(
        GameType.UseMapSettings,
        PLAYER_TEAM,
        slot(SlotType.Human, 'source'),
        PLAYER_TEAM,
        slot(SlotType.Human, 'destination'),
      ),
    ).toBe(true)
    expect(
      canMoveSlot(
        GameType.UseMapSettings,
        PLAYER_TEAM,
        slot(SlotType.Human, 'source'),
        PLAYER_TEAM,
        slot(SlotType.UmsComputer, 'destination'),
      ),
    ).toBe(false)
  })

  test('keeps computers out of observer teams in both directions of a swap', () => {
    expect(
      canMoveSlot(
        GameType.Melee,
        PLAYER_TEAM,
        slot(SlotType.Computer, 'source'),
        OBSERVER_TEAM,
        slot(SlotType.Open, 'destination'),
      ),
    ).toBe(false)
    expect(
      canMoveSlot(
        GameType.Melee,
        OBSERVER_TEAM,
        slot(SlotType.Observer, 'source'),
        PLAYER_TEAM,
        slot(SlotType.Computer, 'destination'),
      ),
    ).toBe(false)
  })

  test.each([GameType.TeamMelee, GameType.TeamFreeForAll])(
    'only lets computers enter empty controlled teams in %s',
    gameType => {
      const computer = slot(SlotType.Computer, 'source')

      expect(
        canMoveSlot(gameType, PLAYER_TEAM, computer, PLAYER_TEAM, slot(SlotType.Open, 'open')),
      ).toBe(true)
      expect(
        canMoveSlot(gameType, PLAYER_TEAM, computer, PLAYER_TEAM, slot(SlotType.Closed, 'closed')),
      ).toBe(true)
      expect(
        canMoveSlot(
          gameType,
          PLAYER_TEAM,
          computer,
          PLAYER_TEAM,
          slot(SlotType.ControlledOpen, 'controlled-open'),
        ),
      ).toBe(false)
      expect(
        canMoveSlot(
          gameType,
          PLAYER_TEAM,
          computer,
          PLAYER_TEAM,
          slot(SlotType.ControlledClosed, 'controlled-closed'),
        ),
      ).toBe(false)
      expect(
        canMoveSlot(gameType, PLAYER_TEAM, computer, PLAYER_TEAM, slot(SlotType.Human, 'occupied')),
      ).toBe(false)
      expect(
        canMoveSlot(
          gameType,
          PLAYER_TEAM,
          slot(SlotType.Human, 'person'),
          PLAYER_TEAM,
          slot(SlotType.Computer, 'computer'),
        ),
      ).toBe(false)
    },
  )

  test('allows people to move into or swap controlled seats', () => {
    expect(
      canMoveSlot(
        GameType.TeamMelee,
        PLAYER_TEAM,
        slot(SlotType.Human, 'source'),
        PLAYER_TEAM,
        slot(SlotType.ControlledClosed, 'destination'),
      ),
    ).toBe(true)
    expect(
      canMoveSlot(
        GameType.TeamFreeForAll,
        PLAYER_TEAM,
        slot(SlotType.Observer, 'source'),
        PLAYER_TEAM,
        slot(SlotType.Human, 'destination'),
      ),
    ).toBe(true)
  })
})
