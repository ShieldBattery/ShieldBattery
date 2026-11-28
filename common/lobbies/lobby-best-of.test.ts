import { describe, expect, test } from 'vitest'
import { GameType } from '../games/game-type'
import { makeSbUserId, SbUserId } from '../users/sb-user-id'
import { Lobby, Team } from './index'
import {
  checkBestOfRoster,
  findBestOfGameWinner,
  getBestOfGameNumber,
  getBestOfScore,
  getBestOfWinsNeeded,
  getRunningBestOf,
  isValidBestOfLength,
  LobbyBestOfGameJson,
  LobbyBestOfJson,
  suggestBestOfSides,
  toBestOfLaunchInfo,
  toBestOfOverlayJson,
} from './lobby-best-of'
import { makeSbLobbyId } from './sb-lobby-id'
import { createClosed, createComputer, createHuman, createObserver, createOpen, Slot } from './slot'

const ALICE = makeSbUserId(1)
const BOB = makeSbUserId(2)
const CARA = makeSbUserId(3)
const DAN = makeSbUserId(4)
const ERIN = makeSbUserId(5)

function team(teamId: number, slots: Slot[], isObserver = false): Team {
  return { name: `Team ${teamId}`, teamId, isObserver, slots, hiddenSlots: [] }
}

/** A lobby with just the given teams; nothing else about it matters to these helpers. */
function lobbyWith(teams: Team[], gameType = GameType.TopVsBottom): Lobby {
  return {
    id: makeSbLobbyId('lobby'),
    name: 'Lobby',
    mapQueue: [],
    gameType,
    gameSubType: 0,
    teams,
    bench: [],
    host: teams[0].slots[0],
    useLegacyLimits: false,
    starcraftCompatibleReplays: false,
    lockedAlliances: false,
    visibility: 'listed',
    createdAt: 0,
  }
}

function bestOf(
  games: LobbyBestOfGameJson[],
  extra: Partial<LobbyBestOfJson> = {},
): LobbyBestOfJson {
  return { id: '1', length: 3, sides: [[ALICE], [BOB]], games, ...extra }
}

const won = (winner: 0 | 1, gameId = 'game'): LobbyBestOfGameJson => ({
  gameId,
  status: 'won',
  winner,
})

