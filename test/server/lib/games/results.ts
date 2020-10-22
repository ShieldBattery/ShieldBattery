import { expect } from 'chai'
import { GameClientResult } from '../../../../common/game-results'
import { AssignedRaceChar } from '../../../../common/races'

import {
  hasCompletedResults,
  PlayerResult,
  ReconciledPlayerResult,
  reconcileResults,
} from '../../../../server/lib/games/results'

function makePlayerResult(
  name: string,
  result: GameClientResult,
  race: AssignedRaceChar,
  apm: number,
): [string, PlayerResult] {
  return [name, { result, race, apm }]
}

describe('games/results/hasCompletedResults', () => {
  it('should return false when one player is still playing in a 1v1', () => {
    const results = [
      {
        reporter: 'tec28',
        time: 7,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Playing, 't', 27),
          makePlayerResult('tec28', GameClientResult.Disconnected, 'z', 35),
        ],
      },
      null,
    ]

    expect(hasCompletedResults(results)).to.equal(false)
  })

  it('should return true when all players have a terminal result in a 1v1', () => {
    const results = [
      {
        reporter: 'tec28',
        time: 7,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Playing, 't', 27),
          makePlayerResult('tec28', GameClientResult.Disconnected, 'z', 35),
        ],
      },
      {
        reporter: 'tec27',
        time: 33,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Victory, 't', 27),
          makePlayerResult('tec28', GameClientResult.Defeat, 'z', 35),
        ],
      },
    ]

    expect(hasCompletedResults(results)).to.equal(true)
  })

  it('should return false when one player is still playing in a 4 player game', () => {
    const results = [
      {
        reporter: 'tec28',
        time: 7,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Playing, 't', 27),
          makePlayerResult('tec28', GameClientResult.Disconnected, 'z', 35),
          makePlayerResult('heyoka', GameClientResult.Playing, 'p', 44),
          makePlayerResult('natook', GameClientResult.Disconnected, 'p', 378),
        ],
      },
      null,
      {
        reporter: 'tec27',
        time: 9,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Disconnected, 't', 27),
          makePlayerResult('tec28', GameClientResult.Disconnected, 'z', 35),
          makePlayerResult('heyoka', GameClientResult.Playing, 'p', 44),
          makePlayerResult('natook', GameClientResult.Disconnected, 'p', 378),
        ],
      },
      null,
    ]

    expect(hasCompletedResults(results)).to.equal(false)
  })

  it('should return true when all players have a terminal state in a 4 player game', () => {
    const results = [
      {
        reporter: 'tec28',
        time: 7,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Playing, 't', 27),
          makePlayerResult('tec28', GameClientResult.Disconnected, 'z', 35),
          makePlayerResult('heyoka', GameClientResult.Playing, 'p', 44),
          makePlayerResult('natook', GameClientResult.Disconnected, 'p', 378),
        ],
      },
      {
        reporter: 'heyoka',
        time: 50,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Defeat, 't', 27),
          makePlayerResult('tec28', GameClientResult.Victory, 'z', 35),
          makePlayerResult('heyoka', GameClientResult.Victory, 'p', 44),
          makePlayerResult('natook', GameClientResult.Defeat, 'p', 378),
        ],
      },
      {
        reporter: 'tec27',
        time: 9,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Disconnected, 't', 27),
          makePlayerResult('tec28', GameClientResult.Disconnected, 'z', 35),
          makePlayerResult('heyoka', GameClientResult.Playing, 'p', 44),
          makePlayerResult('natook', GameClientResult.Disconnected, 'p', 378),
        ],
      },
      null,
    ]

    expect(hasCompletedResults(results)).to.equal(true)
  })
})

function evaluateResults(
  resultsMap: Map<string, ReconciledPlayerResult>,
  expectedObj: { [key: string]: ReconciledPlayerResult },
) {
  expect(resultsMap).to.have.all.keys(Object.keys(expectedObj))
  for (const key of Object.keys(expectedObj)) {
    expect(resultsMap.get(key), `unexpected result for ${key}`).to.deep.equal(expectedObj[key])
  }
}

