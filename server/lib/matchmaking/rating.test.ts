import { ReconciledPlayerResult } from '../../../common/games/results'
import { makeSeasonId, MatchmakingSeason, MatchmakingType } from '../../../common/matchmaking'
import { makeSbUserId } from '../../../common/users/sb-user'
import {
  DEFAULT_MATCHMAKING_RATING,
  LEGACY_DEFAULT_MATCHMAKING_RATING,
  MatchmakingRating,
} from './models'
import { calculateChangedRatings, legacyCalculateChangedRatings } from './rating'

const GAME_ID = 'asdfzxcv'
const GAME_DATE = new Date('2022-05-02T00:00:00.000Z')
const INACTIVE_GAME_DATE = new Date('2022-05-26T00:00:00.000Z')
const VERY_INACTIVE_GAME_DATE = new Date('2022-07-01T00:00:00.000Z')

const WIN: ReconciledPlayerResult = {
  result: 'win',
  race: 'p',
  apm: 7,
}

const LOSS: ReconciledPlayerResult = {
  result: 'loss',
  race: 't',
  apm: 400,
}

const SEASON: MatchmakingSeason = {
  id: makeSeasonId(1),
  name: 'Season 1',
  startDate: new Date('2022-05-01T00:00:00.000Z'),
  useLegacyRating: false,
  resetMmr: true,
}

function createMatchmakingRating(
  data: Partial<Omit<MatchmakingRating, 'userId'>> & Partial<{ userId: number }> = {},
): MatchmakingRating {
  return {
    ...DEFAULT_MATCHMAKING_RATING,
    matchmakingType: MatchmakingType.Match1v1,
    seasonId: SEASON.id,
    ...data,
    userId: makeSbUserId(data.userId ?? 1),
  }
}

