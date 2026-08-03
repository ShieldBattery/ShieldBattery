import { assertUnreachable } from '../../../../../common/assert-unreachable'
import { GameType, isTeamType } from '../../../../../common/games/game-type'
import { findSlotByUserId, Lobby, slotCount } from '../../../../../common/lobbies'
import { Slot, SlotType } from '../../../../../common/lobbies/slot'
import { SbUserId } from '../../../../../common/users/sb-user-id'
import { resolveViewerUserId, ScenarioData, ViewerRole } from '../mock-data'

/**
 * The moment of a lobby's life the "Room" variant is presenting. `regroup` isn't a lifecycle the
 * server tracks — the lobby is gathering again — but it's a distinct presentational state: the
 * results of the game that just ended are still the loudest thing in the room.
 */
export type RoomLifecycle = 'gathering' | 'countingDown' | 'inGame' | 'regroup'

/** Reads which lifecycle moment a scenario snapshot represents off of the data it carries. */
export function getRoomLifecycle(data: ScenarioData): RoomLifecycle {
  if (data.countdownTimer !== undefined) {
    return 'countingDown'
  }
  if (data.runState) {
    return 'inGame'
  }
  if (data.chat.some(line => line.resultsCard)) {
    return 'regroup'
  }
  return 'gathering'
}

/** How a seat reads at a glance: someone's in it, it's joinable, or the host sealed it. */
export type SeatOccupancy = 'filled' | 'open' | 'closed'

export function getSeatOccupancy(slot: Slot): SeatOccupancy {
  switch (slot.type) {
    case SlotType.Open:
    case SlotType.ControlledOpen:
      return 'open'
    case SlotType.Closed:
    case SlotType.ControlledClosed:
      return 'closed'
    case SlotType.Human:
    case SlotType.Observer:
    case SlotType.Computer:
    case SlotType.UmsComputer:
      return 'filled'
    default:
      return assertUnreachable(slot.type)
  }
}

/**
 * One occupancy entry per playable seat, in team order — the source for the sidebar entry's pip
 * row. Observer seats are excluded: they're a separate role, not part of "is this game full yet".
 */
export function getSeatOccupancies(lobby: Lobby): SeatOccupancy[] {
  return lobby.teams
    .filter(team => !team.isObserver)
    .flatMap(team => team.slots.map(getSeatOccupancy))
}

/** How many playable seats have someone in them, out of how many the layout has. */
export function getSeatCounts(lobby: Lobby): { filled: number; total: number } {
  const occupancies = getSeatOccupancies(lobby)
  return {
    filled: occupancies.filter(o => o === 'filled').length,
    total: slotCount(lobby),
  }
}

/** Formats a game's running time as MM:SS (or MMM:SS for games past the hour mark). */
export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/**
 * The clock these pages render against. The mock data builds its timestamps relative to the moment
 * the module loaded, so pinning "now" to load time keeps every derived duration stable across
 * re-renders instead of ticking while nothing else does.
 */
const PAGE_LOAD_TIME = Date.now()

/** Formats how long a bench member has been waiting, e.g. `45s` or `2m`. */
export function formatWaitTime(joinedAt: number): string {
  const seconds = Math.max(0, Math.round((PAGE_LOAD_TIME - joinedAt) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m`
}

/**
 * How much pressure the countdown should project. The numeral walks calm -> amber -> red as the
 * launch approaches, so the room reads the tension without anyone parsing the number.
 */
export type CountdownUrgency = 'calm' | 'warning' | 'urgent'

export function getCountdownUrgency(secondsLeft: number): CountdownUrgency {
  if (secondsLeft <= 1) {
    return 'urgent'
  }
  if (secondsLeft <= 3) {
    return 'warning'
  }
  return 'calm'
}

export function getCountdownColor(urgency: CountdownUrgency): string {
  switch (urgency) {
    case 'urgent':
      return 'var(--theme-negative)'
    case 'warning':
      return 'var(--theme-amber)'
    case 'calm':
      return 'var(--color-blue80)'
    default:
      return assertUnreachable(urgency)
  }
}

/**
 * Game type names, spelled out locally because these pages are development-only and deliberately
 * carry no translation keys.
 */
const GAME_TYPE_LABELS: Record<GameType, string> = {
  [GameType.Melee]: 'Melee',
  [GameType.FreeForAll]: 'Free for all',
  [GameType.TopVsBottom]: 'Top vs bottom',
  [GameType.TeamMelee]: 'Team melee',
  [GameType.TeamFreeForAll]: 'Team free for all',
  [GameType.UseMapSettings]: 'Use map settings',
  [GameType.OneVsOne]: 'One on one',
}

export function gameTypeLabel(gameType: GameType): string {
  return GAME_TYPE_LABELS[gameType]
}

/** A label for how a team game's slots are divided up, e.g. `2 teams` or `3 vs 5`. */
export function gameSubTypeLabel(lobby: Lobby): string | undefined {
  if (!isTeamType(lobby.gameType)) {
    return undefined
  }
  if (lobby.gameType === GameType.TopVsBottom) {
    return `${lobby.gameSubType} vs ${slotCount(lobby) - lobby.gameSubType}`
  }
  return `${lobby.gameSubType} teams`
}

/** Everything the room's surfaces need to know about whoever is looking at it. */
export interface RoomViewer {
  userId: SbUserId
  role: ViewerRole
  /** The viewer's seat, when they have one. */
  slot?: Slot
  /** Index into `lobby.teams` of the viewer's seat, when they have one. */
  teamIndex?: number
  isHost: boolean
  isBenched: boolean
  /** The viewer's place in the bench queue (1-based), when they're on it. */
  benchPosition?: number
}

/**
 * Resolves the lobby member a viewer-role selection stands for, plus the facts every surface keys
 * its affordances off of. A role the lobby has no member for (e.g. `benched` with an empty bench)
 * falls back to the host, so the resolved facts describe whoever was actually landed on rather than
 * the role that was asked for.
 */
export function getRoomViewer(data: ScenarioData, role: ViewerRole): RoomViewer {
  const lobby = data.lobby
  const userId = resolveViewerUserId(lobby, role)
  const [teamIndex, , slot] = findSlotByUserId(lobby, userId)
  const benchIndex = lobby.bench.findIndex(benched => benched.userId === userId)

  return {
    userId,
    role,
    slot,
    teamIndex,
    isHost: lobby.host.userId === userId,
    isBenched: benchIndex >= 0,
    benchPosition: benchIndex >= 0 ? benchIndex + 1 : undefined,
  }
}

/**
 * How many chat lines have landed since the viewer last said something — the room's stand-in for an
 * unread count, so the sidebar entry has something to badge.
 */
export function getUnreadCount(data: ScenarioData, userId: SbUserId): number {
  let lastOwnIndex = -1
  for (let i = 0; i < data.chat.length; i++) {
    if (data.chat[i].userId === userId) {
      lastOwnIndex = i
    }
  }
  return data.chat.length - 1 - lastOwnIndex
}
