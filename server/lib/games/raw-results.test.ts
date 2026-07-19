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
import type { StoredResultReport } from '../models/games-users'
import { computeCorroboratedVictors, deriveResultSubmission } from './raw-results'
import { reconcileResults, ResultSubmission } from './results'

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
  opts: { isUms?: boolean; corroboratedVictors?: ReadonlySet<SbUserId> } = {},
): Record<number, GameClientPlayerResult> {
  const derived = deriveResultSubmission(raw, reporter, { isUms: false, ...opts })
  return Object.fromEntries(derived.playerResults.map(([id, r]) => [id, r]))
}

/** Builds the set of corroborated self-victors from raw reports, matching the reconcile layer. */
function corroborated(
  reports: Array<[reporter: SbUserId, raw: StoredRawGameResults]>,
): Set<SbUserId> {
  const stored: StoredResultReport[] = reports.map(([reporter, raw]) => ({
    kind: 'raw',
    reporter,
    raw,
  }))
  return computeCorroboratedVictors(stored)
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

describe('games/raw-results/deriveResultSubmission — evidence-based veto/synthesis rules', () => {
  // Two players, S (survivor) and L (leaver), used across the exploit scenarios.
  const S = 10
  const L = 20

  /**
   * The survivor's capture in the one-way-ally exploit: L allied S one-directionally then quit, so
   * BW stamped the LEAVER (L) a Victory in S's state while S itself stayed Playing.
   */
  function survivorReport(): StoredRawGameResults {
    return report({
      players: [
        player({
          userId: S,
          bwPlayerId: 1,
          stormId: 0,
          race: 'z',
          victoryState: Playing,
          alliances: alliances(),
        }),
        player({
          userId: L,
          bwPlayerId: 0,
          stormId: 1,
          race: 'p',
          victoryState: Victory,
          alliances: alliances({ 1: AlliedVictory }),
        }),
      ],
      netPlayers: netPlayers(2, { 1: { hasQuit: true } }),
    })
  }

  /**
   * The leaver's own capture, taken at the moment L quit: BW never marks self as quit, and S hadn't
   * left yet, so both slots read Playing and connected.
   */
  function leaverReport(): StoredRawGameResults {
    return report({
      players: [
        player({
          userId: L,
          bwPlayerId: 0,
          stormId: 1,
          race: 'p',
          victoryState: Playing,
          alliances: alliances({ 1: AlliedVictory }),
        }),
        player({
          userId: S,
          bwPlayerId: 1,
          stormId: 0,
          race: 'z',
          victoryState: Playing,
          alliances: alliances(),
        }),
      ],
      netPlayers: netPlayers(2),
    })
  }

  test('ally-quit inversion: survivor report synthesizes the win, leaver report stays a loss', () => {
    const surv = survivorReport()
    const leaver = leaverReport()
    // L never claims self-Victory (its own row is Playing), so it isn't corroborated.
    const corroboratedVictors = corroborated([
      [makeSbUserId(S), surv],
      [makeSbUserId(L), leaver],
    ])
    expect(corroboratedVictors.size).toBe(0)

    // Deriving the survivor's report: L's phantom quit-victory is vetoed (Rule A), leaving no victor,
    // so Rule B synthesizes S's last-standing victory and the victory branch defeats L.
    expect(verdicts(surv, makeSbUserId(S), { corroboratedVictors })).toEqual({
      [S]: R(Victory, 'z'),
      [L]: R(Defeat, 'p'),
    })

    // Deriving the leaver's own report: nothing to veto (S isn't Victory) and Rule B can't fire
    // because S is still connected (two not-quit humans), so L takes the reporter defeat.
    expect(verdicts(leaver, makeSbUserId(L), { corroboratedVictors })).toEqual({
      [L]: R(Defeat, 'p'),
      [S]: R(Playing, 'z'),
    })
  })

  test('ally-quit inversion reconciles to survivor win / leaver loss, not disputed', () => {
    const surv = survivorReport()
    const leaver = leaverReport()
    const corroboratedVictors = corroborated([
      [makeSbUserId(S), surv],
      [makeSbUserId(L), leaver],
    ])

    const submissions: ResultSubmission[] = [
      deriveResultSubmission(surv, makeSbUserId(S), { isUms: false, corroboratedVictors }),
      deriveResultSubmission(leaver, makeSbUserId(L), { isUms: false, corroboratedVictors }),
    ]
    const reconciled = reconcileResults([makeSbUserId(S), makeSbUserId(L)], submissions, [
      [makeSbUserId(S)],
      [makeSbUserId(L)],
    ])

    expect(reconciled.disputed).toBe(false)
    expect(reconciled.results.get(makeSbUserId(S))?.result).toBe('win')
    expect(reconciled.results.get(makeSbUserId(L))?.result).toBe('loss')
  })

  test('legit winner-quits-after-victory: corroborated victory is not vetoed', () => {
    // Reporter is the loser; the winner (77) genuinely won, then quit (lingered off the victory
    // dialog). The winner's own report claims self-Victory, so it corroborates the quit-victory.
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 1,
          stormId: 0,
          race: 'z',
          victoryState: Defeat,
          alliances: alliances(),
        }),
        player({
          userId: 77,
          bwPlayerId: 0,
          stormId: 1,
          race: 'p',
          victoryState: Victory,
          alliances: alliances(),
        }),
      ],
      netPlayers: netPlayers(2, { 1: { hasQuit: true } }),
    })

    // With the winner corroborated, the victory stands unchanged (identical to the stage-1 verdicts).
    expect(verdicts(raw, REPORTER, { corroboratedVictors: new Set([makeSbUserId(77)]) })).toEqual({
      1: R(Defeat, 'z'),
      77: R(Victory, 'p'),
    })

    // Contrast: without corroboration the same quit-victory would be vetoed to a disconnect. Rule B
    // can't rescue it into a survivor win because the reporter was already eliminated (raw Defeat).
    expect(verdicts(raw, REPORTER)).toEqual({
      1: R(Defeat, 'z'),
      77: R(Disconnected, 'p'),
    })
  })

  test('crashed winner (no report): quit-victory downgrades, does not award the loser a win', () => {
    // The survivor here is the loser: they were eliminated (raw Defeat) and the real winner crashed
    // after winning, never reporting. Nothing corroborates the winner's quit-victory.
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 1,
          stormId: 0,
          race: 'z',
          victoryState: Defeat,
          alliances: alliances(),
        }),
        player({
          userId: 77,
          bwPlayerId: 0,
          stormId: 1,
          race: 'p',
          victoryState: Victory,
          alliances: alliances(),
        }),
      ],
      netPlayers: netPlayers(2, { 1: { hasQuit: true } }),
    })

    // Derivation strips the phantom victory to a disconnect; Rule B does not fire (reporter was
    // eliminated), so no one is handed a win from this single report.
    expect(verdicts(raw, REPORTER)).toEqual({
      1: R(Defeat, 'z'),
      77: R(Disconnected, 'p'),
    })

    // Reconciling with only the survivor's report degrades to unknown/disputed — crucially the loser
    // (reporter 1) is NOT credited a win.
    const submission = deriveResultSubmission(raw, REPORTER, { isUms: false })
    const reconciled = reconcileResults(
      [REPORTER, makeSbUserId(77)],
      [submission, null],
      [[REPORTER], [makeSbUserId(77)]],
    )
    expect(reconciled.disputed).toBe(true)
    expect(reconciled.results.get(REPORTER)?.result).not.toBe('win')
  })

  test('linger-gaming attempt: a lingering loser cannot synthesize a victory over a real winner', () => {
    // Reporter (1) is the real loser lingering on the connection, still reading Playing. The real
    // winner (77) left first with a corroborated native Victory.
    const raw = report({
      players: [
        player({
          userId: 1,
          bwPlayerId: 1,
          stormId: 0,
          race: 'z',
          victoryState: Playing,
          alliances: alliances(),
        }),
        player({
          userId: 77,
          bwPlayerId: 0,
          stormId: 1,
          race: 'p',
          victoryState: Victory,
          alliances: alliances(),
        }),
      ],
      netPlayers: netPlayers(2, { 1: { hasQuit: true } }),
    })

    // The winner's corroborated Victory survives Rule A, keeping a victor present, so Rule B is
    // blocked and the lingering loser takes the reporter defeat.
    expect(verdicts(raw, REPORTER, { corroboratedVictors: new Set([makeSbUserId(77)]) })).toEqual({
      1: R(Defeat, 'z'),
      77: R(Victory, 'p'),
    })
  })

  test('team regression: a cleanly-departed allied-victory teammate is still brought along', () => {
    // The teammate (77) left mid-game and reads Disconnected (not Victory) in the survivor's capture,
    // so Rule A never touches them; the victory-branch expansion brings them to the win.
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
})

