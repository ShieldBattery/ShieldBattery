import { ReconciledPlayerResult } from '../../../common/games/results'
import { makeLeagueId } from '../../../common/leagues'
import { makeSeasonId, MatchmakingSeason, MatchmakingType } from '../../../common/matchmaking'
import { makeSbUserId } from '../../../common/users/sb-user'
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
          "points": 423.98293155291043,
          "pointsChange": 423.98293155291043,
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
          "points": 323.9696517314276,
          "pointsChange": 323.9696517314276,
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
          "bonusUsed": 0.01706844708957159,
          "bonusUsedChange": 0.01706844708957159,
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
          "points": 323.98293155291043,
          "pointsChange": 323.98293155291043,
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
          "bonusUsed": 0.01706844708957159,
          "bonusUsedChange": 0.01706844708957159,
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
          "points": 373.9696517314276,
          "pointsChange": 373.9696517314276,
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
          "bonusUsed": 0.0303482685724433,
          "bonusUsedChange": 0.0303482685724433,
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
          "points": 273.99696430944323,
          "pointsChange": 273.99696430944323,
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
          "points": 327.38116967993585,
          "pointsChange": 327.38116967993585,
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
          "points": 176.13815472407867,
          "pointsChange": 176.13815472407867,
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
          "points": 373.9696517314276,
          "pointsChange": 373.9696517314276,
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
          "bonusUsed": 0.0303482685724433,
          "bonusUsedChange": 0.0303482685724433,
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
          "points": 273.99696430944323,
          "pointsChange": 273.99696430944323,
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
          "points": 373.98293155291043,
          "pointsChange": 373.98293155291043,
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
          "bonusUsed": 0.01706844708957159,
          "bonusUsedChange": 0.01706844708957159,
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
          "points": 323.99696430944323,
          "pointsChange": 323.99696430944323,
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
          "points": 6266.3453818031,
          "pointsChange": 276.3453818031001,
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
            "points": 295.98293155291043,
            "pointsChange": 295.98293155291043,
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
          "points": 323.98293155291043,
          "pointsChange": 323.98293155291043,
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
          "bonusUsed": 0.01706844708957159,
          "bonusUsedChange": 0.01706844708957159,
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
          "points": 323.98293155291043,
          "pointsChange": 323.98293155291043,
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
          "points": 323.98293155291043,
          "pointsChange": 323.98293155291043,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1662.3108939062977,
          "ratingChange": 162.31089390629768,
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
          "bonusUsed": 0.01706844708957159,
          "bonusUsedChange": 0.01706844708957159,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1337.6891060937023,
          "ratingChange": -162.31089390629768,
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
          "bonusUsed": 0.01706844708957159,
          "bonusUsedChange": 0.01706844708957159,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1337.6891060937023,
          "ratingChange": -162.31089390629768,
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
          "points": 373.95953419995726,
          "pointsChange": 373.95953419995726,
          "pointsConverged": false,
          "probability": 0.8498165352583855,
          "rating": 1857.5592656406598,
          "ratingChange": 57.55926564065976,
          "uncertainty": 315.4518908402125,
          "uncertaintyChange": -34.54810915978749,
          "userId": 1,
          "volatility": 0.05999946380461907,
          "volatilityChange": -5.361953809290831e-7,
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
          "points": 323.95953419995726,
          "pointsChange": 323.95953419995726,
          "pointsConverged": false,
          "probability": 0.7236957078097978,
          "rating": 1695.680481793672,
          "ratingChange": 95.68048179367202,
          "uncertainty": 299.8502625357793,
          "uncertaintyChange": -50.14973746422072,
          "userId": 2,
          "volatility": 0.0599993619635724,
          "volatilityChange": -6.380364276012407e-7,
        },
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.005398173160242497,
          "bonusUsedChange": 0.005398173160242497,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.2394965031718012,
          "rating": 1315.0462251564052,
          "ratingChange": -84.95377484359483,
          "uncertainty": 303.47877653289225,
          "uncertaintyChange": -46.521223467107745,
          "userId": 3,
          "volatility": 0.05999936878118545,
          "volatilityChange": -6.312188145507491e-7,
        },
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.005398173160242497,
          "bonusUsedChange": 0.005398173160242497,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.17644964001262234,
          "rating": 1234.094606769092,
          "ratingChange": -65.90539323090798,
          "uncertainty": 311.412945174442,
          "uncertaintyChange": -38.58705482555803,
          "userId": 4,
          "volatility": 0.05999942311664358,
          "volatilityChange": -5.768833564179232e-7,
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
          "bonusUsed": 0.040465800042757426,
          "bonusUsedChange": 0.040465800042757426,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.8498165352583855,
          "rating": 1474.2995705361905,
          "ratingChange": -325.70042946380954,
          "uncertainty": 315.45190137125803,
          "uncertaintyChange": -34.54809862874197,
          "userId": 1,
          "volatility": 0.06000224908005475,
          "volatilityChange": 0.00000224908005475033,
        },
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.040465800042757426,
          "bonusUsedChange": 0.040465800042757426,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.7236957078097978,
          "rating": 1349.3938453619537,
          "ratingChange": -250.6061546380463,
          "uncertainty": 299.85026725700897,
          "uncertaintyChange": -50.149732742991034,
          "userId": 2,
          "volatility": 0.060000815893369294,
          "volatilityChange": 8.158933692964387e-7,
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
          "points": 273.99460182683976,
          "pointsChange": 273.99460182683976,
          "pointsConverged": false,
          "probability": 0.2394965031718012,
          "rating": 1669.7644622294274,
          "ratingChange": 269.7644622294274,
          "uncertainty": 303.478782514052,
          "uncertaintyChange": -46.521217485948,
          "userId": 3,
          "volatility": 0.060001145426850394,
          "volatilityChange": 0.0000011454268503963139,
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
          "points": 273.99460182683976,
          "pointsChange": 273.99460182683976,
          "pointsConverged": false,
          "probability": 0.17644964001262234,
          "rating": 1607.6028572169848,
          "ratingChange": 307.60285721698483,
          "uncertainty": 311.4129540744156,
          "uncertaintyChange": -38.58704592558439,
          "userId": 4,
          "volatility": 0.060001869791810374,
          "volatilityChange": 0.000001869791810375776,
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
          "points": 323.98293155291043,
          "pointsChange": 323.98293155291043,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1517.2335985230613,
          "ratingChange": 17.233598523061346,
          "uncertainty": 78.71902251626597,
          "uncertaintyChange": -1.2809774837340342,
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
          "points": 323.98293155291043,
          "pointsChange": 323.98293155291043,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1515.2686772489176,
          "ratingChange": 15.268677248917584,
          "uncertainty": 74.09559920868182,
          "uncertaintyChange": -0.9044007913181815,
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
          "bonusUsed": 0.01706844708957159,
          "bonusUsedChange": 0.01706844708957159,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1483.4906593217172,
          "ratingChange": -16.509340678282797,
          "uncertainty": 76.8562904109994,
          "uncertaintyChange": -1.1437095890005935,
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
          "bonusUsed": 0.01706844708957159,
          "bonusUsedChange": 0.01706844708957159,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1478.4399319765726,
          "ratingChange": -21.560068023427448,
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
          "points": 373.98293155291043,
          "pointsChange": 373.98293155291043,
          "pointsConverged": false,
          "probability": 0.7605034968281987,
          "rating": 1884.9537748435948,
          "ratingChange": 84.95377484359483,
          "uncertainty": 303.47877653289225,
          "uncertaintyChange": -46.521223467107745,
          "userId": 1,
          "volatility": 0.05999936878118545,
          "volatilityChange": -6.312188145507491e-7,
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
          "points": 273.98293155291043,
          "pointsChange": 273.98293155291043,
          "pointsConverged": false,
          "probability": 0.31641538274428405,
          "rating": 1531.6685868916709,
          "ratingChange": 231.66858689167088,
          "uncertainty": 296.63610268512616,
          "uncertaintyChange": -53.36389731487384,
          "userId": 2,
          "volatility": 0.060000516405673956,
          "volatilityChange": 5.164056739587197e-7,
        },
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.012800098828155795,
          "bonusUsedChange": 0.012800098828155795,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.4048860337291681,
          "rating": 1317.0615327748344,
          "ratingChange": -132.9384672251656,
          "uncertainty": 291.9748928608564,
          "uncertaintyChange": -58.025107139143586,
          "userId": 3,
          "volatility": 0.059999466487748024,
          "volatilityChange": -5.335122519739555e-7,
        },
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.012800098828155795,
          "bonusUsedChange": 0.012800098828155795,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1387.689106093702,
          "ratingChange": -162.3108939062979,
          "uncertainty": 290.31896371798047,
          "uncertaintyChange": -59.681036282019534,
          "userId": 4,
          "volatility": 0.05999967537233814,
          "volatilityChange": -3.246276618559807e-7,
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
          "bonusUsed": 0.01706844708957159,
          "bonusUsedChange": 0.01706844708957159,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.7605034968281987,
          "rating": 1530.2355377705726,
          "ratingChange": -269.7644622294274,
          "uncertainty": 303.478782514052,
          "uncertaintyChange": -46.521217485948,
          "userId": 1,
          "volatility": 0.060001145426850366,
          "volatilityChange": 0.0000011454268503685583,
        },
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      {
        "leagues": [],
        "matchmaking": {
          "bonusUsed": 0.01706844708957159,
          "bonusUsedChange": 0.01706844708957159,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.31641538274428405,
          "rating": 1192.7660146747735,
          "ratingChange": -107.23398532522651,
          "uncertainty": 296.63609909206434,
          "uncertaintyChange": -53.36390090793566,
          "userId": 2,
          "volatility": 0.059999373539620704,
          "volatilityChange": -6.264603792938139e-7,
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
          "points": 323.98719990117183,
          "pointsChange": 323.98719990117183,
          "pointsConverged": false,
          "probability": 0.4048860337291681,
          "rating": 1645.3970569806693,
          "ratingChange": 195.39705698066928,
          "uncertainty": 291.97489452700995,
          "uncertaintyChange": -58.02510547299005,
          "userId": 3,
          "volatility": 0.060000022241762076,
          "volatilityChange": 2.2241762077934712e-8,
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
          "points": 323.98719990117183,
          "pointsChange": 323.98719990117183,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1712.3108939062977,
          "ratingChange": 162.31089390629768,
          "uncertainty": 290.31896371798047,
          "uncertaintyChange": -59.681036282019534,
          "userId": 4,
          "volatility": 0.05999967537233814,
          "volatilityChange": -3.246276618559807e-7,
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
          "bonusUsed": 0.01706844708957159,
          "bonusUsedChange": 0.01706844708957159,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.7605034968281987,
          "rating": 1530.2355377705726,
          "ratingChange": -269.7644622294274,
          "uncertainty": 303.478782514052,
          "uncertaintyChange": -46.521217485948,
          "userId": 1,
          "volatility": 0.060001145426850366,
          "volatilityChange": 0.0000011454268503685583,
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
            "points": 99.98029020720129,
            "pointsChange": -0.019709792798710758,
            "pointsConverged": false,
            "userId": 2,
          },
        ],
        "matchmaking": {
          "bonusUsed": 0.01706844708957159,
          "bonusUsedChange": 0.01706844708957159,
          "changeDate": 2022-05-02T00:00:00.000Z,
          "gameId": "asdfzxcv",
          "lifetimeGames": 1,
          "matchmakingType": "2v2",
          "outcome": "loss",
          "points": 0,
          "pointsChange": 0,
          "pointsConverged": false,
          "probability": 0.31641538274428405,
          "rating": 1192.7660146747735,
          "ratingChange": -107.23398532522651,
          "uncertainty": 296.63609909206434,
          "uncertaintyChange": -53.36390090793566,
          "userId": 2,
          "volatility": 0.059999373539620704,
          "volatilityChange": -6.264603792938139e-7,
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
            "points": 6013.021109298073,
            "pointsChange": 263.0211092980728,
            "pointsConverged": true,
            "userId": 3,
          },
          {
            "changeDate": 2022-05-02T00:00:00.000Z,
            "gameId": "asdfzxcv",
            "leagueId": "league-2",
            "outcome": "win",
            "points": 795.9737183685246,
            "pointsChange": 295.9737183685246,
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
          "points": 323.98719990117183,
          "pointsChange": 323.98719990117183,
          "pointsConverged": false,
          "probability": 0.4048860337291681,
          "rating": 1645.3970569806693,
          "ratingChange": 195.39705698066928,
          "uncertainty": 291.97489452700995,
          "uncertaintyChange": -58.02510547299005,
          "userId": 3,
          "volatility": 0.060000022241762076,
          "volatilityChange": 2.2241762077934712e-8,
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
          "points": 323.98719990117183,
          "pointsChange": 323.98719990117183,
          "pointsConverged": false,
          "probability": 0.5,
          "rating": 1712.3108939062977,
          "ratingChange": 162.31089390629768,
          "uncertainty": 290.31896371798047,
          "uncertaintyChange": -59.681036282019534,
          "userId": 4,
          "volatility": 0.05999967537233814,
          "volatilityChange": -3.246276618559807e-7,
        },
      }
    `)
  })
})
