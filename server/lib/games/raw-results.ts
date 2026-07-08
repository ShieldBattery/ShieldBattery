import {
  GameClientAllianceState,
  GameClientPlayerResult,
  GameClientResult,
  StoredRawGameResults,
} from '../../../common/games/results'
import { SbUserId } from '../../../common/users/sb-user-id'
import logger from '../logging/logger'
import type { StoredResultReport } from '../models/games-users'
import { ResultSubmission } from './results'

/** Reused empty default so a caller that omits `corroboratedVictors` allocates nothing. */
const NO_CORROBORATED_VICTORS: ReadonlySet<SbUserId> = new Set()

/**
 * Derives a per-player result submission from a single client's raw end-of-game report. This mirrors
 * the game client's `determine_game_results` (game/src/game_state.rs) and must stay semantically
 * aligned with it: the client used to run this digest itself, so an old digested report and a
 * freshly-derived one from the same evidence have to produce the same verdicts. The heavy lifting
 * of combining reports across players still happens later in `reconcileResults`.
 *
 * The derivation keeps two views of the game that mutate at distinct points, exactly as the client
 * does: the raw per-BW-player table (`rawByBw`, including computers), whose victory states feed the
 * "is there a victor" and "who's still live" questions, and the derived per-user results (`results`,
 * humans only), which is what actually gets returned. Blurring the two produces wrong verdicts (e.g.
 * a locally-defeated reporter still counts as "playing" in the raw table when deciding whether only
 * computers remain).
 *
 * On top of that faithful port, the server intentionally applies two extra evidence-based rules the
 * client digest never had, because the server can see evidence a single client couldn't: the leaver's
 * own report and the network departure record. Both target the "one-way-ally quit" artifact, where a
 * losing player allies a survivor one-directionally and quits, tricking BW into stamping the LEAVER a
 * Victory in the survivor's capture while the survivor's own state stays unresolved. Rule A (below)
 * vetoes an uncorroborated quit-victory; Rule B synthesizes the last-standing victory BW should have
 * awarded but didn't. See each rule's comment for the full evidence reasoning.
 *
 * Adversarial-but-schema-valid input (duplicate `bwPlayerId`s, colliding storm ids, missing rows)
 * degrades sanely — a missing lookup is skipped or treated as "quit" — rather than throwing, since
 * this runs off untrusted client evidence and a throw would wedge an otherwise-reconcilable game.
 *
 * @param raw the stored raw report
 * @param reporterUserId the user who submitted this report (may be an observer with no `players` row)
 * @param opts.isUms whether the game is UMS, taken from the server's own game config (never
 *   client-asserted); UMS reports pass through undigested
 * @param opts.corroboratedVictors the set of users whose OWN stored report claims a self-Victory,
 *   computed once across every report in the game (see `computeCorroboratedVictors`). Rule A uses it
 *   to tell a genuine winner-who-quit (present in the set) from the one-way-ally quit artifact
 *   (absent). Omit it (or pass an empty set) to disable the veto — no player is treated as
 *   corroborated, which is the correct default when deriving a report in isolation.
 */
