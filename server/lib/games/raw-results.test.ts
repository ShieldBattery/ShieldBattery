import { describe, expect, test } from 'vitest'
import {
  GameClientAllianceState,
  GameClientPlayerResult,
  GameClientResult,
  RawNetPlayer,
  RawPlayerResult,
  StoredRawGameResults,
} from '../../../common/games/results'
import { AssignedRaceChar } from '../../../common/races'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { deriveResultSubmission } from './raw-results'

const { Unallied, Allied, AlliedVictory } = GameClientAllianceState
const { Playing, Disconnected, Defeat, Victory } = GameClientResult

const REPORTER = makeSbUserId(1)

/** Builds an 8-length alliance table with the given per-slot overrides. */
function alliances(
  entries: Record<number, GameClientAllianceState> = {},
): GameClientAllianceState[] {
  const table = new Array<GameClientAllianceState>(8).fill(Unallied)
  for (const [slot, state] of Object.entries(entries)) {
    table[Number(slot)] = state
  }
  return table
}

function player(fields: {
  userId: number | null
  bwPlayerId: number
  stormId: number | null
  race: AssignedRaceChar
  victoryState: GameClientResult
  alliances: GameClientAllianceState[]
}): RawPlayerResult {
  return {
    userId: fields.userId === null ? null : makeSbUserId(fields.userId),
    bwPlayerId: fields.bwPlayerId,
    stormId: fields.stormId,
    race: fields.race,
    victoryState: fields.victoryState,
    alliances: fields.alliances,
  }
}

/**
 * Builds net-player rows for storm ids `0..count-1`, all connected (matching the Rust test helper
 * `make_standard_network_results` for the slots the players actually occupy), then applies overrides.
 */
function netPlayers(
  count: number,
  overrides: Record<number, Partial<Omit<RawNetPlayer, 'stormId'>>> = {},
): RawNetPlayer[] {
  const rows: RawNetPlayer[] = []
  for (let stormId = 0; stormId < count; stormId++) {
    rows.push({ stormId, hasQuit: false, wasDropped: false, ...overrides[stormId] })
  }
  return rows
}

function report(fields: {
  players: RawPlayerResult[]
  netPlayers: RawNetPlayer[]
  localPlayerLoseType?: StoredRawGameResults['localPlayerLoseType']
}): StoredRawGameResults {
  return {
    version: 2,
    time: 27270,
    players: fields.players,
    netPlayers: fields.netPlayers,
    localPlayerLoseType: fields.localPlayerLoseType ?? null,
  }
}

/** Converts a derived submission into a `{ userId: {result, race, apm} }` object for comparison. */
function verdicts(
  raw: StoredRawGameResults,
  reporter: SbUserId = REPORTER,
  opts: { isUms: boolean } = { isUms: false },
): Record<number, GameClientPlayerResult> {
  const derived = deriveResultSubmission(raw, reporter, opts)
  return Object.fromEntries(derived.playerResults.map(([id, r]) => [id, r]))
}

const R = (result: GameClientResult, race: AssignedRaceChar): GameClientPlayerResult => ({
  result,
  race,
  apm: 0,
})

