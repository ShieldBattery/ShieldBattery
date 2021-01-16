import { expect } from 'chai'
import { GameClientPlayerResult, GameClientResult } from '../../../../common/game-results'
import { AssignedRaceChar } from '../../../../common/races'
import {
  hasCompletedResults,
  ReconciledPlayerResult,
  reconcileResults,
} from '../../../../server/lib/games/results'

function makePlayerResult(
  userId: number,
  result: GameClientResult,
  race: AssignedRaceChar,
  apm: number,
): [number, GameClientPlayerResult] {
  return [userId, { result, race, apm }]
}

describe('games/results/hasCompletedResults', () => {
  it('should return false when one player is still playing in a 1v1', () => {
    const results = [
      {
        reporter: 2,
        time: 7,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 't', 27),
          makePlayerResult(2, GameClientResult.Disconnected, 'z', 35),
        ],
      },
      null,
    ]

    expect(hasCompletedResults(results)).to.equal(false)
  })

  it('should return true when all players have a terminal result in a 1v1', () => {
    const results = [
      {
        reporter: 2,
        time: 7,
        playerResults: [
          makePlayerResult(1, GameClientResult.Playing, 't', 27),
          makePlayerResult(2, GameClientResult.Disconnected, 'z', 35),
        ],
      },
      {
        reporter: 1,
        time: 33,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 27),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 35),
        ],
      },
    ]

    expect(hasCompletedResults(results)).to.equal(true)
  })

  it('should return false when one player is still playing in a 4 player game', () => {
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
      null,
      {
        reporter: 1,
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

    expect(hasCompletedResults(results)).to.equal(false)
  })

  it('should return true when all players have a terminal state in a 4 player game', () => {
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
          makePlayerResult(1, GameClientResult.Defeat, 't', 27),
          makePlayerResult(2, GameClientResult.Victory, 'z', 35),
          makePlayerResult(3, GameClientResult.Victory, 'p', 44),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 378),
        ],
      },
      {
        reporter: 1,
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

    expect(hasCompletedResults(results)).to.equal(true)
  })
})

function evaluateResults(
  resultsMap: Map<number, ReconciledPlayerResult>,
  expectedObj: { [key: number]: ReconciledPlayerResult },
) {
  expect(resultsMap).to.have.all.keys(Object.keys(expectedObj).map(k => +k))
  for (const key of Object.keys(expectedObj)) {
    expect(resultsMap.get(+key), `unexpected result for ${key}`).to.deep.equal(expectedObj[+key])
  }
}

describe('games/results/reconcileResults', () => {
  it('should reconcile a simple, undisputed 1v1 with complete results', () => {
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

    expect(reconciled.disputed).to.equal(false)
    expect(reconciled.time).to.equal(33)
    evaluateResults(reconciled.results, {
      1: { result: 'win', race: 't', apm: 25 },
      2: { result: 'loss', race: 'z', apm: 60 },
    })
  })

  it('should reconcile a disputed 1v1 with complete results', () => {
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

    expect(reconciled.disputed).to.equal(true)
    evaluateResults(reconciled.results, {
      1: { result: 'unknown', race: 't', apm: 25 },
      2: { result: 'unknown', race: 'z', apm: 60 },
    })
  })

  it('should reconcile a 4 player game with undisputed, but incomplete results', () => {
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

    expect(reconciled.disputed).to.equal(false)
    expect(reconciled.time).to.equal(50)
    evaluateResults(reconciled.results, {
      1: { result: 'loss', race: 't', apm: 40 },
      2: { result: 'win', race: 'z', apm: 20 },
      3: { result: 'win', race: 'p', apm: 30 },
      4: { result: 'loss', race: 'p', apm: 0 },
    })
  })

  it('should reconcile a 4 player game without final results', () => {
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

    expect(reconciled.disputed).to.equal(true)
    expect(reconciled.time).to.equal(9)
    evaluateResults(reconciled.results, {
      1: { result: 'unknown', race: 't', apm: 40 },
      2: { result: 'unknown', race: 'z', apm: 20 },
      3: { result: 'unknown', race: 'p', apm: 0 },
      4: { result: 'unknown', race: 'p', apm: 0 },
    })
  })

  it('should reconcile a 4 player game with disputed results for 1 player', () => {
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

    expect(reconciled.disputed).to.equal(true)
    evaluateResults(reconciled.results, {
      1: { result: 'loss', race: 't', apm: 40 },
      2: { result: 'win', race: 'z', apm: 20 },
      3: { result: 'win', race: 'p', apm: 30 },
      4: { result: 'loss', race: 'p', apm: 50 },
    })
  })

  it('should mark a match disputed if players disagree on assigned races', () => {
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

    expect(reconciled.disputed).to.equal(true)
    evaluateResults(reconciled.results, {
      1: { result: 'win', race: 'p', apm: 20 },
      2: { result: 'loss', race: 'z', apm: 30 },
    })
  })
})
