import {
  GameClientPlayerResult,
  GameClientResult,
  ReconciledPlayerResult,
} from '../../../common/games/results.js'
import { AssignedRaceChar } from '../../../common/races.js'
import { SbUserId, makeSbUserId } from '../../../common/users/sb-user.js'
import { reconcileResults } from './results.js'

function makePlayerResult(
  userId: number,
  result: GameClientResult,
  race: AssignedRaceChar,
  apm: number,
): [SbUserId, GameClientPlayerResult] {
  return [makeSbUserId(userId), { result, race, apm }]
}

function evaluateResults(
  resultsMap: Map<number, ReconciledPlayerResult>,
  expectedObj: { [key: number]: ReconciledPlayerResult },
) {
  const obj = Object.fromEntries(resultsMap.entries())
  expect(obj).toContainAllEntries(Object.entries(expectedObj))
}

describe('games/results/reconcileResults', () => {
  test('should reconcile a simple, undisputed 1v1 with complete results', () => {
    const results = [
      {
        reporter: 2,
        time: 7,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 't', 50),
          makePlayerResult(2, GameClientResult.Disconnected, 'z', 60),
        ],
      },
      {
        reporter: 1,
        time: 33,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 25),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
        ],
      },
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).toBe(false)
    expect(reconciled.time).toBe(33)
    evaluateResults(reconciled.results, {
      1: { result: 'win', race: 't', apm: 25 },
      2: { result: 'loss', race: 'z', apm: 60 },
    })
  })

  test('should reconcile a 1v1 with a game crash', () => {
    const results = [
      {
        reporter: 2,
        time: 7,
        playerResults: [],
      },
      {
        reporter: 1,
        time: 33,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 25),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
        ],
      },
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).toBe(false)
    expect(reconciled.time).toBe(33)
    evaluateResults(reconciled.results, {
      1: { result: 'win', race: 't', apm: 25 },
      2: { result: 'loss', race: 'z', apm: 30 },
    })
  })

  test('should reconcile a disputed 1v1 with complete results', () => {
    const results = [
      {
        reporter: 2,
        time: 45,
        playerResults: [
          makePlayerResult(1, GameClientResult.Defeat, 't', 50),
          makePlayerResult(2, GameClientResult.Victory, 'z', 60),
        ],
      },
      {
        reporter: 1,
        time: 33,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 25),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
        ],
      },
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).toBe(true)
    evaluateResults(reconciled.results, {
      1: { result: 'unknown', race: 't', apm: 25 },
      2: { result: 'unknown', race: 'z', apm: 60 },
    })
  })

  test('should reconcile a 4 player game with undisputed, but incomplete results', () => {
    const results = [
      {
        reporter: 2,
        time: 7,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 't', 20),
          makePlayerResult(2, GameClientResult.Disconnected, 'z', 20),
          makePlayerResult(3, GameClientResult.Playing, 'p', 20),
          makePlayerResult(4, GameClientResult.Disconnected, 'p', 20),
        ],
      },
      {
        reporter: 3,
        time: 50,
        playerResults: [
          makePlayerResult(1, GameClientResult.Defeat, 't', 30),
          makePlayerResult(2, GameClientResult.Victory, 'z', 30),
          makePlayerResult(3, GameClientResult.Victory, 'p', 30),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 30),
        ],
      },
      {
        reporter: 1,
        time: 9,
        playerResults: [
          makePlayerResult(1, GameClientResult.Disconnected, 't', 40),
          makePlayerResult(2, GameClientResult.Disconnected, 'z', 40),
          makePlayerResult(3, GameClientResult.Playing, 'p', 40),
          makePlayerResult(4, GameClientResult.Disconnected, 'p', 40),
        ],
      },
      null,
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).toBe(false)
    expect(reconciled.time).toBe(50)
    evaluateResults(reconciled.results, {
      1: { result: 'loss', race: 't', apm: 40 },
      2: { result: 'win', race: 'z', apm: 20 },
      3: { result: 'win', race: 'p', apm: 30 },
      4: { result: 'loss', race: 'p', apm: 20 },
    })
  })

  test('should reconcile a 4 player game without final results', () => {
    const results = [
      {
        reporter: 2,
        time: 7,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 't', 20),
          makePlayerResult(2, GameClientResult.Disconnected, 'z', 20),
          makePlayerResult(3, GameClientResult.Playing, 'p', 20),
          makePlayerResult(4, GameClientResult.Disconnected, 'p', 20),
        ],
      },
      null,
      {
        reporter: 1,
        time: 9,
        playerResults: [
          makePlayerResult(1, GameClientResult.Disconnected, 't', 40),
          makePlayerResult(2, GameClientResult.Disconnected, 'z', 40),
          makePlayerResult(3, GameClientResult.Playing, 'p', 40),
          makePlayerResult(4, GameClientResult.Disconnected, 'p', 40),
        ],
      },
      null,
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).toBe(true)
    expect(reconciled.time).toBe(9)
    evaluateResults(reconciled.results, {
      1: { result: 'unknown', race: 't', apm: 40 },
      2: { result: 'unknown', race: 'z', apm: 20 },
      3: { result: 'unknown', race: 'p', apm: 20 },
      4: { result: 'unknown', race: 'p', apm: 20 },
    })
  })

  test('should reconcile a 4 player game with disputed results for 1 player', () => {
    const results = [
      {
        reporter: 2,
        time: 7,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 't', 20),
          makePlayerResult(2, GameClientResult.Disconnected, 'z', 20),
          makePlayerResult(3, GameClientResult.Playing, 'p', 20),
          makePlayerResult(4, GameClientResult.Disconnected, 'p', 20),
        ],
      },
      {
        reporter: 3,
        time: 50,
        playerResults: [
          makePlayerResult(1, GameClientResult.Defeat, 't', 30),
          makePlayerResult(2, GameClientResult.Victory, 'z', 30),
          makePlayerResult(3, GameClientResult.Victory, 'p', 30),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 30),
        ],
      },
      {
        reporter: 1,
        time: 45,
        playerResults: [
          makePlayerResult(1, GameClientResult.Defeat, 't', 40),
          makePlayerResult(2, GameClientResult.Victory, 'z', 40),
          makePlayerResult(3, GameClientResult.Victory, 'p', 40),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 40),
        ],
      },
      {
        reporter: 4,
        time: 25,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 50),
          makePlayerResult(2, GameClientResult.Victory, 'z', 50),
          makePlayerResult(3, GameClientResult.Victory, 'p', 50),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 50),
        ],
      },
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).toBe(true)
    evaluateResults(reconciled.results, {
      1: { result: 'loss', race: 't', apm: 40 },
      2: { result: 'win', race: 'z', apm: 20 },
      3: { result: 'win', race: 'p', apm: 30 },
      4: { result: 'loss', race: 'p', apm: 50 },
    })
  })

  test('should mark a match disputed if players disagree on assigned races', () => {
    const results = [
      {
        reporter: 2,
        time: 45,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 'p', 30),
          makePlayerResult(2, GameClientResult.Disconnected, 'z', 30),
        ],
      },
      {
        reporter: 1,
        time: 33,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 20),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 20),
        ],
      },
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).toBe(true)
    evaluateResults(reconciled.results, {
      1: { result: 'win', race: 'p', apm: 20 },
      2: { result: 'loss', race: 'z', apm: 30 },
    })
  })

  // NOTE(tec27): I dunno that this is actually different from other test cases here but it directly
  // maps to real results from a game played locally
  test('2v2 with allied victory, player leaving earlier still gets a win', () => {
    const results = [
      {
        reporter: 7,
        time: 7,
        playerResults: [
          makePlayerResult(7, GameClientResult.Disconnected, 't', 20),
          makePlayerResult(8, GameClientResult.Playing, 'z', 20),
          makePlayerResult(5, GameClientResult.Playing, 'z', 20),
          makePlayerResult(1, GameClientResult.Playing, 'p', 20),
        ],
      },
      {
        reporter: 8,
        time: 50,
        playerResults: [
          makePlayerResult(5, GameClientResult.Playing, 'z', 30),
          makePlayerResult(1, GameClientResult.Playing, 'p', 30),
          makePlayerResult(8, GameClientResult.Disconnected, 'z', 30),
          makePlayerResult(7, GameClientResult.Disconnected, 't', 30),
        ],
      },
      {
        reporter: 5,
        time: 60,
        playerResults: [
          makePlayerResult(7, GameClientResult.Disconnected, 't', 40),
          makePlayerResult(1, GameClientResult.Playing, 'p', 40),
          makePlayerResult(8, GameClientResult.Disconnected, 'z', 40),
          makePlayerResult(5, GameClientResult.Disconnected, 'z', 40),
        ],
      },
      {
        reporter: 1,
        time: 70,
        playerResults: [
          makePlayerResult(7, GameClientResult.Defeat, 't', 50),
          makePlayerResult(1, GameClientResult.Victory, 'p', 50),
          makePlayerResult(8, GameClientResult.Victory, 'z', 50),
          makePlayerResult(5, GameClientResult.Defeat, 'z', 50),
        ],
      },
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).toBe(false)
    evaluateResults(reconciled.results, {
      1: { result: 'win', race: 'p', apm: 50 },
      5: { result: 'loss', race: 'z', apm: 40 },
      7: { result: 'loss', race: 't', apm: 20 },
      8: { result: 'win', race: 'z', apm: 30 },
    })
  })

  test('2v2 with one player missing report and being disconnected', () => {
    // Tests legacy clients that don't map disconnects-with-victories to losses
    const results = [
      {
        reporter: 2,
        time: 7,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 't', 27),
          makePlayerResult(2, GameClientResult.Disconnected, 'z', 35),
          makePlayerResult(3, GameClientResult.Playing, 'p', 44),
          makePlayerResult(4, GameClientResult.Disconnected, 'p', 378),
        ],
      },
      {
        reporter: 3,
        time: 50,
        playerResults: [
          makePlayerResult(1, GameClientResult.Disconnected, 't', 27),
          makePlayerResult(2, GameClientResult.Victory, 'z', 35),
          makePlayerResult(3, GameClientResult.Victory, 'p', 44),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 378),
        ],
      },
      {
        reporter: 4,
        time: 9,
        playerResults: [
          makePlayerResult(1, GameClientResult.Disconnected, 't', 27),
          makePlayerResult(2, GameClientResult.Disconnected, 'z', 35),
          makePlayerResult(3, GameClientResult.Playing, 'p', 44),
          makePlayerResult(4, GameClientResult.Disconnected, 'p', 378),
        ],
      },
      null,
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).toBe(false)
    evaluateResults(reconciled.results, {
      1: { result: 'loss', race: 't', apm: 27 },
      2: { result: 'win', race: 'z', apm: 35 },
      3: { result: 'win', race: 'p', apm: 44 },
      4: { result: 'loss', race: 'p', apm: 378 },
    })
  })

  test('1v1 double loss regression', () => {
    const results = [
      {
        reporter: 2,
        time: 7,
        playerResults: [
          makePlayerResult(1, GameClientResult.Defeat, 't', 27),
          makePlayerResult(2, GameClientResult.Playing, 'z', 35),
        ],
      },
      {
        reporter: 1,
        time: 50,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 't', 27),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 35),
        ],
      },
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).toBe(true)
    evaluateResults(reconciled.results, {
      1: { result: 'unknown', race: 't', apm: 27 },
      2: { result: 'unknown', race: 'z', apm: 35 },
    })
  })
})
