import { describe, expect, test } from 'vitest'
import { GameType } from '../../../common/games/game-type'
import { Lobby } from '../../../common/lobbies'
import { LobbyBestOfJson } from '../../../common/lobbies/lobby-best-of'
import { LobbySeriesGameJson } from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { createHuman, createObserver, createOpen, Slot } from '../../../common/lobbies/slot'
import { SbMapId } from '../../../common/maps'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import {
  getBestOfCandidates,
  getBestOfSeriesGames,
  getBestOfStartBlocker,
  getDisplayedBestOf,
  getRecentGameLimit,
  groupSessionGames,
} from './best-of-display'

const ALICE = makeSbUserId(1)
const BOB = makeSbUserId(2)
const CAROL = makeSbUserId(3)
const DAVE = makeSbUserId(4)
const ERIN = makeSbUserId(5)

function seriesGame(gameId: string): LobbySeriesGameJson {
  return { gameId, mapId: 'map' as SbMapId, teams: [] }
}

function makeLobby(top: Slot[], bottom: Slot[], observers: Slot[] = []): Lobby {
  return {
    id: makeSbLobbyId('lobby'),
    name: 'Lobby',
    map: undefined,
    mapQueue: [],
    gameType: GameType.TopVsBottom,
    gameSubType: top.length,
    teams: [
      { name: 'Top', teamId: 1, isObserver: false, slots: top, hiddenSlots: [] },
      { name: 'Bottom', teamId: 2, isObserver: false, slots: bottom, hiddenSlots: [] },
      { name: 'Observers', teamId: 0, isObserver: true, slots: observers, hiddenSlots: [] },
    ],
    bench: [],
    host: top[0],
    useLegacyLimits: false,
    starcraftCompatibleReplays: true,
    lockedAlliances: false,
    visibility: 'listed',
    createdAt: 0,
  }
}

const RUNNING: LobbyBestOfJson = {
  id: '2',
  length: 3,
  sides: [[ALICE], [BOB]],
  games: [
    { gameId: 'g3', status: 'won', winner: 0 },
    { gameId: 'g4', status: 'notCounted' },
    { gameId: 'g5', status: 'won', winner: 1 },
  ],
}

const ENDED: LobbyBestOfJson = {
  id: '1',
  title: 'Warm-up',
  length: 1,
  sides: [[ALICE], [BOB]],
  games: [{ gameId: 'g2', status: 'won', winner: 0 }],
  outcome: { kind: 'won', winner: 0 },
}

