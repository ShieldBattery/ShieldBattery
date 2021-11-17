/* eslint-disable jest/no-commented-out-tests */
import { makeSbUserId } from '../../../common/users/user-info'
import { DEFAULT_MATCH_CHOOSER, initializePlayer, QueuedMatchmakingPlayer } from './matchmaker'

let curUserId = 1

function createPlayer(data: Partial<QueuedMatchmakingPlayer> = {}): QueuedMatchmakingPlayer {
  const rating = data.rating ?? 1500

  return initializePlayer({
    id: makeSbUserId(curUserId++),
    name: 'tec27',
    numGamesPlayed: 0,
    rating,
    searchIterations: 0,
    race: 'r',
    useAlternateRace: false,
    alternateRace: 'z',
    mapSelections: new Set([]),

    ...data,

    interval: {
      low: rating - 120,
      high: rating + 120,
      ...(data.interval ?? {}),
    },
  })
}

describe('matchmaking/matchmaker/DEFAULT_MATCH_CHOOSER', () => {
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

    const result = DEFAULT_MATCH_CHOOSER(1, player, [kindaFar, pickThis, orThis])

    expect(result).not.toEqual([[player], [kindaFar]])

    const [, teamB] = result
    // NOTE(tec27): The selection is random so we can't easily check for a specific value here, at
    // least without mocking out random in some way. If this test flakes out, it likely means the
    // logic in the function is wrong.
    expect([pickThis, orThis]).toContain(teamB![0])
  })
})