describe('games/results/reconcileResults', () => {
  it('should reconcile a simple, undisputed 1v1 with complete results', () => {
    const results = [
      {
        reporter: 'tec28',
        time: 7,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Playing, 't', 50),
          makePlayerResult('tec28', GameClientResult.Disconnected, 'z', 60),
        ],
      },
      {
        reporter: 'tec27',
        time: 33,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Victory, 't', 25),
          makePlayerResult('tec28', GameClientResult.Defeat, 'z', 30),
        ],
      },
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).to.equal(false)
    expect(reconciled.time).to.equal(33)
    evaluateResults(reconciled.results, {
      tec27: { result: 'win', race: 't', apm: 25 },
      tec28: { result: 'loss', race: 'z', apm: 60 },
    })
  })

  it('should reconcile a disputed 1v1 with complete results', () => {
    const results = [
      {
        reporter: 'tec28',
        time: 45,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Defeat, 't', 50),
          makePlayerResult('tec28', GameClientResult.Victory, 'z', 60),
        ],
      },
      {
        reporter: 'tec27',
        time: 33,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Victory, 't', 25),
          makePlayerResult('tec28', GameClientResult.Defeat, 'z', 30),
        ],
      },
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).to.equal(true)
    evaluateResults(reconciled.results, {
      tec27: { result: 'unknown', race: 't', apm: 25 },
      tec28: { result: 'unknown', race: 'z', apm: 60 },
    })
  })

  it('should reconcile a 4 player game with undisputed, but incomplete results', () => {
    const results = [
      {
        reporter: 'tec28',
        time: 7,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Playing, 't', 20),
          makePlayerResult('tec28', GameClientResult.Disconnected, 'z', 20),
          makePlayerResult('heyoka', GameClientResult.Playing, 'p', 20),
          makePlayerResult('natook', GameClientResult.Disconnected, 'p', 20),
        ],
      },
      {
        reporter: 'heyoka',
        time: 50,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Defeat, 't', 30),
          makePlayerResult('tec28', GameClientResult.Victory, 'z', 30),
          makePlayerResult('heyoka', GameClientResult.Victory, 'p', 30),
          makePlayerResult('natook', GameClientResult.Defeat, 'p', 30),
        ],
      },
      {
        reporter: 'tec27',
        time: 9,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Disconnected, 't', 40),
          makePlayerResult('tec28', GameClientResult.Disconnected, 'z', 40),
          makePlayerResult('heyoka', GameClientResult.Playing, 'p', 40),
          makePlayerResult('natook', GameClientResult.Disconnected, 'p', 40),
        ],
      },
      null,
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).to.equal(false)
    expect(reconciled.time).to.equal(50)
    evaluateResults(reconciled.results, {
      tec27: { result: 'loss', race: 't', apm: 40 },
      tec28: { result: 'win', race: 'z', apm: 20 },
      heyoka: { result: 'win', race: 'p', apm: 30 },
      natook: { result: 'loss', race: 'p', apm: 0 },
    })
  })

  it('should reconcile a 4 player game with disputed results for 1 player', () => {
    const results = [
      {
        reporter: 'tec28',
        time: 7,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Playing, 't', 20),
          makePlayerResult('tec28', GameClientResult.Disconnected, 'z', 20),
          makePlayerResult('heyoka', GameClientResult.Playing, 'p', 20),
          makePlayerResult('natook', GameClientResult.Disconnected, 'p', 20),
        ],
      },
      {
        reporter: 'heyoka',
        time: 50,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Defeat, 't', 30),
          makePlayerResult('tec28', GameClientResult.Victory, 'z', 30),
          makePlayerResult('heyoka', GameClientResult.Victory, 'p', 30),
          makePlayerResult('natook', GameClientResult.Defeat, 'p', 30),
        ],
      },
      {
        reporter: 'tec27',
        time: 45,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Defeat, 't', 40),
          makePlayerResult('tec28', GameClientResult.Victory, 'z', 40),
          makePlayerResult('heyoka', GameClientResult.Victory, 'p', 40),
          makePlayerResult('natook', GameClientResult.Defeat, 'p', 40),
        ],
      },
      {
        reporter: 'natook',
        time: 25,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Victory, 't', 50),
          makePlayerResult('tec28', GameClientResult.Victory, 'z', 50),
          makePlayerResult('heyoka', GameClientResult.Victory, 'p', 50),
          makePlayerResult('natook', GameClientResult.Defeat, 'p', 50),
        ],
      },
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).to.equal(true)
    evaluateResults(reconciled.results, {
      tec27: { result: 'loss', race: 't', apm: 40 },
      tec28: { result: 'win', race: 'z', apm: 20 },
      heyoka: { result: 'win', race: 'p', apm: 30 },
      natook: { result: 'loss', race: 'p', apm: 50 },
    })
  })

  it('should mark a match disputed if players disagree on assigned races', () => {
    const results = [
      {
        reporter: 'tec28',
        time: 45,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Playing, 'p', 30),
          makePlayerResult('tec28', GameClientResult.Disconnected, 'z', 30),
        ],
      },
      {
        reporter: 'tec27',
        time: 33,
        playerResults: [
          makePlayerResult('tec27', GameClientResult.Victory, 't', 20),
          makePlayerResult('tec28', GameClientResult.Defeat, 'z', 20),
        ],
      },
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).to.equal(true)
    evaluateResults(reconciled.results, {
      tec27: { result: 'win', race: 'p', apm: 20 },
      tec28: { result: 'loss', race: 'z', apm: 30 },
    })
  })
})