export function deriveResultSubmission(
  raw: StoredRawGameResults,
  reporterUserId: SbUserId,
  opts: { isUms: boolean; corroboratedVictors?: ReadonlySet<SbUserId> },
): ResultSubmission {
  const corroboratedVictors = opts.corroboratedVictors ?? NO_CORROBORATED_VICTORS
  // The derived, per-user results (humans only). Keyed by SbUserId.
  const results = new Map<SbUserId, GameClientPlayerResult>()
  // The raw per-BW-player table (humans + computers), whose victory states we mutate in place.
  const rawByBw = new Map<number, RawWorkingPlayer>()

  for (const p of raw.players) {
    if (rawByBw.has(p.bwPlayerId)) {
      logger.warn(`raw results report has duplicate bwPlayerId ${p.bwPlayerId}; keeping the latest`)
    }
    rawByBw.set(p.bwPlayerId, {
      userId: p.userId,
      stormId: p.stormId,
      race: p.race,
      victoryState: p.victoryState,
      alliances: p.alliances,
    })

    if (p.userId !== null) {
      results.set(p.userId, { result: p.victoryState, race: p.race, apm: 0 })
    }
  }

  // For UMS games we return exactly what the client observed; UMS scripts control results.
  if (opts.isUms) {
    return toSubmission(reporterUserId, raw.time, results)
  }

  // Human-only lookups between our three identity spaces. Computers have no user/storm id, so
  // membership in these maps is exactly "is a human".
  const sbToStorm = new Map<SbUserId, number>()
  const sbToBw = new Map<SbUserId, number>()
  const bwToSb = new Map<number, SbUserId>()
  for (const p of raw.players) {
    if (p.userId === null) {
      continue
    }
    if (p.stormId !== null) {
      sbToStorm.set(p.userId, p.stormId)
    }
    sbToBw.set(p.userId, p.bwPlayerId)
    bwToSb.set(p.bwPlayerId, p.userId)
  }

  const network = new Map<number, { wasDropped: boolean; hasQuit: boolean }>()
  for (const n of raw.netPlayers) {
    network.set(n.stormId, { wasDropped: n.wasDropped, hasQuit: n.hasQuit })
  }

  // A missing network row means we treat that slot as having quit (and not dropped), matching the
  // client's `is_none_or(has_quit)` treatment of an absent storm status.
  const hasQuit = (stormId: number | undefined): boolean =>
    stormId === undefined || (network.get(stormId)?.hasQuit ?? true)
  const wasDropped = (stormId: number | undefined): boolean =>
    stormId !== undefined && (network.get(stormId)?.wasDropped ?? false)

  // The reporter's own raw victory state as originally captured, before any rule below mutates a
  // view. Rule B needs to know the reporter wasn't eliminated, and the reporter-Playing→Defeat rule
  // just below rewrites the derived view, so we snapshot the raw state now. (The raw table itself is
  // never touched for the reporter, but snapshotting keeps the intent explicit.)
  const reporterBwId = sbToBw.get(reporterUserId)
  const reporterOriginalVictoryState =
    reporterBwId !== undefined ? rawByBw.get(reporterBwId)?.victoryState : undefined

  // Rule A — corroborated-victory veto. A game client sends its result frame to the relay BEFORE its
  // leave intent, so any player who genuinely reached a Victory has their OWN report saying so. A
  // non-reporter human whose row here shows Victory, who has quit, but whose own report does NOT claim
  // self-Victory (absent from `corroboratedVictors`) is the fingerprint of the one-way-alliance
  // artifact: BW stamped the leaver a Victory in this capture even though they never actually won.
  // Downgrade that uncorroborated quit-victory to Disconnected in BOTH views so the has-victory
  // questions below don't see a phantom victor. Only human rows are examined: computers never report
  // (so can never be corroborated) and a computer's Victory only ever comes from the only-computers
  // rule further down, which needs no veto. The reporter's own row is never downgraded — a reporter's
  // self-claim is arbitrated later by reconciliation's cross-report victory/defeat counting.
  for (const p of rawByBw.values()) {
    if (
      p.userId === null ||
      p.userId === reporterUserId ||
      p.victoryState !== GameClientResult.Victory ||
      corroboratedVictors.has(p.userId) ||
      !hasQuit(p.stormId ?? undefined)
    ) {
      continue
    }
    p.victoryState = GameClientResult.Disconnected
    const derived = results.get(p.userId)
    if (derived) {
      derived.result = GameClientResult.Disconnected
    }
  }

  // BW leaves the local player marked Playing unless they were actually defeated (all buildings
  // destroyed); map that to Defeat since a Victory would already have been applied. Later logic may
  // still move this to another state. No-ops cleanly when the reporter is an observer (no own row).
  const reporterResult = results.get(reporterUserId)
  if (reporterResult && reporterResult.result === GameClientResult.Playing) {
    reporterResult.result = GameClientResult.Defeat
  }

  let hasVictory = anyRawVictory(rawByBw)
  const onlyComputersPlaying =
    !hasVictory &&
    !anyRawPlaying(rawByBw, bwToSb, true /* human */) &&
    anyRawPlaying(rawByBw, bwToSb, false /* computer */)

  if (onlyComputersPlaying) {
    // If only computers are left playing and they're all allied-for-victory with one another, give
    // them all a victory. If they aren't all allied, this game can never resolve to a final result.
    const compIds = [...rawByBw.keys()].filter(id => !bwToSb.has(id))
    let allAllied = true
    for (const compId of compIds) {
      const comp = rawByBw.get(compId)!
      for (const allyId of compIds) {
        if (
          allyId !== compId &&
          allianceWith(comp, allyId) !== GameClientAllianceState.AlliedVictory
        ) {
          allAllied = false
          break
        }
      }
      if (!allAllied) {
        break
      }
    }

    if (allAllied) {
      for (const compId of compIds) {
        const comp = rawByBw.get(compId)
        if (comp) {
          comp.victoryState = GameClientResult.Victory
        }
      }
    }
  }

  // If a player was dropped as part of a mass disconnect, assume they're probably still playing in
  // the other games and restore them to Playing (in the derived view only), so the other side's
  // majority report can outweigh ours.
  for (const [sbId, result] of results) {
    const dropped = wasDropped(sbToStorm.get(sbId))
    if (
      dropped &&
      result.result === GameClientResult.Disconnected &&
      raw.localPlayerLoseType === 'massDisconnect'
    ) {
      result.result = GameClientResult.Playing
    }
  }

  // Recompute now that the above may have changed the raw victory states.
  hasVictory = anyRawVictory(rawByBw)

  // Rule B — synthesized last-standing victory. After Rule A vetoes the leaver's phantom victory, a
  // genuinely-won game can be left with no victor at all: BW never resolved the survivor's own state
  // because the interfering one-way alliance denied them the native win. When the reporter is
  // demonstrably the sole player left standing — no victor anywhere, the reporter wasn't eliminated
  // (their original raw state was Playing) and hasn't quit, every other human has quit, and no
  // computer is still playing — award them the Victory BW should have. Setting the reporter's raw
  // state to Victory lets the normal victory branch below run: it maps the quit players to defeats
  // and applies allied-victory expansions. This can't fire for the leaver in the exploit (their own
  // capture shows the survivor still connected, so two humans have not quit) and can't be gamed by
  // lingering (a real winner's corroborated raw Victory survives Rule A, keeping `hasVictory` true and
  // blocking the no-victor precondition).
  if (!hasVictory && reporterOriginalVictoryState === GameClientResult.Playing) {
    const reporterConnected = !hasQuit(sbToStorm.get(reporterUserId))
    const noComputerPlaying = !anyRawPlaying(rawByBw, bwToSb, false /* computer */)
    let allOtherHumansQuit = true
    for (const p of rawByBw.values()) {
      if (p.userId === null || p.userId === reporterUserId) {
        continue
      }
      if (!hasQuit(p.stormId ?? undefined)) {
        allOtherHumansQuit = false
        break
      }
    }

    if (
      reporterConnected &&
      noComputerPlaying &&
      allOtherHumansQuit &&
      reporterBwId !== undefined
    ) {
      const reporterRaw = rawByBw.get(reporterBwId)
      if (reporterRaw) {
        reporterRaw.victoryState = GameClientResult.Victory
        const reporterDerived = results.get(reporterUserId)
        if (reporterDerived) {
          reporterDerived.result = GameClientResult.Victory
        }
        // Recompute so the branch below takes the victor path and finishes the derivation.
        hasVictory = anyRawVictory(rawByBw)
      }
    }
  }

  if (!hasVictory) {
    // No victor yet, so the game is still ongoing: map any Defeats to Disconnected if the player
    // could still win via allied victory with someone who is still live.

    // Players still "live" (still connected and playing), by BW id.
    const liveBwIds = new Set<number>()
    for (const [sbId, result] of results) {
      const storm = sbToStorm.get(sbId)
      const stillConnected =
        storm !== undefined && network.has(storm) && !network.get(storm)!.hasQuit
      if (result.result === GameClientResult.Playing && stillConnected) {
        const bwId = sbToBw.get(sbId)
        if (bwId !== undefined) {
          liveBwIds.add(bwId)
        }
      }
    }

    // Expand the live set across mutual (well, one-directional here — matching the client) allied-
    // victory edges: anyone an allied-victory ally of a live player is also live.
    const toProcess = [...liveBwIds]
    while (toProcess.length > 0) {
      const liveBwId = toProcess.pop()!
      const livePlayer = rawByBw.get(liveBwId)
      if (!livePlayer) {
        continue
      }
      for (let allyId = 0; allyId < 8; allyId++) {
        if (livePlayer.alliances[allyId] === GameClientAllianceState.AlliedVictory) {
          if (!liveBwIds.has(allyId)) {
            liveBwIds.add(allyId)
            toProcess.push(allyId)
          }
        }
      }
    }

    for (const [sbId, result] of results) {
      // BW never marks the local user as having quit by this point, but we treat them as quit so
      // the logic below is uniform.
      const quit = sbId === reporterUserId || hasQuit(sbToStorm.get(sbId))
      if (quit && result.result === GameClientResult.Defeat) {
        const bwId = sbToBw.get(sbId)
        if (bwId !== undefined && liveBwIds.has(bwId)) {
          result.result = GameClientResult.Disconnected
        }
      }
    }
  } else {
    // We have a victor, so the game is complete: use allied-victory settings to bring disconnected
    // players along to victory where mutually allied, and mark the rest of the disconnected as
    // defeated.
    const toProcess: number[] = []
    for (const [bwId, player] of rawByBw) {
      if (player.victoryState === GameClientResult.Victory) {
        toProcess.push(bwId)
      }
    }

    while (toProcess.length > 0) {
      const victorBwId = toProcess.pop()!
      const victor = rawByBw.get(victorBwId)
      if (!victor) {
        continue
      }
      for (const [sbId, allyResult] of results) {
        const bwId = sbToBw.get(sbId)
        if (bwId === undefined || bwId === victorBwId) {
          continue
        }
        if (allianceWith(victor, bwId) !== GameClientAllianceState.AlliedVictory) {
          continue
        }
        if (
          allyResult.result !== GameClientResult.Disconnected &&
          allyResult.result !== GameClientResult.Defeat
        ) {
          continue
        }
        const bwResult = rawByBw.get(bwId)
        if (
          !bwResult ||
          allianceWith(bwResult, victorBwId) !== GameClientAllianceState.AlliedVictory
        ) {
          continue
        }

        allyResult.result = GameClientResult.Victory
        // Bringing this player along may in turn bring their own allies, so process them too.
        toProcess.push(bwId)
      }
    }

    for (const result of results.values()) {
      if (result.result === GameClientResult.Disconnected) {
        result.result = GameClientResult.Defeat
      }
    }
  }

  return toSubmission(reporterUserId, raw.time, results)
}

