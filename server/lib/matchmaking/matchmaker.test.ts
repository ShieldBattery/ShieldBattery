import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { DEFAULT_MATCH_CHOOSER, initializeEntity } from './matchmaker'
import { QueuedMatchmakingEntity } from './matchmaker-queue'
import { MatchmakingPlayer } from './matchmaking-entity'

let curUserId = 1

function createPlayer(data: Partial<MatchmakingPlayer> = {}): QueuedMatchmakingEntity {
  const rating = data.rating ?? 1500

  const player = initializeEntity({
    id: makeSbUserId(curUserId++),
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
    return `PLAYER ${this.id} @ ${rating} mmr`
  }

  return player
}

describe('matchmaking/matchmaker/DEFAULT_MATCH_CHOOSER', () => {
  const origRandom = Math.random

  beforeEach(() => {
    curUserId = 1

    // NOTE(tec27): These values are mostly meaningless, just want to avoid return some combination
    // of the same value + different ones to ferret out bugs
    const randomValues = [0.4, 0.1, 0.4, 0.7, 0.5]
    Math.random = vi.fn().mockImplementation(() => {
      const value = randomValues[0]
      randomValues.push(randomValues.shift()!)
      return value
    })
  })

  afterEach(() => {
    Math.random = origRandom
  })

  test('1v1 - should return the only opponent option if there is only 1', () => {
    const player = createPlayer()
    const opponent = createPlayer()

    expect(DEFAULT_MATCH_CHOOSER(1, false, player, [opponent])).toEqual([[player], [opponent]])
  })

  test("1v1 - shouldn't return any opponents if they don't have the player in their range", () => {
    const player = createPlayer()
    const opponent = createPlayer({
      rating: 1400,
      interval: { low: 1310, high: 1490 },
    })

    expect(DEFAULT_MATCH_CHOOSER(1, false, player, [opponent])).toEqual([])
  })

  test('1v1 - should pick the only new opponent if player is new', () => {
    const player = createPlayer()
    const newOpponent = createPlayer()
    const oldOpponent = createPlayer({ numGamesPlayed: 9001 })

    expect(DEFAULT_MATCH_CHOOSER(1, false, player, [oldOpponent, newOpponent])).toEqual([
      [player],
      [newOpponent],
    ])
  })

  test('1v1 - should pick the only old player if player is not new', () => {
    const player = createPlayer({ numGamesPlayed: 5000 })
    const newOpponent = createPlayer()
    const oldOpponent = createPlayer({ numGamesPlayed: 9001 })

    expect(DEFAULT_MATCH_CHOOSER(1, false, player, [oldOpponent, newOpponent])).toEqual([
      [player],
      [oldOpponent],
    ])
  })

  test("1v1 - should pick the opponent that's been in queue the longest", () => {
    const player = createPlayer()
    const justJoinedOpponent = createPlayer()
    const waitingABitOpponent = createPlayer({ searchIterations: 8 })
    const dyingOfOldAgeOpponent = createPlayer({
      searchIterations: 5000,
    })

    expect(
      DEFAULT_MATCH_CHOOSER(1, false, player, [
        waitingABitOpponent,
        justJoinedOpponent,
        dyingOfOldAgeOpponent,
      ]),
    ).toEqual([[player], [dyingOfOldAgeOpponent]])
  })

  test('1v1 - should pick the opponent with the closest rating', () => {
    const player = createPlayer({ rating: 1700 })
    const kindaFar = createPlayer({ rating: 1300 })
    const gettingWarmer = createPlayer({ rating: 1600 })
    const pickThis = createPlayer({ rating: 1730 })

    expect(DEFAULT_MATCH_CHOOSER(1, false, player, [kindaFar, gettingWarmer, pickThis])).toEqual([
      [player],
      [pickThis],
    ])
  })

  test('1v1 - should pick randomly among the remaining opponents', () => {
    const player = createPlayer({ rating: 1700 })
    const kindaFar = createPlayer({ rating: 1300 })
    const pickThis = createPlayer({ rating: 1670 })
    const orThis = createPlayer({ rating: 1730 })

    expect(DEFAULT_MATCH_CHOOSER(1, false, player, [kindaFar, pickThis, orThis]))
      .toMatchInlineSnapshot(`
        [
          [
            "PLAYER 1 @ 1700 mmr",
          ],
          [
            "PLAYER 3 @ 1670 mmr",
          ],
        ]
      `)
  })

  test('2v2 - should return the only opponents option if there are just enough', () => {
    const player = createPlayer()
    const p1 = createPlayer()
    const p2 = createPlayer()
    const p3 = createPlayer()

    expect(DEFAULT_MATCH_CHOOSER(2, false, player, [p1, p2, p3])).toMatchInlineSnapshot(`
      [
        [
          "PLAYER 1 @ 1500 mmr",
          "PLAYER 3 @ 1500 mmr",
        ],
        [
          "PLAYER 4 @ 1500 mmr",
          "PLAYER 2 @ 1500 mmr",
        ],
      ]
    `)
  })

  test('2v2 - should return a random set of players if there are a lot that match', () => {
    const player = createPlayer()
    const p1 = createPlayer()
    const p2 = createPlayer()
    const p3 = createPlayer()
    const p4 = createPlayer()
    const p5 = createPlayer()
    const p6 = createPlayer()
    const p7 = createPlayer()
    const p8 = createPlayer()

    expect(DEFAULT_MATCH_CHOOSER(2, false, player, [p1, p2, p3, p4, p5, p6, p7, p8]))
      .toMatchInlineSnapshot(`
        [
          [
            "PLAYER 1 @ 1500 mmr",
            "PLAYER 5 @ 1500 mmr",
          ],
          [
            "PLAYER 4 @ 1500 mmr",
            "PLAYER 2 @ 1500 mmr",
          ],
        ]
      `)
  })

  test('2v2 - should find the optimal team arrangement for a set of players', () => {
    const player = createPlayer({ rating: 2000, interval: { low: 1000, high: 3000 } })
    const lowSkill = createPlayer({
      rating: 1000,
      interval: { low: 0, high: 2000 },
    })
    const midSkill = createPlayer({
      rating: 1600,
      interval: { low: 600, high: 2600 },
    })
    const midSkill2 = createPlayer({
      rating: 1400,
      interval: { low: 400, high: 2400 },
    })

    expect(DEFAULT_MATCH_CHOOSER(2, false, player, [midSkill, lowSkill, midSkill2]))
      .toMatchInlineSnapshot(`
        [
          [
            "PLAYER 1 @ 2000 mmr",
            "PLAYER 2 @ 1000 mmr",
          ],
          [
            "PLAYER 4 @ 1400 mmr",
            "PLAYER 3 @ 1600 mmr",
          ],
        ]
      `)
    // NOTE(tec27): We throw some different orderings in here just to make sure it's picking based
    // on optimal rating difference, not order
    expect(DEFAULT_MATCH_CHOOSER(2, false, player, [lowSkill, midSkill, midSkill2]))
      .toMatchInlineSnapshot(`
        [
          [
            "PLAYER 1 @ 2000 mmr",
            "PLAYER 2 @ 1000 mmr",
          ],
          [
            "PLAYER 3 @ 1600 mmr",
            "PLAYER 4 @ 1400 mmr",
          ],
        ]
      `)
    expect(DEFAULT_MATCH_CHOOSER(2, false, player, [midSkill, midSkill2, lowSkill]))
      .toMatchInlineSnapshot(`
        [
          [
            "PLAYER 1 @ 2000 mmr",
            "PLAYER 2 @ 1000 mmr",
          ],
          [
            "PLAYER 3 @ 1600 mmr",
            "PLAYER 4 @ 1400 mmr",
          ],
        ]
      `)
  })

  test("1v1 fastest - shouldn't return any opponents if they don't have overlapping maps", () => {
    const player = createPlayer({
      mapSelections: ['map1'],
    })
    const opponent = createPlayer({
      mapSelections: ['map2'],
    })

    expect(DEFAULT_MATCH_CHOOSER(1, true, player, [opponent])).toEqual([])
  })

  test('1v1 fastest - should return opponent with matching rating and maps', () => {
    const player = createPlayer({
      mapSelections: ['map1', 'map2'],
    })
    const opponent = createPlayer({
      mapSelections: ['map2', 'map3'],
    })

    expect(DEFAULT_MATCH_CHOOSER(1, true, player, [opponent])).toEqual([[player], [opponent]])
  })
})