describe('lobbies/lobby-best-of', () => {
  test('isValidBestOfLength accepts odd lengths up to the maximum', () => {
    expect(isValidBestOfLength(1)).toBe(true)
    expect(isValidBestOfLength(3)).toBe(true)
    expect(isValidBestOfLength(99)).toBe(true)

    expect(isValidBestOfLength(0)).toBe(false)
    expect(isValidBestOfLength(2)).toBe(false)
    expect(isValidBestOfLength(101)).toBe(false)
    expect(isValidBestOfLength(-1)).toBe(false)
    expect(isValidBestOfLength(3.5)).toBe(false)
    expect(isValidBestOfLength(NaN)).toBe(false)
  })

  test('getBestOfWinsNeeded is a majority of the games', () => {
    expect(getBestOfWinsNeeded(1)).toBe(1)
    expect(getBestOfWinsNeeded(3)).toBe(2)
    expect(getBestOfWinsNeeded(5)).toBe(3)
    expect(getBestOfWinsNeeded(99)).toBe(50)
  })

  test('getBestOfScore counts only won games, per side', () => {
    const score = getBestOfScore(
      bestOf([
        won(0, 'a'),
        { gameId: 'b', status: 'noWinner' },
        won(1, 'c'),
        { gameId: 'd', status: 'notCounted' },
        won(0, 'e'),
        { gameId: 'f', status: 'pending' },
      ]),
    )

    expect(score).toEqual([2, 1])
  })

  test('getBestOfGameNumber numbers games by the wins before them', () => {
    const series = bestOf([
      won(0, 'a'),
      { gameId: 'b', status: 'noWinner' },
      { gameId: 'c', status: 'notCounted' },
      won(1, 'd'),
    ])

    expect(getBestOfGameNumber(series, 0)).toBe(1)
    expect(getBestOfGameNumber(series, 1)).toBe(2)
    // Games that didn't count are replayed under the same number
    expect(getBestOfGameNumber(series, 2)).toBe(2)
    expect(getBestOfGameNumber(series, 3)).toBe(2)
    // The next game
    expect(getBestOfGameNumber(series, 4)).toBe(3)
    expect(getBestOfGameNumber(bestOf([]), 0)).toBe(1)
  })

  describe('findBestOfGameWinner', () => {
    const sides: [SbUserId[], SbUserId[]] = [
      [ALICE, BOB],
      [CARA, DAN],
    ]

    test('names the side one of whose players won', () => {
      expect(
        findBestOfGameWinner(sides, [
          { userId: ALICE, result: 'loss' },
          { userId: BOB, result: 'win' },
          { userId: CARA, result: 'loss' },
          { userId: DAN, result: 'loss' },
        ]),
      ).toBe(0)
      expect(
        findBestOfGameWinner(sides, [
          { userId: ALICE, result: 'loss' },
          { userId: DAN, result: 'win' },
        ]),
      ).toBe(1)
    })

    test('has no winner when nobody on either side won', () => {
      expect(
        findBestOfGameWinner(sides, [
          { userId: ALICE, result: 'loss' },
          { userId: CARA, result: 'draw' },
          // Someone on neither side winning makes no difference
          { userId: ERIN, result: 'win' },
        ]),
      ).toBeUndefined()
      expect(findBestOfGameWinner(sides, [])).toBeUndefined()
    })

    test('has no winner when both sides have a win', () => {
      expect(
        findBestOfGameWinner(sides, [
          { userId: ALICE, result: 'win' },
          { userId: CARA, result: 'win' },
        ]),
      ).toBeUndefined()
    })
  })

  describe('checkBestOfRoster', () => {
    test('accepts the two sides seated on two teams', () => {
      const lobby = lobbyWith([
        team(1, [createHuman(ALICE), createHuman(BOB), createOpen()]),
        team(2, [createHuman(CARA), createComputer(), createClosed()]),
      ])

      expect(checkBestOfRoster(lobby, [[ALICE, BOB], [CARA]])).toEqual({ ok: true })
      // Which team holds which side doesn't matter
      expect(checkBestOfRoster(lobby, [[CARA], [BOB, ALICE]])).toEqual({ ok: true })
    })

    test('reports side members not seated as players, observers included', () => {
      const lobby = lobbyWith([
        team(1, [createHuman(ALICE)]),
        team(2, [createHuman(BOB), createOpen()]),
        team(3, [createObserver(CARA)], true),
      ])

      expect(checkBestOfRoster(lobby, [[ALICE], [BOB, CARA, DAN]])).toEqual({
        ok: false,
        missing: [CARA, DAN],
        extra: [],
        mixedTeams: false,
      })
    })

    test('reports seated players on neither side, but not observers', () => {
      const lobby = lobbyWith([
        team(1, [createHuman(ALICE), createHuman(DAN)]),
        team(2, [createHuman(BOB)]),
        team(3, [createObserver(CARA)], true),
      ])

      expect(checkBestOfRoster(lobby, [[ALICE], [BOB]])).toEqual({
        ok: false,
        missing: [],
        extra: [DAN],
        mixedTeams: false,
      })
    })

    test('reports a team holding players of both sides', () => {
      const lobby = lobbyWith([
        team(1, [createHuman(ALICE), createHuman(CARA)]),
        team(2, [createHuman(BOB), createHuman(DAN)]),
      ])

      expect(
        checkBestOfRoster(lobby, [
          [ALICE, BOB],
          [CARA, DAN],
        ]),
      ).toEqual({ ok: false, missing: [], extra: [], mixedTeams: true })
    })

    test('accepts any arrangement when everyone sits on a single team', () => {
      const lobby = lobbyWith(
        [team(0, [createHuman(ALICE), createHuman(BOB), createHuman(CARA), createComputer()])],
        GameType.Melee,
      )

      expect(checkBestOfRoster(lobby, [[ALICE, CARA], [BOB]])).toEqual({ ok: true })
    })

    test('ignores teams holding only computers when deciding whether teams mix', () => {
      const lobby = lobbyWith([
        team(1, [createHuman(ALICE), createHuman(BOB)]),
        team(2, [createComputer(), createOpen()]),
      ])

      expect(checkBestOfRoster(lobby, [[ALICE], [BOB]])).toEqual({ ok: true })
    })
  })

  test('getRunningBestOf returns the last one only while it has no outcome', () => {
    const ended = bestOf([won(0), won(0)], { id: '1', outcome: { kind: 'won', winner: 0 } })
    const running = bestOf([], { id: '2' })

    expect(getRunningBestOf([])).toBeUndefined()
    expect(getRunningBestOf([ended])).toBeUndefined()
    expect(getRunningBestOf([ended, running])).toBe(running)
    expect(
      getRunningBestOf([ended, { ...running, outcome: { kind: 'unfinished' } }]),
    ).toBeUndefined()
  })

  test('toBestOfLaunchInfo describes the next game with the score so far', () => {
    const series = bestOf([won(1, 'a'), { gameId: 'b', status: 'noWinner' }, won(1, 'c')], {
      title: 'Grand final',
      length: 5,
      sides: [[ALICE, BOB], [CARA]],
    })

    expect(toBestOfLaunchInfo(series)).toEqual({
      title: 'Grand final',
      length: 5,
      gameNumber: 3,
      sides: [
        { players: [ALICE, BOB], score: 0 },
        { players: [CARA], score: 2 },
      ],
    })
    expect(toBestOfLaunchInfo(bestOf([]))).toEqual({
      length: 3,
      gameNumber: 1,
      sides: [
        { players: [ALICE], score: 0 },
        { players: [BOB], score: 0 },
      ],
    })
  })

  test("toBestOfLaunchInfo carries the caster overlay's set lines in order and its logo URL", () => {
    const series = (overlay: LobbyBestOfJson['overlay']) => ({ ...bestOf([]), overlay })
    const logo = { url: 'https://cdn.example.com/logo.png', fileName: 'logo.svg' }

    expect(toBestOfLaunchInfo(series({ line1: 'One', line2: 'Two', logo }))).toEqual(
      expect.objectContaining({ lines: ['One', 'Two'], logoUrl: logo.url }),
    )
    expect(toBestOfLaunchInfo(series({ line2: 'Two' }))).toEqual(
      expect.objectContaining({ lines: ['Two'] }),
    )
    const none = toBestOfLaunchInfo(series(undefined))
    expect(none).not.toHaveProperty('lines')
    expect(none).not.toHaveProperty('logoUrl')
  })

  test('toBestOfOverlayJson keeps only the parts that are set', () => {
    expect(toBestOfOverlayJson({ line1: '', line2: undefined })).toBeUndefined()
    expect(toBestOfOverlayJson({ line1: '', line2: 'Two' })).toEqual({ line2: 'Two' })
  })

  describe('suggestBestOfSides', () => {
    test('suggests the humans of the two teams that have any', () => {
      const lobby = lobbyWith([
        team(1, [createHuman(ALICE), createComputer(), createHuman(BOB)]),
        team(2, [createOpen()]),
        team(3, [createHuman(CARA)]),
        team(4, [createObserver(DAN)], true),
      ])

      expect(suggestBestOfSides(lobby)).toEqual([[ALICE, BOB], [CARA]])
    })

    test('splits a single team of exactly two humans one each', () => {
      const lobby = lobbyWith([team(0, [createHuman(ALICE), createComputer(), createHuman(BOB)])])

      expect(suggestBestOfSides(lobby)).toEqual([[ALICE], [BOB]])
    })

    test('suggests nothing for any other arrangement', () => {
      expect(
        suggestBestOfSides(
          lobbyWith([team(0, [createHuman(ALICE), createHuman(BOB), createHuman(CARA)])]),
        ),
      ).toBeUndefined()
      expect(suggestBestOfSides(lobbyWith([team(0, [createHuman(ALICE)])]))).toBeUndefined()
      expect(
        suggestBestOfSides(
          lobbyWith([
            team(1, [createHuman(ALICE)]),
            team(2, [createHuman(BOB)]),
            team(3, [createHuman(CARA)]),
          ]),
        ),
      ).toBeUndefined()
    })

    test('suggests nothing when a team holds more people than a side can', () => {
      const lobby = lobbyWith([
        team(
          1,
          [1, 2, 3, 4, 5].map(id => createHuman(makeSbUserId(id))),
        ),
        team(2, [createHuman(makeSbUserId(6))]),
      ])

      expect(suggestBestOfSides(lobby)).toBeUndefined()
    })
  })
})
