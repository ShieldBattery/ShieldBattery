import { assertUnreachable } from '../../../../common/assert-unreachable'
import { GameType } from '../../../../common/games/game-type'
import { findSlotByUserId, Lobby, MAX_OBSERVERS, Team } from '../../../../common/lobbies'
import { Slot, SlotType } from '../../../../common/lobbies/slot'
import { MapInfo, Tileset } from '../../../../common/maps'
import { SbUserId } from '../../../../common/users/sb-user-id'
import { RedesignScenario, ScenarioData, ViewerRole } from './mock-data'

export const SCENARIOS: ReadonlyArray<{ id: RedesignScenario; label: string }> = [
  { id: 'gathering', label: 'Gathering' },
  { id: 'fullWithBench', label: 'Full + bench' },
  { id: 'settingsChanged', label: 'Settings changed' },
  { id: 'launching', label: 'Launching' },
  { id: 'inGame', label: 'In game' },
  { id: 'regroup', label: 'Regroup' },
  { id: 'navigatedAway', label: 'Navigated away' },
]

export const VIEWER_ROLES: ReadonlyArray<{ id: ViewerRole; label: string }> = [
  { id: 'host', label: 'Host' },
  { id: 'member', label: 'Member' },
  { id: 'benched', label: 'Benched' },
]

/**
 * Where the lobby is in its evening. `regroup` isn't a state the server tracks — the lobby is
 * gathering again — but the game that just ended is still the loudest thing in the room, so it
 * presents differently.
 */
export type Lifecycle = 'gathering' | 'launching' | 'inGame' | 'regroup'

export function getLifecycle(data: ScenarioData): Lifecycle {
  if (data.launch) {
    return 'launching'
  }
  if (data.runState) {
    return 'inGame'
  }
  if (data.series) {
    return 'regroup'
  }
  return 'gathering'
}

/** Everything the surfaces need to know about whoever is looking at the lobby. */
export interface Viewer {
  userId: SbUserId
  role: ViewerRole
  /** The viewer's seat, when they hold one. */
  slot?: Slot
  isHost: boolean
  isBenched: boolean
  isObserver: boolean
  isReady: boolean
}

/**
 * The derived facts every surface of the page keys off of, so the header, the chat and the rail all
 * agree about who the viewer is and how far along the room is.
 */
export interface LobbyView {
  data: ScenarioData
  lobby: Lobby
  lifecycle: Lifecycle
  viewer: Viewer
  /** Whether the lobby launches on a ready check rather than a blind countdown. */
  readyChecks: boolean
  readyUserIds: ReadonlySet<SbUserId>
  /** Everyone a ready check waits on: seated humans plus observers. */
  participants: SbUserId[]
  /** Participants plus everyone waiting for a seat. */
  peopleCount: number
}

/** The lobby members a ready check waits on, in seat order. */
function getParticipants(lobby: Lobby): SbUserId[] {
  return lobby.teams
    .flatMap(team => team.slots)
    .filter(slot => slot.type === SlotType.Human || slot.type === SlotType.Observer)
    .map(slot => slot.userId!)
}

/**
 * Picks the lobby member a viewer-role selection stands for. A role the lobby has no member for
 * (e.g. `benched` once the bench has emptied out) falls back to the host.
 */
function resolveViewerUserId(lobby: Lobby, role: ViewerRole): SbUserId {
  switch (role) {
    case 'host':
      return lobby.host.userId!
    case 'benched':
      return lobby.bench[0]?.userId ?? lobby.host.userId!
    case 'member': {
      const member = lobby.teams
        .flatMap(team => team.slots)
        .find(slot => slot.type === SlotType.Human && slot.id !== lobby.host.id)
      return member?.userId ?? lobby.host.userId!
    }
    default:
      return assertUnreachable(role)
  }
}

export function buildLobbyView({
  data,
  role,
  readyChecks,
  selfReady,
}: {
  data: ScenarioData
  role: ViewerRole
  readyChecks: boolean
  /** Overrides the viewer's own ready state once they've used the header's ready toggle. */
  selfReady?: boolean
}): LobbyView {
  const lobby = data.lobby
  const userId = resolveViewerUserId(lobby, role)
  const [, , slot] = findSlotByUserId(lobby, userId)

  const readyUserIds = new Set(data.readyUserIds)
  if (selfReady === true) {
    readyUserIds.add(userId)
  } else if (selfReady === false) {
    readyUserIds.delete(userId)
  }

  const participants = getParticipants(lobby)

  return {
    data,
    lobby,
    lifecycle: getLifecycle(data),
    viewer: {
      userId,
      role,
      slot,
      isHost: lobby.host.userId === userId,
      isBenched: lobby.bench.some(benched => benched.userId === userId),
      isObserver: slot?.type === SlotType.Observer,
      isReady: readyUserIds.has(userId),
    },
    readyChecks,
    readyUserIds,
    participants,
    peopleCount: participants.length + lobby.bench.length,
  }
}

