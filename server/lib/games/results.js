import { GAME_RESULT_VICTORY, GAME_RESULT_DEFEAT } from '../../../common/game-results'

function isTerminal(resultCode) {
  return resultCode === GAME_RESULT_VICTORY || resultCode === GAME_RESULT_DEFEAT
}

function countTerminalStates(result) {
  return result.reduce((sum, [, curResult]) => (isTerminal(curResult) ? sum + 1 : sum), 0)
}

function getNumPlayers(results) {
  for (const result of results) {
    if (result) {
      return result.length
    }
  }

  throw new Error('results contained no players')
}

/**
 * Returns true of the given set of results can deliver a victory or defeat for every player in the
 * game.
 *
 * @param results an array of game results that have been received from players. Each entry in the
 *     array is either null (if no results have been received from that player yet), or a list of
 *     the current results for every player in the game when they were reported (in the format
 *     [['playerName', 0], ['playerTwoName', 3], ...])
 */
export function hasCompletedResults(results) {
  const numPlayers = getNumPlayers(results)

  const numTerminalStates = results.filter(r => !!r).map(r => countTerminalStates(r))
  let maxTerminal = 0
  for (const numTerminal of numTerminalStates) {
    if (numTerminal > maxTerminal) {
      maxTerminal = numTerminal
    }
  }

  return maxTerminal === numPlayers
}

/**
 * Returns the final game results given the per-player results that were reported for a game.
 *
 * @param results an array of game results that have been received from players. Each entry in the
 *     array is either null (if no results have been received from that player yet), or a list of
 *     the current results for every player in the game when they were reported (in the format
 *     [['playerName', 0], ['playerTwoName', 3], ...])
 *
 * @returns an object containing a `disputed` bool describing whether the results differ between
 *     the player reports, and a `results` Map of player name => 'win'|'loss'|'draw'|'unknown'
 */
export function reconcileResults(results) {
  // TODO(tec27): Incomplete results can also sometimes be reconciled (e.g. 1 player still playing,
  // 1 player disconnected) but we need more information about the game type to do so (e.g. what
  // team structure is)

  let disputed = false

  const sortedResults = results
    .filter(r => !!r)
    .sort((a, b) => {
      const aTerminal = countTerminalStates(a)
      const bTerminal = countTerminalStates(b)
      return aTerminal - bTerminal
    })

  const combined = sortedResults.reduce((map, cur) => {
    for (const [name, result] of cur) {
      if (!map.has(name)) {
        map.set(name, [])
      }
      map.get(name).push(result)
    }

    return map
  }, new Map())

  const reconciled = new Map()

  for (const [playerName, playerResults] of combined.entries()) {
    let victories = 0
    let defeats = 0
    for (const r of playerResults) {
      if (r === GAME_RESULT_VICTORY) {
        victories += 1
      } else if (r === GAME_RESULT_DEFEAT) {
        defeats += 1
      }
    }

    if (victories > 0 && defeats > 0) {
      disputed = true
      if (victories > defeats) {
        reconciled.set(playerName, 'win')
      } else if (victories < defeats) {
        reconciled.set(playerName, 'loss')
      } else {
        reconciled.set(playerName, 'unknown')
      }
    } else if (victories > 0) {
      reconciled.set(playerName, 'win')
    } else {
      reconciled.set(playerName, 'loss')
    }
  }

  // TODO(tec27): Check that the results are valid for the game configuration (e.g. only 1 victor
  // for an FFA)

  if (Array.from(reconciled.values()).some(r => r === 'unknown')) {
    for (const name of reconciled.keys()) {
      reconciled.set(name, 'unknown')
    }
  }

  return { disputed, results: reconciled }
}