describe('client/lobbies/room/best-of-display', () => {
  describe('getDisplayedBestOf', () => {
    const series = ['g1', 'g2'].map(seriesGame)

    test('shows the running series whatever the lobby is doing', () => {
      expect(getDisplayedBestOf([ENDED, RUNNING], series, true)).toBe(RUNNING)
    })

    test('keeps an ended series up until the lobby moves on to a game outside it', () => {
      expect(getDisplayedBestOf([ENDED], series, false)).toBe(ENDED)
      expect(getDisplayedBestOf([ENDED], series, true)).toBeUndefined()
      expect(getDisplayedBestOf([ENDED], [...series, seriesGame('g3')], false)).toBeUndefined()
    })

    test('shows nothing for a series that ended without a finished game', () => {
      const empty: LobbyBestOfJson = { ...ENDED, games: [], outcome: { kind: 'unfinished' } }
      expect(getDisplayedBestOf([empty], series, false)).toBeUndefined()
      expect(getDisplayedBestOf([], series, false)).toBeUndefined()
    })
  })

  test('getBestOfSeriesGames numbers only the finished games, sharing a replayed number', () => {
    const series = ['g3', 'g4'].map(seriesGame)
    expect(
      getBestOfSeriesGames(RUNNING, series).map(({ game, gameNumber }) => [
        game.gameId,
        gameNumber,
      ]),
    ).toEqual([
      ['g3', 1],
      ['g4', 2],
    ])
  })

  describe('groupSessionGames', () => {
    test('heads each run of series games and numbers them within it', () => {
      const series = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map(seriesGame)
      const entries = groupSessionGames(series, [
        ENDED,
        { ...RUNNING, outcome: { kind: 'unfinished' } },
      ])

      expect(
        entries.map(entry =>
          entry.kind === 'bestOf'
            ? `bestOf ${entry.bestOf.id}`
            : `${entry.game.gameId}:${entry.gameNumber}`,
        ),
      ).toEqual(['g1:1', 'bestOf 1', 'g2:1', 'bestOf 2', 'g3:1', 'g4:2', 'g5:2', 'g6:6'])
    })

    test('heads the running series at the end before it has a finished game', () => {
      const running: LobbyBestOfJson = { ...RUNNING, games: [] }
      const entries = groupSessionGames(['g1'].map(seriesGame), [running])

      expect(entries.map(entry => entry.kind)).toEqual(['game', 'bestOf'])
    })

    test('leaves out a series that ended without a finished game', () => {
      const empty: LobbyBestOfJson = { ...ENDED, games: [], outcome: { kind: 'unfinished' } }
      expect(groupSessionGames(['g1'].map(seriesGame), [empty]).map(e => e.kind)).toEqual(['game'])
    })
  })

  describe('getBestOfStartBlocker', () => {
    const lobby = makeLobby([createHuman(ALICE), createOpen()], [createHuman(BOB), createOpen()])
    const fresh: LobbyBestOfJson = { ...RUNNING, games: [] }

    test('is nothing without a running series, or with the sides seated against each other', () => {
      expect(getBestOfStartBlocker(lobby, [ENDED])).toBeUndefined()
      expect(getBestOfStartBlocker(lobby, [fresh])).toBeUndefined()
    })

    test('waits for a pending game before anything about the seats', () => {
      const pending: LobbyBestOfJson = {
        ...fresh,
        sides: [[CAROL], [BOB]],
        games: [{ gameId: 'g1', status: 'pending' }],
      }
      expect(getBestOfStartBlocker(lobby, [pending])).toEqual({ kind: 'bestOfGamePending' })
    })

    test('names the first side with nobody seated, then the first extra player', () => {
      expect(getBestOfStartBlocker(lobby, [{ ...fresh, sides: [[CAROL, DAVE], [BOB]] }])).toEqual({
        kind: 'bestOfSideNotSeated',
        side: 0,
      })
      expect(
        getBestOfStartBlocker(lobby, [
          { ...fresh, sides: [[ALICE], [CAROL]], sideNames: [null, 'Ironclad'] },
        ]),
      ).toEqual({ kind: 'bestOfSideNotSeated', side: 1, sideName: 'Ironclad' })
      const crowded = makeLobby(
        [createHuman(ALICE), createHuman(ERIN)],
        [createHuman(BOB), createHuman(DAVE)],
      )
      expect(getBestOfStartBlocker(crowded, [fresh])).toEqual({
        kind: 'bestOfExtraPlayer',
        userId: ERIN,
      })
    })

    test('side members observing or on the bench do not hold the game up', () => {
      const withSpectators: Lobby = {
        ...makeLobby(
          [createHuman(ALICE), createOpen()],
          [createHuman(BOB), createOpen()],
          [createObserver(CAROL)],
        ),
        bench: [{ userId: DAVE, race: 'z', joinedAt: 0 }],
      }
      expect(
        getBestOfStartBlocker(withSpectators, [
          {
            ...fresh,
            sides: [
              [ALICE, CAROL],
              [DAVE, BOB],
            ],
            sideNames: ['Nexus', 'Ironclad'],
          },
        ]),
      ).toBeUndefined()
    })

    test('refuses sides that share a team', () => {
      const mixed = makeLobby(
        [createHuman(ALICE), createHuman(BOB)],
        [createHuman(CAROL), createOpen()],
      )
      expect(getBestOfStartBlocker(mixed, [{ ...fresh, sides: [[ALICE, CAROL], [BOB]] }])).toEqual({
        kind: 'bestOfMixedTeams',
      })
    })
  })

  test('getBestOfCandidates lists seated players, then observers, then the bench', () => {
    const lobby: Lobby = {
      ...makeLobby(
        [createHuman(ALICE), createOpen()],
        [createHuman(BOB), createHuman(CAROL)],
        [createObserver(DAVE)],
      ),
      bench: [{ userId: ERIN, race: 'r', joinedAt: 0 }],
    }

    expect(getBestOfCandidates(lobby, [[BOB], []])).toEqual([
      { userId: ALICE, seat: 'player' },
      { userId: CAROL, seat: 'player' },
      { userId: DAVE, seat: 'observer' },
      { userId: ERIN, seat: 'bench' },
    ])
  })
})

describe('getRecentGameLimit', () => {
  const plain = { hasScoreTile: false, hasNextGame: true, hasQueuedMaps: false }

  test('without a series, shows two games from 480 (620 with queued maps) and never none', () => {
    expect(getRecentGameLimit({ ...plain, stripWidth: 480 })).toBe(2)
    expect(getRecentGameLimit({ ...plain, stripWidth: 479 })).toBe(1)
    expect(getRecentGameLimit({ ...plain, stripWidth: 0 })).toBe(1)
    expect(getRecentGameLimit({ ...plain, hasQueuedMaps: true, stripWidth: 620 })).toBe(2)
    expect(getRecentGameLimit({ ...plain, hasQueuedMaps: true, stripWidth: 619 })).toBe(1)
  })

  test('with a series, the score tile takes room first and games can yield entirely', () => {
    const series = { ...plain, hasScoreTile: true }
    expect(getRecentGameLimit({ ...series, stripWidth: 616 })).toBe(2)
    expect(getRecentGameLimit({ ...series, stripWidth: 615 })).toBe(1)
    expect(getRecentGameLimit({ ...series, stripWidth: 496 })).toBe(1)
    expect(getRecentGameLimit({ ...series, stripWidth: 488 })).toBe(1)
    expect(getRecentGameLimit({ ...series, stripWidth: 487 })).toBe(0)
    expect(getRecentGameLimit({ ...series, hasQueuedMaps: true, stripWidth: 496 })).toBe(0)
    expect(getRecentGameLimit({ ...series, hasQueuedMaps: true, stripWidth: 628 })).toBe(1)
  })

  test('does not reserve room for elements that are not rendered', () => {
    const over = { hasScoreTile: true, hasNextGame: false, hasQueuedMaps: false }
    expect(getRecentGameLimit({ ...over, stripWidth: 512 })).toBe(2)
    expect(getRecentGameLimit({ ...over, stripWidth: 400 })).toBe(1)
    expect(getRecentGameLimit({ ...over, stripWidth: 383 })).toBe(0)
  })
})
