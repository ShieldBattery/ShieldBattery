import { describe, expect, test } from 'vitest'
import { GameType } from '../games/game-type'
import { makeSbUserId, SbUserId } from '../users/sb-user-id'
import { Lobby, Team } from './index'
import {
  BEST_OF_DISPLAY_NAME_MAX_LENGTH,
  BEST_OF_SIDE_NAME_MAX_LENGTH,
  checkBestOfRoster,
  countBestOfTextCharacters,
  findBestOfGameWinner,
  getBestOfDisplayName,
  getBestOfGameNumber,
  getBestOfScore,
  getBestOfSeatedSides,
  getBestOfSideName,
  getBestOfTextProblem,
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

    test('gives the win to the side whichever of its members played', () => {
      // A side of three, of whom only the substitute played this game
      const roster: [SbUserId[], SbUserId[]] = [[ALICE, BOB, ERIN], [CARA]]

      expect(
        findBestOfGameWinner(roster, [
          { userId: ERIN, result: 'win' },
          { userId: CARA, result: 'loss' },
        ]),
      ).toBe(0)
      expect(
        findBestOfGameWinner(roster, [
          { userId: ERIN, result: 'loss' },
          { userId: CARA, result: 'win' },
        ]),
      ).toBe(1)
    })
  })

  describe('checkBestOfRoster', () => {
    const notOk = (extra: Partial<{ unseatedSides: number[]; extra: SbUserId[] }> = {}) => ({
      ok: false,
      unseatedSides: [],
      extra: [],
      mixedTeams: false,
      ...extra,
    })

    test('accepts the two sides seated on two teams', () => {
      const lobby = lobbyWith([
        team(1, [createHuman(ALICE), createHuman(BOB), createOpen()]),
        team(2, [createHuman(CARA), createComputer(), createClosed()]),
      ])

      expect(checkBestOfRoster(lobby, [[ALICE, BOB], [CARA]])).toEqual({ ok: true })
      // Which team holds which side doesn't matter
      expect(checkBestOfRoster(lobby, [[CARA], [BOB, ALICE]])).toEqual({ ok: true })
    })

    test("doesn't need side members who observe, sit on the bench or are gone", () => {
      const lobby: Lobby = {
        ...lobbyWith([
          team(1, [createHuman(ALICE)]),
          team(2, [createHuman(BOB), createOpen()]),
          team(3, [createObserver(CARA)], true),
        ]),
        bench: [{ userId: DAN, race: 'r', joinedAt: 0 }],
      }
      const gone = makeSbUserId(20)

      expect(
        checkBestOfRoster(lobby, [
          [ALICE, DAN],
          [BOB, CARA, gone],
        ]),
      ).toEqual({ ok: true })
    })

    test('accepts sides larger than the game seats, with any of their members seated', () => {
      const side0 = [1, 2, 3, 4, 5, 6, 7, 8].map(id => makeSbUserId(id))
      const side1 = [11, 12, 13, 14, 15, 16, 17, 18].map(id => makeSbUserId(id))
      const lobby = lobbyWith([
        team(1, [createHuman(side0[6]), createHuman(side0[2])]),
        team(2, [createHuman(side1[7]), createOpen()]),
      ])

      expect(checkBestOfRoster(lobby, [side0, side1])).toEqual({ ok: true })
    })

    test('reports each side none of whose members is seated as a player', () => {
      const lobby = lobbyWith([
        team(1, [createHuman(ALICE)]),
        team(2, [createComputer(), createOpen()]),
        team(3, [createObserver(BOB)], true),
      ])

      expect(checkBestOfRoster(lobby, [[ALICE], [BOB, CARA]])).toEqual(
        notOk({ unseatedSides: [1] }),
      )
      expect(checkBestOfRoster(lobby, [[CARA], [BOB]])).toEqual(
        notOk({ unseatedSides: [0, 1], extra: [ALICE] }),
      )
    })

    test('reports seated players on neither side, but not observers', () => {
      const lobby = lobbyWith([
        team(1, [createHuman(ALICE), createHuman(DAN)]),
        team(2, [createHuman(BOB)]),
        team(3, [createObserver(CARA)], true),
      ])

      expect(checkBestOfRoster(lobby, [[ALICE], [BOB]])).toEqual(notOk({ extra: [DAN] }))
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
      ).toEqual({ ...notOk(), mixedTeams: true })
      // Benched members of both sides don't mix a team
      expect(
        checkBestOfRoster(lobby, [
          [ALICE, CARA, ERIN],
          [BOB, DAN],
        ]),
      ).toEqual({ ok: true })
    })

    test('accepts any arrangement when everyone sits on a single team', () => {
      const lobby = lobbyWith(
        [team(0, [createHuman(ALICE), createHuman(BOB), createHuman(CARA), createComputer()])],
        GameType.Melee,
      )

      expect(checkBestOfRoster(lobby, [[ALICE, CARA], [BOB]])).toEqual({ ok: true })
      expect(
        checkBestOfRoster(lobby, [
          [ALICE, DAN],
          [BOB, CARA, ERIN],
        ]),
      ).toEqual({ ok: true })
      // Still needs someone of each side, and nobody else
      expect(checkBestOfRoster(lobby, [[ALICE, BOB, CARA], [DAN]])).toEqual(
        notOk({ unseatedSides: [1] }),
      )
      expect(checkBestOfRoster(lobby, [[ALICE], [BOB]])).toEqual(notOk({ extra: [CARA] }))
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

  describe('toBestOfLaunchInfo', () => {
    const seatedAll = lobbyWith([
      team(1, [createHuman(ALICE), createHuman(BOB)]),
      team(2, [createHuman(CARA), createOpen()]),
    ])

    test('describes the next game with the score so far', () => {
      const series = bestOf([won(1, 'a'), { gameId: 'b', status: 'noWinner' }, won(1, 'c')], {
        title: 'Grand final',
        length: 5,
        sides: [[ALICE, BOB], [CARA]],
      })

      expect(toBestOfLaunchInfo(series, seatedAll)).toEqual({
        title: 'Grand final',
        length: 5,
        gameNumber: 3,
        sides: [
          { players: [ALICE, BOB], score: 0 },
          { players: [CARA], score: 2 },
        ],
      })
      expect(
        toBestOfLaunchInfo(
          bestOf([]),
          lobbyWith([team(1, [createHuman(ALICE)]), team(2, [createHuman(BOB)])]),
        ),
      ).toEqual({
        length: 3,
        gameNumber: 1,
        sides: [
          { players: [ALICE], score: 0 },
          { players: [BOB], score: 0 },
        ],
      })
    })

    test("lists each side's seated members, its name, and only their display names", () => {
      // Side 0 has BOB on the bench and DAN observing; side 1 has ERIN not in the lobby at all
      const lobby: Lobby = {
        ...lobbyWith([
          team(1, [createHuman(ALICE), createOpen()]),
          team(2, [createHuman(CARA), createComputer()]),
          team(3, [createObserver(DAN)], true),
        ]),
        bench: [{ userId: BOB, race: 'z', joinedAt: 0 }],
      }
      const series = bestOf([], {
        sides: [
          [BOB, ALICE, DAN],
          [ERIN, CARA],
        ],
        sideNames: ['Ironclad', null],
        displayNames: [
          { userId: BOB, name: 'Benchwarmer' },
          { userId: ALICE, name: '이영호' },
          { userId: DAN, name: 'Watcher' },
          { userId: ERIN, name: 'Gone' },
          { userId: CARA, name: 'Cara 🐙' },
        ],
      })

      expect(toBestOfLaunchInfo(series, lobby)).toEqual({
        length: 3,
        gameNumber: 1,
        sides: [
          { players: [ALICE], score: 0, name: 'Ironclad' },
          { players: [CARA], score: 0 },
        ],
        displayNames: [
          { userId: ALICE, name: '이영호' },
          { userId: CARA, name: 'Cara 🐙' },
        ],
      })
    })

    test('carries no display names when no seated player has one', () => {
      const series = bestOf([], {
        sides: [[ALICE, DAN], [CARA]],
        displayNames: [{ userId: DAN, name: 'Bench' }],
      })

      expect(toBestOfLaunchInfo(series, seatedAll)).not.toHaveProperty('displayNames')
    })

    test("carries the caster overlay's set lines in order and its logo URL", () => {
      const series = (overlay: LobbyBestOfJson['overlay']) => ({ ...bestOf([]), overlay })
      const logo = { url: 'https://cdn.example.com/logo.png', fileName: 'logo.svg' }

      expect(toBestOfLaunchInfo(series({ line1: 'One', line2: 'Two', logo }), seatedAll)).toEqual(
        expect.objectContaining({ lines: ['One', 'Two'], logoUrl: logo.url }),
      )
      expect(toBestOfLaunchInfo(series({ line2: 'Two' }), seatedAll)).toEqual(
        expect.objectContaining({ lines: ['Two'] }),
      )
      const none = toBestOfLaunchInfo(series(undefined), seatedAll)
      expect(none).not.toHaveProperty('lines')
      expect(none).not.toHaveProperty('logoUrl')
    })
  })

  test("getBestOfSeatedSides lists each side's members seated as players, in side order", () => {
    const lobby: Lobby = {
      ...lobbyWith([
        team(1, [createHuman(BOB), createHuman(ALICE)]),
        team(2, [createHuman(CARA)]),
        team(3, [createObserver(DAN)], true),
      ]),
      bench: [{ userId: ERIN, race: 'p', joinedAt: 0 }],
    }

    expect(
      getBestOfSeatedSides(lobby, [
        [ALICE, ERIN, BOB],
        [DAN, CARA],
      ]),
    ).toEqual([[ALICE, BOB], [CARA]])
    expect(getBestOfSeatedSides(lobby, [[ERIN], [DAN]])).toEqual([[], []])
  })

  test('getBestOfSideName and getBestOfDisplayName read the names that are set', () => {
    const series = bestOf([], {
      sideNames: [null, 'Ironclad'],
      displayNames: [{ userId: BOB, name: 'Flash' }],
    })

    expect(getBestOfSideName(series, 0)).toBeUndefined()
    expect(getBestOfSideName(series, 1)).toBe('Ironclad')
    expect(getBestOfSideName(bestOf([]), 1)).toBeUndefined()
    expect(getBestOfDisplayName(series, BOB)).toBe('Flash')
    expect(getBestOfDisplayName(series, ALICE)).toBeUndefined()
  })

  describe('getBestOfTextProblem', () => {
    test('counts characters in code points, once trimmed', () => {
      const korean = `${'이영호'.repeat(5)}이`
      const emoji = '🐙'.repeat(16)

      expect(countBestOfTextCharacters(emoji)).toBe(16)
      for (const name of [korean, emoji, 'x'.repeat(16), `  ${'x'.repeat(16)}  `]) {
        expect(getBestOfTextProblem(name, BEST_OF_DISPLAY_NAME_MAX_LENGTH)).toBeUndefined()
        expect(getBestOfTextProblem(`${name.trim()}a`, BEST_OF_DISPLAY_NAME_MAX_LENGTH)).toBe(
          'tooLong',
        )
      }
      expect(getBestOfTextProblem('🐙'.repeat(24), BEST_OF_SIDE_NAME_MAX_LENGTH)).toBeUndefined()
      expect(getBestOfTextProblem('팀'.repeat(25), BEST_OF_SIDE_NAME_MAX_LENGTH)).toBe('tooLong')
      expect(BEST_OF_SIDE_NAME_MAX_LENGTH).toBe(24)
      expect(BEST_OF_DISPLAY_NAME_MAX_LENGTH).toBe(16)
    })

    // Invisible characters are written as code points, so the source shows what each case holds
    const cp = (...codePoints: number[]) => String.fromCodePoint(...codePoints)

    test('accepts any text, including joined emoji and an empty name', () => {
      for (const name of [
        '',
        '   ',
        'Team Liquid',
        '[KT] Flash!',
        '一二三四',
        'Ébène',
        cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467), // emoji joined with zero-width joiners
        `${cp(0x0646, 0x06cc, 0x0645)}${cp(0x200c)}${cp(0x0641, 0x0627)}`, // a zero-width non-joiner
        `e${cp(0x0301)}`, // a combining accent
        cp(0x2764, 0xfe0f), // a variation selector
      ]) {
        expect(getBestOfTextProblem(name, BEST_OF_SIDE_NAME_MAX_LENGTH)).toBeUndefined()
      }
    })

    test('refuses line breaks, control characters and invisible formatting characters', () => {
      for (const [what, codePoint] of [
        ['a line feed', 0x0a],
        ['a carriage return', 0x0d],
        ['a tab', 0x09],
        ['a null', 0x00],
        ['a bell', 0x07],
        ['a delete', 0x7f],
        ['a C1 next line', 0x85],
        ['a line separator', 0x2028],
        ['a paragraph separator', 0x2029],
        ['a right-to-left override', 0x202e],
        ['a right-to-left embedding', 0x202b],
        ['a right-to-left isolate', 0x2067],
        ['a pop directional isolate', 0x2069],
        ['a right-to-left mark', 0x200f],
        ['an Arabic letter mark', 0x061c],
        ['a zero-width space', 0x200b],
        ['a word joiner', 0x2060],
        ['a soft hyphen', 0x00ad],
        ['a byte order mark', 0xfeff],
        ['a tag character', 0xe0041],
        ['a lone high surrogate', 0xd800],
        ['a lone low surrogate', 0xdc00],
      ] as const) {
        expect([what, getBestOfTextProblem(`Name${cp(codePoint)}here`, 100)]).toEqual([
          what,
          'invalidCharacters',
        ])
      }
    })
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

    test('suggests a team of seven against one', () => {
      const seven = [1, 2, 3, 4, 5, 6, 7].map(id => makeSbUserId(id))
      const lobby = lobbyWith([
        team(
          1,
          seven.map(id => createHuman(id)),
        ),
        team(2, [createHuman(makeSbUserId(8))]),
      ])

      expect(suggestBestOfSides(lobby)).toEqual([seven, [makeSbUserId(8)]])
    })
  })
})