describe('matchmaking/rating/calculateChangedRatings', () => {
  test('1v1 - basic math check', () => {
    // Check against the numbers in the example here: https://github.com/KenanY/glicko2-lite#example
    const player = createMatchmakingRating({
      userId: 1,
      rating: 1500,
      uncertainty: 350,
      volatility: 0.06,
    })
    const opponent = createMatchmakingRating({ userId: 2, rating: 2000, uncertainty: 70 })
    const results = new Map([
      [player.userId, LOSS],
      [opponent.userId, WIN],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.599999999999999e-19,
        "bonusUsedChange": 9.599999999999999e-19,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.056800668788887634,
        "rating": 1467.5878493169462,
        "ratingChange": -32.412150683053824,
        "uncertainty": 318.6617548537152,
        "uncertaintyChange": -31.338245146284805,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.059999457650202655,
        "volatilityChange": -5.42349797343078e-7,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 153.14285714285705,
        "pointsChange": 153.14285714285705,
        "probability": 0.8727767622922719,
        "rating": 2002.4341359287553,
        "ratingChange": 2.4341359287552677,
        "uncertainty": 70.48160153525924,
        "uncertaintyChange": 0.48160153525924443,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.05999943068757301,
        "volatilityChange": -5.693124269859351e-7,
      }
    `)
  })

  test('1v1 - first glicko example calculation', () => {
    // Roughly matches the first iteration of the example calculation in
    // http://www.glicko.net/glicko/glicko2.pdf (we don't calculate multiple games at once, so the
    // initial numbers will match but the later ones will not)
    const player = createMatchmakingRating({ userId: 1 })
    const opponent = createMatchmakingRating({ userId: 2, rating: 1400, uncertainty: 30 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 153.14285714285617,
        "pointsChange": 153.14285714285617,
        "probability": 0.6394677305521533,
        "rating": 1631.3689199495877,
        "ratingChange": 131.36891994958773,
        "uncertainty": 252.16000623738702,
        "uncertaintyChange": -97.83999376261298,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.0599988681523054,
        "volatilityChange": -0.0000011318476945965106,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.599999999999992e-14,
        "bonusUsedChange": 9.599999999999992e-14,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.4048860337291681,
        "rating": 1398.4327712791226,
        "ratingChange": -1.5672287208774378,
        "uncertainty": 31.701978358302014,
        "uncertaintyChange": 1.7019783583020143,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.05999953267267602,
        "volatilityChange": -4.6732732397747334e-7,
      }
    `)
  })

  test('1v1 - evenly matched new players', () => {
    const player = createMatchmakingRating({ userId: 1 })
    const opponent = createMatchmakingRating({ userId: 2 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 153.14285714285705,
        "pointsChange": 153.14285714285705,
        "probability": 0.5,
        "rating": 1662.3108939062977,
        "ratingChange": 162.31089390629768,
        "uncertainty": 290.31896371798047,
        "uncertaintyChange": -59.681036282019534,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.05999967537233814,
        "volatilityChange": -3.246276618559807e-7,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.599999999999992e-14,
        "bonusUsedChange": 9.599999999999992e-14,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.5,
        "rating": 1337.6891060937023,
        "ratingChange": -162.31089390629768,
        "uncertainty": 290.31896371798047,
        "uncertaintyChange": -59.681036282019534,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.05999967537233814,
        "volatilityChange": -3.246276618559807e-7,
      }
    `)
  })

  test('1v1 - better new player wins', () => {
    const player = createMatchmakingRating({ userId: 1, rating: 1800 })
    const opponent = createMatchmakingRating({ userId: 2, rating: 1400 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 153.14285714285617,
        "pointsChange": 153.14285714285617,
        "probability": 0.8235503599873776,
        "rating": 1865.905393230908,
        "ratingChange": 65.90539323090798,
        "uncertainty": 311.412945174442,
        "uncertaintyChange": -38.58705482555803,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.05999942311664358,
        "volatilityChange": -5.768833564179232e-7,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.600000000000001e-17,
        "bonusUsedChange": 9.600000000000001e-17,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.17644964001262234,
        "rating": 1334.094606769092,
        "ratingChange": -65.90539323090798,
        "uncertainty": 311.412945174442,
        "uncertaintyChange": -38.58705482555803,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.05999942311664358,
        "volatilityChange": -5.768833564179232e-7,
      }
    `)
  })

  test('1v1 - better new player loses', () => {
    const player = createMatchmakingRating({ userId: 1, rating: 1800 })
    const opponent = createMatchmakingRating({ userId: 2, rating: 1400 })
    const results = new Map([
      [player.userId, LOSS],
      [opponent.userId, WIN],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.599999999999905e-13,
        "bonusUsedChange": 9.599999999999905e-13,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.8235503599873776,
        "rating": 1492.3971427830152,
        "ratingChange": -307.60285721698483,
        "uncertainty": 311.4129540744156,
        "uncertaintyChange": -38.58704592558439,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.06000186979181032,
        "volatilityChange": 0.0000018697918103202649,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 153.14285714285714,
        "pointsChange": 153.14285714285714,
        "probability": 0.17644964001262234,
        "rating": 1707.6028572169848,
        "ratingChange": 307.60285721698483,
        "uncertainty": 311.4129540744156,
        "uncertaintyChange": -38.58704592558439,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.060001869791810374,
        "volatilityChange": 0.000001869791810375776,
      }
    `)
  })

  test('1v1 - wildly better new player wins', () => {
    const player = createMatchmakingRating({ userId: 1, rating: 1800 })
    const opponent = createMatchmakingRating({ userId: 2, rating: 10 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 53.501916841180105,
        "bonusUsedChange": 53.501916841180105,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 107.00383368236021,
        "pointsChange": 107.00383368236021,
        "probability": 0.9989873147672865,
        "rating": 1800.4773358542373,
        "ratingChange": 0.47733585423725344,
        "uncertainty": 349.8334735744819,
        "uncertaintyChange": -0.16652642551810004,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.06,
        "volatilityChange": 0,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.600000000000001e-17,
        "bonusUsedChange": 9.600000000000001e-17,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.00101268523271354,
        "rating": 9.52266414576252,
        "ratingChange": -0.4773358542374808,
        "uncertainty": 349.8334735744819,
        "uncertaintyChange": -0.16652642551810004,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.06,
        "volatilityChange": 0,
      }
    `)
  })

  test("1v1 - really bad players can't go below 0", () => {
    const player = createMatchmakingRating({ userId: 1, rating: 1 })
    const opponent = createMatchmakingRating({ userId: 2, rating: 1, bonusUsed: 999999 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 48.55259600746991,
        "bonusUsedChange": 48.55259600746991,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 97.10519201493982,
        "pointsChange": 97.10519201493982,
        "probability": 0.5,
        "rating": 163.3108939062979,
        "ratingChange": 162.3108939062979,
        "uncertainty": 290.31896371798047,
        "uncertaintyChange": -59.681036282019534,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.05999967537233814,
        "volatilityChange": -3.246276618559807e-7,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 999999,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 0,
        "pointsChange": -0,
        "probability": 0.5,
        "rating": 0,
        "ratingChange": -1,
        "uncertainty": 290.31896371798047,
        "uncertaintyChange": -59.681036282019534,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.05999967537233814,
        "volatilityChange": -3.246276618559807e-7,
      }
    `)
  })

  test('1v1 - evenly matched veteran players', () => {
    const player = createMatchmakingRating({
      userId: 1,
      volatility: 0.04,
      uncertainty: 40,
      points: 5500,
    })
    const opponent = createMatchmakingRating({
      userId: 2,
      uncertainty: 60,
      points: 5000,
      bonusUsed: 400,
    })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 5648.031796483463,
        "pointsChange": 148.03179648346298,
        "probability": 0.5,
        "rating": 1504.599790880405,
        "ratingChange": 4.599790880404953,
        "uncertainty": 40.334200421176426,
        "uncertaintyChange": 0.33420042117642623,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.04000000000000001,
        "volatilityChange": 6.938893903907228e-18,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 400,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 4999.969651731428,
        "pointsChange": -0.0303482685724433,
        "probability": 0.5,
        "rating": 1489.7214447426297,
        "ratingChange": -10.278555257370272,
        "uncertainty": 59.998307665971765,
        "uncertaintyChange": -0.0016923340282346544,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.05999990538094029,
        "volatilityChange": -9.461905970536977e-8,
      }
    `)
  })

  test('1v1 - better veteran player wins', () => {
    const player = createMatchmakingRating({
      userId: 1,
      rating: 1800,
      volatility: 0.03,
      uncertainty: 35,
    })
    const opponent = createMatchmakingRating({
      userId: 2,
      rating: 1400,
      uncertainty: 50,
    })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 153.14285714285617,
        "pointsChange": 153.14285714285617,
        "probability": 0.9067117622479638,
        "rating": 1800.6618473247609,
        "ratingChange": 0.6618473247608563,
        "uncertainty": 35.32545474406196,
        "uncertaintyChange": 0.3254547440619575,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.029999875471499775,
        "volatilityChange": -1.2452850022340312e-7,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.600000000000001e-17,
        "bonusUsedChange": 9.600000000000001e-17,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.09207906580307251,
        "rating": 1398.6354857745691,
        "ratingChange": -1.3645142254308666,
        "uncertainty": 50.89348613457374,
        "uncertaintyChange": 0.8934861345737417,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.05999900455341547,
        "volatilityChange": -9.954465845299354e-7,
      }
    `)
  })

  test('1v1 - better veteran player loses', () => {
    const player = createMatchmakingRating({
      userId: 1,
      rating: 1800,
      volatility: 0.0598,
      uncertainty: 50,
    })
    const opponent = createMatchmakingRating({
      userId: 2,
      rating: 1400,
      uncertainty: 60,
    })
    const results = new Map([
      [player.userId, LOSS],
      [opponent.userId, WIN],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.599999999999905e-13,
        "bonusUsedChange": 9.599999999999905e-13,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.9056755308175902,
        "rating": 1786.7379643790682,
        "ratingChange": -13.262035620931783,
        "uncertainty": 50.88715700186865,
        "uncertaintyChange": 0.8871570018686512,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.05980933984299412,
        "volatilityChange": 0.000009339842994122993,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 153.14285714285714,
        "pointsChange": 153.14285714285714,
        "probability": 0.0932882377520363,
        "rating": 1418.9261362476745,
        "ratingChange": 18.92613624767455,
        "uncertainty": 60.59246954491489,
        "uncertaintyChange": 0.5924695449148913,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.06000951093078874,
        "volatilityChange": 0.00000951093078874199,
      }
    `)
  })

  test('1v1 - well-defined veteran player wins versus new player', () => {
    const player = createMatchmakingRating({
      userId: 1,
      rating: 1800,
      volatility: 0.05999,
      uncertainty: 80,
    })
    const opponent = createMatchmakingRating({ userId: 2 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 153.14285714285705,
        "pointsChange": 153.14285714285705,
        "probability": 0.7605034968281987,
        "rating": 1805.8998778914479,
        "ratingChange": 5.899877891447886,
        "uncertainty": 79.97578205828962,
        "uncertaintyChange": -0.024217941710375612,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.059989253454822374,
        "volatilityChange": -7.465451776281218e-7,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.600000000000001e-17,
        "bonusUsedChange": 9.600000000000001e-17,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.15791408986566244,
        "rating": 1428.3426918304933,
        "ratingChange": -71.65730816950668,
        "uncertainty": 285.1836625372841,
        "uncertaintyChange": -64.81633746271592,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.05999902050203107,
        "volatilityChange": -9.794979689281558e-7,
      }
    `)
  })

  test('1v1 - well-defined veteran player loses versus new player', () => {
    const player = createMatchmakingRating({
      userId: 1,
      rating: 1800,
      volatility: 0.05999,
      uncertainty: 60,
    })
    const opponent = createMatchmakingRating({ userId: 2 })
    const results = new Map([
      [player.userId, LOSS],
      [opponent.userId, WIN],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.599999999999992e-14,
        "bonusUsedChange": 9.599999999999992e-14,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.7605034968281987,
        "rating": 1789.2450205003195,
        "ratingChange": -10.75497949968053,
        "uncertainty": 60.59555369008366,
        "uncertaintyChange": 0.595553690083662,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.05999233550668953,
        "volatilityChange": 0.000002335506689529754,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 153.14285714285714,
        "pointsChange": 153.14285714285714,
        "probability": 0.15492878366474863,
        "rating": 1887.1725788267997,
        "ratingChange": 387.17257882679974,
        "uncertainty": 284.6394234124444,
        "uncertaintyChange": -65.36057658755561,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.060002935730022335,
        "volatilityChange": 0.000002935730022336769,
      }
    `)
  })

  test('1v1 - inactive player should have higher uncertainty', () => {
    const player = createMatchmakingRating({
      userId: 1,
      rating: 1800,
      uncertainty: 100,
      lastPlayedDate: GAME_DATE,
    })
    const opponent = createMatchmakingRating({ userId: 2 })
    const results = new Map([
      [player.userId, LOSS],
      [opponent.userId, WIN],
    ])

    const activeChanges = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const activePlayerChange = activeChanges.get(player.userId)

    const inactiveChanges = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: INACTIVE_GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const inactivePlayerChange = inactiveChanges.get(player.userId)

    expect(activePlayerChange!.uncertainty).toBeLessThan(inactivePlayerChange!.uncertainty)

    const veryInactiveChanges = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: VERY_INACTIVE_GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const veryInactivePlayerChange = veryInactiveChanges.get(player.userId)

    expect(inactivePlayerChange!.uncertainty).toBeLessThan(veryInactivePlayerChange!.uncertainty)
  })

  test('2v2 - evenly matched new players', () => {
    const player1 = createMatchmakingRating({
      userId: 1,
      matchmakingType: MatchmakingType.Match2v2,
    })
    const player2 = createMatchmakingRating({
      userId: 2,
      matchmakingType: MatchmakingType.Match2v2,
    })
    const opponent1 = createMatchmakingRating({
      userId: 3,
      matchmakingType: MatchmakingType.Match2v2,
    })
    const opponent2 = createMatchmakingRating({
      userId: 4,
      matchmakingType: MatchmakingType.Match2v2,
    })
    const results = new Map([
      [player1.userId, WIN],
      [player2.userId, WIN],
      [opponent1.userId, LOSS],
      [opponent2.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player1, player2, opponent1, opponent2],
      teams: [
        [player1.userId, player2.userId],
        [opponent1.userId, opponent2.userId],
      ],
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 153.14285714285705,
        "pointsChange": 153.14285714285705,
        "probability": 0.5,
        "rating": 1662.3108939062977,
        "ratingChange": 162.31089390629768,
        "uncertainty": 290.31896371798047,
        "uncertaintyChange": -59.681036282019534,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.05999967537233814,
        "volatilityChange": -3.246276618559807e-7,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 153.14285714285705,
        "pointsChange": 153.14285714285705,
        "probability": 0.5,
        "rating": 1662.3108939062977,
        "ratingChange": 162.31089390629768,
        "uncertainty": 290.31896371798047,
        "uncertaintyChange": -59.681036282019534,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.05999967537233814,
        "volatilityChange": -3.246276618559807e-7,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.599999999999992e-14,
        "bonusUsedChange": 9.599999999999992e-14,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.5,
        "rating": 1337.6891060937023,
        "ratingChange": -162.31089390629768,
        "uncertainty": 290.31896371798047,
        "uncertaintyChange": -59.681036282019534,
        "unexpectedStreak": 0,
        "userId": 3,
        "volatility": 0.05999967537233814,
        "volatilityChange": -3.246276618559807e-7,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.599999999999992e-14,
        "bonusUsedChange": 9.599999999999992e-14,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.5,
        "rating": 1337.6891060937023,
        "ratingChange": -162.31089390629768,
        "uncertainty": 290.31896371798047,
        "uncertaintyChange": -59.681036282019534,
        "unexpectedStreak": 0,
        "userId": 4,
        "volatility": 0.05999967537233814,
        "volatilityChange": -3.246276618559807e-7,
      }
    `)
  })

  test('2v2 - better new players win', () => {
    const player1 = createMatchmakingRating({
      userId: 1,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1800,
    })
    const player2 = createMatchmakingRating({
      userId: 2,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1600,
    })
    const opponent1 = createMatchmakingRating({
      userId: 3,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1400,
    })
    const opponent2 = createMatchmakingRating({
      userId: 4,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1300,
    })
    const results = new Map([
      [player1.userId, WIN],
      [player2.userId, WIN],
      [opponent1.userId, LOSS],
      [opponent2.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player1, player2, opponent1, opponent2],
      teams: [
        [player1.userId, player2.userId],
        [opponent1.userId, opponent2.userId],
      ],
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 153.1428571428541,
        "pointsChange": 153.1428571428541,
        "probability": 0.8498165352583855,
        "rating": 1857.5592656406598,
        "ratingChange": 57.55926564065976,
        "uncertainty": 315.4518908402125,
        "uncertaintyChange": -34.54810915978749,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.05999946380461907,
        "volatilityChange": -5.361953809290831e-7,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 153.1428571428541,
        "pointsChange": 153.1428571428541,
        "probability": 0.7236957078097978,
        "rating": 1695.680481793672,
        "ratingChange": 95.68048179367202,
        "uncertainty": 299.8502625357793,
        "uncertaintyChange": -50.14973746422072,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.0599993619635724,
        "volatilityChange": -6.380364276012407e-7,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.6e-16,
        "bonusUsedChange": 9.6e-16,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.2394965031718012,
        "rating": 1315.0462251564052,
        "ratingChange": -84.95377484359483,
        "uncertainty": 303.47877653289225,
        "uncertaintyChange": -46.521223467107745,
        "unexpectedStreak": 0,
        "userId": 3,
        "volatility": 0.05999936878118545,
        "volatilityChange": -6.312188145507491e-7,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.6e-16,
        "bonusUsedChange": 9.6e-16,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.17644964001262234,
        "rating": 1234.094606769092,
        "ratingChange": -65.90539323090798,
        "uncertainty": 311.412945174442,
        "uncertaintyChange": -38.58705482555803,
        "unexpectedStreak": 0,
        "userId": 4,
        "volatility": 0.05999942311664358,
        "volatilityChange": -5.768833564179232e-7,
      }
    `)
  })

  test('2v2 - better new players lose', () => {
    const player1 = createMatchmakingRating({
      userId: 1,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1800,
    })
    const player2 = createMatchmakingRating({
      userId: 2,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1600,
    })
    const opponent1 = createMatchmakingRating({
      userId: 3,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1400,
    })
    const opponent2 = createMatchmakingRating({
      userId: 4,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1300,
    })
    const results = new Map([
      [player1.userId, LOSS],
      [player2.userId, LOSS],
      [opponent1.userId, WIN],
      [opponent2.userId, WIN],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player1, player2, opponent1, opponent2],
      teams: [
        [player1.userId, player2.userId],
        [opponent1.userId, opponent2.userId],
      ],
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 3.035786553761548e-12,
        "bonusUsedChange": 3.035786553761548e-12,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.8498165352583855,
        "rating": 1474.2995705361905,
        "ratingChange": -325.70042946380954,
        "uncertainty": 315.45190137125803,
        "uncertaintyChange": -34.54809862874197,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.06000224908005475,
        "volatilityChange": 0.00000224908005475033,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 3.035786553761548e-12,
        "bonusUsedChange": 3.035786553761548e-12,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.7236957078097978,
        "rating": 1349.3938453619537,
        "ratingChange": -250.6061546380463,
        "uncertainty": 299.85026725700897,
        "uncertaintyChange": -50.149732742991034,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.060000815893369294,
        "volatilityChange": 8.158933692964387e-7,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 153.14285714285714,
        "pointsChange": 153.14285714285714,
        "probability": 0.2394965031718012,
        "rating": 1669.7644622294274,
        "ratingChange": 269.7644622294274,
        "uncertainty": 303.478782514052,
        "uncertaintyChange": -46.521217485948,
        "unexpectedStreak": 0,
        "userId": 3,
        "volatility": 0.060001145426850394,
        "volatilityChange": 0.0000011454268503963139,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 153.14285714285714,
        "pointsChange": 153.14285714285714,
        "probability": 0.17644964001262234,
        "rating": 1607.6028572169848,
        "ratingChange": 307.60285721698483,
        "uncertainty": 311.4129540744156,
        "uncertaintyChange": -38.58704592558439,
        "unexpectedStreak": 0,
        "userId": 4,
        "volatility": 0.060001869791810374,
        "volatilityChange": 0.000001869791810375776,
      }
    `)
  })

  test('2v2 - evenly matched veteran players', () => {
    const player1 = createMatchmakingRating({
      userId: 1,
      matchmakingType: MatchmakingType.Match2v2,
      uncertainty: 80,
      volatility: 0.059998,
    })
    const player2 = createMatchmakingRating({
      userId: 2,
      matchmakingType: MatchmakingType.Match2v2,
      uncertainty: 75,
      volatility: 0.059997,
    })
    const opponent1 = createMatchmakingRating({
      userId: 3,
      matchmakingType: MatchmakingType.Match2v2,
      uncertainty: 78,
      volatility: 0.059998,
    })
    const opponent2 = createMatchmakingRating({
      userId: 4,
      matchmakingType: MatchmakingType.Match2v2,
      uncertainty: 90,
      volatility: 0.059999,
    })
    const results = new Map([
      [player1.userId, WIN],
      [player2.userId, WIN],
      [opponent1.userId, LOSS],
      [opponent2.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player1, player2, opponent1, opponent2],
      teams: [
        [player1.userId, player2.userId],
        [opponent1.userId, opponent2.userId],
      ],
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 153.14285714285705,
        "pointsChange": 153.14285714285705,
        "probability": 0.5,
        "rating": 1517.2335985230613,
        "ratingChange": 17.233598523061346,
        "uncertainty": 78.71902251626597,
        "uncertaintyChange": -1.2809774837340342,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.059997856228701026,
        "volatilityChange": -1.4377129897713559e-7,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 153.14285714285705,
        "pointsChange": 153.14285714285705,
        "probability": 0.5,
        "rating": 1515.2686772489176,
        "ratingChange": 15.268677248917584,
        "uncertainty": 74.09559920868182,
        "uncertaintyChange": -0.9044007913181815,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.059996871896271425,
        "volatilityChange": -1.2810372857635643e-7,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.599999999999992e-14,
        "bonusUsedChange": 9.599999999999992e-14,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.5,
        "rating": 1483.4906593217172,
        "ratingChange": -16.509340678282797,
        "uncertainty": 76.8562904109994,
        "uncertaintyChange": -1.1437095890005935,
        "unexpectedStreak": 0,
        "userId": 3,
        "volatility": 0.05999785994364396,
        "volatilityChange": -1.400563560405299e-7,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.599999999999992e-14,
        "bonusUsedChange": 9.599999999999992e-14,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.5,
        "rating": 1478.4399319765726,
        "ratingChange": -21.560068023427448,
        "uncertainty": 87.82933962119554,
        "uncertaintyChange": -2.170660378804456,
        "unexpectedStreak": 0,
        "userId": 4,
        "volatility": 0.05999881979408518,
        "volatilityChange": -1.8020591481537895e-7,
      }
    `)
  })

  test('2v2 - mixed upper/lower ratings', () => {
    const player1 = createMatchmakingRating({
      userId: 1,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1800,
    })
    const player2 = createMatchmakingRating({
      userId: 2,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1300,
    })
    const opponent1 = createMatchmakingRating({
      userId: 3,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1450,
    })
    const opponent2 = createMatchmakingRating({
      userId: 4,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1550,
    })
    const results = new Map([
      [player1.userId, WIN],
      [player2.userId, WIN],
      [opponent1.userId, LOSS],
      [opponent2.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player1, player2, opponent1, opponent2],
      teams: [
        [player1.userId, player2.userId],
        [opponent1.userId, opponent2.userId],
      ],
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 153.14285714285705,
        "pointsChange": 153.14285714285705,
        "probability": 0.7605034968281987,
        "rating": 1884.9537748435948,
        "ratingChange": 84.95377484359483,
        "uncertainty": 303.47877653289225,
        "uncertaintyChange": -46.521223467107745,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.05999936878118545,
        "volatilityChange": -6.312188145507491e-7,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 153.14285714285705,
        "pointsChange": 153.14285714285705,
        "probability": 0.31641538274428405,
        "rating": 1531.6685868916709,
        "ratingChange": 231.66858689167088,
        "uncertainty": 296.63610268512616,
        "uncertaintyChange": -53.36389731487384,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.060000516405673956,
        "volatilityChange": 5.164056739587197e-7,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 3.035786553761644e-14,
        "bonusUsedChange": 3.035786553761644e-14,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.4048860337291681,
        "rating": 1317.0615327748344,
        "ratingChange": -132.9384672251656,
        "uncertainty": 291.9748928608564,
        "uncertaintyChange": -58.025107139143586,
        "unexpectedStreak": 0,
        "userId": 3,
        "volatility": 0.059999466487748024,
        "volatilityChange": -5.335122519739555e-7,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 3.035786553761644e-14,
        "bonusUsedChange": 3.035786553761644e-14,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.5,
        "rating": 1387.689106093702,
        "ratingChange": -162.3108939062979,
        "uncertainty": 290.31896371798047,
        "uncertaintyChange": -59.681036282019534,
        "unexpectedStreak": 0,
        "userId": 4,
        "volatility": 0.05999967537233814,
        "volatilityChange": -3.246276618559807e-7,
      }
    `)
  })

  test('2v2 - mixed upper/lower ratings, highest loses', () => {
    const player1 = createMatchmakingRating({
      userId: 1,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1800,
    })
    const player2 = createMatchmakingRating({
      userId: 2,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1300,
    })
    const opponent1 = createMatchmakingRating({
      userId: 3,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1450,
    })
    const opponent2 = createMatchmakingRating({
      userId: 4,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1550,
    })
    const results = new Map([
      [player1.userId, LOSS],
      [player2.userId, LOSS],
      [opponent1.userId, WIN],
      [opponent2.userId, WIN],
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player1, player2, opponent1, opponent2],
      teams: [
        [player1.userId, player2.userId],
        [opponent1.userId, opponent2.userId],
      ],
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.599999999999992e-14,
        "bonusUsedChange": 9.599999999999992e-14,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.7605034968281987,
        "rating": 1530.2355377705726,
        "ratingChange": -269.7644622294274,
        "uncertainty": 303.478782514052,
        "uncertaintyChange": -46.521217485948,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0.060001145426850366,
        "volatilityChange": 0.0000011454268503685583,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 9.599999999999992e-14,
        "bonusUsedChange": 9.599999999999992e-14,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 0,
        "pointsChange": 0,
        "probability": 0.31641538274428405,
        "rating": 1192.7660146747735,
        "ratingChange": -107.23398532522651,
        "uncertainty": 296.63609909206434,
        "uncertaintyChange": -53.36390090793566,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0.059999373539620704,
        "volatilityChange": -6.264603792938139e-7,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 153.1428571428571,
        "pointsChange": 153.1428571428571,
        "probability": 0.4048860337291681,
        "rating": 1645.3970569806693,
        "ratingChange": 195.39705698066928,
        "uncertainty": 291.97489452700995,
        "uncertaintyChange": -58.02510547299005,
        "unexpectedStreak": 0,
        "userId": 3,
        "volatility": 0.060000022241762076,
        "volatilityChange": 2.2241762077934712e-8,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 57.142857142857146,
        "bonusUsedChange": 57.142857142857146,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 0,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 153.1428571428571,
        "pointsChange": 153.1428571428571,
        "probability": 0.5,
        "rating": 1712.3108939062977,
        "ratingChange": 162.31089390629768,
        "uncertainty": 290.31896371798047,
        "uncertaintyChange": -59.681036282019534,
        "unexpectedStreak": 0,
        "userId": 4,
        "volatility": 0.05999967537233814,
        "volatilityChange": -3.246276618559807e-7,
      }
    `)
  })
})