describe('games/raw-results/deriveResultSubmission', () => {
  test('1v1 opponent leaves', () => {
    const raw = report({
      players: [
        {
          ...player({
            userId: 1,
            bwPlayerId: 1,
            stormId: 0,
            race: 'z',
            victoryState: Victory,
            alliances: alliances({ 1: Allied }),
          }),
        },
        {
          ...player({
            userId: 77,
            bwPlayerId: 0,
            stormId: 1,
            race: 'p',
            victoryState: Defeat,
            alliances: alliances({ 0: Allied }),
          }),
        },
      ],
      netPlayers: netPlayers(2, { 1: { hasQuit: true } }),
    })

    expect(verdicts(raw)).toEqual({ 1: R(Victory, 'z'), 77: R(Defeat, 'p') })
  })

  test('1v1 self leaves (both still Playing)', () => {
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 1,
          stormId: 0,
          race: 'z',
          victoryState: Playing,
          alliances: alliances({ 1: Allied }),
        }),
        player({
          userId: 77,
          bwPlayerId: 0,
          stormId: 1,
          race: 'p',
          victoryState: Playing,
          alliances: alliances({ 0: Allied }),
        }),
      ],
      netPlayers: netPlayers(2),
    })

    expect(verdicts(raw)).toEqual({ 1: R(Defeat, 'z'), 77: R(Playing, 'p') })
  })

  test('1v1 self all buildings killed', () => {
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 1,
          stormId: 0,
          race: 'z',
          victoryState: Defeat,
          alliances: alliances({ 1: Allied }),
        }),
        player({
          userId: 77,
          bwPlayerId: 0,
          stormId: 1,
          race: 'p',
          victoryState: Victory,
          alliances: alliances({ 0: Allied }),
        }),
      ],
      netPlayers: netPlayers(2),
    })

    expect(verdicts(raw)).toEqual({ 1: R(Defeat, 'z'), 77: R(Victory, 'p') })
  })

  test('1v1 opponent dropped', () => {
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 1,
          stormId: 0,
          race: 'z',
          victoryState: Victory,
          alliances: alliances({ 1: Allied }),
        }),
        player({
          userId: 77,
          bwPlayerId: 0,
          stormId: 1,
          race: 'p',
          victoryState: Disconnected,
          alliances: alliances({ 0: Allied }),
        }),
      ],
      netPlayers: netPlayers(2, { 1: { hasQuit: true, wasDropped: true } }),
      localPlayerLoseType: 'targetedDisconnect',
    })

    expect(verdicts(raw)).toEqual({ 1: R(Victory, 'z'), 77: R(Defeat, 'p') })
  })

  test('2v2 victory, ally left', () => {
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 0,
          stormId: 0,
          race: 'z',
          victoryState: Victory,
          alliances: alliances({ 0: AlliedVictory, 1: AlliedVictory }),
        }),
        player({
          userId: 77,
          bwPlayerId: 1,
          stormId: 1,
          race: 'p',
          victoryState: Defeat,
          alliances: alliances({ 0: AlliedVictory, 1: AlliedVictory }),
        }),
        player({
          userId: 78,
          bwPlayerId: 2,
          stormId: 2,
          race: 'p',
          victoryState: Defeat,
          alliances: alliances({ 2: AlliedVictory, 3: AlliedVictory }),
        }),
        player({
          userId: 79,
          bwPlayerId: 3,
          stormId: 3,
          race: 't',
          victoryState: Defeat,
          alliances: alliances({ 2: AlliedVictory, 3: AlliedVictory }),
        }),
      ],
      netPlayers: netPlayers(4, { 1: { hasQuit: true } }),
    })

    expect(verdicts(raw)).toEqual({
      1: R(Victory, 'z'),
      77: R(Victory, 'p'),
      78: R(Defeat, 'p'),
      79: R(Defeat, 't'),
    })
  })

  test('2v2 left with ally still playing', () => {
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 0,
          stormId: 0,
          race: 'z',
          victoryState: Playing,
          alliances: alliances({ 0: AlliedVictory, 1: AlliedVictory }),
        }),
        player({
          userId: 77,
          bwPlayerId: 1,
          stormId: 1,
          race: 'p',
          victoryState: Playing,
          alliances: alliances({ 0: AlliedVictory, 1: AlliedVictory }),
        }),
        player({
          userId: 78,
          bwPlayerId: 2,
          stormId: 2,
          race: 'p',
          victoryState: Playing,
          alliances: alliances({ 2: AlliedVictory, 3: AlliedVictory }),
        }),
        player({
          userId: 79,
          bwPlayerId: 3,
          stormId: 3,
          race: 't',
          victoryState: Playing,
          alliances: alliances({ 2: AlliedVictory, 3: AlliedVictory }),
        }),
      ],
      netPlayers: netPlayers(4),
    })

    expect(verdicts(raw)).toEqual({
      1: R(Disconnected, 'z'),
      77: R(Playing, 'p'),
      78: R(Playing, 'p'),
      79: R(Playing, 't'),
    })
  })

  test('2v2 loss', () => {
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 0,
          stormId: 0,
          race: 'z',
          victoryState: Playing,
          alliances: alliances({ 0: AlliedVictory, 1: AlliedVictory }),
        }),
        player({
          userId: 77,
          bwPlayerId: 1,
          stormId: 1,
          race: 'p',
          victoryState: Defeat,
          alliances: alliances({ 0: AlliedVictory, 1: AlliedVictory }),
        }),
        player({
          userId: 78,
          bwPlayerId: 2,
          stormId: 2,
          race: 'p',
          victoryState: Playing,
          alliances: alliances({ 2: AlliedVictory, 3: AlliedVictory }),
        }),
        player({
          userId: 79,
          bwPlayerId: 3,
          stormId: 3,
          race: 't',
          victoryState: Playing,
          alliances: alliances({ 2: AlliedVictory, 3: AlliedVictory }),
        }),
      ],
      netPlayers: netPlayers(4, { 1: { hasQuit: true } }),
    })

    expect(verdicts(raw)).toEqual({
      1: R(Defeat, 'z'),
      77: R(Defeat, 'p'),
      78: R(Playing, 'p'),
      79: R(Playing, 't'),
    })
  })

  test('2v2 non-symmetric allies', () => {
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 0,
          stormId: 0,
          race: 'z',
          victoryState: Playing,
          alliances: alliances({ 0: AlliedVictory, 1: AlliedVictory }),
        }),
        player({
          userId: 77,
          bwPlayerId: 1,
          stormId: 1,
          race: 'p',
          victoryState: Playing,
          alliances: alliances({ 1: Allied }),
        }),
        player({
          userId: 78,
          bwPlayerId: 2,
          stormId: 2,
          race: 'p',
          victoryState: Playing,
          alliances: alliances({ 2: AlliedVictory, 3: AlliedVictory }),
        }),
        player({
          userId: 79,
          bwPlayerId: 3,
          stormId: 3,
          race: 't',
          victoryState: Playing,
          alliances: alliances({ 2: AlliedVictory, 3: AlliedVictory }),
        }),
      ],
      netPlayers: netPlayers(4),
    })

    expect(verdicts(raw)).toEqual({
      1: R(Defeat, 'z'),
      77: R(Playing, 'p'),
      78: R(Playing, 'p'),
      79: R(Playing, 't'),
    })
  })

  test('2v2 self disconnect (mass disconnect restores others to Playing)', () => {
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 0,
          stormId: 0,
          race: 'z',
          victoryState: Victory,
          alliances: alliances({ 0: AlliedVictory, 1: AlliedVictory }),
        }),
        player({
          userId: 77,
          bwPlayerId: 1,
          stormId: 1,
          race: 'p',
          victoryState: Disconnected,
          alliances: alliances({ 0: AlliedVictory, 1: AlliedVictory }),
        }),
        player({
          userId: 78,
          bwPlayerId: 2,
          stormId: 2,
          race: 'p',
          victoryState: Disconnected,
          alliances: alliances({ 2: AlliedVictory, 3: AlliedVictory }),
        }),
        player({
          userId: 79,
          bwPlayerId: 3,
          stormId: 3,
          race: 't',
          victoryState: Disconnected,
          alliances: alliances({ 2: AlliedVictory, 3: AlliedVictory }),
        }),
      ],
      netPlayers: netPlayers(4, {
        1: { hasQuit: true, wasDropped: true },
        2: { hasQuit: true, wasDropped: true },
        3: { hasQuit: true, wasDropped: true },
      }),
      localPlayerLoseType: 'massDisconnect',
    })

    expect(verdicts(raw)).toEqual({
      1: R(Victory, 'z'),
      77: R(Playing, 'p'),
      78: R(Playing, 'p'),
      79: R(Playing, 't'),
    })
  })

  test('2v2 with a single dropped player (no mass disconnect)', () => {
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 0,
          stormId: 0,
          race: 'z',
          victoryState: Playing,
          alliances: alliances({ 0: AlliedVictory, 1: AlliedVictory }),
        }),
        player({
          userId: 77,
          bwPlayerId: 1,
          stormId: 1,
          race: 'p',
          victoryState: Disconnected,
          alliances: alliances({ 0: AlliedVictory, 1: AlliedVictory }),
        }),
        player({
          userId: 78,
          bwPlayerId: 2,
          stormId: 2,
          race: 'p',
          victoryState: Playing,
          alliances: alliances({ 2: AlliedVictory, 3: AlliedVictory }),
        }),
        player({
          userId: 79,
          bwPlayerId: 3,
          stormId: 3,
          race: 't',
          victoryState: Playing,
          alliances: alliances({ 2: AlliedVictory, 3: AlliedVictory }),
        }),
      ],
      netPlayers: netPlayers(4, { 1: { hasQuit: true, wasDropped: true } }),
    })

    expect(verdicts(raw)).toEqual({
      1: R(Defeat, 'z'),
      77: R(Disconnected, 'p'),
      78: R(Playing, 'p'),
      79: R(Playing, 't'),
    })
  })

  test('UMS game passes results through undigested', () => {
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 0,
          stormId: 0,
          race: 'z',
          victoryState: Playing,
          alliances: alliances({ 0: Allied }),
        }),
        player({
          userId: 77,
          bwPlayerId: 1,
          stormId: 1,
          race: 'p',
          victoryState: Defeat,
          alliances: alliances({ 1: AlliedVictory, 2: AlliedVictory }),
        }),
        player({
          userId: 78,
          bwPlayerId: 2,
          stormId: 2,
          race: 'p',
          victoryState: Playing,
          alliances: alliances({ 1: AlliedVictory, 2: AlliedVictory }),
        }),
      ],
      netPlayers: netPlayers(2, { 1: { hasQuit: true } }),
    })

    expect(verdicts(raw, REPORTER, { isUms: true })).toEqual({
      1: R(Playing, 'z'),
      77: R(Defeat, 'p'),
      78: R(Playing, 'p'),
    })
  })

  test('allied computers bring their human allies along to victory', () => {
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 0,
          stormId: 0,
          race: 'z',
          victoryState: Defeat,
          alliances: alliances({ 0: Allied }),
        }),
        player({
          userId: 78,
          bwPlayerId: 2,
          stormId: 1,
          race: 'p',
          victoryState: Defeat,
          alliances: alliances({ 1: AlliedVictory, 2: AlliedVictory, 3: AlliedVictory }),
        }),
        player({
          userId: 79,
          bwPlayerId: 3,
          stormId: 2,
          race: 't',
          victoryState: Defeat,
          alliances: alliances({ 1: AlliedVictory, 2: AlliedVictory, 3: AlliedVictory }),
        }),
        player({
          userId: null,
          bwPlayerId: 1,
          stormId: null,
          race: 'p',
          victoryState: Defeat,
          alliances: alliances({
            1: AlliedVictory,
            2: AlliedVictory,
            3: AlliedVictory,
            4: AlliedVictory,
          }),
        }),
        player({
          userId: null,
          bwPlayerId: 4,
          stormId: null,
          race: 'p',
          victoryState: Playing,
          alliances: alliances({ 1: AlliedVictory, 4: AlliedVictory }),
        }),
      ],
      netPlayers: netPlayers(3, { 1: { hasQuit: true }, 2: { hasQuit: true } }),
    })

    expect(verdicts(raw)).toEqual({
      1: R(Defeat, 'z'),
      78: R(Victory, 'p'),
      79: R(Victory, 't'),
    })
  })

  test('unallied computers left playing yield a local defeat', () => {
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 0,
          stormId: 0,
          race: 'z',
          victoryState: Playing,
          alliances: alliances({ 0: Allied }),
        }),
        player({
          userId: null,
          bwPlayerId: 1,
          stormId: null,
          race: 'p',
          victoryState: Playing,
          alliances: alliances({ 1: Allied }),
        }),
        player({
          userId: null,
          bwPlayerId: 2,
          stormId: null,
          race: 'p',
          victoryState: Playing,
          alliances: alliances({ 2: Allied }),
        }),
      ],
      netPlayers: netPlayers(1),
    })

    expect(verdicts(raw)).toEqual({ 1: R(Defeat, 'z') })
  })

  test('observer reporter (no own player row) applies no self-rules and derives normally', () => {
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 0,
          stormId: 0,
          race: 'z',
          victoryState: Victory,
          alliances: alliances({ 0: Allied }),
        }),
        player({
          userId: 2,
          bwPlayerId: 1,
          stormId: 1,
          race: 'p',
          victoryState: Defeat,
          alliances: alliances({ 1: Allied }),
        }),
      ],
      netPlayers: netPlayers(2),
    })

    // Reporter 99 is an observer that never appears in `players`.
    expect(verdicts(raw, makeSbUserId(99))).toEqual({ 1: R(Victory, 'z'), 2: R(Defeat, 'p') })
  })

  test('all humans dead with allied computers still playing: computers win, humans defeated', () => {
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 0,
          stormId: 0,
          race: 'z',
          victoryState: Disconnected,
          alliances: alliances({ 0: Allied }),
        }),
        player({
          userId: 2,
          bwPlayerId: 1,
          stormId: 1,
          race: 't',
          victoryState: Disconnected,
          alliances: alliances({ 1: Allied }),
        }),
        player({
          userId: null,
          bwPlayerId: 2,
          stormId: null,
          race: 'p',
          victoryState: Playing,
          alliances: alliances({ 2: AlliedVictory, 3: AlliedVictory }),
        }),
        player({
          userId: null,
          bwPlayerId: 3,
          stormId: null,
          race: 'z',
          victoryState: Playing,
          alliances: alliances({ 2: AlliedVictory, 3: AlliedVictory }),
        }),
      ],
      netPlayers: netPlayers(2, { 0: { hasQuit: true }, 1: { hasQuit: true } }),
    })

    expect(verdicts(raw)).toEqual({ 1: R(Defeat, 'z'), 2: R(Defeat, 't') })
  })

  test('adversarial duplicate bwPlayerId does not crash and still yields both humans', () => {
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 0,
          stormId: 0,
          race: 'z',
          victoryState: Victory,
          alliances: alliances({ 0: Allied }),
        }),
        player({
          userId: 2,
          bwPlayerId: 0,
          stormId: 1,
          race: 'p',
          victoryState: Defeat,
          alliances: alliances({ 0: Allied }),
        }),
      ],
      netPlayers: netPlayers(2),
    })

    const derived = deriveResultSubmission(raw, REPORTER, { isUms: false })
    expect(derived.reporter).toBe(REPORTER)
    const ids = derived.playerResults.map(([id]) => id)
    expect(ids).toContain(makeSbUserId(1))
    expect(ids).toContain(makeSbUserId(2))
  })

  test('round-trips through the stored raw shape (submit strips userId/resultCode)', () => {
    // Mirrors how `submitGameResults` stores a wire report: drop userId/resultCode, keep the rest.
    const wire = {
      version: 2 as const,
      userId: makeSbUserId(1),
      resultCode: 'secret',
      time: 5000,
      players: [
        player({
          userId: 1,
          bwPlayerId: 1,
          stormId: 0,
          race: 'z',
          victoryState: Victory,
          alliances: alliances({ 1: Allied }),
        }),
        player({
          userId: 77,
          bwPlayerId: 0,
          stormId: 1,
          race: 'p',
          victoryState: Defeat,
          alliances: alliances({ 0: Allied }),
        }),
      ],
      netPlayers: netPlayers(2, { 1: { hasQuit: true } }),
      localPlayerLoseType: null,
    }
    const stored: StoredRawGameResults = {
      version: 2,
      time: wire.time,
      players: wire.players,
      netPlayers: wire.netPlayers,
      localPlayerLoseType: wire.localPlayerLoseType,
    }

    const derived = deriveResultSubmission(stored, wire.userId, { isUms: false })
    expect(derived.time).toBe(5000)
    expect(Object.fromEntries(derived.playerResults)).toEqual({
      1: R(Victory, 'z'),
      77: R(Defeat, 'p'),
    })
  })
})
