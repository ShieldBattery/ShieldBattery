import { getLobbySlots, Lobby, slotCount, takenSlotCount } from '../../../../../common/lobbies'
import { LobbyChangedSetting } from '../../../../../common/lobbies/lobby-network'
import { Slot, SlotType } from '../../../../../common/lobbies/slot'
import { SbUserId } from '../../../../../common/users/sb-user-id'
import { resolveViewerUserId, ScenarioData, ViewerRole } from '../mock-data'

/**
 * Where the lobby is in its life, as far as the board needs to care. Derived from which optional
 * fields a scenario carries rather than from the scenario's name, so the board reacts to lobby
 * state the same way the real view will.
 */
export type BoardLifecycle = 'gathering' | 'countingDown' | 'inGame' | 'regroup'

/** Which start model the board is rendering: the classic countdown, or per-player ready checks. */
export type StartModel = 'countdown' | 'readyChecks'

/** Everything the board's pieces need, derived once per render from a scenario + viewer role. */
export interface BoardModel {
  data: ScenarioData
  lobby: Lobby
  viewer: ViewerRole
  selfUserId: SbUserId
  isHost: boolean
  /** Whether the viewer is one of the members waiting for a seat. */
  isBenched: boolean
  lifecycle: BoardLifecycle
  startModel: StartModel
  /** Members currently inside the running game; empty unless the lobby is `inGame`. */
  inGameUsers: ReadonlySet<SbUserId>
  /** Seated members who have readied up; only meaningful under the `readyChecks` start model. */
  readyUsers: ReadonlySet<SbUserId>
  /** True when a settings change has just cleared everyone's readiness. */
  readinessReset: boolean
  changedSettings: ReadonlySet<LobbyChangedSetting>
  seatCount: number
  takenSeatCount: number
  /** Every seat in team order, so seat-indexed presentation (launch rings) stays stable. */
  seats: ReadonlyArray<Slot>
}

/**
 * How far along each seat is in loading the game, indexed by seat position. Static stand-ins for
 * the per-player load progress the launch rings (D12) will show once they're wired up.
 */
const LAUNCH_PROGRESS: ReadonlyArray<number> = [1, 0.82, 0.55, 0.95, 0.7, 1, 0.38, 0.88]

export function launchProgressForSeat(seatIndex: number): number {
  return LAUNCH_PROGRESS[seatIndex % LAUNCH_PROGRESS.length]
}

function seatedUserIds(lobby: Lobby): SbUserId[] {
  return getLobbySlots(lobby)
    .filter(slot => slot.type === SlotType.Human && slot.userId !== undefined)
    .map(slot => slot.userId!)
}

/**
 * Picks who has readied up. A lobby that's already launching has everyone ready by definition, a
 * settings change clears the board, and anything else gets a deterministic mix so the ready and
 * unready treatments are both visible at once.
 */
function computeReadyUsers(
  lobby: Lobby,
  lifecycle: BoardLifecycle,
  readinessReset: boolean,
): Set<SbUserId> {
  if (readinessReset) {
    return new Set()
  }

  const seated = seatedUserIds(lobby)
  if (lifecycle === 'countingDown') {
    return new Set(seated)
  }

  return new Set(seated.filter((_userId, i) => i % 3 !== 2))
}

/** Derives everything the board renders from one lifecycle snapshot and the viewer's role. */
export function deriveBoardModel(
  data: ScenarioData,
  viewer: ViewerRole,
  startModel: StartModel,
): BoardModel {
  const lobby = data.lobby
  const selfUserId = resolveViewerUserId(lobby, viewer)

  let lifecycle: BoardLifecycle = 'gathering'
  if (data.countdownTimer !== undefined) {
    lifecycle = 'countingDown'
  } else if (data.runState) {
    lifecycle = 'inGame'
  } else if (data.seriesScore !== undefined) {
    lifecycle = 'regroup'
  }

  const changedSettings = new Set(data.changedSettings ?? [])
  const readyChecks = startModel === 'readyChecks'
  const readinessReset = readyChecks && changedSettings.size > 0

  return {
    data,
    lobby,
    viewer,
    selfUserId,
    isHost: lobby.host.userId === selfUserId,
    isBenched: lobby.bench.some(benched => benched.userId === selfUserId),
    lifecycle,
    startModel,
    inGameUsers: new Set(data.runState?.inGameUsers ?? []),
    readyUsers: readyChecks ? computeReadyUsers(lobby, lifecycle, readinessReset) : new Set(),
    readinessReset,
    changedSettings,
    seatCount: slotCount(lobby),
    takenSeatCount: takenSlotCount(lobby),
    seats: getLobbySlots(lobby),
  }
}

/**
 * Whether the lobby's seat layout can be rearranged right now. A lobby that just finished a game is
 * gathering again with its seats kept, so regrouping is as editable as a fresh lobby; a lobby that
 * is launching or already running one is not.
 */
export function canEditSeats(model: BoardModel): boolean {
  return model.lifecycle === 'gathering' || model.lifecycle === 'regroup'
}

/** How many seated members have readied up, and how many seats are waiting on a human. */
export function readyTally(model: BoardModel): { ready: number; total: number } {
  const seated = seatedUserIds(model.lobby)
  return {
    ready: seated.filter(userId => model.readyUsers.has(userId)).length,
    total: seated.length,
  }
}

/** Formats a duration as `MM:SS`, for elapsed game time. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** Formats how long someone has been waiting on the bench, coarsely. */
export function formatWaiting(joinedAt: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - joinedAt) / 1000))
  if (seconds < 60) {
    return `${seconds}s`
  }
  return `${Math.floor(seconds / 60)}m`
}

/**
 * Stands in for every action the board would dispatch. These explorations are presentational, so
 * the affordances are real but their effects are only logged.
 */
export function logBoardAction(action: string, ...details: unknown[]) {
  console.log(`[lobby board] ${action}`, ...details)
}
