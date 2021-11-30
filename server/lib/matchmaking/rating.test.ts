import { ReconciledPlayerResult } from '../../../common/games/results'
import { MatchmakingType } from '../../../common/matchmaking'
import { SbUserId } from '../../../common/users/user-info'
import { DEFAULT_MATCHMAKING_RATING, MatchmakingRating } from './models'
import { calculateChangedRatings } from './rating'

const GAME_ID = 'asdfzxcv'
const GAME_DATE = new Date(27)

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

function createMatchmakingRating(
  data: Partial<Omit<MatchmakingRating, 'userId'>> & Partial<{ userId: number }> = {},
): MatchmakingRating {
  return {
    ...DEFAULT_MATCHMAKING_RATING,
    matchmakingType: MatchmakingType.Match1v1,
    ...data,
    userId: (data.userId ?? 1) as SbUserId,
  }
}

describe('matchmaking/rating/calculateChangedRatings', () => {
  test('1v1 - evenly matched new players', () => {
    const player = createMatchmakingRating({ userId: 1 })
    const opponent = createMatchmakingRating({ userId: 2 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.5,
        "rating": 1520,
        "ratingChange": 20,
        "uncertainty": 180,
        "uncertaintyChange": -20,
        "unexpectedStreak": 0,
        "userId": 1,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.5,
        "rating": 1480,
        "ratingChange": -20,
        "uncertainty": 220,
        "uncertaintyChange": 20,
        "unexpectedStreak": 1,
        "userId": 2,
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.9090909090909091,
        "rating": 1803.6363636363637,
        "ratingChange": 3.6363636363637397,
        "uncertainty": 196.36363636363637,
        "uncertaintyChange": -3.636363636363626,
        "unexpectedStreak": 0,
        "userId": 1,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.09090909090909091,
        "rating": 1396.3636363636363,
        "ratingChange": -3.6363636363637397,
        "uncertainty": 196.36363636363637,
        "uncertaintyChange": -3.636363636363626,
        "unexpectedStreak": 0,
        "userId": 2,
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.9090909090909091,
        "rating": 1763.6363636363637,
        "ratingChange": -36.36363636363626,
        "uncertainty": 236.36363636363637,
        "uncertaintyChange": 36.363636363636374,
        "unexpectedStreak": 1,
        "userId": 1,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.09090909090909091,
        "rating": 1436.3636363636363,
        "ratingChange": 36.36363636363626,
        "uncertainty": 236.36363636363637,
        "uncertaintyChange": 36.363636363636374,
        "unexpectedStreak": 1,
        "userId": 2,
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.9999665045780651,
        "rating": 1800.0013398168774,
        "ratingChange": 0.0013398168773619545,
        "uncertainty": 199.9986601831226,
        "uncertaintyChange": -0.0013398168773903762,
        "unexpectedStreak": 0,
        "userId": 1,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.00003349542193491098,
        "rating": 9.998660183122604,
        "ratingChange": -0.0013398168773957053,
        "uncertainty": 199.9986601831226,
        "uncertaintyChange": -0.0013398168773903762,
        "unexpectedStreak": 0,
        "userId": 2,
      }
    `)
  })

  test("1v1 - really bad players can't go below 0", () => {
    const player = createMatchmakingRating({ userId: 1, rating: 1 })
    const opponent = createMatchmakingRating({ userId: 2, rating: 1 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.5,
        "rating": 21,
        "ratingChange": 20,
        "uncertainty": 180,
        "uncertaintyChange": -20,
        "unexpectedStreak": 0,
        "userId": 1,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.5,
        "rating": 0,
        "ratingChange": -1,
        "uncertainty": 220,
        "uncertaintyChange": 20,
        "unexpectedStreak": 1,
        "userId": 2,
      }
    `)
  })

  test('1v1 - evenly matched veteran players', () => {
    const player = createMatchmakingRating({ userId: 1, numGamesPlayed: 25 })
    const opponent = createMatchmakingRating({ userId: 2, numGamesPlayed: 25 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 39.5,
        "kFactorChange": -0.5,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.5,
        "rating": 1520,
        "ratingChange": 20,
        "uncertainty": 180,
        "uncertaintyChange": -20,
        "unexpectedStreak": 0,
        "userId": 1,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.5,
        "rating": 1480,
        "ratingChange": -20,
        "uncertainty": 220,
        "uncertaintyChange": 20,
        "unexpectedStreak": 1,
        "userId": 2,
      }
    `)
  })

  test('1v1 - better veteran player wins', () => {
    const player = createMatchmakingRating({ userId: 1, rating: 1800, numGamesPlayed: 25 })
    const opponent = createMatchmakingRating({ userId: 2, rating: 1400, numGamesPlayed: 25 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 39.09090909090909,
        "kFactorChange": -0.9090909090909065,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.9090909090909091,
        "rating": 1803.6363636363637,
        "ratingChange": 3.6363636363637397,
        "uncertainty": 196.36363636363637,
        "uncertaintyChange": -3.636363636363626,
        "unexpectedStreak": 0,
        "userId": 1,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 39.09090909090909,
        "kFactorChange": -0.9090909090909065,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.09090909090909091,
        "rating": 1396.3636363636363,
        "ratingChange": -3.6363636363637397,
        "uncertainty": 196.36363636363637,
        "uncertaintyChange": -3.636363636363626,
        "unexpectedStreak": 0,
        "userId": 2,
      }
    `)
  })

  test('1v1 - better veteran player loses', () => {
    const player = createMatchmakingRating({ userId: 1, rating: 1800, numGamesPlayed: 25 })
    const opponent = createMatchmakingRating({ userId: 2, rating: 1400, numGamesPlayed: 25 })
    const results = new Map([
      [player.userId, LOSS],
      [opponent.userId, WIN],
    ])

    const changes = calculateChangedRatings({
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.9090909090909091,
        "rating": 1763.6363636363637,
        "ratingChange": -36.36363636363626,
        "uncertainty": 236.36363636363637,
        "uncertaintyChange": 36.363636363636374,
        "unexpectedStreak": 1,
        "userId": 1,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.09090909090909091,
        "rating": 1436.3636363636363,
        "ratingChange": 36.36363636363626,
        "uncertainty": 236.36363636363637,
        "uncertaintyChange": 36.363636363636374,
        "unexpectedStreak": 1,
        "userId": 2,
      }
    `)
  })

  test('1v1 - well-defined veteran player wins versus new player', () => {
    const player = createMatchmakingRating({
      userId: 1,
      rating: 1800,
      numGamesPlayed: 25,
      kFactor: 24,
      uncertainty: 80,
    })
    const opponent = createMatchmakingRating({ userId: 2 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 24,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.8490204427886767,
        "rating": 1803.6235093730718,
        "ratingChange": 3.6235093730717836,
        "uncertainty": 80,
        "uncertaintyChange": 0,
        "unexpectedStreak": 0,
        "userId": 1,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.15097955721132328,
        "rating": 1493.9608177115472,
        "ratingChange": -6.039182288452821,
        "uncertainty": 193.96081771154707,
        "uncertaintyChange": -6.039182288452935,
        "unexpectedStreak": 0,
        "userId": 2,
      }
    `)
  })

  test('1v1 - well-defined veteran player loses versus new player', () => {
    const player = createMatchmakingRating({
      userId: 1,
      rating: 1800,
      numGamesPlayed: 25,
      kFactor: 24,
      uncertainty: 80,
    })
    const opponent = createMatchmakingRating({ userId: 2 })
    const results = new Map([
      [player.userId, LOSS],
      [opponent.userId, WIN],
    ])

    const changes = calculateChangedRatings({
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 24,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.8490204427886767,
        "rating": 1779.6235093730718,
        "ratingChange": -20.376490626928216,
        "uncertainty": 100.37649062692824,
        "uncertaintyChange": 20.376490626928245,
        "unexpectedStreak": 1,
        "userId": 1,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.15097955721132328,
        "rating": 1533.960817711547,
        "ratingChange": 33.96081771154695,
        "uncertainty": 233.96081771154707,
        "uncertaintyChange": 33.960817711547065,
        "unexpectedStreak": 1,
        "userId": 2,
      }
    `)
  })

  test('1v1 - well-defined veteran player continues a loss streak versus new player', () => {
    const player = createMatchmakingRating({
      userId: 1,
      rating: 1800,
      numGamesPlayed: 25,
      kFactor: 24,
      uncertainty: 120,
      unexpectedStreak: 2,
    })
    const opponent = createMatchmakingRating({ userId: 2 })
    const results = new Map([
      [player.userId, LOSS],
      [opponent.userId, WIN],
    ])

    const changes = calculateChangedRatings({
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 25,
        "kFactorChange": 1,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.8490204427886767,
        "rating": 1779.6235093730718,
        "ratingChange": -20.376490626928216,
        "uncertainty": 140.37649062692824,
        "uncertaintyChange": 20.376490626928245,
        "unexpectedStreak": 0,
        "userId": 1,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.15097955721132328,
        "rating": 1533.960817711547,
        "ratingChange": 33.96081771154695,
        "uncertainty": 233.96081771154707,
        "uncertaintyChange": 33.960817711547065,
        "unexpectedStreak": 1,
        "userId": 2,
      }
    `)
  })

  test('1v1 - well-defined veteran player ends a loss streak versus new player', () => {
    const player = createMatchmakingRating({
      userId: 1,
      rating: 1800,
      numGamesPlayed: 25,
      kFactor: 24,
      uncertainty: 120,
      unexpectedStreak: 2,
    })
    const opponent = createMatchmakingRating({ userId: 2 })
    const results = new Map([
      [player.userId, WIN],
      [opponent.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 24,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.8490204427886767,
        "rating": 1803.6235093730718,
        "ratingChange": 3.6235093730717836,
        "uncertainty": 116.37649062692824,
        "uncertaintyChange": -3.623509373071755,
        "unexpectedStreak": 0,
        "userId": 1,
      }
    `)
    expect(opponentChange).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.15097955721132328,
        "rating": 1493.9608177115472,
        "ratingChange": -6.039182288452821,
        "uncertainty": 193.96081771154707,
        "uncertaintyChange": -6.039182288452935,
        "unexpectedStreak": 0,
        "userId": 2,
      }
    `)
  })

  test('2v2 - evenly matched new players', () => {
    const player1 = createMatchmakingRating({ userId: 1 })
    const player2 = createMatchmakingRating({ userId: 2 })
    const opponent1 = createMatchmakingRating({ userId: 3 })
    const opponent2 = createMatchmakingRating({ userId: 4 })
    const results = new Map([
      [player1.userId, WIN],
      [player2.userId, WIN],
      [opponent1.userId, LOSS],
      [opponent2.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.5,
        "rating": 1520,
        "ratingChange": 20,
        "uncertainty": 180,
        "uncertaintyChange": -20,
        "unexpectedStreak": 0,
        "userId": 1,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.5,
        "rating": 1520,
        "ratingChange": 20,
        "uncertainty": 180,
        "uncertaintyChange": -20,
        "unexpectedStreak": 0,
        "userId": 2,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.5,
        "rating": 1480,
        "ratingChange": -20,
        "uncertainty": 220,
        "uncertaintyChange": 20,
        "unexpectedStreak": 1,
        "userId": 3,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.5,
        "rating": 1480,
        "ratingChange": -20,
        "uncertainty": 220,
        "uncertaintyChange": 20,
        "unexpectedStreak": 1,
        "userId": 4,
      }
    `)
  })

  test('2v2 - better new players win', () => {
    const player1 = createMatchmakingRating({ userId: 1, rating: 1800 })
    const player2 = createMatchmakingRating({ userId: 2, rating: 1600 })
    const opponent1 = createMatchmakingRating({ userId: 3, rating: 1400 })
    const opponent2 = createMatchmakingRating({ userId: 4, rating: 1300 })
    const results = new Map([
      [player1.userId, WIN],
      [player2.userId, WIN],
      [opponent1.userId, LOSS],
      [opponent2.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.9298951590492744,
        "rating": 1802.8041936380291,
        "ratingChange": 2.804193638029119,
        "uncertainty": 197.19580636197097,
        "uncertaintyChange": -2.8041936380290338,
        "unexpectedStreak": 0,
        "userId": 1,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.8074907587437063,
        "rating": 1607.7003696502518,
        "ratingChange": 7.700369650251787,
        "uncertainty": 192.29963034974824,
        "uncertaintyChange": -7.7003696502517585,
        "unexpectedStreak": 0,
        "userId": 2,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.14882394314935965,
        "rating": 1394.0470422740257,
        "ratingChange": -5.952957725974329,
        "uncertainty": 194.0470422740256,
        "uncertaintyChange": -5.952957725974386,
        "unexpectedStreak": 0,
        "userId": 3,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.08952070290729923,
        "rating": 1296.419171883708,
        "ratingChange": -3.5808281162919684,
        "uncertainty": 196.41917188370803,
        "uncertaintyChange": -3.5808281162919684,
        "unexpectedStreak": 0,
        "userId": 4,
      }
    `)
  })

  test('2v2 - better new players lose', () => {
    const player1 = createMatchmakingRating({ userId: 1, rating: 1800 })
    const player2 = createMatchmakingRating({ userId: 2, rating: 1600 })
    const opponent1 = createMatchmakingRating({ userId: 3, rating: 1400 })
    const opponent2 = createMatchmakingRating({ userId: 4, rating: 1300 })
    const results = new Map([
      [player1.userId, LOSS],
      [player2.userId, LOSS],
      [opponent1.userId, WIN],
      [opponent2.userId, WIN],
    ])

    const changes = calculateChangedRatings({
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.9298951590492744,
        "rating": 1762.8041936380291,
        "ratingChange": -37.19580636197088,
        "uncertainty": 237.195806361971,
        "uncertaintyChange": 37.195806361970995,
        "unexpectedStreak": 1,
        "userId": 1,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.8074907587437063,
        "rating": 1567.7003696502518,
        "ratingChange": -32.29963034974821,
        "uncertainty": 232.29963034974827,
        "uncertaintyChange": 32.29963034974827,
        "unexpectedStreak": 1,
        "userId": 2,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.14882394314935965,
        "rating": 1434.0470422740257,
        "ratingChange": 34.04704227402567,
        "uncertainty": 234.0470422740256,
        "uncertaintyChange": 34.047042274025614,
        "unexpectedStreak": 1,
        "userId": 3,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.08952070290729923,
        "rating": 1336.419171883708,
        "ratingChange": 36.41917188370803,
        "uncertainty": 236.41917188370803,
        "uncertaintyChange": 36.41917188370803,
        "unexpectedStreak": 1,
        "userId": 4,
      }
    `)
  })

  test('2v2 - evenly matched veteran players', () => {
    const player1 = createMatchmakingRating({ userId: 1, numGamesPlayed: 30 })
    const player2 = createMatchmakingRating({ userId: 2, numGamesPlayed: 35 })
    const opponent1 = createMatchmakingRating({ userId: 3, numGamesPlayed: 25 })
    const opponent2 = createMatchmakingRating({ userId: 4, numGamesPlayed: 40 })
    const results = new Map([
      [player1.userId, WIN],
      [player2.userId, WIN],
      [opponent1.userId, LOSS],
      [opponent2.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 39.5,
        "kFactorChange": -0.5,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.5,
        "rating": 1520,
        "ratingChange": 20,
        "uncertainty": 180,
        "uncertaintyChange": -20,
        "unexpectedStreak": 0,
        "userId": 1,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 39.5,
        "kFactorChange": -0.5,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.5,
        "rating": 1520,
        "ratingChange": 20,
        "uncertainty": 180,
        "uncertaintyChange": -20,
        "unexpectedStreak": 0,
        "userId": 2,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.5,
        "rating": 1480,
        "ratingChange": -20,
        "uncertainty": 220,
        "uncertaintyChange": 20,
        "unexpectedStreak": 1,
        "userId": 3,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.5,
        "rating": 1480,
        "ratingChange": -20,
        "uncertainty": 220,
        "uncertaintyChange": 20,
        "unexpectedStreak": 1,
        "userId": 4,
      }
    `)
  })

  test('2v2 - mixed upper/lower ratings', () => {
    const player1 = createMatchmakingRating({ userId: 1, rating: 1800 })
    const player2 = createMatchmakingRating({ userId: 2, rating: 1300 })
    const opponent1 = createMatchmakingRating({ userId: 3, rating: 1450 })
    const opponent2 = createMatchmakingRating({ userId: 4, rating: 1550 })
    const results = new Map([
      [player1.userId, WIN],
      [player2.userId, WIN],
      [opponent1.userId, LOSS],
      [opponent2.userId, LOSS],
    ])

    const changes = calculateChangedRatings({
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.8484046751539909,
        "rating": 1806.0638129938404,
        "ratingChange": 6.063812993840429,
        "uncertainty": 193.93618700615963,
        "uncertaintyChange": -6.063812993840372,
        "unexpectedStreak": 0,
        "userId": 1,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.23937879387419578,
        "rating": 1330.424848245032,
        "ratingChange": 30.42484824503208,
        "uncertainty": 230.42484824503217,
        "uncertaintyChange": 30.424848245032166,
        "unexpectedStreak": 1,
        "userId": 2,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.33381980560653496,
        "rating": 1436.6472077757387,
        "ratingChange": -13.352792224261293,
        "uncertainty": 186.6472077757386,
        "uncertaintyChange": -13.352792224261407,
        "unexpectedStreak": 0,
        "userId": 3,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.4712037566392997,
        "rating": 1531.151849734428,
        "ratingChange": -18.84815026557203,
        "uncertainty": 181.15184973442803,
        "uncertaintyChange": -18.848150265571974,
        "unexpectedStreak": 0,
        "userId": 4,
      }
    `)
  })

  test('2v2 - mixed upper/lower ratings, highest loses', () => {
    const player1 = createMatchmakingRating({ userId: 1, rating: 1800 })
    const player2 = createMatchmakingRating({ userId: 2, rating: 1300 })
    const opponent1 = createMatchmakingRating({ userId: 3, rating: 1450 })
    const opponent2 = createMatchmakingRating({ userId: 4, rating: 1550 })
    const results = new Map([
      [player1.userId, LOSS],
      [player2.userId, LOSS],
      [opponent1.userId, WIN],
      [opponent2.userId, WIN],
    ])

    const changes = calculateChangedRatings({
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
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.8484046751539909,
        "rating": 1766.0638129938404,
        "ratingChange": -33.93618700615957,
        "uncertainty": 233.93618700615963,
        "uncertaintyChange": 33.93618700615963,
        "unexpectedStreak": 1,
        "userId": 1,
      }
    `)
    expect(player2Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "loss",
        "probability": 0.23937879387419578,
        "rating": 1290.424848245032,
        "ratingChange": -9.57515175496792,
        "uncertainty": 190.42484824503217,
        "uncertaintyChange": -9.575151754967834,
        "unexpectedStreak": 0,
        "userId": 2,
      }
    `)
    expect(opponent1Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.33381980560653496,
        "rating": 1476.6472077757387,
        "ratingChange": 26.647207775738707,
        "uncertainty": 226.6472077757386,
        "uncertaintyChange": 26.647207775738593,
        "unexpectedStreak": 1,
        "userId": 3,
      }
    `)
    expect(opponent2Change).toMatchInlineSnapshot(`
      Object {
        "changeDate": 1970-01-01T00:00:00.027Z,
        "gameId": "asdfzxcv",
        "kFactor": 40,
        "kFactorChange": 0,
        "matchmakingType": "1v1",
        "outcome": "win",
        "probability": 0.4712037566392997,
        "rating": 1571.151849734428,
        "ratingChange": 21.15184973442797,
        "uncertainty": 221.15184973442803,
        "uncertaintyChange": 21.151849734428026,
        "unexpectedStreak": 1,
        "userId": 4,
      }
    `)
  })
})
