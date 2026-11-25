import { DepartureKind } from '../../../common/games/netcode-v2'
import { MS_PER_GAME_FRAME } from '../../../common/games/replay-timestamp'
import {
  GameClientResult,
  isRawStoredGameResults,
  ReconciledResult,
  StoredGameResults,
  StoredRawGameResults,
} from '../../../common/games/results'
import { SbUserId } from '../../../common/users/sb-user-id'

/**
 * How much game time a matchmaking game has to have run before a player can abandon it without a
 * matchmaking penalty. A player who abandons it sooner is penalized.
 */
export const EARLY_LEAVE_THRESHOLD_MS = 75_000

export interface EarlyLeavePlayer {
  userId: SbUserId
  departureKind: DepartureKind | null
  /** When the player's departure was recorded, in wall-clock time. */
  departureTime: Date | null
  /** The relay's game frame when it recorded the player's own result report, if it did. */
  relayReportFrame: number | null
  /** The player's own stored result report, if they sent one. */
  report: StoredGameResults | null
  /** The player's reconciled result for the game. */
  result: ReconciledResult | null
}

/** Whether a player's own report shows the game finished for them: they won or were eliminated. */
function reportedFinished(userId: SbUserId, report: StoredRawGameResults): boolean {
  const own = report.players.find(p => p.userId === userId)
  return (
    own?.victoryState === GameClientResult.Victory || own?.victoryState === GameClientResult.Defeat
  )
}

/**
 * Whether a player abandoned the game: they departed from it before it was finished for them. A
 * departure alone doesn't show that, since players leave a game they've won or lost too.
 */
function isAbandoner(player: EarlyLeavePlayer): boolean {
  if (!player.departureKind || (player.result !== 'win' && player.result !== 'loss')) {
    return false
  }
  if (!player.report) {
    // A player whose client dropped from the game never got to report anything
    return true
  }
  // A digested (legacy) report doesn't show the player's own state as they left, so it never counts
  // as abandoning
  return isRawStoredGameResults(player.report) && !reportedFinished(player.userId, player.report)
}

/**
 * The game time at which a player left, in milliseconds. The relay's frame for their report is
 * exact. Without one, the time is bounded from above by both the game's length and the wall-clock
 * time from the game's start to the departure (which includes loading), so the smaller is used.
 */
function getLeaveTime(
  player: EarlyLeavePlayer,
  gameLengthMs: number | null,
  gameStartTime: Date,
): number {
  if (player.relayReportFrame !== null) {
    return player.relayReportFrame * MS_PER_GAME_FRAME
  }

  const bounds: number[] = []
  if (gameLengthMs !== null) {
    bounds.push(gameLengthMs)
  }
  if (player.departureTime) {
    bounds.push(Number(player.departureTime) - Number(gameStartTime))
  }
  return bounds.length ? Math.min(...bounds) : Infinity
}

/** Orders two times that may be `Infinity` (unknown), unknown times last. */
function compareTimes(a: number, b: number): number {
  if (a === b) {
    return 0
  }
  return a < b ? -1 : 1
}

/**
 * Finds the players in a matchmaking game who should be penalized for leaving it early. A player is
 * penalized for abandoning the game before `EARLY_LEAVE_THRESHOLD_MS` of game time, but only if
 * they were the first on their team to abandon it, and only if the game was still contested at the
 * time: some opposing player was still in it.
 *
 * @param teams The game's human players, grouped by team
 * @param gameLengthMs The game's reconciled length, if known
 * @param gameStartTime When the game's record was created, which precedes loading
 * @returns the users to penalize, in the order they left
 */
export function findEarlyLeavers({
  teams,
  gameLengthMs,
  gameStartTime,
  players,
}: {
  teams: ReadonlyArray<ReadonlyArray<SbUserId>>
  gameLengthMs: number | null
  gameStartTime: Date
  players: ReadonlyArray<EarlyLeavePlayer>
}): SbUserId[] {
  const teamOf = new Map<SbUserId, number>()
  for (const [index, team] of teams.entries()) {
    for (const userId of team) {
      teamOf.set(userId, index)
    }
  }

  const abandoners = players
    .filter(p => teamOf.has(p.userId) && isAbandoner(p))
    .map(p => ({
      userId: p.userId,
      team: teamOf.get(p.userId)!,
      leaveTime: getLeaveTime(p, gameLengthMs, gameStartTime),
      departureTime: Number(p.departureTime ?? Infinity),
    }))
    .sort(
      (a, b) =>
        compareTimes(a.leaveTime, b.leaveTime) || compareTimes(a.departureTime, b.departureTime),
    )

  const leftBefore = new Set<SbUserId>()
  const teamsAbandoned = new Set<number>()
  const penalized: SbUserId[] = []
  for (const abandoner of abandoners) {
    const contested = teams.some(
      (team, index) => index !== abandoner.team && team.some(userId => !leftBefore.has(userId)),
    )
    if (
      abandoner.leaveTime < EARLY_LEAVE_THRESHOLD_MS &&
      !teamsAbandoned.has(abandoner.team) &&
      contested
    ) {
      penalized.push(abandoner.userId)
    }

    leftBefore.add(abandoner.userId)
    teamsAbandoned.add(abandoner.team)
  }

  return penalized
}
