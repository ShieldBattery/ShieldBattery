import { describe, expect, test } from 'vitest'
import {
  GameClientPlayerResult,
  GameClientResult,
  ReconciledPlayerResult,
  ReconciledResults,
} from '../../../common/games/results'
import { AssignedRaceChar } from '../../../common/races'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import {
  applyDepartureConcessionTiebreak,
  applyDesyncPolicy,
  DesyncPolicyEvent,
  ResultSubmission,
} from './results'

function makePlayerResult(
  userId: number,
  result: GameClientResult,
  race: AssignedRaceChar,
  apm: number,
): [SbUserId, GameClientPlayerResult] {
  return [makeSbUserId(userId), { result, race, apm }]
}

function users(ids: ReadonlyArray<number>): SbUserId[] {
  return ids.map(makeSbUserId)
}

function resultsToObj(reconciled: ReconciledResults) {
  return Object.fromEntries(reconciled.results.entries())
}

const divergedEvent = (ids: ReadonlyArray<number>): DesyncPolicyEvent => ({
  noMajority: false,
  divergedUserIds: users(ids),
})
const noMajorityEvent: DesyncPolicyEvent = { noMajority: true, divergedUserIds: [] }

describe('games/results/applyDesyncPolicy', () => {
  test('no events reconciles a 1v1 exactly as normal', () => {
    const results: Array<ResultSubmission | null> = [
      {
        reporter: makeSbUserId(1),
        time: 33,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 25),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
        ],
      },
      {
        reporter: makeSbUserId(2),
        time: 34,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 25),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
        ],
      },
    ]

    const { reconciled, outcome } = applyDesyncPolicy({
      isMatchmaking: true,
      humans: users([1, 2]),
      results,
      validationTeams: [users([1]), users([2])],
      desyncEvents: [],
    })

    expect(outcome).toEqual({ kind: 'no-events' })
    expect(reconciled.disputed).toBe(false)
    expect(resultsToObj(reconciled)).toEqual({
      1: { result: 'win', race: 't', apm: 25 },
      2: { result: 'loss', race: 'z', apm: 30 },
    })
  })

  test('non-matchmaking game with an event forces a dispute but keeps computed results', () => {
    const results: Array<ResultSubmission | null> = [
      {
        reporter: makeSbUserId(1),
        time: 33,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 25),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
        ],
      },
      {
        reporter: makeSbUserId(2),
        time: 34,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 25),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
        ],
      },
    ]

    const { reconciled, outcome } = applyDesyncPolicy({
      isMatchmaking: false,
      humans: users([1, 2]),
      results,
      validationTeams: null,
      desyncEvents: [divergedEvent([1])],
    })

    expect(outcome).toEqual({ kind: 'lobby-disputed', eventCount: 1 })
    expect(reconciled.disputed).toBe(true)
    // Results stand as computed even though the game is disputed.
    expect(resultsToObj(reconciled)).toEqual({
      1: { result: 'win', race: 't', apm: 25 },
      2: { result: 'loss', race: 'z', apm: 30 },
    })
  })

  test('matchmaking game with a no-majority event voids to all-unknown + disputed', () => {
    const results: Array<ResultSubmission | null> = [
      {
        reporter: makeSbUserId(1),
        time: 33,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 25),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
        ],
      },
      {
        reporter: makeSbUserId(2),
        time: 34,
        playerResults: [
          makePlayerResult(1, GameClientResult.Defeat, 't', 25),
          makePlayerResult(2, GameClientResult.Victory, 'z', 30),
        ],
      },
    ]

    const { reconciled, outcome } = applyDesyncPolicy({
      isMatchmaking: true,
      humans: users([1, 2]),
      results,
      validationTeams: [users([1]), users([2])],
      desyncEvents: [noMajorityEvent],
    })

    expect(outcome).toEqual({ kind: 'void', reason: 'no-majority' })
    expect(reconciled.disputed).toBe(true)
    expect(Array.from(reconciled.results.values()).every(r => r.result === 'unknown')).toBe(true)
  })

  test('matchmaking 2v2 discards a diverged player report and lets the majority decide', () => {
    // Teams: (1, 2) vs (3, 4). Player 3 is diverged and lies about the outcome; the majority
    // (1, 2, 4) all agree that team (1, 2) won.
    const majorityReport = (reporter: number): ResultSubmission => ({
      reporter: makeSbUserId(reporter),
      time: 60,
      playerResults: [
        makePlayerResult(1, GameClientResult.Victory, 't', 100),
        makePlayerResult(2, GameClientResult.Victory, 'z', 100),
        makePlayerResult(3, GameClientResult.Defeat, 'p', 100),
        makePlayerResult(4, GameClientResult.Defeat, 'p', 100),
      ],
    })
    const results: Array<ResultSubmission | null> = [
      majorityReport(1),
      majorityReport(2),
      {
        reporter: makeSbUserId(3),
        time: 61,
        playerResults: [
          makePlayerResult(1, GameClientResult.Defeat, 't', 100),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 100),
          makePlayerResult(3, GameClientResult.Victory, 'p', 100),
          makePlayerResult(4, GameClientResult.Victory, 'p', 100),
        ],
      },
      majorityReport(4),
    ]

    const { reconciled, outcome } = applyDesyncPolicy({
      isMatchmaking: true,
      humans: users([1, 2, 3, 4]),
      results,
      validationTeams: [users([1, 2]), users([3, 4])],
      desyncEvents: [divergedEvent([3])],
    })

    expect(outcome).toEqual({ kind: 'majority-discard', divergedUserIds: users([3]) })
    expect(reconciled.disputed).toBe(false)
    expect(resultsToObj(reconciled)).toEqual({
      1: { result: 'win', race: 't', apm: 100 },
      2: { result: 'win', race: 'z', apm: 100 },
      3: { result: 'loss', race: 'p', apm: 100 },
      4: { result: 'loss', race: 'p', apm: 100 },
    })
  })

  test('matchmaking void when the diverged union covers every human', () => {
    const results: Array<ResultSubmission | null> = [
      {
        reporter: makeSbUserId(1),
        time: 33,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 25),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
        ],
      },
      {
        reporter: makeSbUserId(2),
        time: 34,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 25),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
        ],
      },
    ]

    const { reconciled, outcome } = applyDesyncPolicy({
      isMatchmaking: true,
      humans: users([1, 2]),
      results,
      validationTeams: [users([1]), users([2])],
      desyncEvents: [divergedEvent([1]), divergedEvent([2])],
    })

    expect(outcome).toEqual({ kind: 'void', reason: 'diverged-covers-all' })
    expect(reconciled.disputed).toBe(true)
    expect(Array.from(reconciled.results.values()).every(r => r.result === 'unknown')).toBe(true)
  })

  test('matchmaking void when discarding leaves zero reports', () => {
    // Only the diverged player reported; discarding their report leaves nothing to reconcile.
    const results: Array<ResultSubmission | null> = [
      {
        reporter: makeSbUserId(1),
        time: 33,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 25),
          makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
        ],
      },
      null,
    ]

    const { reconciled, outcome } = applyDesyncPolicy({
      isMatchmaking: true,
      humans: users([1, 2]),
      results,
      validationTeams: [users([1]), users([2])],
      desyncEvents: [divergedEvent([1])],
    })

    expect(outcome).toEqual({ kind: 'void', reason: 'zero-reports' })
    expect(reconciled.disputed).toBe(true)
    expect(Array.from(reconciled.results.values()).every(r => r.result === 'unknown')).toBe(true)
    // Both humans are still represented in the voided result.
    expect(new Set(reconciled.results.keys())).toEqual(new Set(users([1, 2])))
  })

  test('matchmaking majority-discard falls back to all-unknown when the majority leaves a hole', () => {
    // Teams (1, 2) vs (3, 4). Player 2 is diverged; only player 1 reported, and their report only
    // covers players 1 and 3, so players 2 and 4 have no result and the all-unknown pass voids.
    const results: Array<ResultSubmission | null> = [
      {
        reporter: makeSbUserId(1),
        time: 60,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 100),
          makePlayerResult(3, GameClientResult.Defeat, 'p', 100),
        ],
      },
      null,
      null,
      null,
    ]

    const { reconciled, outcome } = applyDesyncPolicy({
      isMatchmaking: true,
      humans: users([1, 2, 3, 4]),
      results,
      validationTeams: [users([1, 2]), users([3, 4])],
      desyncEvents: [divergedEvent([2])],
    })

    expect(outcome).toEqual({ kind: 'majority-discard', divergedUserIds: users([2]) })
    expect(Array.from(reconciled.results.values()).every(r => r.result === 'unknown')).toBe(true)
  })

  describe('adversarial / untrusted-shaped input', () => {
    test('ignores a diverged id that is not a human player of this game', () => {
      // Id 99 isn't in `humans` at all (e.g. a stale/mismatched coordinator ref). It must be dropped
      // rather than trusted or indexed against, and player 3's report should decide the outcome since
      // 3 is the only real diverged id... but here only the bogus id is named, so nothing valid
      // diverges: this degrades to the "diverged names nobody valid" void case, not a normal
      // reconcile.
      const results: Array<ResultSubmission | null> = [
        {
          reporter: makeSbUserId(1),
          time: 33,
          playerResults: [
            makePlayerResult(1, GameClientResult.Victory, 't', 25),
            makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
          ],
        },
        null,
      ]

      const { reconciled, outcome } = applyDesyncPolicy({
        isMatchmaking: true,
        humans: users([1, 2]),
        results,
        validationTeams: [users([1]), users([2])],
        desyncEvents: [divergedEvent([99])],
      })

      expect(outcome).toEqual({ kind: 'void', reason: 'diverged-unresolvable' })
      expect(reconciled.disputed).toBe(true)
      expect(Array.from(reconciled.results.values()).every(r => r.result === 'unknown')).toBe(true)
    })

    test('a valid diverged id alongside a bogus one is still honored (bogus id merely dropped)', () => {
      const majorityReport = (reporter: number): ResultSubmission => ({
        reporter: makeSbUserId(reporter),
        time: 60,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 100),
          makePlayerResult(2, GameClientResult.Victory, 'z', 100),
          makePlayerResult(3, GameClientResult.Defeat, 'p', 100),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 100),
        ],
      })
      const results: Array<ResultSubmission | null> = [
        majorityReport(1),
        majorityReport(2),
        {
          reporter: makeSbUserId(3),
          time: 61,
          playerResults: [
            makePlayerResult(1, GameClientResult.Defeat, 't', 100),
            makePlayerResult(2, GameClientResult.Defeat, 'z', 100),
            makePlayerResult(3, GameClientResult.Victory, 'p', 100),
            makePlayerResult(4, GameClientResult.Victory, 'p', 100),
          ],
        },
        majorityReport(4),
      ]

      // 99 doesn't belong to this game; it's dropped, leaving only the valid diverged id (3).
      const { reconciled, outcome } = applyDesyncPolicy({
        isMatchmaking: true,
        humans: users([1, 2, 3, 4]),
        results,
        validationTeams: [users([1, 2]), users([3, 4])],
        desyncEvents: [divergedEvent([3, 99])],
      })

      expect(outcome).toEqual({ kind: 'majority-discard', divergedUserIds: users([3]) })
      expect(resultsToObj(reconciled)).toEqual({
        1: { result: 'win', race: 't', apm: 100 },
        2: { result: 'win', race: 'z', apm: 100 },
        3: { result: 'loss', race: 'p', apm: 100 },
        4: { result: 'loss', race: 'p', apm: 100 },
      })
    })

    test('duplicated diverged ids (repeated across events, or within one event) are deduped', () => {
      const majorityReport = (reporter: number): ResultSubmission => ({
        reporter: makeSbUserId(reporter),
        time: 60,
        playerResults: [
          makePlayerResult(1, GameClientResult.Victory, 't', 100),
          makePlayerResult(2, GameClientResult.Victory, 'z', 100),
          makePlayerResult(3, GameClientResult.Defeat, 'p', 100),
          makePlayerResult(4, GameClientResult.Defeat, 'p', 100),
        ],
      })
      const results: Array<ResultSubmission | null> = [
        majorityReport(1),
        majorityReport(2),
        {
          reporter: makeSbUserId(3),
          time: 61,
          playerResults: [
            makePlayerResult(1, GameClientResult.Defeat, 't', 100),
            makePlayerResult(2, GameClientResult.Defeat, 'z', 100),
            makePlayerResult(3, GameClientResult.Victory, 'p', 100),
            makePlayerResult(4, GameClientResult.Victory, 'p', 100),
          ],
        },
        majorityReport(4),
      ]

      const { reconciled, outcome } = applyDesyncPolicy({
        isMatchmaking: true,
        humans: users([1, 2, 3, 4]),
        results,
        validationTeams: [users([1, 2]), users([3, 4])],
        // Same id repeated within one event's array, plus a second event repeating it again.
        desyncEvents: [divergedEvent([3, 3]), divergedEvent([3])],
      })

      expect(outcome).toEqual({ kind: 'majority-discard', divergedUserIds: users([3]) })
      expect(reconciled.disputed).toBe(false)
      expect(resultsToObj(reconciled)).toEqual({
        1: { result: 'win', race: 't', apm: 100 },
        2: { result: 'win', race: 'z', apm: 100 },
        3: { result: 'loss', race: 'p', apm: 100 },
        4: { result: 'loss', race: 'p', apm: 100 },
      })
    })

    test('a diverged player reporting a self-victory in a 2v2 cannot leak through: majority decides', () => {
      // Player 3 is diverged (compromised or buggy client) and reports themselves + their ally as
      // victors, contradicting the majority. Their report must be discarded outright, not merely
      // outvoted, so it can never influence anyone's result (including their own).
      const results: Array<ResultSubmission | null> = [
        {
          reporter: makeSbUserId(1),
          time: 60,
          playerResults: [
            makePlayerResult(1, GameClientResult.Victory, 't', 100),
            makePlayerResult(2, GameClientResult.Victory, 'z', 100),
            makePlayerResult(3, GameClientResult.Defeat, 'p', 100),
            makePlayerResult(4, GameClientResult.Defeat, 'p', 100),
          ],
        },
        {
          reporter: makeSbUserId(2),
          time: 60,
          playerResults: [
            makePlayerResult(1, GameClientResult.Victory, 't', 100),
            makePlayerResult(2, GameClientResult.Victory, 'z', 100),
            makePlayerResult(3, GameClientResult.Defeat, 'p', 100),
            makePlayerResult(4, GameClientResult.Defeat, 'p', 100),
          ],
        },
        {
          // Malicious/compromised report: claims the diverged team won.
          reporter: makeSbUserId(3),
          time: 61,
          playerResults: [
            makePlayerResult(1, GameClientResult.Defeat, 't', 100),
            makePlayerResult(2, GameClientResult.Defeat, 'z', 100),
            makePlayerResult(3, GameClientResult.Victory, 'p', 100),
            makePlayerResult(4, GameClientResult.Victory, 'p', 100),
          ],
        },
        null,
      ]

      const { reconciled, outcome } = applyDesyncPolicy({
        isMatchmaking: true,
        humans: users([1, 2, 3, 4]),
        results,
        validationTeams: [users([1, 2]), users([3, 4])],
        desyncEvents: [divergedEvent([3])],
      })

      expect(outcome).toEqual({ kind: 'majority-discard', divergedUserIds: users([3]) })
      expect(reconciled.disputed).toBe(false)
      // The majority's verdict stands for everyone, including the diverged player, and there is no
      // sign of the self-reported victory anywhere in the outcome.
      expect(resultsToObj(reconciled)).toEqual({
        1: { result: 'win', race: 't', apm: 100 },
        2: { result: 'win', race: 'z', apm: 100 },
        3: { result: 'loss', race: 'p', apm: 100 },
        4: { result: 'loss', race: 'p', apm: 100 },
      })
    })

    test('malicious self-desync in a 1v1 voids for both sides (no MMR to either)', () => {
      // A 1v1 has no strict majority (2 slots, 1 vs 1), so any desync there is unavoidably
      // `noMajority`. Even a player deliberately desyncing their own client to try to dodge a loss
      // gains nothing but a void — not a win, not a clean loss for the opponent either.
      const results: Array<ResultSubmission | null> = [
        {
          reporter: makeSbUserId(1),
          time: 33,
          playerResults: [
            makePlayerResult(1, GameClientResult.Victory, 't', 25),
            makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
          ],
        },
        {
          reporter: makeSbUserId(2),
          time: 34,
          playerResults: [
            makePlayerResult(1, GameClientResult.Victory, 't', 25),
            makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
          ],
        },
      ]

      const { reconciled, outcome } = applyDesyncPolicy({
        isMatchmaking: true,
        humans: users([1, 2]),
        results,
        validationTeams: [users([1]), users([2])],
        desyncEvents: [{ noMajority: true, divergedUserIds: [] }],
      })

      expect(outcome).toEqual({ kind: 'void', reason: 'no-majority' })
      expect(reconciled.disputed).toBe(true)
      expect(Array.from(reconciled.results.values()).every(r => r.result === 'unknown')).toBe(true)
    })

    test('is total over fully degenerate input: no humans, no results, desync events present', () => {
      expect(() =>
        applyDesyncPolicy({
          isMatchmaking: true,
          humans: [],
          results: [],
          validationTeams: null,
          desyncEvents: [divergedEvent([1, 2, 3])],
        }),
      ).not.toThrow()
    })

    test('is total when every result is null and there are no desync events', () => {
      expect(() =>
        applyDesyncPolicy({
          isMatchmaking: true,
          humans: users([1, 2]),
          results: [null, null],
          validationTeams: [users([1]), users([2])],
          desyncEvents: [],
        }),
      ).not.toThrow()
    })

    test('a report from a reporter outside the human list is sanitized away rather than throwing', () => {
      const results: Array<ResultSubmission | null> = [
        {
          reporter: makeSbUserId(1),
          time: 33,
          playerResults: [
            makePlayerResult(1, GameClientResult.Victory, 't', 25),
            makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
          ],
        },
        {
          // Not a member of `humans` — should never reach `reconcileResults`.
          reporter: makeSbUserId(999),
          time: 34,
          playerResults: [
            makePlayerResult(1, GameClientResult.Victory, 't', 25),
            makePlayerResult(2, GameClientResult.Defeat, 'z', 30),
          ],
        },
      ]

      expect(() =>
        applyDesyncPolicy({
          isMatchmaking: true,
          humans: users([1, 2]),
          results,
          validationTeams: [users([1]), users([2])],
          desyncEvents: [],
        }),
      ).not.toThrow()
    })
  })
})