export function getReadyCount(view: LobbyView): number {
  return view.participants.filter(id => view.readyUserIds.has(id)).length
}

export function isEveryoneReady(view: LobbyView): boolean {
  return getReadyCount(view) === view.participants.length
}

/** How many playable seats the layout has, and how many of them are taken. */
export function getSeatCounts(lobby: Lobby): { taken: number; total: number; open: number } {
  const slots = lobby.teams.filter(team => !team.isObserver).flatMap(team => team.slots)
  return {
    taken: slots.filter(slot => !isEmptySeat(slot)).length,
    total: slots.length,
    open: slots.filter(slot => slot.type === SlotType.Open || slot.type === SlotType.ControlledOpen)
      .length,
  }
}

export function isEmptySeat(slot: Slot): boolean {
  return (
    slot.type === SlotType.Open ||
    slot.type === SlotType.Closed ||
    slot.type === SlotType.ControlledOpen ||
    slot.type === SlotType.ControlledClosed
  )
}

export function isClosedSeat(slot: Slot): boolean {
  return slot.type === SlotType.Closed || slot.type === SlotType.ControlledClosed
}

export function isComputerSeat(slot: Slot): boolean {
  return slot.type === SlotType.Computer || slot.type === SlotType.UmsComputer
}

export function getObserverSlots(lobby: Lobby): Slot[] {
  return lobby.teams
    .filter(team => team.isObserver)
    .flatMap(team => team.slots)
    .filter(slot => slot.type === SlotType.Observer)
}

/** The rail's heading for one team, e.g. `TEAM 1 · TOP`. */
export function teamLabel(team: Team, index: number): string {
  return `TEAM ${index + 1} · ${team.name.toUpperCase()}`
}

/** The header's game-type chip, e.g. `TOP VS BOTTOM 4V4`. */
export function gameTypeChipLabel(lobby: Lobby): string {
  const { total } = getSeatCounts(lobby)
  switch (lobby.gameType) {
    case GameType.TopVsBottom:
      return `TOP VS BOTTOM ${lobby.gameSubType}V${total - lobby.gameSubType}`
    case GameType.TeamMelee:
      return `TEAM MELEE ${lobby.gameSubType} TEAMS`
    case GameType.TeamFreeForAll:
      return `TEAM FFA ${lobby.gameSubType} TEAMS`
    case GameType.Melee:
      return 'MELEE'
    case GameType.FreeForAll:
      return 'FREE FOR ALL'
    case GameType.OneVsOne:
      return '1V1'
    case GameType.UseMapSettings:
      return 'USE MAP SETTINGS'
    default:
      return assertUnreachable(lobby.gameType)
  }
}

/** The header's observer chip, e.g. `OBS 1/4`. */
export function observerChipLabel(lobby: Lobby): string {
  return `OBS ${getObserverSlots(lobby).length}/${MAX_OBSERVERS}`
}

const TILESET_NAMES: Record<Tileset, string> = {
  [Tileset.Badlands]: 'Badlands',
  [Tileset.Platform]: 'Space platform',
  [Tileset.Installation]: 'Installation',
  [Tileset.Ashworld]: 'Ashworld',
  [Tileset.Jungle]: 'Jungle',
  [Tileset.Desert]: 'Desert',
  [Tileset.Ice]: 'Ice',
  [Tileset.Twilight]: 'Twilight',
}

/** The line under the rail's map card, e.g. `128×128 · Jungle · 8 players`. */
export function mapDetailsLine(map: MapInfo): string {
  const { width, height, tileset, slots } = map.mapData
  return `${width}×${height} · ${TILESET_NAMES[tileset]} · ${slots} players`
}

/** Formats a running game's clock as MM:SS. */
export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Formats a launch countdown as M:SS. */
export function formatCountdown(secondsLeft: number): string {
  const clamped = Math.max(0, secondsLeft)
  return `${Math.floor(clamped / 60)}:${String(clamped % 60).padStart(2, '0')}`
}

/** Every seat a running game is playing out, humans and computers alike. */
export function getPlayingCount(lobby: Lobby): number {
  return lobby.teams
    .filter(team => !team.isObserver)
    .flatMap(team => team.slots)
    .filter(slot => !isEmptySeat(slot)).length
}

/** Logs an action a presentational affordance would take against a real lobby. */
export function logAction(action: string, detail?: unknown): void {
  console.log(`[lobby redesign] ${action}`, detail ?? '')
}
