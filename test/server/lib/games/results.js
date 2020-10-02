import { expect } from 'chai'
import {
  GAME_RESULT_DEFEAT,
  GAME_RESULT_DISCONNECTED,
  GAME_RESULT_PLAYING,
  GAME_RESULT_VICTORY,
} from '../../../../common/game-results'

import { hasCompletedResults, reconcileResults } from '../../../../server/lib/games/results'

describe('games/results/hasCompletedResults', () => {
  it('should return false when one player is still playing in a 1v1', () => {
    const results = [
      [
        ['tec27', GAME_RESULT_PLAYING],
        ['tec28', GAME_RESULT_DISCONNECTED],
      ],
      null,
    ]

    expect(hasCompletedResults(results)).to.equal(false)
  })

  it('should return true when all players have a terminal result in a 1v1', () => {
    const results = [
      [
        ['tec27', GAME_RESULT_PLAYING],
        ['tec28', GAME_RESULT_DISCONNECTED],
      ],
      [
        ['tec27', GAME_RESULT_VICTORY],
        ['tec28', GAME_RESULT_DEFEAT],
      ],
    ]

    expect(hasCompletedResults(results)).to.equal(true)
  })

  it('should return false when one player is still playing in a 4 player game', () => {
    const results = [
      [
        ['tec27', GAME_RESULT_PLAYING],
        ['tec28', GAME_RESULT_DISCONNECTED],
        ['heyoka', GAME_RESULT_PLAYING],
        ['natook', GAME_RESULT_DISCONNECTED],
      ],
      null,
      [
        ['tec27', GAME_RESULT_DISCONNECTED],
        ['tec28', GAME_RESULT_DISCONNECTED],
        ['heyoka', GAME_RESULT_PLAYING],
        ['natook', GAME_RESULT_DISCONNECTED],
      ],
      null,
    ]

    expect(hasCompletedResults(results)).to.equal(false)
  })

  it('should return true when all players have a terminal state in a 4 player game', () => {
    const results = [
      [
        ['tec27', GAME_RESULT_PLAYING],
        ['tec28', GAME_RESULT_DISCONNECTED],
        ['heyoka', GAME_RESULT_PLAYING],
        ['natook', GAME_RESULT_DISCONNECTED],
      ],
      [
        ['tec27', GAME_RESULT_DEFEAT],
        ['tec28', GAME_RESULT_VICTORY],
        ['heyoka', GAME_RESULT_VICTORY],
        ['natook', GAME_RESULT_DEFEAT],
      ],
      [
        ['tec27', GAME_RESULT_DISCONNECTED],
        ['tec28', GAME_RESULT_DISCONNECTED],
        ['heyoka', GAME_RESULT_PLAYING],
        ['natook', GAME_RESULT_DISCONNECTED],
      ],
      null,
    ]

    expect(hasCompletedResults(results)).to.equal(true)
  })
})

function evaluateResults(resultsMap, expectedObj) {
  expect(resultsMap).to.have.all.keys(Object.keys(expectedObj))
  for (const key of Object.keys(expectedObj)) {
    expect(resultsMap.get(key), `unexpected result for ${key}`).to.equal(expectedObj[key])
  }
}

describe('games/results/reconcileResults', () => {
  it('should reconcile a simple, undisputed 1v1 with complete results', () => {
    const results = [
      [
        ['tec27', GAME_RESULT_PLAYING],
        ['tec28', GAME_RESULT_DISCONNECTED],
      ],
      [
        ['tec27', GAME_RESULT_VICTORY],
        ['tec28', GAME_RESULT_DEFEAT],
      ],
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).to.equal(false)
    evaluateResults(reconciled.results, {
      tec27: 'win',
      tec28: 'loss',
    })
  })

  it('should reconcile a disputed 1v1 with complete results', () => {
    const results = [
      [
        ['tec27', GAME_RESULT_DEFEAT],
        ['tec28', GAME_RESULT_VICTORY],
      ],
      [
        ['tec27', GAME_RESULT_VICTORY],
        ['tec28', GAME_RESULT_DEFEAT],
      ],
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).to.equal(true)
    evaluateResults(reconciled.results, {
      tec27: 'unknown',
      tec28: 'unknown',
    })
  })

  it('should reconcile a 4 player game with undisputed, but incomplete results', () => {
    const results = [
      [
        ['tec27', GAME_RESULT_PLAYING],
        ['tec28', GAME_RESULT_DISCONNECTED],
        ['heyoka', GAME_RESULT_PLAYING],
        ['natook', GAME_RESULT_DISCONNECTED],
      ],
      [
        ['tec27', GAME_RESULT_DEFEAT],
        ['tec28', GAME_RESULT_VICTORY],
        ['heyoka', GAME_RESULT_VICTORY],
        ['natook', GAME_RESULT_DEFEAT],
      ],
      [
        ['tec27', GAME_RESULT_DISCONNECTED],
        ['tec28', GAME_RESULT_DISCONNECTED],
        ['heyoka', GAME_RESULT_PLAYING],
        ['natook', GAME_RESULT_DISCONNECTED],
      ],
      null,
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).to.equal(false)
    evaluateResults(reconciled.results, {
      tec27: 'loss',
      tec28: 'win',
      heyoka: 'win',
      natook: 'loss',
    })
  })

  it('should reconcile a 4 player game with disputed results for 1 player', () => {
    const results = [
      [
        ['tec27', GAME_RESULT_PLAYING],
        ['tec28', GAME_RESULT_DISCONNECTED],
        ['heyoka', GAME_RESULT_PLAYING],
        ['natook', GAME_RESULT_DISCONNECTED],
      ],
      [
        ['tec27', GAME_RESULT_DEFEAT],
        ['tec28', GAME_RESULT_VICTORY],
        ['heyoka', GAME_RESULT_VICTORY],
        ['natook', GAME_RESULT_DEFEAT],
      ],
      [
        ['tec27', GAME_RESULT_DEFEAT],
        ['tec28', GAME_RESULT_VICTORY],
        ['heyoka', GAME_RESULT_VICTORY],
        ['natook', GAME_RESULT_DEFEAT],
      ],
      [
        ['tec27', GAME_RESULT_VICTORY],
        ['tec28', GAME_RESULT_VICTORY],
        ['heyoka', GAME_RESULT_VICTORY],
        ['natook', GAME_RESULT_DEFEAT],
      ],
    ]

    const reconciled = reconcileResults(results)

    expect(reconciled.disputed).to.equal(true)
    evaluateResults(reconciled.results, {
      tec27: 'loss',
      tec28: 'win',
      heyoka: 'win',
      natook: 'loss',
    })
  })
})
