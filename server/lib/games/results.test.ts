import { describe, expect, test } from 'vitest'
import {
  GameClientPlayerResult,
  GameClientResult,
  ReconciledPlayerResult,
} from '../../../common/games/results'
import { AssignedRaceChar } from '../../../common/races'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { reconcileResults } from './results'

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
  expect(obj).toEqual(expectedObj)
}

function users(ids: ReadonlyArray<number>): SbUserId[] {
  return ids.map(makeSbUserId)
}

describe('games/results/reconcileResults', () => {
  test('should reconcile a simple, undisputed 1v1 with complete results', () => {
    const results = [
      {
        reporter: makeSbUserId(2),
        time: 7,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 't', 50),
          makePlayerResult(2, GameClientResult.Disconnected, 'z', 60),
        ],
      },
      {
        reporter: makeSbUserId(1),
        time: 33,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 25),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
        ],
      },
    ]

    const reconciled = reconcileResults(users([2, 1]), results, [users([1]), users([2])])

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
        reporter: makeSbUserId(2),
        time: 7,
        playerResults: [],
      },
      {
        reporter: makeSbUserId(1),
        time: 33,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 25),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
        ],
      },
    ]

    const reconciled = reconcileResults(users([2, 1]), results, [users([1]), users([2])])

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
        reporter: makeSbUserId(2),
        time: 45,
        playerResults: [
          makePlayerResult(1, GameClientResult.Defeat, 't', 50),
          makePlayerResult(2, GameClientResult.Victory, 'z', 60),
        ],
      },
      {
        reporter: makeSbUserId(1),
        time: 33,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 25),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
        ],
      },
    ]

    const reconciled = reconcileResults(users([2, 1]), results, [users([1]), users([2])])

    expect(reconciled.disputed).toBe(true)
    evaluateResults(reconciled.results, {
      1: { result: 'unknown', race: 't', apm: 25 },
      2: { result: 'unknown', race: 'z', apm: 60 },
    })
  })

  test('should reconcile a 4 player game with undisputed, but incomplete results', () => {
    const results = [
      {
        reporter: makeSbUserId(2),
        time: 7,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 't', 20),
          makePlayerResult(2, GameClientResult.Disconnected, 'z', 20),
          makePlayerResult(3, GameClientResult.Playing, 'p', 20),
          makePlayerResult(4, GameClientResult.Disconnected, 'p', 20),
        ],
      },
      {
        reporter: makeSbUserId(3),
        time: 50,
        playerResults: [
          makePlayerResult(1, GameClientResult.Defeat, 't', 30),
          makePlayerResult(2, GameClientResult.Victory, 'z', 30),
          makePlayerResult(3, GameClientResult.Victory, 'p', 30),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 30),
        ],
      },
      {
        reporter: makeSbUserId(1),
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

    const reconciled = reconcileResults(users([2, 3, 1, 4]), results, [
      users([2, 3]),
      users([1, 4]),
    ])

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
        reporter: makeSbUserId(2),
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
        reporter: makeSbUserId(1),
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

    const reconciled = reconcileResults(users([2, 1, 3, 4]), results, [
      users([2, 3]),
      users([1, 4]),
    ])

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
        reporter: makeSbUserId(2),
        time: 7,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 't', 20),
          makePlayerResult(2, GameClientResult.Disconnected, 'z', 20),
          makePlayerResult(3, GameClientResult.Playing, 'p', 20),
          makePlayerResult(4, GameClientResult.Disconnected, 'p', 20),
        ],
      },
      {
        reporter: makeSbUserId(3),
        time: 50,
        playerResults: [
          makePlayerResult(1, GameClientResult.Defeat, 't', 30),
          makePlayerResult(2, GameClientResult.Victory, 'z', 30),
          makePlayerResult(3, GameClientResult.Victory, 'p', 30),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 30),
        ],
      },
      {
        reporter: makeSbUserId(1),
        time: 45,
        playerResults: [
          makePlayerResult(1, GameClientResult.Defeat, 't', 40),
          makePlayerResult(2, GameClientResult.Victory, 'z', 40),
          makePlayerResult(3, GameClientResult.Victory, 'p', 40),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 40),
        ],
      },
      {
        reporter: makeSbUserId(4),
        time: 25,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 50),
          makePlayerResult(2, GameClientResult.Victory, 'z', 50),
          makePlayerResult(3, GameClientResult.Victory, 'p', 50),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 50),
        ],
      },
    ]

    const reconciled = reconcileResults(users([1, 2, 3, 4]), results, [
      users([2, 3]),
      users([1, 4]),
    ])

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
        reporter: makeSbUserId(2),
        time: 45,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 'p', 30),
          makePlayerResult(2, GameClientResult.Disconnected, 'z', 30),
        ],
      },
      {
        reporter: makeSbUserId(1),
        time: 33,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 20),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 20),
        ],
      },
    ]

    const reconciled = reconcileResults(users([1, 2]), results, [users([1]), users([2])])

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
        reporter: makeSbUserId(7),
        time: 7,
        playerResults: [
          makePlayerResult(7, GameClientResult.Disconnected, 't', 20),
          makePlayerResult(8, GameClientResult.Playing, 'z', 20),
          makePlayerResult(5, GameClientResult.Playing, 'z', 20),
          makePlayerResult(1, GameClientResult.Playing, 'p', 20),
        ],
      },
      {
        reporter: makeSbUserId(8),
        time: 50,
        playerResults: [
          makePlayerResult(5, GameClientResult.Playing, 'z', 30),
          makePlayerResult(1, GameClientResult.Playing, 'p', 30),
          makePlayerResult(8, GameClientResult.Disconnected, 'z', 30),
          makePlayerResult(7, GameClientResult.Disconnected, 't', 30),
        ],
      },
      {
        reporter: makeSbUserId(5),
        time: 60,
        playerResults: [
          makePlayerResult(7, GameClientResult.Disconnected, 't', 40),
          makePlayerResult(1, GameClientResult.Playing, 'p', 40),
          makePlayerResult(8, GameClientResult.Disconnected, 'z', 40),
          makePlayerResult(5, GameClientResult.Disconnected, 'z', 40),
        ],
      },
      {
        reporter: makeSbUserId(1),
        time: 70,
        playerResults: [
          makePlayerResult(7, GameClientResult.Defeat, 't', 50),
          makePlayerResult(1, GameClientResult.Victory, 'p', 50),
          makePlayerResult(8, GameClientResult.Victory, 'z', 50),
          makePlayerResult(5, GameClientResult.Defeat, 'z', 50),
        ],
      },
    ]

    const reconciled = reconcileResults(users([1, 5, 7, 8]), results, [
      users([1, 8]),
      users([5, 7]),
    ])

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
        reporter: makeSbUserId(2),
        time: 7,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 't', 27),
          makePlayerResult(2, GameClientResult.Disconnected, 'z', 35),
          makePlayerResult(3, GameClientResult.Playing, 'p', 44),
          makePlayerResult(4, GameClientResult.Disconnected, 'p', 378),
        ],
      },
      {
        reporter: makeSbUserId(3),
        time: 50,
        playerResults: [
          makePlayerResult(1, GameClientResult.Disconnected, 't', 27),
          makePlayerResult(2, GameClientResult.Victory, 'z', 35),
          makePlayerResult(3, GameClientResult.Victory, 'p', 44),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 378),
        ],
      },
      {
        reporter: makeSbUserId(4),
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

    const reconciled = reconcileResults(users([3, 2, 4, 1]), results, [
      users([2, 3]),
      users([1, 4]),
    ])

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
        reporter: makeSbUserId(2),
        time: 7,
        playerResults: [
          makePlayerResult(1, GameClientResult.Defeat, 't', 27),
          makePlayerResult(2, GameClientResult.Playing, 'z', 35),
        ],
      },
      {
        reporter: makeSbUserId(1),
        time: 50,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 't', 27),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 35),
        ],
      },
    ]

    const reconciled = reconcileResults(users([1, 2]), results, [users([1]), users([2])])

    expect(reconciled.disputed).toBe(true)
    evaluateResults(reconciled.results, {
      1: { result: 'unknown', race: 't', apm: 27 },
      2: { result: 'unknown', race: 'z', apm: 35 },
    })
  })

  test('2v2 with blank results is handled gracefully', () => {
    // Tests that we don't fail to reconcile bugged results from #1217
    const results = [
      {
        reporter: makeSbUserId(2),
        time: 0,
        playerResults: [],
      },
      {
        reporter: makeSbUserId(3),
        time: 0,
        playerResults: [],
      },
      {
        reporter: makeSbUserId(4),
        time: 0,
        playerResults: [],
      },
      null,
    ]

    const reconciled = reconcileResults(users([3, 2, 4, 1]), results, [
      users([2, 3]),
      users([1, 4]),
    ])

    expect(reconciled.disputed).toBe(true)
    evaluateResults(reconciled.results, {
      1: { result: 'unknown', race: 'p', apm: 0 },
      2: { result: 'unknown', race: 'p', apm: 0 },
      3: { result: 'unknown', race: 'p', apm: 0 },
      4: { result: 'unknown', race: 'p', apm: 0 },
    })
  })

  test('matchmaking 1v1 where both players report themselves the winner is disputed', () => {
    // Each player honestly reports self=Victory and opponent=Playing (not Defeat). Without team
    // validation this reconciles to two clean wins; a 1v1 with a fixed team structure only allows a
    // single winner, so passing teams must instead mark it disputed with no credit for either player.
    const results = [
      {
        reporter: makeSbUserId(25),
        time: 40,
        playerResults: [
          makePlayerResult(26, GameClientResult.Playing, 'z', 60),
          makePlayerResult(25, GameClientResult.Victory, 't', 50),
        ],
      },
      {
        reporter: makeSbUserId(26),
        time: 42,
        playerResults: [
          makePlayerResult(25, GameClientResult.Playing, 't', 55),
          makePlayerResult(26, GameClientResult.Victory, 'z', 65),
        ],
      },
    ]

    const reconciled = reconcileResults(users([25, 26]), results, [users([25]), users([26])])

    expect(reconciled.disputed).toBe(true)
    evaluateResults(reconciled.results, {
      25: { result: 'unknown', race: 't', apm: 50 },
      26: { result: 'unknown', race: 'z', apm: 65 },
    })
  })

  test('legit 1v1 with one victory and one defeat is not disputed', () => {
    const results = [
      {
        reporter: makeSbUserId(1),
        time: 40,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 50),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 60),
        ],
      },
      {
        reporter: makeSbUserId(2),
        time: 42,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 50),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 60),
        ],
      },
    ]

    const reconciled = reconcileResults(users([1, 2]), results, [users([1]), users([2])])

    expect(reconciled.disputed).toBe(false)
    evaluateResults(reconciled.results, {
      1: { result: 'win', race: 't', apm: 50 },
      2: { result: 'loss', race: 'z', apm: 60 },
    })
  })

  test('legit 2v2 with both winners on the same team is not disputed', () => {
    const results = [
      {
        reporter: makeSbUserId(1),
        time: 40,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 50),
          makePlayerResult(2, GameClientResult.Victory, 'z', 60),
          makePlayerResult(3, GameClientResult.Defeat, 'p', 30),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 40),
        ],
      },
      {
        reporter: makeSbUserId(3),
        time: 42,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 50),
          makePlayerResult(2, GameClientResult.Victory, 'z', 60),
          makePlayerResult(3, GameClientResult.Defeat, 'p', 30),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 40),
        ],
      },
    ]

    const reconciled = reconcileResults(users([1, 2, 3, 4]), results, [
      users([1, 2]),
      users([3, 4]),
    ])

    expect(reconciled.disputed).toBe(false)
    evaluateResults(reconciled.results, {
      1: { result: 'win', race: 't', apm: 50 },
      2: { result: 'win', race: 'z', apm: 60 },
      3: { result: 'loss', race: 'p', apm: 30 },
      4: { result: 'loss', race: 'p', apm: 40 },
    })
  })

  test('team game with winners spanning two teams is disputed', () => {
    // Winners end up on both teams (players 1 and 3), which is impossible for a game that allows a
    // single winning team.
    const results = [
      {
        reporter: makeSbUserId(1),
        time: 40,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 50),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 60),
          makePlayerResult(3, GameClientResult.Playing, 'p', 30),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 40),
        ],
      },
      {
        reporter: makeSbUserId(3),
        time: 42,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 't', 55),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 65),
          makePlayerResult(3, GameClientResult.Victory, 'p', 35),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 45),
        ],
      },
    ]

    const reconciled = reconcileResults(users([1, 2, 3, 4]), results, [
      users([1, 2]),
      users([3, 4]),
    ])

    expect(reconciled.disputed).toBe(true)
    evaluateResults(reconciled.results, {
      1: { result: 'unknown', race: 't', apm: 50 },
      2: { result: 'unknown', race: 'z', apm: 60 },
      3: { result: 'unknown', race: 'p', apm: 35 },
      4: { result: 'unknown', race: 'p', apm: 40 },
    })
  })

  test('game with null teams is not disputed by the structural check even with two winners', () => {
    // Passing null teams skips the single-winner validation. The caller passes null for any non-
    // matchmaking game (e.g. a lobby/custom game), where alliances can change mid-game so two
    // players who started on different teams could legitimately ally and co-win. Such contradictions
    // are left to other dispute signals rather than this structural check.
    const results = [
      {
        reporter: makeSbUserId(1),
        time: 40,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 50),
          makePlayerResult(2, GameClientResult.Victory, 'z', 60),
        ],
      },
      {
        reporter: makeSbUserId(2),
        time: 42,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 50),
          makePlayerResult(2, GameClientResult.Victory, 'z', 60),
        ],
      },
    ]

    const reconciled = reconcileResults(users([1, 2]), results, null)

    expect(reconciled.disputed).toBe(false)
    evaluateResults(reconciled.results, {
      1: { result: 'win', race: 't', apm: 50 },
      2: { result: 'win', race: 'z', apm: 60 },
    })
  })

  test('FFA where two players report self-victory is disputed', () => {
    // A free-for-all with no fixed teams: each player is their own team, so only one player may win.
    const results = [
      {
        reporter: makeSbUserId(1),
        time: 40,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 50),
          makePlayerResult(2, GameClientResult.Playing, 'z', 60),
          makePlayerResult(3, GameClientResult.Playing, 'p', 30),
        ],
      },
      {
        reporter: makeSbUserId(2),
        time: 42,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 't', 55),
          makePlayerResult(2, GameClientResult.Victory, 'z', 65),
          makePlayerResult(3, GameClientResult.Playing, 'p', 35),
        ],
      },
    ]

    const reconciled = reconcileResults(users([1, 2, 3]), results, [
      users([1]),
      users([2]),
      users([3]),
    ])

    expect(reconciled.disputed).toBe(true)
    evaluateResults(reconciled.results, {
      1: { result: 'unknown', race: 't', apm: 50 },
      2: { result: 'unknown', race: 'z', apm: 65 },
      3: { result: 'unknown', race: 'p', apm: 30 },
    })
  })

  test('FFA with a single clear winner is not disputed', () => {
    const results = [
      {
        reporter: makeSbUserId(1),
        time: 40,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 50),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 60),
          makePlayerResult(3, GameClientResult.Defeat, 'p', 30),
        ],
      },
      {
        reporter: makeSbUserId(2),
        time: 42,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 50),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 60),
          makePlayerResult(3, GameClientResult.Defeat, 'p', 30),
        ],
      },
      {
        reporter: makeSbUserId(3),
        time: 41,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 50),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 60),
          makePlayerResult(3, GameClientResult.Defeat, 'p', 30),
        ],
      },
    ]

    const reconciled = reconcileResults(users([1, 2, 3]), results, [
      users([1]),
      users([2]),
      users([3]),
    ])

    expect(reconciled.disputed).toBe(false)
    evaluateResults(reconciled.results, {
      1: { result: 'win', race: 't', apm: 50 },
      2: { result: 'loss', race: 'z', apm: 60 },
      3: { result: 'loss', race: 'p', apm: 30 },
    })
  })
})
