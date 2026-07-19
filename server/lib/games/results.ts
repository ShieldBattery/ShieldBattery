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
 * @param users the user IDs of every (human) player in the game
 * @param results an array of results submitted from each player. For players that have not
 *   submitted a result yet, a null will be present in this array.
 * @param teams the players grouped into teams, used to validate that no more than one team ends up
 *   with a winning player (a game whose structure allows only a single winner). Pass `null` to skip
 *   this validation (e.g. for game types with arbitrary victory conditions, like UMS). For a free-
 *   for-all with no fixed teams, pass each player as their own single-member team.
 */
export function reconcileResults(
  users: ReadonlyArray<SbUserId>,
  results: ReadonlyArray<ResultSubmission | null>,
  teams: ReadonlyArray<ReadonlyArray<SbUserId>> | null,
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

    let result: ReconciledResult
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

  if (teams) {
    // Only a single team is allowed to win. If a winning player shows up on more than one team, the
    // reported results are contradictory (e.g. both players in a 1v1 claiming victory), so we treat
    // the game as disputed and don't credit anyone.
    const winningTeams = teams.filter(team =>
      team.some(id => reconciled.get(id)?.result === 'win'),
    ).length
    if (winningTeams > 1) {
      disputed = true
      for (const value of reconciled.values()) {
        value.result = 'unknown'
      }
    }
  }

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

/**
 * The relay-observed desync information needed to decide how a game's results should be reconciled.
 * A superset (like `GameDesyncEvent`) is structurally assignable.
 */
export interface DesyncPolicyEvent {
  noMajority: boolean
  divergedUserIds: ReadonlyArray<SbUserId>
}

/** Describes how the desync policy resolved a game, for audit logging. */
export type DesyncOutcome =
  | { kind: 'no-events' }
  | { kind: 'lobby-disputed'; eventCount: number }
  | {
      kind: 'void'
      reason: 'no-majority' | 'diverged-covers-all' | 'zero-reports' | 'diverged-unresolvable'
    }
  | { kind: 'majority-discard'; divergedUserIds: SbUserId[] }

export interface DesyncPolicyDecision {
  reconciled: ReconciledResults
  outcome: DesyncOutcome
}

/**
 * Produces a fully-voided reconciliation (every player 'unknown', disputed) so a game that a relay
 * flagged as undecidable never credits anyone. Reports (if any) are only used to recover a sensible
 * elapsed time and per-player races/apm; the outcomes are all forced to 'unknown'.
 */
function voidReconciledResults(
  humans: ReadonlyArray<SbUserId>,
  results: ReadonlyArray<ResultSubmission | null>,
  teams: ReadonlyArray<ReadonlyArray<SbUserId>> | null,
): ReconciledResults {
  if (!results.some(r => !!r)) {
    return {
      disputed: true,
      time: 0,
      results: new Map(humans.map(id => [id, { result: 'unknown', race: 'p', apm: 0 }])),
    }
  }

  const base = reconcileResults(humans, results, teams)
  for (const value of base.results.values()) {
    value.result = 'unknown'
  }
  return { ...base, disputed: true, results: base.results }
}

/**
 * Applies the relay desync policy around `reconcileResults`. Given the raw reports and the desync
 * events a game accumulated, decides whether to reconcile normally, force a dispute (lobby), void
 * the game entirely, or reconcile from the majority's reports after discarding a diverged minority's
 * reports.
 *
 * Security / trust model: `desyncEvents` originate from the rally-point2 relay's Ed25519-signed
 * webhook, so a game client cannot inject, forge, or suppress them — a client only controls whether
 * ITS OWN slot's simulation diverges from the majority, never whether an event exists or which user
 * IDs it names. Even so, this function treats `divergedUserIds` as untrusted-SHAPED input (the
 * coordinator resolves it from a session-create ref that could be stale, missing, or — under a
 * defense-in-depth assumption — subtly wrong): every ID is intersected against `humans` before use,
 * so an ID that isn't actually a player of this game is dropped rather than trusted or indexed
 * against. This function is total over its inputs — empty/all-null `results`, empty `humans`,
 * duplicated or out-of-game `divergedUserIds`, etc. all resolve to a well-formed (typically voided)
 * outcome rather than throwing, since this runs fire-and-forget and a throw here would only be lost
 * noise while leaving the game stuck unreconciled.
 *
 * The worst a malicious/compromised client can do through this path is cause its own game to be
 * disputed or voided (no stats/MMR for anyone) — never crash the server, corrupt another player's
 * result, or force a false win/loss onto someone else. A single client desyncing alone in a game of
 * more than two humans is, by construction, the minority: its own reports are discarded and the
 * majority's reports decide the outcome (including its own), which pins the fault on the
 * misbehaving party instead of voiding. A 1v1 (or any even split with no strict majority) has no way
 * to tell which side is telling the truth, so it always voids — that's an unavoidable limit of
 * majority-authoritative resolution, not a gap in this policy.
 *
 * @param isMatchmaking whether the game is a matchmaking game (matchmaking gets the void /
 *   majority-authoritative handling; other sources are only forced to disputed)
 * @param humans every human player's user ID
 * @param results the reports submitted so far (one entry per human, nulls for missing reports)
 * @param validationTeams the single-winner validation teams (see `getValidationTeams`)
 * @param desyncEvents the desync events recorded for the game
 */
export function applyDesyncPolicy({
  isMatchmaking,
  humans,
  results,
  validationTeams,
  desyncEvents,
}: {
  isMatchmaking: boolean
  humans: ReadonlyArray<SbUserId>
  results: ReadonlyArray<ResultSubmission | null>
  validationTeams: ReadonlyArray<ReadonlyArray<SbUserId>> | null
  desyncEvents: ReadonlyArray<DesyncPolicyEvent>
}): DesyncPolicyDecision {
  // Defense in depth: a report's `reporter` should always be one of `humans` (it's derived from the
  // games_users row it was stored under), but `reconcileResults` throws on a reporter it doesn't
  // recognize. Sanitizing here means this function can never propagate that throw, no matter how the
  // inputs are assembled upstream.
  const humanSet = new Set(humans)
  const safeResults = results.map(r => (r && humanSet.has(r.reporter) ? r : null))
  // `reconcileResults` also indexes into its sorted-reports array, which is only safe when at least
  // one report is present; route a fully degenerate (all-null) input through the same synthesized
  // void path used elsewhere instead of calling it directly.
  const hasAnyReport = safeResults.some(r => !!r)

  if (desyncEvents.length === 0) {
    return {
      reconciled: hasAnyReport
        ? reconcileResults(humans, safeResults, validationTeams)
        : voidReconciledResults(humans, safeResults, validationTeams),
      outcome: { kind: 'no-events' },
    }
  }

  if (!isMatchmaking) {
    // A desync in a non-matchmaking game leaves the computed results standing but forces a dispute
    // (which blocks stats), since we can't trust that everyone simulated the same game.
    const reconciled = hasAnyReport
      ? reconcileResults(humans, safeResults, validationTeams)
      : voidReconciledResults(humans, safeResults, validationTeams)
    return {
      reconciled: { ...reconciled, disputed: true },
      outcome: { kind: 'lobby-disputed', eventCount: desyncEvents.length },
    }
  }

  if (desyncEvents.some(e => e.noMajority)) {
    // No trustworthy majority existed for at least one divergence, so the game is undecidable.
    return {
      reconciled: voidReconciledResults(humans, safeResults, validationTeams),
      outcome: { kind: 'void', reason: 'no-majority' },
    }
  }

  // Every event here claims a resolvable diverged minority (`noMajority` is false). Intersect each
  // event's diverged IDs against the actual humans in this game before trusting them at all: an ID
  // that doesn't belong to this game is dropped, never used to index or discard a report.
  const divergedUnion = new Set<SbUserId>()
  for (const event of desyncEvents) {
    for (const id of event.divergedUserIds) {
      if (humanSet.has(id)) {
        divergedUnion.add(id)
      }
    }
  }

  if (divergedUnion.size === 0) {
    // A signed event claimed a resolvable minority but, after dropping IDs that don't belong to
    // this game, named nobody we recognize. That's undecidable, not clean — void rather than
    // silently falling through to a normal reconcile with nothing discarded.
    return {
      reconciled: voidReconciledResults(humans, safeResults, validationTeams),
      outcome: { kind: 'void', reason: 'diverged-unresolvable' },
    }
  }

  if (humans.every(id => divergedUnion.has(id))) {
    return {
      reconciled: voidReconciledResults(humans, safeResults, validationTeams),
      outcome: { kind: 'void', reason: 'diverged-covers-all' },
    }
  }

  // Discard the diverged minority's own reports; the majority's reports remain authoritative for
  // everyone (including the diverged players) — a diverged player's own report (even a fabricated
  // self-victory) cannot leak into the outcome, since it's nulled out before reconciling.
  const filtered = safeResults.map(r => (r && divergedUnion.has(r.reporter) ? null : r))
  if (!filtered.some(r => !!r)) {
    return {
      reconciled: voidReconciledResults(humans, safeResults, validationTeams),
      outcome: { kind: 'void', reason: 'zero-reports' },
    }
  }

  return {
    reconciled: reconcileResults(humans, filtered, validationTeams),
    outcome: { kind: 'majority-discard', divergedUserIds: Array.from(divergedUnion) },
  }
}

export interface DepartureConcessionDecision {
  reconciled: ReconciledResults
  applied: boolean
  winner?: SbUserId
  loser?: SbUserId
}

/**
 * Whether `report` is a genuine terminal self-victory claim by `reporter` over `nonReporter`: the
 * reporter's own entry says `Victory`, and the non-reporter's entry (if the report has one at all)
 * doesn't also say `Victory`. This is what the departure concession tiebreak requires as its win
 * basis — a report that's still `Playing`, claims the reporter lost, or claims a mutual victory
 * can't be trusted just because it's the only one that showed up.
 */
function isTerminalSelfVictoryReport(
  report: ResultSubmission,
  reporter: SbUserId,
  nonReporter: SbUserId,
): boolean {
  const reporterEntry = report.playerResults.find(([id]) => id === reporter)
  if (!reporterEntry || reporterEntry[1].result !== GameClientResult.Victory) {
    return false
  }

  const nonReporterEntry = report.playerResults.find(([id]) => id === nonReporter)
  if (nonReporterEntry && nonReporterEntry[1].result === GameClientResult.Victory) {
    return false
  }

  return true
}

/**
 * For a two-human, no-computer game with no relay desync events, whose reconciled outcome is
 * disputed or entirely unknown, resolves the outcome as a concession when exactly one of the two
 * players never submitted a result, that non-reporting player has a recorded mid-game departure
 * (`left` or `dropped` count identically) — i.e. they abandoned the game without ever reporting
 * anything — AND the sole reporter's own raw report is a genuine terminal self-victory over the
 * non-reporter (see `isTerminalSelfVictoryReport`). The sole reporter takes the win, the abandoning
 * non-reporter takes the loss, and the dispute clears (so MMR can apply for matchmaking).
 *
 * The terminal-self-victory check matters because the submit endpoint accepts non-terminal reports
 * (e.g. still `Playing`): without it, a sole reporter who submitted garbage, a self-defeat, or a
 * mutual-victory claim would still hand themselves a win and the abandoning opponent a ranked loss.
 *
 * This deliberately does NOT engage when both players reported, even if their reports conflict (e.g.
 * a mutual claimed victory) — that combination must stay disputed/void. Departure order/time is
 * client-controllable: a losing player can report a false victory (producing a two-sided conflict)
 * and then simply linger on the connection to become the "later" departer. A rule that let departure
 * order arbitrate a two-sided dispute would let that lingering flip the honest winner into a loss.
 * Restricting this to a genuine one-sided abandonment — where the non-reporter's client never
 * produced a report to contest with — closes that hole: the non-reporter's departure record only
 * ever corroborates that they left, never who won.
 *
 * @returns the (possibly modified) reconciliation plus whether the concession was applied
 */
export function applyDepartureConcessionTiebreak({
  reconciled,
  humans,
  hasComputers,
  hasDesyncEvents,
  reportedHumans,
  results,
  departureTimes,
}: {
  reconciled: ReconciledResults
  humans: ReadonlyArray<SbUserId>
  hasComputers: boolean
  hasDesyncEvents: boolean
  /** The user IDs of the humans who submitted a result report (regardless of what it said). */
  reportedHumans: ReadonlySet<SbUserId>
  /** The raw reports submitted so far, used to find the sole reporter's actual claim. */
  results: ReadonlyArray<ResultSubmission | null>
  departureTimes: ReadonlyMap<SbUserId, Date | null>
}): DepartureConcessionDecision {
  if (hasDesyncEvents || hasComputers || humans.length !== 2) {
    return { reconciled, applied: false }
  }

  const allUnknown = Array.from(reconciled.results.values()).every(r => r.result === 'unknown')
  if (!reconciled.disputed && !allUnknown) {
    return { reconciled, applied: false }
  }

  const [a, b] = humans
  const aReported = reportedHumans.has(a)
  const bReported = reportedHumans.has(b)
  if (aReported === bReported) {
    // Both reported (a two-sided conflict — must stay disputed/void) or neither reported (nothing
    // to trust as a win basis either way).
    return { reconciled, applied: false }
  }

  const [reporter, nonReporter] = aReported ? [a, b] : [b, a]
  if (!departureTimes.get(nonReporter)) {
    // No corroborating departure for the non-reporter: they may just be slow, not abandoned.
    return { reconciled, applied: false }
  }

  const report = results.find((r): r is ResultSubmission => !!r && r.reporter === reporter)
  if (!report || !isTerminalSelfVictoryReport(report, reporter, nonReporter)) {
    // The sole report isn't a clean terminal self-victory (still in progress, a self-reported
    // defeat, a mutual-victory claim, or missing entirely) — nothing trustworthy to concede to.
    return { reconciled, applied: false }
  }

  const reporterResult = reconciled.results.get(reporter)
  const nonReporterResult = reconciled.results.get(nonReporter)
  if (!reporterResult || !nonReporterResult) {
    return { reconciled, applied: false }
  }

  const newResults = new Map(reconciled.results)
  newResults.set(reporter, { ...reporterResult, result: 'win' })
  newResults.set(nonReporter, { ...nonReporterResult, result: 'loss' })

  return {
    reconciled: { ...reconciled, disputed: false, results: newResults },
    applied: true,
    winner: reporter,
    loser: nonReporter,
  }
}