interface RawWorkingPlayer {
  userId: SbUserId | null
  stormId: number | null
  race: GameClientPlayerResult['race']
  victoryState: GameClientResult
  alliances: GameClientAllianceState[]
}

function allianceWith(player: RawWorkingPlayer, otherBwId: number): GameClientAllianceState {
  return player.alliances[otherBwId] ?? GameClientAllianceState.Unallied
}

function anyRawVictory(rawByBw: ReadonlyMap<number, RawWorkingPlayer>): boolean {
  for (const p of rawByBw.values()) {
    if (p.victoryState === GameClientResult.Victory) {
      return true
    }
  }
  return false
}

/**
 * Whether any raw player with the given human-ness is still Playing. `wantHuman` selects between
 * human rows (present in `bwToSb`) and computer rows (absent).
 */
function anyRawPlaying(
  rawByBw: ReadonlyMap<number, RawWorkingPlayer>,
  bwToSb: ReadonlyMap<number, SbUserId>,
  wantHuman: boolean,
): boolean {
  for (const [bwId, p] of rawByBw) {
    if (p.victoryState === GameClientResult.Playing && bwToSb.has(bwId) === wantHuman) {
      return true
    }
  }
  return false
}

function toSubmission(
  reporter: SbUserId,
  time: number,
  results: ReadonlyMap<SbUserId, GameClientPlayerResult>,
): ResultSubmission {
  return {
    reporter,
    time,
    playerResults: [...results.entries()],
  }
}

