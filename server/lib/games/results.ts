import {
  GameClientPlayerResult,
  GameClientResult,
  ReconciledResult,
} from '../../../common/game-results'
import { AssignedRaceChar } from '../../../common/races'

export interface ResultSubmission {
  /** The user ID of the player who reported these results. */
  reporter: number
  /** The elapsed time of the game, in milliseconds. */
  time: number
  /** A tuple of (user id, result info). */
  playerResults: Array<[number, GameClientPlayerResult]>
}

function isTerminal(resultCode: GameClientResult) {
  return resultCode === GameClientResult.Victory || resultCode === GameClientResult.Defeat
}

function countTerminalStates(resultMap: Array<[number, GameClientPlayerResult]>) {
  return resultMap.reduce((sum, [, curResult]) => (isTerminal(curResult.result) ? sum + 1 : sum), 0)
}

function getNumPlayers(results: Array<ResultSubmission | null>) {
  for (const result of results) {
    if (result) {
      return result.playerResults.length
    }
  }

  throw new Error('results contained no players')
}

/**
 * Returns true of the given set of results can deliver a victory or defeat for every player in the
 * game.
 *
 * @param results an array of results submitted from each player. Players that have not submitted
 *   results yet will be nulls in this array.
 */
export function hasCompletedResults(results: Array<ResultSubmission | null>) {
  const numPlayers = getNumPlayers(results)

  const numTerminalStates = results
    .filter((r): r is ResultSubmission => !!r)
    .map(r => countTerminalStates(r.playerResults))
  let maxTerminal = 0
  for (const numTerminal of numTerminalStates) {
    if (numTerminal > maxTerminal) {
      maxTerminal = numTerminal
    }
  }

  return maxTerminal === numPlayers
}

export interface ReconciledPlayerResult {
  result: ReconciledResult
  race: AssignedRaceChar
  apm: number
}

export interface ReconciledResults {
  /**
   * Whether or not some of the players' results disagree on outcomes. Disputed results should
   * be looked over by an administrator to ensure correctness and that no cheating is occurring.
   */
  disputed: boolean
  /** The elapsed time for the game, in milliseconds. */
  time: number
  /** A map containing the final result info for each player in the game. */
  results: Map<number, ReconciledPlayerResult>
}

/**
 * Returns the final game results given the per-player results that were reported for a game.
 *
 * @param results an array of results submitted from each player. For players that have not
 *   submitted a result yet, a null will be present in this array.
 */
export function reconcileResults(results: Array<ResultSubmission | null>): ReconciledResults {
  // TODO(tec27): Incomplete results can also sometimes be reconciled (e.g. 1 player still playing,
  // 1 player disconnected) but we need more information about the game type to do so (e.g. what
  // team structure is)

  let disputed = false

  const sortedResults = results
    .filter((r): r is ResultSubmission => !!r)
    .sort((a, b) => {
      const aTerminal = countTerminalStates(a.playerResults)
      const bTerminal = countTerminalStates(b.playerResults)
      return aTerminal - bTerminal
    })

  // TODO(tec27): I *think* we can ensure that these sorted results have times that are also sorted
  // correctly, and use that to detect suspicious submissions? Unsure if this is safe, probably need
  // to let a bunch get submitted and see. For now this gives the final submitter (e.g. the victor)
  // control over the displayed time which is *slightly* unsafe, I suppose.
  const elapsedTime = sortedResults[sortedResults.length - 1].time

  const combined = new Map<number, GameClientPlayerResult[]>()
  const apm = new Map<number, number>()
  for (const { reporter, playerResults } of sortedResults) {
    for (const [id, result] of playerResults) {
      if (!combined.has(id)) {
        combined.set(id, [])
      }
      combined.get(id)!.push(result)

      if (reporter === id) {
        // Trust each player about their own APM only. This is a tad exploitable but probably not
        // for anything that harmful (a workaround to this would be to calculate it from replays
        // exclusively?)
        apm.set(id, result.apm)
      }
    }
  }

  const playerRaces = new Map<number, AssignedRaceChar>()
  for (const [playerId, playerResults] of combined) {
    const raceSet = new Set(playerResults.map(r => r.race))
    if (raceSet.size > 1) {
      disputed = true
    }
    playerRaces.set(playerId, playerResults[0].race)
  }

  const reconciled = new Map<number, ReconciledPlayerResult>()

  for (const [playerId, playerResults] of combined.entries()) {
    let victories = 0
    let defeats = 0
    for (const r of playerResults) {
      if (r.result === GameClientResult.Victory) {
        victories += 1
      } else if (r.result === GameClientResult.Defeat) {
        defeats += 1
      }
    }

    let result: ReconciledResult = 'unknown'
    if (victories > 0 && defeats > 0) {
      disputed = true
      if (victories > defeats) {
        result = 'win'
      } else if (victories < defeats) {
        result = 'loss'
      } else {
        result = 'unknown'
      }
    } else if (victories > 0) {
      result = 'win'
    } else if (defeats > 0) {
      result = 'loss'
    } else {
      disputed = true
      result = 'unknown'
    }

    reconciled.set(playerId, {
      result,
      race: playerRaces.get(playerId)!,
      apm: apm.get(playerId) ?? 0,
    })
  }

  // TODO(tec27): Check that the results are valid for the game configuration (e.g. only 1 victor
  // for an FFA)

  if (Array.from(reconciled.values()).some(r => r.result === 'unknown')) {
    // If any of the player results are unknown, we set all of them to unknown. (This prevents
    // people from getting credit for games where they submit false results that dispute their
    // opponents' results)
    for (const value of reconciled.values()) {
      value.result = 'unknown'
    }
  }

  return { disputed, time: elapsedTime, results: reconciled }
}
