/* eslint-disable jest/no-commented-out-tests */
import { mockRandomForEach } from 'jest-mock-random'
import { makeSbUserId } from '../../../common/users/sb-user'
import { DEFAULT_MATCH_CHOOSER, initializeEntity } from './matchmaker'
import { QueuedMatchmakingEntity } from './matchmaker-queue'
import { MatchmakingPlayer } from './matchmaking-entity'

let curUserId = 1

function createPlayer(data: Partial<MatchmakingPlayer> = {}): QueuedMatchmakingEntity {
  const rating = data.rating ?? 1500

  const player = initializeEntity({
    id: makeSbUserId(curUserId++),
    name: 'tec27',
    numGamesPlayed: 0,
    rating,
    searchIterations: 0,
    race: 'r',
    preferenceData: {
      useAlternateRace: false,
      alternateRace: 'z',
    },
    mapSelections: [],

    ...data,

    interval: {
      low: rating - 120,
      high: rating + 120,
      ...(data.interval ?? {}),
    },
  })

  // Simplify the JSON output of this structure for easy comparison in inline snapshots
  ;(player as any).toJSON = function () {
    return `PLAYER ${this.id} '${this.name}' @ ${rating} mmr`
  }

  return player
}

describe('matchmaking/matchmaker/DEFAULT_MATCH_CHOOSER', () => {
  // NOTE(tec27): These values are mostly meaningless, just want to avoid return some combination
  // of the same value + different ones to ferret out bugs
  mockRandomForEach([0.4, 0.1, 0.4, 0.7, 0.5])

  beforeEach(() => {
    curUserId = 1
  })

  test('1v1 - should return the only opponent option if there is only 1', () => {
    const player = createPlayer()
    const opponent = createPlayer({ name: 'ReallyBadDude' })

    expect(DEFAULT_MATCH_CHOOSER(1, player, [opponent])).toEqual([[player], [opponent]])
  })

  test("1v1 - shouldn't return any opponents if they don't have the player in their range", () => {
    const player = createPlayer()
    const opponent = createPlayer({
      name: 'ReallyBadDude',
      rating: 1400,
      interval: { low: 1310, high: 1490 },
    })

    expect(DEFAULT_MATCH_CHOOSER(1, player, [opponent])).toEqual([])
  })

  test('1v1 - should pick the only new opponent if player is new', () => {
    const player = createPlayer()
    const newOpponent = createPlayer({ name: 'SuperChoboNewbie' })
    const oldOpponent = createPlayer({ name: 'GrizzledVet', numGamesPlayed: 9001 })

    expect(DEFAULT_MATCH_CHOOSER(1, player, [oldOpponent, newOpponent])).toEqual([
      [player],
      [newOpponent],
    ])
  })

  test('1v1 - should pick the only old player if player is not new', () => {
    const player = createPlayer({ numGamesPlayed: 5000 })
    const newOpponent = createPlayer({ name: 'SuperChoboNewbie' })
    const oldOpponent = createPlayer({ name: 'GrizzledVet', numGamesPlayed: 9001 })

    expect(DEFAULT_MATCH_CHOOSER(1, player, [oldOpponent, newOpponent])).toEqual([
      [player],
      [oldOpponent],
    ])
  })

  test("1v1 - should pick the opponent that's been in queue the longest", () => {
    const player = createPlayer()
    const justJoinedOpponent = createPlayer({ name: 'HiJustGotHere' })
    const waitingABitOpponent = createPlayer({ name: 'ComeOnWheresMyMatch', searchIterations: 8 })
    const dyingOfOldAgeOpponent = createPlayer({
      name: 'IveBeenWaitingHereSinceLaunchWtf',
      searchIterations: 5000,
    })

    expect(
      DEFAULT_MATCH_CHOOSER(1, player, [
        waitingABitOpponent,
        justJoinedOpponent,
        dyingOfOldAgeOpponent,
      ]),
    ).toEqual([[player], [dyingOfOldAgeOpponent]])
  })

  test('1v1 - should pick the opponent with the closest rating', () => {
    const player = createPlayer({ rating: 1700 })
    const kindaFar = createPlayer({ name: 'ThirteenHundred', rating: 1300 })
    const gettingWarmer = createPlayer({ name: 'WarmPerson', rating: 1600 })
    const pickThis = createPlayer({ name: 'PickMePickMe', rating: 1730 })

    expect(DEFAULT_MATCH_CHOOSER(1, player, [kindaFar, gettingWarmer, pickThis])).toEqual([
      [player],
      [pickThis],
    ])
  })

  test('1v1 - should pick randomly among the remaining opponents', () => {
    const player = createPlayer({ rating: 1700 })
    const kindaFar = createPlayer({ name: 'ThirteenHundred', rating: 1300 })
    const pickThis = createPlayer({ name: 'PickMe', rating: 1670 })
    const orThis = createPlayer({ name: 'OrMe', rating: 1730 })

    expect(DEFAULT_MATCH_CHOOSER(1, player, [kindaFar, pickThis, orThis])).toMatchInlineSnapshot(`
      [
        [
          "PLAYER 1 'tec27' @ 1700 mmr",
        ],
        [
          "PLAYER 3 'PickMe' @ 1670 mmr",
        ],
      ]
    `)
  })

  test('2v2 - should return the only opponents option if there are just enough', () => {
    const player = createPlayer()
    const p1 = createPlayer({ name: 'ReallyBadDude' })
    const p2 = createPlayer({ name: 'ReallyBadDude2' })
    const p3 = createPlayer({ name: 'ReallyBadDude3' })

    expect(DEFAULT_MATCH_CHOOSER(2, player, [p1, p2, p3])).toMatchInlineSnapshot(`
      [
        [
          "PLAYER 1 'tec27' @ 1500 mmr",
          "PLAYER 3 'ReallyBadDude2' @ 1500 mmr",
        ],
        [
          "PLAYER 4 'ReallyBadDude3' @ 1500 mmr",
          "PLAYER 2 'ReallyBadDude' @ 1500 mmr",
        ],
      ]
    `)
  })

  test('2v2 - should return a random set of players if there are a lot that match', () => {
    const player = createPlayer()
    const p1 = createPlayer({ name: 'ReallyBadDude' })
    const p2 = createPlayer({ name: 'ReallyBadDude2' })
    const p3 = createPlayer({ name: 'ReallyBadDude3' })
    const p4 = createPlayer({ name: 'ReallyBadDude4' })
    const p5 = createPlayer({ name: 'ReallyBadDude5' })
    const p6 = createPlayer({ name: 'ReallyBadDude6' })
    const p7 = createPlayer({ name: 'ReallyBadDude7' })
    const p8 = createPlayer({ name: 'ReallyBadDude8' })

    expect(DEFAULT_MATCH_CHOOSER(2, player, [p1, p2, p3, p4, p5, p6, p7, p8]))
      .toMatchInlineSnapshot(`
      [
        [
          "PLAYER 1 'tec27' @ 1500 mmr",
          "PLAYER 5 'ReallyBadDude4' @ 1500 mmr",
        ],
        [
          "PLAYER 4 'ReallyBadDude3' @ 1500 mmr",
          "PLAYER 2 'ReallyBadDude' @ 1500 mmr",
        ],
      ]
    `)
  })

  test('2v2 - should find the optimal team arrangement for a set of players', () => {
    const player = createPlayer({ rating: 2000, interval: { low: 1000, high: 3000 } })
    const lowSkill = createPlayer({
      name: 'LowSkill',
      rating: 1000,
      interval: { low: 0, high: 2000 },
    })
    const midSkill = createPlayer({
      name: 'MidSkill',
      rating: 1600,
      interval: { low: 600, high: 2600 },
    })
    const midSkill2 = createPlayer({
      name: 'MidSkill2',
      rating: 1400,
      interval: { low: 400, high: 2400 },
    })

    expect(DEFAULT_MATCH_CHOOSER(2, player, [midSkill, lowSkill, midSkill2]))
      .toMatchInlineSnapshot(`
      [
        [
          "PLAYER 1 'tec27' @ 2000 mmr",
          "PLAYER 2 'LowSkill' @ 1000 mmr",
        ],
        [
          "PLAYER 4 'MidSkill2' @ 1400 mmr",
          "PLAYER 3 'MidSkill' @ 1600 mmr",
        ],
      ]
    `)
    // NOTE(tec27): We throw some different orderings in here just to make sure it's picking based
    // on optimal rating difference, not order
    expect(DEFAULT_MATCH_CHOOSER(2, player, [lowSkill, midSkill, midSkill2]))
      .toMatchInlineSnapshot(`
      [
        [
          "PLAYER 1 'tec27' @ 2000 mmr",
          "PLAYER 2 'LowSkill' @ 1000 mmr",
        ],
        [
          "PLAYER 3 'MidSkill' @ 1600 mmr",
          "PLAYER 4 'MidSkill2' @ 1400 mmr",
        ],
      ]
    `)
    expect(DEFAULT_MATCH_CHOOSER(2, player, [midSkill, midSkill2, lowSkill]))
      .toMatchInlineSnapshot(`
      [
        [
          "PLAYER 1 'tec27' @ 2000 mmr",
          "PLAYER 2 'LowSkill' @ 1000 mmr",
        ],
        [
          "PLAYER 3 'MidSkill' @ 1600 mmr",
          "PLAYER 4 'MidSkill2' @ 1400 mmr",
        ],
      ]
    `)
  })
})
