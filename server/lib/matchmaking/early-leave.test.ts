import { describe, expect, test } from 'vitest'
import { MS_PER_GAME_FRAME } from '../../../common/games/replay-timestamp'
import {
  GameClientResult,
  ReconciledResult,
  StoredGameResults,
} from '../../../common/games/results'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { EARLY_LEAVE_THRESHOLD_MS, EarlyLeavePlayer, findEarlyLeavers } from './early-leave'

const A1 = makeSbUserId(1)
const A2 = makeSbUserId(2)
const B1 = makeSbUserId(3)
const B2 = makeSbUserId(4)

const START = new Date('2026-11-01T12:00:00Z')
/** Wall-clock time the game takes to load before game time starts counting. */
const LOAD_MS = 20_000

function atGameTime(ms: number): Date {
  return new Date(Number(START) + LOAD_MS + ms)
}

/** A stored raw report in which `userId` sees themselves in `victoryState`. */
function report(userId: SbUserId, victoryState: GameClientResult): StoredGameResults {
  return {
    version: 2,
    time: 0,
    players: [
      {
        userId,
        bwPlayerId: 0,
        stormId: 0,
        race: 'p',
        victoryState,
        alliances: [0, 0, 0, 0, 0, 0, 0, 0],
      },
    ],
    netPlayers: [],
    localPlayerLoseType: null,
  }
}

/** A player who left the game while it was still going for them, at `ms` of game time. */
function quitter(userId: SbUserId, ms: number, result: ReconciledResult): EarlyLeavePlayer {
  return {
    userId,
    departureKind: 'left',
    departureTime: atGameTime(ms),
    relayReportFrame: Math.round(ms / MS_PER_GAME_FRAME),
    report: report(userId, GameClientResult.Playing),
    result,
  }
}

/** A player whose client dropped from the game, recorded at `ms` of game time. */
function dropped(userId: SbUserId, ms: number, result: ReconciledResult): EarlyLeavePlayer {
  return {
    userId,
    departureKind: 'dropped',
    departureTime: atGameTime(ms),
    relayReportFrame: null,
    report: null,
    result,
  }
}

/** A player who saw the game through, then left from the end-of-game screen at `ms`. */
function finisher(
  userId: SbUserId,
  ms: number,
  victoryState: GameClientResult.Victory | GameClientResult.Defeat,
): EarlyLeavePlayer {
  return {
    userId,
    departureKind: 'left',
    departureTime: atGameTime(ms + 3_000),
    relayReportFrame: Math.round(ms / MS_PER_GAME_FRAME),
    report: report(userId, victoryState),
    result: victoryState === GameClientResult.Victory ? 'win' : 'loss',
  }
}

/** A player who reported finishing and never had a departure recorded. */
function stayer(userId: SbUserId, result: 'win' | 'loss'): EarlyLeavePlayer {
  return {
    userId,
    departureKind: null,
    departureTime: null,
    relayReportFrame: null,
    report: report(userId, result === 'win' ? GameClientResult.Victory : GameClientResult.Defeat),
    result,
  }
}

const ONE_V_ONE = [[A1], [B1]]
const TWO_V_TWO = [
  [A1, A2],
  [B1, B2],
]

