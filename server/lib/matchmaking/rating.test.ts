import { describe, expect, test } from 'vitest'
import { ReconciledPlayerResult } from '../../../common/games/results'
import { makeLeagueId } from '../../../common/leagues/leagues'
import { makeSeasonId, MatchmakingSeason, MatchmakingType } from '../../../common/matchmaking'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { LeagueUser } from '../leagues/league-models'
import { DEFAULT_MATCHMAKING_RATING, MatchmakingRating } from './models'
import { calculateChangedRatings } from './rating'

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

function createLeagueUser(
  data: Partial<Omit<LeagueUser, 'userId' | 'leagueId'>> & { userId: number; leagueId: string },
): LeagueUser {
  return {
    lastPlayedDate: undefined,
    points: 0,
    pointsConverged: false,
    wins: 0,
    losses: 0,
    pWins: 0,
    pLosses: 0,
    tWins: 0,
    tLosses: 0,
    zWins: 0,
    zLosses: 0,
    rWins: 0,
    rLosses: 0,
    rPWins: 0,
    rPLosses: 0,
    rTWins: 0,
    rTLosses: 0,
    rZWins: 0,
    rZLosses: 0,
    ...data,
    userId: makeSbUserId(data.userId),
    leagueId: makeLeagueId(data.leagueId),
    isBanned: false,
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
      activeLeagues: new Map(),
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.0009599904000959991,
          "bonusUsedChange": 0.0009599904000959991,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.056800668788887634,
          "rating": 1467.5878493169462,
          "ratingChange": -32.412150683053824,
          "uncertainty": 318.6617548537152,
          "uncertaintyChange": -31.338245146284805,
          "userId": 1,
          "volatility": 0.059999457650202655,
          "volatilityChange": -5.42349797343078e-7,
        },
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "win",
          "points": 223.98293155291043,
          "pointsChange": 223.98293155291043,
          "pointsConverged": false,
          "probability": 0.8727767622922719,
          "rating": 2002.4341359287553,
          "ratingChange": 2.4341359287552677,
          "uncertainty": 70.48160153525924,
          "uncertaintyChange": 0.48160153525924443,
          "userId": 2,
          "volatility": 0.05999943068757301,
          "volatilityChange": -5.693124269859351e-7,
        },
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
      activeLeagues: new Map(),
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "win",
          "points": 223.96965173142758,
          "pointsChange": 223.96965173142758,
          "pointsConverged": false,
          "probability": 0.6394677305521533,
          "rating": 1631.3689199495877,
          "ratingChange": 131.36891994958773,
          "uncertainty": 252.16000623738702,
          "uncertaintyChange": -97.83999376261298,
          "userId": 1,
          "volatility": 0.0599988681523054,
          "volatilityChange": -0.0000011318476945965106,
        },
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.017068447089571587,
          "bonusUsedChange": 0.017068447089571587,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.4048860337291681,
          "rating": 1398.4327712791226,
          "ratingChange": -1.5672287208774378,
          "uncertainty": 31.701978358302014,
          "uncertaintyChange": 1.7019783583020143,
          "userId": 2,
          "volatility": 0.05999953267267602,
          "volatilityChange": -4.6732732397747334e-7,
        },
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
      activeLeagues: new Map(),
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "win",
          "points": 223.98293155291043,
          "pointsChange": 223.98293155291043,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1662.3108939062977,
          "ratingChange": 162.31089390629768,
          "uncertainty": 290.31896371798047,
          "uncertaintyChange": -59.681036282019534,
          "userId": 1,
          "volatility": 0.05999967537233814,
          "volatilityChange": -3.246276618559807e-7,
        },
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.017068447089571587,
          "bonusUsedChange": 0.017068447089571587,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1337.6891060937023,
          "ratingChange": -162.31089390629768,
          "uncertainty": 290.31896371798047,
          "uncertaintyChange": -59.681036282019534,
          "userId": 2,
          "volatility": 0.05999967537233814,
          "volatilityChange": -3.246276618559807e-7,
        },
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
      activeLeagues: new Map(),
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "win",
          "points": 223.96965173142758,
          "pointsChange": 223.96965173142758,
          "pointsConverged": false,
          "probability": 0.8235503599873776,
          "rating": 1865.905393230908,
          "ratingChange": 65.90539323090798,
          "uncertainty": 311.412945174442,
          "uncertaintyChange": -38.58705482555803,
          "userId": 1,
          "volatility": 0.05999942311664358,
          "volatilityChange": -5.768833564179232e-7,
        },
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.003035690556797335,
          "bonusUsedChange": 0.003035690556797335,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.17644964001262234,
          "rating": 1334.094606769092,
          "ratingChange": -65.90539323090798,
          "uncertainty": 311.412945174442,
          "uncertaintyChange": -38.58705482555803,
          "userId": 2,
          "volatility": 0.05999942311664358,
          "volatilityChange": -5.768833564179232e-7,
        },
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
      activeLeagues: new Map(),
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.030348268572443295,
          "bonusUsedChange": 0.030348268572443295,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.8235503599873776,
          "rating": 1492.3971427830152,
          "ratingChange": -307.60285721698483,
          "uncertainty": 311.4129540744156,
          "uncertaintyChange": -38.58704592558439,
          "userId": 1,
          "volatility": 0.06000186979181032,
          "volatilityChange": 0.0000018697918103202649,
        },
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "win",
          "points": 188.9969643094432,
          "pointsChange": 188.9969643094432,
          "pointsConverged": false,
          "probability": 0.17644964001262234,
          "rating": 1707.6028572169848,
          "ratingChange": 307.60285721698483,
          "uncertainty": 311.4129540744156,
          "uncertaintyChange": -38.58704592558439,
          "userId": 2,
          "volatility": 0.060001869791810374,
          "volatilityChange": 0.000001869791810375776,
        },
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
      activeLeagues: new Map(),
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "win",
          "points": 177.38116967993585,
          "pointsChange": 177.38116967993585,
          "pointsConverged": false,
          "probability": 0.9989873147672865,
          "rating": 1800.4773358542373,
          "ratingChange": 0.47733585423725344,
          "uncertainty": 349.8334735744819,
          "uncertaintyChange": -0.16652642551810004,
          "userId": 1,
          "volatility": 0.06,
          "volatilityChange": 0,
        },
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.003035690556797335,
          "bonusUsedChange": 0.003035690556797335,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.00101268523271354,
          "rating": 9.52266414576252,
          "ratingChange": -0.4773358542374808,
          "uncertainty": 349.8334735744819,
          "uncertaintyChange": -0.16652642551810004,
          "userId": 2,
          "volatility": 0.06,
          "volatilityChange": 0,
        },
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
      activeLeagues: new Map(),
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "win",
          "points": 106.13815472407867,
          "pointsChange": 106.13815472407867,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 163.3108939062979,
          "ratingChange": 162.3108939062979,
          "uncertainty": 290.31896371798047,
          "uncertaintyChange": -59.681036282019534,
          "userId": 1,
          "volatility": 0.05999967537233814,
          "volatilityChange": -3.246276618559807e-7,
        },
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 999999,
          "bonusUsedChange": 0,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "loss",
          "points": 0,
          "pointsChange": -0,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 0,
          "ratingChange": -1,
          "uncertainty": 290.31896371798047,
          "uncertaintyChange": -59.681036282019534,
          "userId": 2,
          "volatility": 0.05999967537233814,
          "volatilityChange": -3.246276618559807e-7,
        },
      }
    `)
  })

  test('1v1 - evenly matched veteran players', () => {
    const player = createMatchmakingRating({
      userId: 1,
      volatility: 0.04,
      uncertainty: 40,
      points: 5500,
      pointsConverged: true,
    })
    const opponent = createMatchmakingRating({
      userId: 2,
      uncertainty: 60,
      points: 5000,
      pointsConverged: true,
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
      activeLeagues: new Map(),
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "win",
          "points": 5592.560925760158,
          "pointsChange": 92.56092576015857,
          "pointsConverged": true,
          "probability": 0.5,
          "rating": 1504.599790880405,
          "ratingChange": 4.599790880404953,
          "uncertainty": 40.334200421176426,
          "uncertaintyChange": 0.33420042117642623,
          "userId": 1,
          "volatility": 0.04000000000000001,
          "volatilityChange": 6.938893903907228e-18,
        },
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 400,
          "bonusUsedChange": 0,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "loss",
          "points": 4988.7044765165065,
          "pointsChange": -11.295523483493623,
          "pointsConverged": true,
          "probability": 0.5,
          "rating": 1489.7214447426297,
          "ratingChange": -10.278555257370272,
          "uncertainty": 59.998307665971765,
          "uncertaintyChange": -0.0016923340282346544,
          "userId": 2,
          "volatility": 0.05999990538094029,
          "volatilityChange": -9.461905970536977e-8,
        },
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
      activeLeagues: new Map(),
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "win",
          "points": 223.96965173142758,
          "pointsChange": 223.96965173142758,
          "pointsConverged": false,
          "probability": 0.9067117622479638,
          "rating": 1800.6618473247609,
          "ratingChange": 0.6618473247608563,
          "uncertainty": 35.32545474406196,
          "uncertaintyChange": 0.3254547440619575,
          "userId": 1,
          "volatility": 0.029999875471499775,
          "volatilityChange": -1.2452850022340312e-7,
        },
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.003035690556797335,
          "bonusUsedChange": 0.003035690556797335,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.09207906580307251,
          "rating": 1398.6354857745691,
          "ratingChange": -1.3645142254308666,
          "uncertainty": 50.89348613457374,
          "uncertaintyChange": 0.8934861345737417,
          "userId": 2,
          "volatility": 0.05999900455341547,
          "volatilityChange": -9.954465845299354e-7,
        },
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
      activeLeagues: new Map(),
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.030348268572443295,
          "bonusUsedChange": 0.030348268572443295,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.9056755308175902,
          "rating": 1786.7379643790682,
          "ratingChange": -13.262035620931783,
          "uncertainty": 50.88715700186865,
          "uncertaintyChange": 0.8871570018686512,
          "userId": 1,
          "volatility": 0.05980933984299412,
          "volatilityChange": 0.000009339842994122993,
        },
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "win",
          "points": 188.9969643094432,
          "pointsChange": 188.9969643094432,
          "pointsConverged": false,
          "probability": 0.0932882377520363,
          "rating": 1418.9261362476745,
          "ratingChange": 18.92613624767455,
          "uncertainty": 60.59246954491489,
          "uncertaintyChange": 0.5924695449148913,
          "userId": 2,
          "volatility": 0.06000951093078874,
          "volatilityChange": 0.00000951093078874199,
        },
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
      activeLeagues: new Map(),
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "win",
          "points": 223.98293155291043,
          "pointsChange": 223.98293155291043,
          "pointsConverged": false,
          "probability": 0.7605034968281987,
          "rating": 1805.8998778914479,
          "ratingChange": 5.899877891447886,
          "uncertainty": 79.97578205828962,
          "uncertaintyChange": -0.024217941710375612,
          "userId": 1,
          "volatility": 0.059989253454822374,
          "volatilityChange": -7.465451776281218e-7,
        },
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.003035690556797335,
          "bonusUsedChange": 0.003035690556797335,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.15791408986566244,
          "rating": 1428.3426918304933,
          "ratingChange": -71.65730816950668,
          "uncertainty": 285.1836625372841,
          "uncertaintyChange": -64.81633746271592,
          "userId": 2,
          "volatility": 0.05999902050203107,
          "volatilityChange": -9.794979689281558e-7,
        },
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
      activeLeagues: new Map(),
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.017068447089571587,
          "bonusUsedChange": 0.017068447089571587,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.7605034968281987,
          "rating": 1789.2450205003195,
          "ratingChange": -10.75497949968053,
          "uncertainty": 60.59555369008366,
          "uncertaintyChange": 0.595553690083662,
          "userId": 1,
          "volatility": 0.05999233550668953,
          "volatilityChange": 0.000002335506689529754,
        },
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "win",
          "points": 223.9969643094432,
          "pointsChange": 223.9969643094432,
          "pointsConverged": false,
          "probability": 0.15492878366474863,
          "rating": 1887.1725788267997,
          "ratingChange": 387.17257882679974,
          "uncertainty": 284.6394234124444,
          "uncertaintyChange": -65.36057658755561,
          "userId": 2,
          "volatility": 0.060002935730022335,
          "volatilityChange": 0.000002935730022336769,
        },
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
      activeLeagues: new Map(),
    })
    const activePlayerChange = activeChanges.get(player.userId)?.matchmaking

    const inactiveChanges = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: INACTIVE_GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
      activeLeagues: new Map(),
    })
    const inactivePlayerChange = inactiveChanges.get(player.userId)?.matchmaking

    expect(activePlayerChange!.uncertainty).toBeLessThan(inactivePlayerChange!.uncertainty)

    const veryInactiveChanges = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: VERY_INACTIVE_GAME_DATE,
      results,
      mmrs: [player, opponent],
      teams: [[player.userId], [opponent.userId]],
      activeLeagues: new Map(),
    })
    const veryInactivePlayerChange = veryInactiveChanges.get(player.userId)?.matchmaking

    expect(inactivePlayerChange!.uncertainty).toBeLessThan(veryInactivePlayerChange!.uncertainty)
  })

  test('1v1 - player reaches point convergence', () => {
    const player = createMatchmakingRating({
      userId: 1,
      volatility: 0.04,
      uncertainty: 40,
      rating: 1500,
      points: 5990,
      pointsConverged: false,
    })
    const opponent = createMatchmakingRating({
      userId: 2,
      uncertainty: 60,
      points: 5000,
      pointsConverged: false,
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
      activeLeagues: new Map(),
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "win",
          "points": 6166.3453818031,
          "pointsChange": 176.3453818031001,
          "pointsConverged": true,
          "probability": 0.5,
          "rating": 1504.599790880405,
          "ratingChange": 4.599790880404953,
          "uncertainty": 40.334200421176426,
          "uncertaintyChange": 0.33420042117642623,
          "userId": 1,
          "volatility": 0.04000000000000001,
          "volatilityChange": 6.938893903907228e-18,
        },
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 400,
          "bonusUsedChange": 0,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "loss",
          "points": 4988.7044765165065,
          "pointsChange": -11.295523483493623,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1489.7214447426297,
          "ratingChange": -10.278555257370272,
          "uncertainty": 59.998307665971765,
          "uncertaintyChange": -0.0016923340282346544,
          "userId": 2,
          "volatility": 0.05999990538094029,
          "volatilityChange": -9.461905970536977e-8,
        },
      }
    `)
  })

  test('1v1 - one player in two leagues', () => {
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
      activeLeagues: new Map([
        [
          player.userId,
          [
            createLeagueUser({ userId: player.userId, leagueId: 'league-1' }),
            createLeagueUser({
              userId: player.userId,
              leagueId: 'league-2',
              points: 4000,
              pointsConverged: true,
            }),
          ],
        ],
      ]),
    })
    const playerChange = changes.get(player.userId)
    const opponentChange = changes.get(opponent.userId)

    expect(playerChange).toMatchInlineSnapshot(`
      {
        "leagues": [
          {
            "changeDate": 2022-05-02T00:00:00.000Z,
            "gameId": "asdfzxcv",
            "leagueId": "league-1",
            "outcome": "win",
            "points": 195.98293155291043,
            "pointsChange": 195.98293155291043,
            "pointsConverged": false,
            "userId": 1,
          },
          {
            "changeDate": 2022-05-02T00:00:00.000Z,
            "gameId": "asdfzxcv",
            "leagueId": "league-2",
            "outcome": "win",
            "points": 4090.8889393406057,
            "pointsChange": 90.88893934060584,
            "pointsConverged": true,
            "userId": 1,
          },
        ],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "win",
          "points": 223.98293155291043,
          "pointsChange": 223.98293155291043,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1662.3108939062977,
          "ratingChange": 162.31089390629768,
          "uncertainty": 290.31896371798047,
          "uncertaintyChange": -59.681036282019534,
          "userId": 1,
          "volatility": 0.05999967537233814,
          "volatilityChange": -3.246276618559807e-7,
        },
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.017068447089571587,
          "bonusUsedChange": 0.017068447089571587,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "1v1",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1337.6891060937023,
          "ratingChange": -162.31089390629768,
          "uncertainty": 290.31896371798047,
          "uncertaintyChange": -59.681036282019534,
          "userId": 2,
          "volatility": 0.05999967537233814,
          "volatilityChange": -3.246276618559807e-7,
        },
      }
    `)
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
      activeLeagues: new Map(),
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "win",
          "points": 222.73666625142027,
          "pointsChange": 222.73666625142027,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1581.1554469531488,
          "ratingChange": 81.15544695314884,
          "uncertainty": 290.31896371798047,
          "uncertaintyChange": -59.681036282019534,
          "userId": 1,
          "volatility": 0.05999967537233814,
          "volatilityChange": -3.246276618559807e-7,
        },
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "win",
          "points": 222.73666625142027,
          "pointsChange": 222.73666625142027,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1581.1554469531488,
          "ratingChange": 81.15544695314884,
          "uncertainty": 290.31896371798047,
          "uncertaintyChange": -59.681036282019534,
          "userId": 2,
          "volatility": 0.05999967537233814,
          "volatilityChange": -3.246276618559807e-7,
        },
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 1.263333748579728,
          "bonusUsedChange": 1.263333748579728,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1418.8445530468512,
          "ratingChange": -81.15544695314884,
          "uncertainty": 290.31896371798047,
          "uncertaintyChange": -59.681036282019534,
          "userId": 3,
          "volatility": 0.05999967537233814,
          "volatilityChange": -3.246276618559807e-7,
        },
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 1.263333748579728,
          "bonusUsedChange": 1.263333748579728,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1418.8445530468512,
          "ratingChange": -81.15544695314884,
          "uncertainty": 290.31896371798047,
          "uncertaintyChange": -59.681036282019534,
          "userId": 4,
          "volatility": 0.05999967537233814,
          "volatilityChange": -3.246276618559807e-7,
        },
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
      activeLeagues: new Map(),
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "win",
          "points": 220.11552070089303,
          "pointsChange": 220.11552070089303,
          "pointsConverged": false,
          "probability": 0.7938050043063389,
          "rating": 1837.5166905141596,
          "ratingChange": 37.51669051415956,
          "uncertainty": 307.3794082104756,
          "uncertaintyChange": -42.62059178952438,
          "userId": 1,
          "volatility": 0.059999390341488476,
          "volatilityChange": -6.096585115217268e-7,
        },
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "win",
          "points": 217.30320441354502,
          "pointsChange": 217.30320441354502,
          "pointsConverged": false,
          "probability": 0.7938050043063389,
          "rating": 1637.5166905141598,
          "ratingChange": 37.51669051415979,
          "uncertainty": 307.3794082104756,
          "uncertaintyChange": -42.62059178952438,
          "userId": 2,
          "volatility": 0.059999390341488476,
          "volatilityChange": -6.096585115217268e-7,
        },
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.22711330522330642,
          "bonusUsedChange": 0.22711330522330642,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.20619499569366112,
          "rating": 1362.4833094858402,
          "ratingChange": -37.51669051415979,
          "uncertainty": 307.3794082104756,
          "uncertaintyChange": -42.62059178952438,
          "userId": 3,
          "volatility": 0.059999390341488476,
          "volatilityChange": -6.096585115217268e-7,
        },
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.3026216815929803,
          "bonusUsedChange": 0.3026216815929803,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.20619499569366112,
          "rating": 1262.4833094858402,
          "ratingChange": -37.51669051415979,
          "uncertainty": 307.3794082104756,
          "uncertaintyChange": -42.62059178952438,
          "userId": 4,
          "volatility": 0.059999390341488476,
          "volatilityChange": -6.096585115217268e-7,
        },
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
      activeLeagues: new Map(),
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 3.884479299106977,
          "bonusUsedChange": 3.884479299106977,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.7938050043063389,
          "rating": 1655.56905489205,
          "ratingChange": -144.43094510795004,
          "uncertainty": 307.3794155872101,
          "uncertaintyChange": -42.620584412789924,
          "userId": 1,
          "volatility": 0.06000149915839679,
          "volatilityChange": 0.0000014991583967907673,
        },
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 6.696795586455,
          "bonusUsedChange": 6.696795586455,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.7938050043063389,
          "rating": 1455.56905489205,
          "ratingChange": -144.43094510795004,
          "uncertainty": 307.3794155872101,
          "uncertaintyChange": -42.620584412789924,
          "userId": 2,
          "volatility": 0.06000149915839679,
          "volatilityChange": 0.0000014991583967907673,
        },
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "win",
          "points": 188.7728866947767,
          "pointsChange": 188.7728866947767,
          "pointsConverged": false,
          "probability": 0.20619499569366112,
          "rating": 1544.43094510795,
          "ratingChange": 144.43094510795004,
          "uncertainty": 307.3794155872101,
          "uncertaintyChange": -42.620584412789924,
          "userId": 3,
          "volatility": 0.06000149915839679,
          "volatilityChange": 0.0000014991583967907673,
        },
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "win",
          "points": 188.697378318407,
          "pointsChange": 188.697378318407,
          "pointsConverged": false,
          "probability": 0.20619499569366112,
          "rating": 1444.43094510795,
          "ratingChange": 144.43094510795004,
          "uncertainty": 307.3794155872101,
          "uncertaintyChange": -42.620584412789924,
          "userId": 4,
          "volatility": 0.06000149915839679,
          "volatilityChange": 0.0000014991583967907673,
        },
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
      activeLeagues: new Map(),
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "win",
          "points": 222.73666625142027,
          "pointsChange": 222.73666625142027,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1508.6167992615306,
          "ratingChange": 8.61679926153056,
          "uncertainty": 80,
          "uncertaintyChange": 0,
          "userId": 1,
          "volatility": 0.059997856228701026,
          "volatilityChange": -1.4377129897713559e-7,
        },
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "win",
          "points": 222.73666625142027,
          "pointsChange": 222.73666625142027,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1507.634338624459,
          "ratingChange": 7.6343386244589055,
          "uncertainty": 80,
          "uncertaintyChange": 5,
          "userId": 2,
          "volatility": 0.059996871896271425,
          "volatilityChange": -1.2810372857635643e-7,
        },
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 1.263333748579728,
          "bonusUsedChange": 1.263333748579728,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1491.7453296608585,
          "ratingChange": -8.254670339141512,
          "uncertainty": 80,
          "uncertaintyChange": 2,
          "userId": 3,
          "volatility": 0.05999785994364396,
          "volatilityChange": -1.400563560405299e-7,
        },
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 1.263333748579728,
          "bonusUsedChange": 1.263333748579728,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1489.2199659882863,
          "ratingChange": -10.780034011713724,
          "uncertainty": 87.82933962119554,
          "uncertaintyChange": -2.170660378804456,
          "userId": 4,
          "volatility": 0.05999881979408518,
          "volatilityChange": -1.8020591481537895e-7,
        },
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
      activeLeagues: new Map(),
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "win",
          "points": 223.28545985421744,
          "pointsChange": 223.28545985421744,
          "pointsConverged": false,
          "probability": 0.5479951802792414,
          "rating": 1873.5772120852987,
          "ratingChange": 73.5772120852987,
          "uncertainty": 290.73793489520585,
          "uncertaintyChange": -59.26206510479415,
          "userId": 1,
          "volatility": 0.05999955486001053,
          "volatilityChange": -4.4513998946615896e-7,
        },
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "win",
          "points": 186.05727071695532,
          "pointsChange": 186.05727071695532,
          "pointsConverged": false,
          "probability": 0.5479951802792414,
          "rating": 1373.5772120852987,
          "ratingChange": 73.5772120852987,
          "uncertainty": 290.73793489520585,
          "uncertaintyChange": -59.26206510479415,
          "userId": 2,
          "volatility": 0.05999955486001053,
          "volatilityChange": -4.4513998946615896e-7,
        },
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 1.0959350448401675,
          "bonusUsedChange": 1.0959350448401675,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.45200481972075857,
          "rating": 1376.4227879147013,
          "ratingChange": -73.5772120852987,
          "uncertainty": 290.73793489520585,
          "uncertaintyChange": -59.26206510479415,
          "userId": 3,
          "volatility": 0.05999955486001053,
          "volatilityChange": -4.4513998946615896e-7,
        },
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.8241885714397832,
          "bonusUsedChange": 0.8241885714397832,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.45200481972075857,
          "rating": 1476.4227879147013,
          "ratingChange": -73.5772120852987,
          "uncertainty": 290.73793489520585,
          "uncertaintyChange": -59.26206510479415,
          "userId": 4,
          "volatility": 0.05999955486001053,
          "volatilityChange": -4.4513998946615896e-7,
        },
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
      activeLeagues: new Map(),
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.7145401457825784,
          "bonusUsedChange": 0.7145401457825784,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.5479951802792414,
          "rating": 1710.7975046540416,
          "ratingChange": -89.20249534595837,
          "uncertainty": 290.7379357113368,
          "uncertaintyChange": -59.262064288663225,
          "userId": 1,
          "volatility": 0.05999983057423894,
          "volatilityChange": -1.6942576105960505e-7,
        },
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 2.942729283044689,
          "bonusUsedChange": 2.942729283044689,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.5479951802792414,
          "rating": 1210.7975046540416,
          "ratingChange": -89.20249534595837,
          "uncertainty": 290.7379357113368,
          "uncertaintyChange": -59.262064288663225,
          "userId": 2,
          "volatility": 0.05999983057423894,
          "volatilityChange": -1.6942576105960505e-7,
        },
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "win",
          "points": 187.90406495515984,
          "pointsChange": 187.90406495515984,
          "pointsConverged": false,
          "probability": 0.45200481972075857,
          "rating": 1539.2024953459584,
          "ratingChange": 89.20249534595837,
          "uncertainty": 290.7379357113368,
          "uncertaintyChange": -59.262064288663225,
          "userId": 3,
          "volatility": 0.05999983057423894,
          "volatilityChange": -1.6942576105960505e-7,
        },
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "win",
          "points": 223.17581142856022,
          "pointsChange": 223.17581142856022,
          "pointsConverged": false,
          "probability": 0.45200481972075857,
          "rating": 1639.2024953459584,
          "ratingChange": 89.20249534595837,
          "uncertainty": 290.7379357113368,
          "uncertaintyChange": -59.262064288663225,
          "userId": 4,
          "volatility": 0.05999983057423894,
          "volatilityChange": -1.6942576105960505e-7,
        },
      }
    `)
  })

  test('2v2 - mixed league status', () => {
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
      activeLeagues: new Map([
        [player1.userId, [createLeagueUser({ userId: player1.userId, leagueId: 'league-1' })]],
        [
          player2.userId,
          [createLeagueUser({ userId: player2.userId, leagueId: 'league-2', points: 100 })],
        ],
        [
          opponent1.userId,
          [
            createLeagueUser({ userId: opponent1.userId, leagueId: 'league-1', points: 5750 }),
            createLeagueUser({ userId: opponent1.userId, leagueId: 'league-2', points: 500 }),
          ],
        ],
      ]),
    })
    const player1Change = changes.get(player1.userId)
    const player2Change = changes.get(player2.userId)
    const opponent1Change = changes.get(opponent1.userId)
    const opponent2Change = changes.get(opponent2.userId)

    expect(player1Change).toMatchInlineSnapshot(`
      {
        "leagues": [
          {
            "changeDate": 2022-05-02T00:00:00.000Z,
            "gameId": "asdfzxcv",
            "leagueId": "league-1",
            "outcome": "loss",
            "points": 0,
            "pointsChange": -0,
            "pointsConverged": false,
            "userId": 1,
          },
        ],
        "matchmaking": {
          "bonusUsed": 0.7145401457825784,
          "bonusUsedChange": 0.7145401457825784,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.5479951802792414,
          "rating": 1710.7975046540416,
          "ratingChange": -89.20249534595837,
          "uncertainty": 290.7379357113368,
          "uncertaintyChange": -59.262064288663225,
          "userId": 1,
          "volatility": 0.05999983057423894,
          "volatilityChange": -1.6942576105960505e-7,
        },
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      {
        "leagues": [
          {
            "changeDate": 2022-05-02T00:00:00.000Z,
            "gameId": "asdfzxcv",
            "leagueId": "league-2",
            "outcome": "loss",
            "points": 96.84493566328877,
            "pointsChange": -3.1550643367112396,
            "pointsConverged": false,
            "userId": 2,
          },
        ],
        "matchmaking": {
          "bonusUsed": 2.942729283044689,
          "bonusUsedChange": 2.942729283044689,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.5479951802792414,
          "rating": 1210.7975046540416,
          "ratingChange": -89.20249534595837,
          "uncertainty": 290.7379357113368,
          "uncertaintyChange": -59.262064288663225,
          "userId": 2,
          "volatility": 0.05999983057423894,
          "volatilityChange": -1.6942576105960505e-7,
        },
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      {
        "leagues": [
          {
            "changeDate": 2022-05-02T00:00:00.000Z,
            "gameId": "asdfzxcv",
            "leagueId": "league-1",
            "outcome": "win",
            "points": 5870.704029917078,
            "pointsChange": 120.70402991707724,
            "pointsConverged": true,
            "userId": 3,
          },
          {
            "changeDate": 2022-05-02T00:00:00.000Z,
            "gameId": "asdfzxcv",
            "leagueId": "league-2",
            "outcome": "win",
            "points": 659.437236462308,
            "pointsChange": 159.43723646230796,
            "pointsConverged": false,
            "userId": 3,
          },
        ],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "win",
          "points": 187.90406495515984,
          "pointsChange": 187.90406495515984,
          "pointsConverged": false,
          "probability": 0.45200481972075857,
          "rating": 1539.2024953459584,
          "ratingChange": 89.20249534595837,
          "uncertainty": 290.7379357113368,
          "uncertaintyChange": -59.262064288663225,
          "userId": 3,
          "volatility": 0.05999983057423894,
          "volatilityChange": -1.6942576105960505e-7,
        },
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 28,
          "bonusUsedChange": 28,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "win",
          "points": 223.17581142856022,
          "pointsChange": 223.17581142856022,
          "pointsConverged": false,
          "probability": 0.45200481972075857,
          "rating": 1639.2024953459584,
          "ratingChange": 89.20249534595837,
          "uncertainty": 290.7379357113368,
          "uncertaintyChange": -59.262064288663225,
          "userId": 4,
          "volatility": 0.05999983057423894,
          "volatilityChange": -1.6942576105960505e-7,
        },
      }
    `)
  })

  test('team modes scale rating moves by team size and keep a higher uncertainty floor', () => {
    function evenWin(matchmakingType: MatchmakingType, teamSize: number) {
      const players = Array.from({ length: teamSize * 2 }, (_, i) =>
        createMatchmakingRating({ matchmakingType, userId: i + 1, uncertainty: 60 }),
      )
      const winners = players.slice(0, teamSize)
      const losers = players.slice(teamSize)
      const changes = calculateChangedRatings({
        season: SEASON,
        gameId: GAME_ID,
        gameDate: GAME_DATE,
        results: new Map([
          ...winners.map(p => [p.userId, WIN] as const),
          ...losers.map(p => [p.userId, LOSS] as const),
        ]),
        mmrs: players,
        teams: [winners.map(p => p.userId), losers.map(p => p.userId)],
        activeLeagues: new Map(),
      })
      return changes.get(winners[0].userId)!.matchmaking
    }

    const twos = evenWin(MatchmakingType.Match2v2, 2)
    const threes = evenWin(MatchmakingType.Match3v3Bgh, 3)

    // The same evenly matched win moves a 3v3 rating by 1/3 where a 2v2 one moves by 1/2.
    expect(threes.ratingChange / twos.ratingChange).toBeCloseTo(2 / 3)
    expect(twos.uncertainty).toBe(80)
    expect(threes.uncertainty).toBe(100)
  })

  test('3v3 - a weaker player is not rewarded for winning with stronger teammates', () => {
    const veteran = {
      matchmakingType: MatchmakingType.Match3v3Bgh,
      uncertainty: 60,
      pointsConverged: true,
    }
    const weak = createMatchmakingRating({ ...veteran, userId: 1, rating: 1300, points: 5200 })
    const strong1 = createMatchmakingRating({ ...veteran, userId: 2, rating: 1700, points: 6800 })
    const strong2 = createMatchmakingRating({ ...veteran, userId: 3, rating: 1700, points: 6800 })
    const opponents = [4, 5, 6].map(userId =>
      createMatchmakingRating({ ...veteran, userId, rating: 1567, points: 6268 }),
    )
    const results = new Map([
      [weak.userId, WIN],
      [strong1.userId, WIN],
      [strong2.userId, WIN],
      ...opponents.map(o => [o.userId, LOSS] as const),
    ])

    const changes = calculateChangedRatings({
      season: SEASON,
      gameId: GAME_ID,
      gameDate: GAME_DATE,
      results,
      mmrs: [weak, strong1, strong2, ...opponents],
      teams: [[weak.userId, strong1.userId, strong2.userId], opponents.map(o => o.userId)],
      activeLeagues: new Map(),
    })
    const weakChange = changes.get(weak.userId)!.matchmaking
    const strongChange = changes.get(strong1.userId)!.matchmaking

    // Both teams average 1567, so the win was a coin flip for everyone on the winning team, and
    // teammates with the same uncertainty move by the same amount.
    expect(weakChange.probability).toBeCloseTo(0.5)
    expect(strongChange.probability).toBeCloseTo(0.5)
    expect(weakChange.ratingChange).toBeCloseTo(strongChange.ratingChange)
    // Points also price in teammates: the weaker player's points sit at their rating target, so
    // they earn what their teammates do for an even win.
    expect(weakChange.pointsChange).toBeCloseTo(strongChange.pointsChange)
  })
})
