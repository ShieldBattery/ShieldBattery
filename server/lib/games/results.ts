import {
  GameClientPlayerResult,
  GameClientResult,
  ReconciledPlayerResult,
  ReconciledResult,
  ReconciledResults,
} from '../../../common/games/results'
import { AssignedRaceChar } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user-id'
import logger from '../logging/logger'

export interface ResultSubmission {
  /** The user ID of the player who reported these results. */
  reporter: SbUserId
  /** The elapsed time of the game, in milliseconds. */
  time: number
  /** A tuple of (user id, result info). */
  playerResults: Array<[SbUserId, GameClientPlayerResult]>
}

/**
 * Returns whether the given result is "terminal" (that is, won't change again in future
 * non-malicious reports).
 *
 * @param resultCode the reported result for the client
 * @param disconnectIsLoss whether or not disconnects count as a loss (and are therefor terminal).
 *     This handles older client reports where a dropped player that was not allied with a victor
 *     would not be marked as losing, and just be disconnected instead. This should generally be
 *     true if the result report contains any victories.
 */
function isTerminal(resultCode: GameClientResult, disconnectIsLoss = false) {
  return (
    resultCode === GameClientResult.Victory ||
    resultCode === GameClientResult.Defeat ||
    (disconnectIsLoss && resultCode === GameClientResult.Disconnected)
  )
}

/**
 * Counts the total number of terminal results in a given report.
 *
 * @param resultMap an array of [SbUserId, GameClientPlayerResult] entries, one for each player in
 *     the game
 */
function countTerminalStates(resultMap: ReadonlyArray<[SbUserId, GameClientPlayerResult]>) {
  const disconnectIsLoss = resultMap.some(([_, r]) => r.result === GameClientResult.Victory)
  return resultMap.reduce(
    (sum, [, curResult]) => (isTerminal(curResult.result, disconnectIsLoss) ? sum + 1 : sum),
    0,
  )
}

/**
 * Returns the final game results given the per-player results that were reported for a game.
 *
 * @param results an array of results submitted from each player. For players that have not
 *   submitted a result yet, a null will be present in this array.
 */
export function reconcileResults(
  users: ReadonlyArray<SbUserId>,
  results: ReadonlyArray<ResultSubmission | null>,
): ReconciledResults {
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

  const combined = new Map<SbUserId, GameClientPlayerResult[]>(users.map(u => [u, []]))
  const apm = new Map<SbUserId, number | undefined>(users.map(u => [u, undefined]))
  for (const { reporter, playerResults } of sortedResults) {
    if (!combined.has(reporter)) {
      throw new Error(`Found results for ${reporter} that was not in the game`)
    }

    const disconnectIsLoss = playerResults.some(([_, r]) => r.result === GameClientResult.Victory)

    for (const [id, r] of playerResults) {
      if (!combined.has(id)) {
        logger.warn(`Received result from player ${reporter} for ${id} that was not in the game`)
        continue
      }

      // Handle legacy client reports that don't properly force disconnect clients to a defeat when
      // the game's victors are known
      let result = r
      if (disconnectIsLoss && r.result === GameClientResult.Disconnected) {
        result = {
          ...r,
          result: GameClientResult.Defeat,
        }
      }

      combined.get(id)!.push(result)

      if (reporter === id) {
        // Trust each player about their own APM only. This is a tad exploitable but probably not
        // for anything that harmful (a workaround to this would be to calculate it from replays
        // exclusively?)
        apm.set(id, result.apm)
      }
      if (apm.get(id) === undefined) {
        // Store the first reported APM for a user just in case we don't get a report from them
        apm.set(id, result.apm)
      }
    }
  }

  const playerRaces = new Map<SbUserId, AssignedRaceChar>()
  for (const [playerId, playerResults] of combined) {
    const raceSet = new Set(playerResults.map(r => r.race))
    if (raceSet.size !== 1) {
      disputed = true
    }
    if (playerResults.length > 0) {
      playerRaces.set(playerId, playerResults[0].race)
    }
  }

  const reconciled = new Map<SbUserId, ReconciledPlayerResult>()

  let winningPlayers = 0
  let losingPlayers = 0

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
        winningPlayers += 1
        result = 'win'
      } else if (victories < defeats) {
        losingPlayers += 1
        result = 'loss'
      } else {
        result = 'unknown'
      }
    } else if (victories > 0) {
      winningPlayers += 1
      result = 'win'
    } else if (defeats > 0) {
      losingPlayers += 1
      result = 'loss'
    } else {
      disputed = true
      result = 'unknown'
    }

    reconciled.set(playerId, {
      result,
      // This default is ehhh but if this happens this game will definitely not be reconciled for
      // a result because it had blank results for at least one player. We could make race optional
      // but this bug only happened for a few games and we'd have to maintain that annoyance in
      // perpetuity
      race: playerRaces.get(playerId) ?? 'p',
      apm: apm.get(playerId) ?? 0,
    })
  }

  if (losingPlayers && !winningPlayers) {
    // If there are losing players but no winning players, we mark everything unknown to avoid bugs
    // where everybody in a game loses
    for (const key of reconciled.keys()) {
      reconciled.get(key)!.result = 'unknown'
      disputed = true
    }
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