function reconciled(
  entries: Array<[number, ReconciledPlayerResult]>,
  disputed: boolean,
): ReconciledResults {
  return {
    disputed,
    time: 100,
    results: new Map(entries.map(([id, r]) => [makeSbUserId(id), r])),
  }
}

const unknown: ReconciledPlayerResult = { result: 'unknown', race: 'p', apm: 10 }

function departures(entries: Array<[number, Date | null]>): Map<SbUserId, Date | null> {
  return new Map(entries.map(([id, d]) => [makeSbUserId(id), d]))
}

function reporters(ids: ReadonlyArray<number>): Set<SbUserId> {
  return new Set(users(ids))
}

/** A raw report where `reporter` claims a clean terminal victory over `nonReporter`. */
function selfVictoryReport(reporter: number, nonReporter: number): ResultSubmission {
  return {
    reporter: makeSbUserId(reporter),
    time: 100,
    playerResults: [
      makePlayerResult(reporter, GameClientResult.Victory, 'p', 10),
      makePlayerResult(nonReporter, GameClientResult.Defeat, 'p', 10),
    ],
  }
}

describe('games/results/applyDepartureConcessionTiebreak', () => {
  test('applies when one player reported a terminal self-victory and the other abandoned', () => {
    const decision = applyDepartureConcessionTiebreak({
      reconciled: reconciled(
        [
          [1, unknown],
          [2, unknown],
        ],
        true,
      ),
      humans: users([1, 2]),
      hasComputers: false,
      hasDesyncEvents: false,
      reportedHumans: reporters([1]),
      results: [selfVictoryReport(1, 2)],
      departureTimes: departures([[2, new Date(20_000)]]),
    })

    expect(decision.applied).toBe(true)
    expect(decision.winner).toBe(makeSbUserId(1))
    expect(decision.loser).toBe(makeSbUserId(2))
    expect(decision.reconciled.disputed).toBe(false)
    expect(resultsToObj(decision.reconciled)).toEqual({
      1: { result: 'win', race: 'p', apm: 10 },
      2: { result: 'loss', race: 'p', apm: 10 },
    })
  })

  test('orients winner/loser by which player is the sole reporter (reverse case)', () => {
    const decision = applyDepartureConcessionTiebreak({
      reconciled: reconciled(
        [
          [1, unknown],
          [2, unknown],
        ],
        true,
      ),
      humans: users([1, 2]),
      hasComputers: false,
      hasDesyncEvents: false,
      reportedHumans: reporters([2]),
      results: [selfVictoryReport(2, 1)],
      departureTimes: departures([[1, new Date(20_000)]]),
    })

    expect(decision.applied).toBe(true)
    expect(decision.winner).toBe(makeSbUserId(2))
    expect(decision.loser).toBe(makeSbUserId(1))
  })

  test('left and dropped departures are treated identically (only presence matters)', () => {
    // The function only receives departure presence, not kind, so a 'left' vs 'dropped' departure
    // for the same non-reporter produces an identical outcome.
    for (const departureTime of [new Date(1), new Date(999_999)]) {
      const decision = applyDepartureConcessionTiebreak({
        reconciled: reconciled(
          [
            [1, unknown],
            [2, unknown],
          ],
          true,
        ),
        humans: users([1, 2]),
        hasComputers: false,
        hasDesyncEvents: false,
        reportedHumans: reporters([1]),
        results: [selfVictoryReport(1, 2)],
        departureTimes: departures([[2, departureTime]]),
      })

      expect(decision.applied).toBe(true)
      expect(decision.winner).toBe(makeSbUserId(1))
      expect(decision.loser).toBe(makeSbUserId(2))
    }
  })

  test('NOT applied when both players reported conflicting victories (closes the lingering exploit)', () => {
    // This is the exploit case: a losing player falsely reports victory, producing a two-sided
    // conflict, then lingers on the connection. Departure evidence must never resolve this — it must
    // stay disputed/void regardless of which player's departure is later.
    const decision = applyDepartureConcessionTiebreak({
      reconciled: reconciled(
        [
          [1, unknown],
          [2, unknown],
        ],
        true,
      ),
      humans: users([1, 2]),
      hasComputers: false,
      hasDesyncEvents: false,
      reportedHumans: reporters([1, 2]),
      results: [selfVictoryReport(1, 2), selfVictoryReport(2, 1)],
      departureTimes: departures([
        [1, new Date(1000)],
        [2, new Date(999_999)],
      ]),
    })

    expect(decision.applied).toBe(false)
    expect(decision.reconciled.disputed).toBe(true)
  })

  test('not applied when neither player reported', () => {
    const decision = applyDepartureConcessionTiebreak({
      reconciled: reconciled(
        [
          [1, unknown],
          [2, unknown],
        ],
        true,
      ),
      humans: users([1, 2]),
      hasComputers: false,
      hasDesyncEvents: false,
      reportedHumans: reporters([]),
      results: [null, null],
      departureTimes: departures([
        [1, new Date(1000)],
        [2, new Date(999_999)],
      ]),
    })

    expect(decision.applied).toBe(false)
  })

  test('not applied when the non-reporter has no departure record (may just be slow)', () => {
    const decision = applyDepartureConcessionTiebreak({
      reconciled: reconciled(
        [
          [1, unknown],
          [2, unknown],
        ],
        true,
      ),
      humans: users([1, 2]),
      hasComputers: false,
      hasDesyncEvents: false,
      reportedHumans: reporters([1]),
      results: [selfVictoryReport(1, 2)],
      departureTimes: departures([[2, null]]),
    })

    expect(decision.applied).toBe(false)
  })

  test('not applied when there are more than two humans', () => {
    const decision = applyDepartureConcessionTiebreak({
      reconciled: reconciled(
        [
          [1, unknown],
          [2, unknown],
          [3, unknown],
        ],
        true,
      ),
      humans: users([1, 2, 3]),
      hasComputers: false,
      hasDesyncEvents: false,
      reportedHumans: reporters([1, 2]),
      results: [selfVictoryReport(1, 3), selfVictoryReport(2, 3)],
      departureTimes: departures([[3, new Date(1000)]]),
    })

    expect(decision.applied).toBe(false)
  })

  test('not applied when the game has a computer player', () => {
    const decision = applyDepartureConcessionTiebreak({
      reconciled: reconciled(
        [
          [1, unknown],
          [2, unknown],
        ],
        true,
      ),
      humans: users([1, 2]),
      hasComputers: true,
      hasDesyncEvents: false,
      reportedHumans: reporters([1]),
      results: [selfVictoryReport(1, 2)],
      departureTimes: departures([[2, new Date(1000)]]),
    })

    expect(decision.applied).toBe(false)
  })

  test('not applied when the reconciled outcome is neither disputed nor all-unknown', () => {
    const decision = applyDepartureConcessionTiebreak({
      reconciled: reconciled(
        [
          [1, { result: 'win', race: 't', apm: 20 }],
          [2, { result: 'loss', race: 'z', apm: 20 }],
        ],
        false,
      ),
      humans: users([1, 2]),
      hasComputers: false,
      hasDesyncEvents: false,
      reportedHumans: reporters([1]),
      results: [selfVictoryReport(1, 2)],
      departureTimes: departures([[2, new Date(1000)]]),
    })

    expect(decision.applied).toBe(false)
  })

  test('not applied when the game has relay desync events', () => {
    const decision = applyDepartureConcessionTiebreak({
      reconciled: reconciled(
        [
          [1, unknown],
          [2, unknown],
        ],
        true,
      ),
      humans: users([1, 2]),
      hasComputers: false,
      hasDesyncEvents: true,
      reportedHumans: reporters([1]),
      results: [selfVictoryReport(1, 2)],
      departureTimes: departures([[2, new Date(1000)]]),
    })

    expect(decision.applied).toBe(false)
  })

  describe('terminal self-victory requirement (Fix 3: sole report must not be trusted blindly)', () => {
    test('NOT applied when the sole report has the reporter still Playing (non-terminal)', () => {
      const decision = applyDepartureConcessionTiebreak({
        reconciled: reconciled(
          [
            [1, unknown],
            [2, unknown],
          ],
          true,
        ),
        humans: users([1, 2]),
        hasComputers: false,
        hasDesyncEvents: false,
        reportedHumans: reporters([1]),
        results: [
          {
            reporter: makeSbUserId(1),
            time: 100,
            playerResults: [
              makePlayerResult(1, GameClientResult.Playing, 'p', 10),
              makePlayerResult(2, GameClientResult.Disconnected, 'p', 10),
            ],
          },
        ],
        departureTimes: departures([[2, new Date(1000)]]),
      })

      expect(decision.applied).toBe(false)
      expect(decision.reconciled.disputed).toBe(true)
    })

    test('NOT applied when the sole reporter reports themselves as defeated', () => {
      const decision = applyDepartureConcessionTiebreak({
        reconciled: reconciled(
          [
            [1, unknown],
            [2, unknown],
          ],
          true,
        ),
        humans: users([1, 2]),
        hasComputers: false,
        hasDesyncEvents: false,
        reportedHumans: reporters([1]),
        results: [
          {
            reporter: makeSbUserId(1),
            time: 100,
            playerResults: [
              makePlayerResult(1, GameClientResult.Defeat, 'p', 10),
              makePlayerResult(2, GameClientResult.Victory, 'p', 10),
            ],
          },
        ],
        departureTimes: departures([[2, new Date(1000)]]),
      })

      expect(decision.applied).toBe(false)
    })

    test('NOT applied when the sole report claims the non-reporter as a victor too (mutual claim)', () => {
      const decision = applyDepartureConcessionTiebreak({
        reconciled: reconciled(
          [
            [1, unknown],
            [2, unknown],
          ],
          true,
        ),
        humans: users([1, 2]),
        hasComputers: false,
        hasDesyncEvents: false,
        reportedHumans: reporters([1]),
        results: [
          {
            reporter: makeSbUserId(1),
            time: 100,
            playerResults: [
              makePlayerResult(1, GameClientResult.Victory, 'p', 10),
              makePlayerResult(2, GameClientResult.Victory, 'p', 10),
            ],
          },
        ],
        departureTimes: departures([[2, new Date(1000)]]),
      })

      expect(decision.applied).toBe(false)
    })

    test('NOT applied when the "sole reporter" set and raw results disagree (no matching report found)', () => {
      // Defensive/total: `reportedHumans` says 1 reported, but `results` has nothing from them.
      const decision = applyDepartureConcessionTiebreak({
        reconciled: reconciled(
          [
            [1, unknown],
            [2, unknown],
          ],
          true,
        ),
        humans: users([1, 2]),
        hasComputers: false,
        hasDesyncEvents: false,
        reportedHumans: reporters([1]),
        results: [],
        departureTimes: departures([[2, new Date(1000)]]),
      })

      expect(decision.applied).toBe(false)
    })
  })
})
