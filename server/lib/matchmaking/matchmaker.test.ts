/* eslint-disable jest/no-commented-out-tests */
import { MatchmakingPlayer } from './matchmaking-player'

function _createPlayer(data: Partial<MatchmakingPlayer> = {}): MatchmakingPlayer {
  const rating = data.rating ?? 1500

  return {
    id: 1,
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
  }
}
/*
TODO(tec27): Update these tests for new matchmaker organization.

describe('matchmaking/matchmaker/DEFAULT_OPPONENT_CHOOSER', () => {
  test('should return the only opponent option if there is only 1', () => {
    const player = createPlayer()
    const opponent = createPlayer({ name: 'ReallyBadDude' })

    expect(DEFAULT_OPPONENT_CHOOSER(player, [opponent], false)).toBe(opponent)
  })

  test("shouldn't return any opponents if they don't have the player in their range", () => {
    const player = createPlayer()
    const opponent = createPlayer({
      name: 'ReallyBadDude',
      rating: 1400,
      interval: { low: 1310, high: 1490 },
    })

    expect(DEFAULT_OPPONENT_CHOOSER(player, [opponent], false)).toBeUndefined()
  })

  test('should pick the only new opponent if player is new', () => {
    const player = createPlayer()
    const newOpponent = createPlayer({ name: 'SuperChoboNewbie' })
    const oldOpponent = createPlayer({ name: 'GrizzledVet', numGamesPlayed: 9001 })

    expect(DEFAULT_OPPONENT_CHOOSER(player, [oldOpponent, newOpponent], false)).toBe(newOpponent)
  })

  test('should pick the only old player if player is not new', () => {
    const player = createPlayer({ numGamesPlayed: 5000 })
    const newOpponent = createPlayer({ name: 'SuperChoboNewbie' })
    const oldOpponent = createPlayer({ name: 'GrizzledVet', numGamesPlayed: 9001 })

    expect(DEFAULT_OPPONENT_CHOOSER(player, [oldOpponent, newOpponent], false)).toBe(oldOpponent)
  })

  test("should pick the opponent that's been in queue the longest", () => {
    const player = createPlayer()
    const justJoinedOpponent = createPlayer({ name: 'HiJustGotHere' })
    const waitingABitOpponent = createPlayer({ name: 'ComeOnWheresMyMatch', searchIterations: 8 })
    const dyingOfOldAgeOpponent = createPlayer({
      name: 'IveBeenWaitingHereSinceLaunchWtf',
      searchIterations: 5000,
    })

    expect(
      DEFAULT_OPPONENT_CHOOSER(
        player,
        [waitingABitOpponent, justJoinedOpponent, dyingOfOldAgeOpponent],
        false,
      ),
    ).toBe(dyingOfOldAgeOpponent)
  })

  test('should pick the opponent with the closest rating', () => {
    const player = createPlayer({ rating: 1700 })
    const kindaFar = createPlayer({ name: 'ThirteenHundred', rating: 1300 })
    const gettingWarmer = createPlayer({ name: 'WarmPerson', rating: 1600 })
    const pickThis = createPlayer({ name: 'PickMePickMe', rating: 1730 })

    expect(DEFAULT_OPPONENT_CHOOSER(player, [kindaFar, gettingWarmer, pickThis], false)).toBe(
      pickThis,
    )
  })

  test('should pick randomly among the remaining opponents', () => {
    const player = createPlayer({ rating: 1700 })
    const kindaFar = createPlayer({ name: 'ThirteenHundred', rating: 1300 })
    const pickThis = createPlayer({ name: 'PickMe', rating: 1670 })
    const orThis = createPlayer({ name: 'OrMe', rating: 1730 })

    const result = DEFAULT_OPPONENT_CHOOSER(player, [kindaFar, pickThis, orThis], false)

    expect(result).not.toBe(kindaFar)
    // NOTE(tec27): The selection is random so we can't easily check for a specific value here, at
    // least without mocking out random in some way. If this test flakes out, it likely means the
    // logic in the function is wrong.
    expect([pickThis, orThis]).toContain(result)
  })

  test('should return asymmetric range matches if player is highly ranked', () => {
    const player = createPlayer()
    const opponent = createPlayer({
      name: 'ReallyBadDude',
      rating: 1400,
      interval: { low: 1310, high: 1490 },
    })

    expect(DEFAULT_OPPONENT_CHOOSER(player, [opponent], true)).toBeUndefined()
  })
})
*/
