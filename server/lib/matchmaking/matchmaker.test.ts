import { DEFAULT_OPPONENT_CHOOSER } from './matchmaker'
import { MatchmakingPlayer } from './matchmaking-player'

function createPlayer(data: Partial<MatchmakingPlayer> = {}): MatchmakingPlayer {
  return {
    id: 1,
    name: 'tec27',
    numGamesPlayed: 0,
    rating: 1500,
    searchIterations: 0,
    race: 'r',
    useAlternateRace: false,
    alternateRace: 'z',
    preferredMaps: new Set([]),

    ...data,

    interval: {
      low: 1500,
      high: 1500,
      ...(data.interval ?? {}),
    },
  }
}

describe('matchmaking/matchmaker/DEFAULT_OPPONENT_CHOOSER', () => {
  test('should return the only opponent option if there is only 1', () => {
    const player = createPlayer()
    const opponent = createPlayer({ name: 'ReallyBadDude' })

    expect(DEFAULT_OPPONENT_CHOOSER(player, [opponent])).toBe(opponent)
  })

  test('should pick the only new opponent if player is new', () => {
    const player = createPlayer()
    const newOpponent = createPlayer({ name: 'SuperChoboNewbie' })
    const oldOpponent = createPlayer({ name: 'GrizzledVet', numGamesPlayed: 9001 })

    expect(DEFAULT_OPPONENT_CHOOSER(player, [oldOpponent, newOpponent])).toBe(newOpponent)
  })

  test('should pick the only old player if player is not new', () => {
    const player = createPlayer({ numGamesPlayed: 5000 })
    const newOpponent = createPlayer({ name: 'SuperChoboNewbie' })
    const oldOpponent = createPlayer({ name: 'GrizzledVet', numGamesPlayed: 9001 })

    expect(DEFAULT_OPPONENT_CHOOSER(player, [oldOpponent, newOpponent])).toBe(oldOpponent)
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
      DEFAULT_OPPONENT_CHOOSER(player, [
        waitingABitOpponent,
        justJoinedOpponent,
        dyingOfOldAgeOpponent,
      ]),
    ).toBe(dyingOfOldAgeOpponent)
  })

  test('should pick the opponent with the closest rating', () => {
    const player = createPlayer({ rating: 1700 })
    const kindaFar = createPlayer({ name: 'ThirteenHundred', rating: 1300 })
    const gettingWarmer = createPlayer({ name: 'WarmPerson', rating: 1600 })
    const pickThis = createPlayer({ name: 'PickMePickMe', rating: 1730 })

    expect(DEFAULT_OPPONENT_CHOOSER(player, [kindaFar, gettingWarmer, pickThis])).toBe(pickThis)
  })

  test('should pick randomly among the remaining opponents', () => {
    const player = createPlayer({ rating: 1700 })
    const kindaFar = createPlayer({ name: 'ThirteenHundred', rating: 1300 })
    const pickThis = createPlayer({ name: 'PickMe', rating: 1670 })
    const orThis = createPlayer({ name: 'OrMe', rating: 1730 })

    const result = DEFAULT_OPPONENT_CHOOSER(player, [kindaFar, pickThis, orThis])

    expect(result).not.toBe(kindaFar)
    // NOTE(tec27): The selection is random so we can't easily check for a specific value here, at
    // least without mocking out random in some way. If this test flakes out, it likely means the
    // logic in the function is wrong.
    expect([pickThis, orThis]).toContain(result)
  })
})