describe('games/raw-results/computeCorroboratedVictors', () => {
  function rawSelf(reporter: number, victoryState: GameClientResult): StoredResultReport {
    return {
      kind: 'raw',
      reporter: makeSbUserId(reporter),
      raw: report({
        players: [
          player({
            userId: reporter,
            bwPlayerId: 0,
            stormId: 0,
            race: 'z',
            victoryState,
            alliances: alliances(),
          }),
          player({
            userId: 99,
            bwPlayerId: 1,
            stormId: 1,
            race: 'p',
            victoryState: Victory,
            alliances: alliances(),
          }),
        ],
        netPlayers: netPlayers(2),
      }),
    }
  }

  test('includes a raw self-victory claim', () => {
    expect(computeCorroboratedVictors([rawSelf(1, Victory)])).toEqual(new Set([makeSbUserId(1)]))
  })

  test('excludes a raw report whose own row is not a victory', () => {
    // Reporter 1 claims Playing for itself even though it claims 99 (someone else) is a victor.
    expect(computeCorroboratedVictors([rawSelf(1, Playing)])).toEqual(new Set())
  })

  test('includes a legacy self-victory claim and excludes a legacy non-victory', () => {
    const legacyVictor: StoredResultReport = {
      kind: 'legacy',
      reporter: makeSbUserId(2),
      time: 1000,
      playerResults: [
        [makeSbUserId(2), R(Victory, 'z')],
        [makeSbUserId(3), R(Defeat, 'p')],
      ],
    }
    const legacyLoser: StoredResultReport = {
      kind: 'legacy',
      reporter: makeSbUserId(3),
      time: 1000,
      playerResults: [
        [makeSbUserId(2), R(Victory, 'z')],
        [makeSbUserId(3), R(Defeat, 'p')],
      ],
    }
    expect(computeCorroboratedVictors([legacyVictor, legacyLoser, null])).toEqual(
      new Set([makeSbUserId(2)]),
    )
  })

  test('a player with no stored report is never corroborated', () => {
    expect(computeCorroboratedVictors([null, null])).toEqual(new Set())
  })
})