/** @deprecated For legacy ratings only, will be deleted soon. */
function legacyCreateMatchmakingRating(
  data: Partial<Omit<MatchmakingRating, 'userId'>> & Partial<{ userId: number }> = {},
): MatchmakingRating {
  return {
    ...LEGACY_DEFAULT_MATCHMAKING_RATING,
    matchmakingType: MatchmakingType.Match1v1,
    seasonId: makeSeasonId(1),
    ...data,
    userId: makeSbUserId(data.userId ?? 1),
    points: data.points ?? data.rating ?? LEGACY_DEFAULT_MATCHMAKING_RATING.points,
  }
}

describe('matchmaking/rating/legacyCalculateChangedRatings', () => {
  test('1v1 - evenly matched new players', () => {
    const player = legacyCreateMatchmakingRating({ userId: 1 })
    const opponent = legacyCreateMatchmakingRating({ userId: 2 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 1520,
        "pointsChange": 20,
        "probability": 0.5,
        "rating": 1520,
        "ratingChange": 20,
        "uncertainty": 180,
        "uncertaintyChange": -20,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 1480,
        "pointsChange": -20,
        "probability": 0.5,
        "rating": 1480,
        "ratingChange": -20,
        "uncertainty": 220,
        "uncertaintyChange": 20,
        "unexpectedStreak": 1,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test('1v1 - better new player wins', () => {
    const player = legacyCreateMatchmakingRating({ userId: 1, rating: 1800 })
    const opponent = legacyCreateMatchmakingRating({ userId: 2, rating: 1400 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 1803.6363636363637,
        "pointsChange": 3.6363636363637397,
        "probability": 0.9090909090909091,
        "rating": 1803.6363636363637,
        "ratingChange": 3.6363636363637397,
        "uncertainty": 196.36363636363637,
        "uncertaintyChange": -3.636363636363626,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 1396.3636363636363,
        "pointsChange": -3.6363636363637397,
        "probability": 0.09090909090909091,
        "rating": 1396.3636363636363,
        "ratingChange": -3.6363636363637397,
        "uncertainty": 196.36363636363637,
        "uncertaintyChange": -3.636363636363626,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test('1v1 - better new player loses', () => {
    const player = legacyCreateMatchmakingRating({ userId: 1, rating: 1800 })
    const opponent = legacyCreateMatchmakingRating({ userId: 2, rating: 1400 })
    const results = new Map([
      [player.userId, LOSS],
      [opponent.userId, WIN],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 1763.6363636363637,
        "pointsChange": -36.36363636363626,
        "probability": 0.9090909090909091,
        "rating": 1763.6363636363637,
        "ratingChange": -36.36363636363626,
        "uncertainty": 236.36363636363637,
        "uncertaintyChange": 36.363636363636374,
        "unexpectedStreak": 1,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 1436.3636363636363,
        "pointsChange": 36.36363636363626,
        "probability": 0.09090909090909091,
        "rating": 1436.3636363636363,
        "ratingChange": 36.36363636363626,
        "uncertainty": 236.36363636363637,
        "uncertaintyChange": 36.363636363636374,
        "unexpectedStreak": 1,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test('1v1 - wildly better new player wins', () => {
    const player = legacyCreateMatchmakingRating({ userId: 1, rating: 1800 })
    const opponent = legacyCreateMatchmakingRating({ userId: 2, rating: 10 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 1800.0013398168774,
        "pointsChange": 0.0013398168773619545,
        "probability": 0.9999665045780651,
        "rating": 1800.0013398168774,
        "ratingChange": 0.0013398168773619545,
        "uncertainty": 199.9986601831226,
        "uncertaintyChange": -0.0013398168773903762,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 9.998660183122604,
        "pointsChange": -0.0013398168773957053,
        "probability": 0.00003349542193491098,
        "rating": 9.998660183122604,
        "ratingChange": -0.0013398168773957053,
        "uncertainty": 199.9986601831226,
        "uncertaintyChange": -0.0013398168773903762,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test("1v1 - really bad players can't go below 0", () => {
    const player = legacyCreateMatchmakingRating({ userId: 1, rating: 1 })
    const opponent = legacyCreateMatchmakingRating({ userId: 2, rating: 1 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 21,
        "pointsChange": 20,
        "probability": 0.5,
        "rating": 21,
        "ratingChange": 20,
        "uncertainty": 180,
        "uncertaintyChange": -20,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 0,
        "pointsChange": -1,
        "probability": 0.5,
        "rating": 0,
        "ratingChange": -1,
        "uncertainty": 220,
        "uncertaintyChange": 20,
        "unexpectedStreak": 1,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test('1v1 - evenly matched veteran players', () => {
    const player = legacyCreateMatchmakingRating({ userId: 1, numGamesPlayed: 25 })
    const opponent = legacyCreateMatchmakingRating({ userId: 2, numGamesPlayed: 25 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 39.5,
        "kFactorChange": -0.5,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 1520,
        "pointsChange": 20,
        "probability": 0.5,
        "rating": 1520,
        "ratingChange": 20,
        "uncertainty": 180,
        "uncertaintyChange": -20,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 1480,
        "pointsChange": -20,
        "probability": 0.5,
        "rating": 1480,
        "ratingChange": -20,
        "uncertainty": 220,
        "uncertaintyChange": 20,
        "unexpectedStreak": 1,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test('1v1 - better veteran player wins', () => {
    const player = legacyCreateMatchmakingRating({ userId: 1, rating: 1800, numGamesPlayed: 25 })
    const opponent = legacyCreateMatchmakingRating({ userId: 2, rating: 1400, numGamesPlayed: 25 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 39.09090909090909,
        "kFactorChange": -0.9090909090909065,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 1803.6363636363637,
        "pointsChange": 3.6363636363637397,
        "probability": 0.9090909090909091,
        "rating": 1803.6363636363637,
        "ratingChange": 3.6363636363637397,
        "uncertainty": 196.36363636363637,
        "uncertaintyChange": -3.636363636363626,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 39.09090909090909,
        "kFactorChange": -0.9090909090909065,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 1396.3636363636363,
        "pointsChange": -3.6363636363637397,
        "probability": 0.09090909090909091,
        "rating": 1396.3636363636363,
        "ratingChange": -3.6363636363637397,
        "uncertainty": 196.36363636363637,
        "uncertaintyChange": -3.636363636363626,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test('1v1 - better veteran player loses', () => {
    const player = legacyCreateMatchmakingRating({ userId: 1, rating: 1800, numGamesPlayed: 25 })
    const opponent = legacyCreateMatchmakingRating({ userId: 2, rating: 1400, numGamesPlayed: 25 })
    const results = new Map([
      [player.userId, LOSS],
      [opponent.userId, WIN],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 1763.6363636363637,
        "pointsChange": -36.36363636363626,
        "probability": 0.9090909090909091,
        "rating": 1763.6363636363637,
        "ratingChange": -36.36363636363626,
        "uncertainty": 236.36363636363637,
        "uncertaintyChange": 36.363636363636374,
        "unexpectedStreak": 1,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 1436.3636363636363,
        "pointsChange": 36.36363636363626,
        "probability": 0.09090909090909091,
        "rating": 1436.3636363636363,
        "ratingChange": 36.36363636363626,
        "uncertainty": 236.36363636363637,
        "uncertaintyChange": 36.363636363636374,
        "unexpectedStreak": 1,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test('1v1 - well-defined veteran player wins versus new player', () => {
    const player = legacyCreateMatchmakingRating({
      userId: 1,
      rating: 1800,
      numGamesPlayed: 25,
      kFactor: 24,
      uncertainty: 80,
    })
    const opponent = legacyCreateMatchmakingRating({ userId: 2 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 24,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 1803.6235093730718,
        "pointsChange": 3.6235093730717836,
        "probability": 0.8490204427886767,
        "rating": 1803.6235093730718,
        "ratingChange": 3.6235093730717836,
        "uncertainty": 80,
        "uncertaintyChange": 0,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 1493.9608177115472,
        "pointsChange": -6.039182288452821,
        "probability": 0.15097955721132328,
        "rating": 1493.9608177115472,
        "ratingChange": -6.039182288452821,
        "uncertainty": 193.96081771154707,
        "uncertaintyChange": -6.039182288452935,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test('1v1 - well-defined veteran player loses versus new player', () => {
    const player = legacyCreateMatchmakingRating({
      userId: 1,
      rating: 1800,
      numGamesPlayed: 25,
      kFactor: 24,
      uncertainty: 80,
    })
    const opponent = legacyCreateMatchmakingRating({ userId: 2 })
    const results = new Map([
      [player.userId, LOSS],
      [opponent.userId, WIN],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 24,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 1779.6235093730718,
        "pointsChange": -20.376490626928216,
        "probability": 0.8490204427886767,
        "rating": 1779.6235093730718,
        "ratingChange": -20.376490626928216,
        "uncertainty": 100.37649062692824,
        "uncertaintyChange": 20.376490626928245,
        "unexpectedStreak": 1,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 1533.960817711547,
        "pointsChange": 33.96081771154695,
        "probability": 0.15097955721132328,
        "rating": 1533.960817711547,
        "ratingChange": 33.96081771154695,
        "uncertainty": 233.96081771154707,
        "uncertaintyChange": 33.960817711547065,
        "unexpectedStreak": 1,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test('1v1 - well-defined veteran player continues a loss streak versus new player', () => {
    const player = legacyCreateMatchmakingRating({
      userId: 1,
      rating: 1800,
      numGamesPlayed: 25,
      kFactor: 24,
      uncertainty: 120,
      unexpectedStreak: 2,
    })
    const opponent = legacyCreateMatchmakingRating({ userId: 2 })
    const results = new Map([
      [player.userId, LOSS],
      [opponent.userId, WIN],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 25,
        "kFactorChange": 1,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 1779.6235093730718,
        "pointsChange": -20.376490626928216,
        "probability": 0.8490204427886767,
        "rating": 1779.6235093730718,
        "ratingChange": -20.376490626928216,
        "uncertainty": 140.37649062692824,
        "uncertaintyChange": 20.376490626928245,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 1533.960817711547,
        "pointsChange": 33.96081771154695,
        "probability": 0.15097955721132328,
        "rating": 1533.960817711547,
        "ratingChange": 33.96081771154695,
        "uncertainty": 233.96081771154707,
        "uncertaintyChange": 33.960817711547065,
        "unexpectedStreak": 1,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test('1v1 - well-defined veteran player ends a loss streak versus new player', () => {
    const player = legacyCreateMatchmakingRating({
      userId: 1,
      rating: 1800,
      numGamesPlayed: 25,
      kFactor: 24,
      uncertainty: 120,
      unexpectedStreak: 2,
    })
    const opponent = legacyCreateMatchmakingRating({ userId: 2 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 24,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "points": 1803.6235093730718,
        "pointsChange": 3.6235093730717836,
        "probability": 0.8490204427886767,
        "rating": 1803.6235093730718,
        "ratingChange": 3.6235093730717836,
        "uncertainty": 116.37649062692824,
        "uncertaintyChange": -3.623509373071755,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "points": 1493.9608177115472,
        "pointsChange": -6.039182288452821,
        "probability": 0.15097955721132328,
        "rating": 1493.9608177115472,
        "ratingChange": -6.039182288452821,
        "uncertainty": 193.96081771154707,
        "uncertaintyChange": -6.039182288452935,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test('2v2 - evenly matched new players', () => {
    const player1 = legacyCreateMatchmakingRating({
      userId: 1,
      matchmakingType: MatchmakingType.Match2v2,
    })
    const player2 = legacyCreateMatchmakingRating({
      userId: 2,
      matchmakingType: MatchmakingType.Match2v2,
    })
    const opponent1 = legacyCreateMatchmakingRating({
      userId: 3,
      matchmakingType: MatchmakingType.Match2v2,
    })
    const opponent2 = legacyCreateMatchmakingRating({
      userId: 4,
      matchmakingType: MatchmakingType.Match2v2,
    })
    const results = new Map([
      [player1.userId, WIN],
      [player2.userId, WIN],
      [opponent1.userId, LOSS],
      [opponent2.userId, LOSS],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player1, player2, opponent1, opponent2],
      teams: [
        [player1.userId, player2.userId],
        [opponent1.userId, opponent2.userId],
      ],
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 1520,
        "pointsChange": 20,
        "probability": 0.5,
        "rating": 1520,
        "ratingChange": 20,
        "uncertainty": 180,
        "uncertaintyChange": -20,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 1520,
        "pointsChange": 20,
        "probability": 0.5,
        "rating": 1520,
        "ratingChange": 20,
        "uncertainty": 180,
        "uncertaintyChange": -20,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 1480,
        "pointsChange": -20,
        "probability": 0.5,
        "rating": 1480,
        "ratingChange": -20,
        "uncertainty": 220,
        "uncertaintyChange": 20,
        "unexpectedStreak": 1,
        "userId": 3,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 1480,
        "pointsChange": -20,
        "probability": 0.5,
        "rating": 1480,
        "ratingChange": -20,
        "uncertainty": 220,
        "uncertaintyChange": 20,
        "unexpectedStreak": 1,
        "userId": 4,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test('2v2 - better new players win', () => {
    const player1 = legacyCreateMatchmakingRating({
      userId: 1,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1800,
    })
    const player2 = legacyCreateMatchmakingRating({
      userId: 2,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1600,
    })
    const opponent1 = legacyCreateMatchmakingRating({
      userId: 3,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1400,
    })
    const opponent2 = legacyCreateMatchmakingRating({
      userId: 4,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1300,
    })
    const results = new Map([
      [player1.userId, WIN],
      [player2.userId, WIN],
      [opponent1.userId, LOSS],
      [opponent2.userId, LOSS],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player1, player2, opponent1, opponent2],
      teams: [
        [player1.userId, player2.userId],
        [opponent1.userId, opponent2.userId],
      ],
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 1802.7903314943562,
        "pointsChange": 2.7903314943562236,
        "probability": 0.9302417126410938,
        "rating": 1802.7903314943562,
        "ratingChange": 2.7903314943562236,
        "uncertainty": 197.20966850564375,
        "uncertaintyChange": -2.790331494356252,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 1607.6672930980217,
        "pointsChange": 7.667293098021673,
        "probability": 0.8083176725494586,
        "rating": 1607.6672930980217,
        "ratingChange": 7.667293098021673,
        "uncertainty": 192.33270690197836,
        "uncertaintyChange": -7.667293098021645,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 1393.9608177115472,
        "pointsChange": -6.039182288452821,
        "probability": 0.15097955721132328,
        "rating": 1393.9608177115472,
        "ratingChange": -6.039182288452821,
        "uncertainty": 193.96081771154707,
        "uncertaintyChange": -6.039182288452935,
        "unexpectedStreak": 0,
        "userId": 3,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 1296.3636363636363,
        "pointsChange": -3.6363636363637397,
        "probability": 0.09090909090909091,
        "rating": 1296.3636363636363,
        "ratingChange": -3.6363636363637397,
        "uncertainty": 196.36363636363637,
        "uncertaintyChange": -3.636363636363626,
        "unexpectedStreak": 0,
        "userId": 4,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test('2v2 - better new players lose', () => {
    const player1 = legacyCreateMatchmakingRating({
      userId: 1,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1800,
    })
    const player2 = legacyCreateMatchmakingRating({
      userId: 2,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1600,
    })
    const opponent1 = legacyCreateMatchmakingRating({
      userId: 3,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1400,
    })
    const opponent2 = legacyCreateMatchmakingRating({
      userId: 4,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1300,
    })
    const results = new Map([
      [player1.userId, LOSS],
      [player2.userId, LOSS],
      [opponent1.userId, WIN],
      [opponent2.userId, WIN],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player1, player2, opponent1, opponent2],
      teams: [
        [player1.userId, player2.userId],
        [opponent1.userId, opponent2.userId],
      ],
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 1762.7903314943562,
        "pointsChange": -37.209668505643776,
        "probability": 0.9302417126410938,
        "rating": 1762.7903314943562,
        "ratingChange": -37.209668505643776,
        "uncertainty": 237.20966850564375,
        "uncertaintyChange": 37.20966850564375,
        "unexpectedStreak": 1,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 1567.6672930980217,
        "pointsChange": -32.33270690197833,
        "probability": 0.8083176725494586,
        "rating": 1567.6672930980217,
        "ratingChange": -32.33270690197833,
        "uncertainty": 232.33270690197836,
        "uncertaintyChange": 32.332706901978355,
        "unexpectedStreak": 1,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 1433.960817711547,
        "pointsChange": 33.96081771154695,
        "probability": 0.15097955721132328,
        "rating": 1433.960817711547,
        "ratingChange": 33.96081771154695,
        "uncertainty": 233.96081771154707,
        "uncertaintyChange": 33.960817711547065,
        "unexpectedStreak": 1,
        "userId": 3,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 1336.3636363636363,
        "pointsChange": 36.36363636363626,
        "probability": 0.09090909090909091,
        "rating": 1336.3636363636363,
        "ratingChange": 36.36363636363626,
        "uncertainty": 236.36363636363637,
        "uncertaintyChange": 36.363636363636374,
        "unexpectedStreak": 1,
        "userId": 4,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test('2v2 - evenly matched veteran players', () => {
    const player1 = legacyCreateMatchmakingRating({
      userId: 1,
      matchmakingType: MatchmakingType.Match2v2,
      numGamesPlayed: 30,
    })
    const player2 = legacyCreateMatchmakingRating({
      userId: 2,
      matchmakingType: MatchmakingType.Match2v2,
      numGamesPlayed: 35,
    })
    const opponent1 = legacyCreateMatchmakingRating({
      userId: 3,
      matchmakingType: MatchmakingType.Match2v2,
      numGamesPlayed: 25,
    })
    const opponent2 = legacyCreateMatchmakingRating({
      userId: 4,
      matchmakingType: MatchmakingType.Match2v2,
      numGamesPlayed: 40,
    })
    const results = new Map([
      [player1.userId, WIN],
      [player2.userId, WIN],
      [opponent1.userId, LOSS],
      [opponent2.userId, LOSS],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player1, player2, opponent1, opponent2],
      teams: [
        [player1.userId, player2.userId],
        [opponent1.userId, opponent2.userId],
      ],
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 39.5,
        "kFactorChange": -0.5,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 1520,
        "pointsChange": 20,
        "probability": 0.5,
        "rating": 1520,
        "ratingChange": 20,
        "uncertainty": 180,
        "uncertaintyChange": -20,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 39.5,
        "kFactorChange": -0.5,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 1520,
        "pointsChange": 20,
        "probability": 0.5,
        "rating": 1520,
        "ratingChange": 20,
        "uncertainty": 180,
        "uncertaintyChange": -20,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 1480,
        "pointsChange": -20,
        "probability": 0.5,
        "rating": 1480,
        "ratingChange": -20,
        "uncertainty": 220,
        "uncertaintyChange": 20,
        "unexpectedStreak": 1,
        "userId": 3,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 1480,
        "pointsChange": -20,
        "probability": 0.5,
        "rating": 1480,
        "ratingChange": -20,
        "uncertainty": 220,
        "uncertaintyChange": 20,
        "unexpectedStreak": 1,
        "userId": 4,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test('2v2 - mixed upper/lower ratings', () => {
    const player1 = legacyCreateMatchmakingRating({
      userId: 1,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1800,
    })
    const player2 = legacyCreateMatchmakingRating({
      userId: 2,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1300,
    })
    const opponent1 = legacyCreateMatchmakingRating({
      userId: 3,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1450,
    })
    const opponent2 = legacyCreateMatchmakingRating({
      userId: 4,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1550,
    })
    const results = new Map([
      [player1.userId, WIN],
      [player2.userId, WIN],
      [opponent1.userId, LOSS],
      [opponent2.userId, LOSS],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player1, player2, opponent1, opponent2],
      teams: [
        [player1.userId, player2.userId],
        [opponent1.userId, opponent2.userId],
      ],
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 1806.0391822884528,
        "pointsChange": 6.039182288452821,
        "probability": 0.8490204427886767,
        "rating": 1806.0391822884528,
        "ratingChange": 6.039182288452821,
        "uncertainty": 193.96081771154707,
        "uncertaintyChange": -6.039182288452935,
        "unexpectedStreak": 0,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 1330.3898770659184,
        "pointsChange": 30.389877065918427,
        "probability": 0.2402530733520421,
        "rating": 1330.3898770659184,
        "ratingChange": 30.389877065918427,
        "uncertainty": 230.3898770659183,
        "uncertaintyChange": 30.389877065918313,
        "unexpectedStreak": 1,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 1435.6025999921153,
        "pointsChange": -14.397400007884698,
        "probability": 0.35993500019711494,
        "rating": 1435.6025999921153,
        "ratingChange": -14.397400007884698,
        "uncertainty": 185.60259999211542,
        "uncertaintyChange": -14.397400007884585,
        "unexpectedStreak": 0,
        "userId": 3,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 1530,
        "pointsChange": -20,
        "probability": 0.5,
        "rating": 1530,
        "ratingChange": -20,
        "uncertainty": 220,
        "uncertaintyChange": 20,
        "unexpectedStreak": 1,
        "userId": 4,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })

  test('2v2 - mixed upper/lower ratings, highest loses', () => {
    const player1 = legacyCreateMatchmakingRating({
      userId: 1,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1800,
    })
    const player2 = legacyCreateMatchmakingRating({
      userId: 2,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1300,
    })
    const opponent1 = legacyCreateMatchmakingRating({
      userId: 3,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1450,
    })
    const opponent2 = legacyCreateMatchmakingRating({
      userId: 4,
      matchmakingType: MatchmakingType.Match2v2,
      rating: 1550,
    })
    const results = new Map([
      [player1.userId, LOSS],
      [player2.userId, LOSS],
      [opponent1.userId, WIN],
      [opponent2.userId, WIN],
    ])

    const changes = legacyCalculateChangedRatings({
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [player1, player2, opponent1, opponent2],
      teams: [
        [player1.userId, player2.userId],
        [opponent1.userId, opponent2.userId],
      ],
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 1766.039182288453,
        "pointsChange": -33.96081771154695,
        "probability": 0.8490204427886767,
        "rating": 1766.039182288453,
        "ratingChange": -33.96081771154695,
        "uncertainty": 233.96081771154707,
        "uncertaintyChange": 33.960817711547065,
        "unexpectedStreak": 1,
        "userId": 1,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "loss",
        "points": 1290.3898770659184,
        "pointsChange": -9.610122934081573,
        "probability": 0.2402530733520421,
        "rating": 1290.3898770659184,
        "ratingChange": -9.610122934081573,
        "uncertainty": 190.3898770659183,
        "uncertaintyChange": -9.610122934081687,
        "unexpectedStreak": 0,
        "userId": 2,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 1475.6025999921153,
        "pointsChange": 25.6025999921153,
        "probability": 0.35993500019711494,
        "rating": 1475.6025999921153,
        "ratingChange": 25.6025999921153,
        "uncertainty": 225.60259999211542,
        "uncertaintyChange": 25.602599992115415,
        "unexpectedStreak": 1,
        "userId": 3,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "bonusUsed": 0,
        "bonusUsedChange": 0,
        "changeDate": 2022-05-02T00:00:00.000Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "2v2",
        "outcome": "win",
        "points": 1570,
        "pointsChange": 20,
        "probability": 0.5,
        "rating": 1570,
        "ratingChange": 20,
        "uncertainty": 180,
        "uncertaintyChange": -20,
        "unexpectedStreak": 0,
        "userId": 4,
        "volatility": 0,
        "volatilityChange": 0,
      }
    `)
  })
})