describe('matchmaking/early-leave', () => {
  test('penalizes a 1v1 quitter but not the winner who left the victory screen', () => {
    expect(
      findEarlyLeavers({
        teams: ONE_V_ONE,
        gameLengthMs: 30_100,
        gameStartTime: START,
        players: [quitter(A1, 30_000, 'loss'), finisher(B1, 30_100, GameClientResult.Victory)],
      }),
    ).toEqual([A1])
  })

  test('penalizes only the first of two 1v1 players who both abandon early', () => {
    expect(
      findEarlyLeavers({
        teams: ONE_V_ONE,
        gameLengthMs: 40_000,
        gameStartTime: START,
        players: [quitter(B1, 40_000, 'win'), quitter(A1, 30_000, 'loss')],
      }),
    ).toEqual([A1])
  })

  test('penalizes only the first abandoner on a team', () => {
    expect(
      findEarlyLeavers({
        teams: TWO_V_TWO,
        gameLengthMs: 60_000,
        gameStartTime: START,
        players: [
          quitter(A1, 20_000, 'loss'),
          quitter(A2, 50_000, 'loss'),
          finisher(B1, 60_000, GameClientResult.Victory),
          finisher(B2, 60_000, GameClientResult.Victory),
        ],
      }),
    ).toEqual([A1])
  })

  test('penalizes an early abandoner whose team went on to win', () => {
    expect(
      findEarlyLeavers({
        teams: TWO_V_TWO,
        gameLengthMs: 900_000,
        gameStartTime: START,
        players: [
          quitter(A1, 20_000, 'win'),
          stayer(A2, 'win'),
          finisher(B1, 900_000, GameClientResult.Defeat),
          finisher(B2, 900_000, GameClientResult.Defeat),
        ],
      }),
    ).toEqual([A1])
  })

  test('penalizes the first abandoner on each team while the game was contested', () => {
    expect(
      findEarlyLeavers({
        teams: TWO_V_TWO,
        gameLengthMs: 900_000,
        gameStartTime: START,
        players: [
          quitter(B1, 40_000, 'loss'),
          quitter(A1, 20_000, 'win'),
          stayer(A2, 'win'),
          finisher(B2, 900_000, GameClientResult.Defeat),
        ],
      }),
    ).toEqual([A1, B1])
  })

  test("doesn't penalize leaving a game whose opponents had all abandoned it", () => {
    expect(
      findEarlyLeavers({
        teams: TWO_V_TWO,
        gameLengthMs: 30_000,
        gameStartTime: START,
        players: [
          quitter(B1, 10_000, 'loss'),
          quitter(B2, 15_000, 'loss'),
          quitter(A1, 30_000, 'win'),
          stayer(A2, 'win'),
        ],
      }),
    ).toEqual([B1])
  })

  test('penalizes a 1v1 drop bounded by a short game length', () => {
    // The drop's wall-clock bound includes loading, so the game's length is the tighter bound, and
    // the winner's own frame-derived time lands just under it
    expect(
      findEarlyLeavers({
        teams: ONE_V_ONE,
        gameLengthMs: 30_000,
        gameStartTime: START,
        players: [dropped(A1, 29_000, 'loss'), finisher(B1, 29_958, GameClientResult.Victory)],
      }),
    ).toEqual([A1])
  })

  test('bounds a drop in a long team game by its wall-clock departure', () => {
    const players = (dropMs: number) => [
      dropped(A1, dropMs, 'loss'),
      stayer(A2, 'loss'),
      stayer(B1, 'win'),
      stayer(B2, 'win'),
    ]

    // The departure is recorded `LOAD_MS` after the game time it happened at
    expect(
      findEarlyLeavers({
        teams: TWO_V_TWO,
        gameLengthMs: 1_200_000,
        gameStartTime: START,
        players: players(EARLY_LEAVE_THRESHOLD_MS - LOAD_MS - 1),
      }),
    ).toEqual([A1])
    expect(
      findEarlyLeavers({
        teams: TWO_V_TWO,
        gameLengthMs: 1_200_000,
        gameStartTime: START,
        players: players(EARLY_LEAVE_THRESHOLD_MS - LOAD_MS),
      }),
    ).toEqual([])
  })

  test('penalizes leaving just under the threshold but not at it', () => {
    // A drop ends the game for a 1v1, so the game's length is when it happened
    const run = (gameLengthMs: number) =>
      findEarlyLeavers({
        teams: ONE_V_ONE,
        gameLengthMs,
        gameStartTime: START,
        players: [dropped(A1, gameLengthMs, 'loss'), stayer(B1, 'win')],
      })

    expect(run(EARLY_LEAVE_THRESHOLD_MS)).toEqual([])
    expect(run(EARLY_LEAVE_THRESHOLD_MS - 1)).toEqual([A1])
  })

  test('times a leave by the frame the relay recorded it at', () => {
    const run = (frame: number) =>
      findEarlyLeavers({
        teams: ONE_V_ONE,
        gameLengthMs: 900_000,
        gameStartTime: START,
        players: [{ ...quitter(A1, 0, 'loss'), relayReportFrame: frame }, stayer(B1, 'win')],
      })
    const lastFrameUnder = Math.ceil(EARLY_LEAVE_THRESHOLD_MS / MS_PER_GAME_FRAME) - 1

    expect(run(lastFrameUnder)).toEqual([A1])
    expect(run(lastFrameUnder + 1)).toEqual([])
  })

  test("doesn't penalize a player whose own report shows them eliminated", () => {
    expect(
      findEarlyLeavers({
        teams: ONE_V_ONE,
        gameLengthMs: 30_000,
        gameStartTime: START,
        players: [finisher(A1, 30_000, GameClientResult.Defeat), stayer(B1, 'win')],
      }),
    ).toEqual([])
  })

  test("doesn't penalize a player with a legacy report", () => {
    expect(
      findEarlyLeavers({
        teams: ONE_V_ONE,
        gameLengthMs: 30_000,
        gameStartTime: START,
        players: [
          {
            ...quitter(A1, 30_000, 'loss'),
            report: { time: 30_000, playerResults: [] },
          },
          stayer(B1, 'win'),
        ],
      }),
    ).toEqual([])
  })

  test("doesn't penalize a player without a win or loss", () => {
    for (const result of ['unknown', 'draw', null] as const) {
      expect(
        findEarlyLeavers({
          teams: ONE_V_ONE,
          gameLengthMs: 30_000,
          gameStartTime: START,
          players: [dropped(A1, 10_000, result as any), stayer(B1, 'win')],
        }),
      ).toEqual([])
    }
  })
})