/**
 * Collects the users whose OWN stored report claims a self-Victory, across every report submitted for
 * a game. This is the corroboration set Rule A (see `deriveResultSubmission`) uses to distinguish a
 * genuine winner-who-quit from the one-way-alliance quit artifact: a player who truly reached a
 * victory sent a result frame saying so before ever leaving, so their own report — raw or legacy —
 * records the self-Victory. A player with no stored report (e.g. a crash before reporting) is never
 * corroborated, which is intentional: an uncorroborated quit-victory in someone else's capture is
 * exactly what the veto is meant to strip.
 *
 * Only a report's claim about ITSELF counts. A raw report is inspected via the reporter's own
 * `players` row; a legacy digested report via its `playerResults` entry for the reporter.
 */
export function computeCorroboratedVictors(
  storedReports: ReadonlyArray<StoredResultReport | null>,
): Set<SbUserId> {
  const corroborated = new Set<SbUserId>()
  for (const stored of storedReports) {
    if (!stored) {
      continue
    }
    if (stored.kind === 'raw') {
      const ownRow = stored.raw.players.find(p => p.userId === stored.reporter)
      if (ownRow?.victoryState === GameClientResult.Victory) {
        corroborated.add(stored.reporter)
      }
    } else {
      const ownEntry = stored.playerResults.find(([id]) => id === stored.reporter)
      if (ownEntry?.[1].result === GameClientResult.Victory) {
        corroborated.add(stored.reporter)
      }
    }
  }
  return corroborated
}
