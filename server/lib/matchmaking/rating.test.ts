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
        "matchmakingType": "2v2",
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
        "matchmakingType": "2v2",
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
        "matchmakingType": "2v2",
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
        "matchmakingType": "2v2",
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
        "matchmakingType": "2v2",
        "outcome": "win",
        "probability": 0.9302417126410938,
        "rating": 1802.7903314943562,
        "ratingChange": 2.7903314943562236,
        "uncertainty": 197.20966850564375,
        "uncertaintyChange": -2.790331494356252,
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
        "matchmakingType": "2v2",
        "outcome": "win",
        "probability": 0.8083176725494586,
        "rating": 1607.6672930980217,
        "ratingChange": 7.667293098021673,
        "uncertainty": 192.33270690197836,
        "uncertaintyChange": -7.667293098021645,
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
        "matchmakingType": "2v2",
        "outcome": "loss",
        "probability": 0.15097955721132328,
        "rating": 1393.9608177115472,
        "ratingChange": -6.039182288452821,
        "uncertainty": 193.96081771154707,
        "uncertaintyChange": -6.039182288452935,
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
        "matchmakingType": "2v2",
        "outcome": "loss",
        "probability": 0.09090909090909091,
        "rating": 1296.3636363636363,
        "ratingChange": -3.6363636363637397,
        "uncertainty": 196.36363636363637,
        "uncertaintyChange": -3.636363636363626,
        "unexpectedStreak": 0,
        "userId": 4,
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
        "matchmakingType": "2v2",
        "outcome": "loss",
        "probability": 0.9302417126410938,
        "rating": 1762.7903314943562,
        "ratingChange": -37.209668505643776,
        "uncertainty": 237.20966850564375,
        "uncertaintyChange": 37.20966850564375,
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
        "matchmakingType": "2v2",
        "outcome": "loss",
        "probability": 0.8083176725494586,
        "rating": 1567.6672930980217,
        "ratingChange": -32.33270690197833,
        "uncertainty": 232.33270690197836,
        "uncertaintyChange": 32.332706901978355,
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
        "matchmakingType": "2v2",
        "outcome": "win",
        "probability": 0.15097955721132328,
        "rating": 1433.960817711547,
        "ratingChange": 33.96081771154695,
        "uncertainty": 233.96081771154707,
        "uncertaintyChange": 33.960817711547065,
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
        "matchmakingType": "2v2",
        "outcome": "win",
        "probability": 0.09090909090909091,
        "rating": 1336.3636363636363,
        "ratingChange": 36.36363636363626,
        "uncertainty": 236.36363636363637,
        "uncertaintyChange": 36.363636363636374,
        "unexpectedStreak": 1,
        "userId": 4,
      }
    `)
  })

  test('2v2 - evenly matched veteran players', () => {
    const player1 = createMatchmakingRating({
      userId: 1,
      matchmakingType: MatchmakingType.Match2v2,
      numGamesPlayed: 30,
    })
    const player2 = createMatchmakingRating({
      userId: 2,
      matchmakingType: MatchmakingType.Match2v2,
      numGamesPlayed: 35,
    })
    const opponent1 = createMatchmakingRating({
      userId: 3,
      matchmakingType: MatchmakingType.Match2v2,
      numGamesPlayed: 25,
    })
    const opponent2 = createMatchmakingRating({
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
        "matchmakingType": "2v2",
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
        "matchmakingType": "2v2",
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
        "matchmakingType": "2v2",
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
        "matchmakingType": "2v2",
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
        "matchmakingType": "2v2",
        "outcome": "win",
        "probability": 0.8490204427886767,
        "rating": 1806.0391822884528,
        "ratingChange": 6.039182288452821,
        "uncertainty": 193.96081771154707,
        "uncertaintyChange": -6.039182288452935,
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
        "matchmakingType": "2v2",
        "outcome": "win",
        "probability": 0.2402530733520421,
        "rating": 1330.3898770659184,
        "ratingChange": 30.389877065918427,
        "uncertainty": 230.3898770659183,
        "uncertaintyChange": 30.389877065918313,
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
        "matchmakingType": "2v2",
        "outcome": "loss",
        "probability": 0.35993500019711494,
        "rating": 1435.6025999921153,
        "ratingChange": -14.397400007884698,
        "uncertainty": 185.60259999211542,
        "uncertaintyChange": -14.397400007884585,
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
        "matchmakingType": "2v2",
        "outcome": "loss",
        "probability": 0.5,
        "rating": 1530,
        "ratingChange": -20,
        "uncertainty": 220,
        "uncertaintyChange": 20,
        "unexpectedStreak": 1,
        "userId": 4,
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
        "matchmakingType": "2v2",
        "outcome": "loss",
        "probability": 0.8490204427886767,
        "rating": 1766.039182288453,
        "ratingChange": -33.96081771154695,
        "uncertainty": 233.96081771154707,
        "uncertaintyChange": 33.960817711547065,
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
        "matchmakingType": "2v2",
        "outcome": "loss",
        "probability": 0.2402530733520421,
        "rating": 1290.3898770659184,
        "ratingChange": -9.610122934081573,
        "uncertainty": 190.3898770659183,
        "uncertaintyChange": -9.610122934081687,
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
        "matchmakingType": "2v2",
        "outcome": "win",
        "probability": 0.35993500019711494,
        "rating": 1475.6025999921153,
        "ratingChange": 25.6025999921153,
        "uncertainty": 225.60259999211542,
        "uncertaintyChange": 25.602599992115415,
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
        "matchmakingType": "2v2",
        "outcome": "win",
        "probability": 0.5,
        "rating": 1570,
        "ratingChange": 20,
        "uncertainty": 180,
        "uncertaintyChange": -20,
        "unexpectedStreak": 0,
        "userId": 4,
      }
    `)
  })
})
