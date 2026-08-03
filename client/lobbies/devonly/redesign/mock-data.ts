import { GameType } from '../../../../common/games/game-type'
import { BenchedUser, getLobbySlots, Lobby, Team } from '../../../../common/lobbies'
import { LobbyChangedSetting, LobbyRunStateJson } from '../../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../../common/lobbies/sb-lobby-id'
import { createHuman, createOpen, Slot, SlotType } from '../../../../common/lobbies/slot'
import { makeSbMapId, MapInfo, MapInfoJson, MapVisibility, Tileset } from '../../../../common/maps'
import { RaceChar } from '../../../../common/races'
import { SbUser } from '../../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../../common/users/sb-user-id'

/**
 * The six lifecycle snapshots every in-lobby redesign exploration must render (spec 6b). These are
 * points in a single lobby's life, not independent lobbies: `fullWithBench` -> `countdown` ->
 * `inGame` -> `regroup` is one continuous story, and `settingsChanged` branches off `gathering`.
 */
export type RedesignScenario =
  'gathering' | 'fullWithBench' | 'countdown' | 'inGame' | 'regroup' | 'settingsChanged'

/**
 * Whose perspective a variant page renders the lobby from. Affects which host/moderation
 * affordances show up and which chat/slot row is "you" -- not part of `ScenarioData` itself, since
 * the same scenario can be viewed from any role the lobby actually has a member for.
 */
export type ViewerRole = 'host' | 'member' | 'benched'

/** A single line in a scenario's mock chat log. */
export interface MockChatLine {
  id: string
  /** Absent for `system`/`resultsCard` lines, which aren't attributed to a lobby member. */
  userId?: SbUserId
  text: string
  /** A server-generated notice (join/leave/settings/etc.), rendered without a chat bubble. */
  system?: boolean
  /** Marks the regroup results-card line so a variant can swap it for its own results component. */
  resultsCard?: boolean
}

/** Everything a variant page needs to render one lifecycle snapshot of the mock lobby. */
export interface ScenarioData {
  lobby: Lobby
  /** The lobby's running game, present only while it's `inGame`. */
  runState?: LobbyRunStateJson
  /** Seconds left on the countdown, present only during `countdown`. */
  countdownTimer?: number
  chat: MockChatLine[]
  /** Best-of series tally so far, present only during `regroup`. */
  seriesScore?: [number, number]
  /** Which settings the host just changed, present only during `settingsChanged`. */
  changedSettings?: LobbyChangedSetting[]
}

// High enough that no dev-DB user ever collides with these ids -- a collision lets a background
// `@users/loadUsers` fetch for the real user overwrite these mock names out from under us.
const tec27: SbUser = { id: makeSbUserId(90001), name: 'tec27', created: 0 }
const twoPacalypse: SbUser = { id: makeSbUserId(90002), name: '2Pacalypse-', created: 0 }
const dronebabo: SbUser = { id: makeSbUserId(90003), name: 'dronebabo', created: 0 }
const pachi: SbUser = { id: makeSbUserId(90004), name: 'pachi', created: 0 }
const heyoka: SbUser = { id: makeSbUserId(90005), name: 'Heyoka', created: 0 }
const legionnaire: SbUser = { id: makeSbUserId(90006), name: 'Legionnaire', created: 0 }
const boesthius: SbUser = { id: makeSbUserId(90007), name: 'boesthius', created: 0 }
const harem: SbUser = { id: makeSbUserId(90008), name: 'harem', created: 0 }
const flash: SbUser = { id: makeSbUserId(90009), name: 'Flash', created: 0 }
const bisu: SbUser = { id: makeSbUserId(90010), name: 'Bisu', created: 0 }
const jaedong: SbUser = { id: makeSbUserId(90011), name: 'Jaedong', created: 0 }
const stork: SbUser = { id: makeSbUserId(90012), name: 'Stork', created: 0 }

/** Every user referenced by any scenario, for seeding the redux users store. */
export const ALL_MOCK_USERS: SbUser[] = [
  tec27,
  twoPacalypse,
  dronebabo,
  pachi,
  heyoka,
  legionnaire,
  boesthius,
  harem,
  flash,
  bisu,
  jaedong,
  stork,
]

const RACE_BY_USER: ReadonlyMap<SbUserId, RaceChar> = new Map([
  [tec27.id, 'p'],
  [twoPacalypse.id, 't'],
  [dronebabo.id, 'z'],
  [pachi.id, 'r'],
  [heyoka.id, 'r'],
  [legionnaire.id, 'p'],
  [boesthius.id, 't'],
  [harem.id, 'z'],
  [flash.id, 't'],
  [bisu.id, 'p'],
  [jaedong.id, 'z'],
  [stork.id, 'p'],
])

function human(user: SbUser): Slot {
  return createHuman(user.id, RACE_BY_USER.get(user.id) ?? 'r')
}

function onBench(user: SbUser, joinedAgoMs: number): BenchedUser {
  return {
    userId: user.id,
    race: RACE_BY_USER.get(user.id) ?? 'r',
    joinedAt: Date.now() - joinedAgoMs,
  }
}

function team(teamId: number, name: string, slots: Slot[]): Team {
  return { teamId, name, isObserver: false, slots, hiddenSlots: [] }
}

function makeMockMapJson(
  idSuffix: string,
  name: string,
  tileset: Tileset,
  slotCount: number,
): MapInfoJson {
  return {
    id: makeSbMapId(`redesign-mock-map-${idSuffix}`),
    hash: idSuffix.padEnd(64, '0'),
    name,
    description: `A ${slotCount}-player map used by the in-lobby redesign explorations.`,
    uploadedBy: tec27.id,
    uploadDate: Date.now(),
    visibility: MapVisibility.Official,
    mapData: {
      format: 'scx',
      tileset,
      originalName: name,
      originalDescription: name,
      slots: slotCount,
      umsSlots: slotCount,
      umsForces: [
        {
          name: 'Players',
          teamId: 0,
          players: Array.from({ length: slotCount }, (_, i) => ({
            id: i,
            race: 'any' as const,
            typeId: 5,
            computer: false,
          })),
        },
      ],
      width: 128,
      height: 128,
      isEud: false,
      parserVersion: 1,
    },
    mapUrl: 'https://example.org/redesign-mock-map.scx',
    imageVersion: 1,
  }
}

function toMapInfo(json: MapInfoJson): MapInfo {
  return { ...json, uploadDate: new Date(json.uploadDate) }
}

const BIG_GAME_HUNTERS_JSON = makeMockMapJson('8p', 'Big Game Hunters', Tileset.Twilight, 8)
const DESTINATION_JSON = makeMockMapJson('6p', 'Destination', Tileset.Ice, 6)

const BIG_GAME_HUNTERS = toMapInfo(BIG_GAME_HUNTERS_JSON)
const DESTINATION = toMapInfo(DESTINATION_JSON)

/**
 * The wire form of every mock map, meant to be dispatched into the redux maps store (`@maps/
 * loadMapInfos`) so `ReduxMapThumbnail` and friends can resolve them by id, the same way
 * `loadMapsForTesting` seeds `FightingSpirit` for `lobby-test.tsx`.
 */
export const ALL_MOCK_MAPS: MapInfoJson[] = [BIG_GAME_HUNTERS_JSON, DESTINATION_JSON]

function lobbyId(suffix: string) {
  return makeSbLobbyId(`redesign-mock-lobby-${suffix}`)
}

const LOBBY_NAME = "tec27's basement"

// --- 1. gathering, partly full ---------------------------------------------------------------

const gatheringTeam1 = [human(tec27), human(twoPacalypse), human(dronebabo), createOpen('r')]
const gatheringTeam2 = [human(pachi), human(heyoka), createOpen('r'), createOpen('r')]

const GATHERING_LOBBY: Lobby = {
  id: lobbyId('gathering'),
  name: LOBBY_NAME,
  map: BIG_GAME_HUNTERS,
  gameType: GameType.TeamMelee,
  gameSubType: 2,
  teams: [team(0, 'Team 1', gatheringTeam1), team(1, 'Team 2', gatheringTeam2)],
  bench: [],
  host: gatheringTeam1[0],
  useLegacyLimits: false,
  visibility: 'listed',
}

const GATHERING_CHAT: MockChatLine[] = [
  { id: 'g1', userId: tec27.id, text: "alright, let's get a few more in here" },
  { id: 'g2', userId: twoPacalypse.id, text: 'gg last game btw, that was close' },
  { id: 'g3', userId: dronebabo.id, text: 'give me a sec, refilling water' },
]

// --- 2. full + 2 benched -----------------------------------------------------------------------

const fullTeam1 = [human(tec27), human(twoPacalypse), human(dronebabo), human(pachi)]
const fullTeam2 = [human(heyoka), human(legionnaire), human(boesthius), human(harem)]

const FULL_WITH_BENCH_LOBBY: Lobby = {
  id: lobbyId('full-bench'),
  name: LOBBY_NAME,
  map: BIG_GAME_HUNTERS,
  gameType: GameType.TeamMelee,
  gameSubType: 2,
  teams: [team(0, 'Team 1', fullTeam1), team(1, 'Team 2', fullTeam2)],
  bench: [onBench(flash, 90_000), onBench(bisu, 30_000)],
  host: fullTeam1[0],
  useLegacyLimits: false,
  visibility: 'listed',
}

const FULL_WITH_BENCH_CHAT: MockChatLine[] = [
  { id: 'f1', userId: harem.id, text: 'finally full!' },
  { id: 'f2', system: true, text: 'Flash joined the bench.' },
  { id: 'f3', system: true, text: 'Bisu joined the bench.' },
  { id: 'f4', userId: bisu.id, text: "guess I'm on deck, gl all" },
]

// --- 3. countdown --------------------------------------------------------------------------

const countdownTeam1 = [human(tec27), human(twoPacalypse), human(dronebabo), human(pachi)]
const countdownTeam2 = [human(heyoka), human(legionnaire), human(boesthius), human(harem)]

const COUNTDOWN_LOBBY: Lobby = {
  id: lobbyId('countdown'),
  name: LOBBY_NAME,
  map: BIG_GAME_HUNTERS,
  gameType: GameType.TeamMelee,
  gameSubType: 2,
  teams: [team(0, 'Team 1', countdownTeam1), team(1, 'Team 2', countdownTeam2)],
  bench: [onBench(jaedong, 15_000)],
  host: countdownTeam1[0],
  useLegacyLimits: false,
  visibility: 'listed',
}

const COUNTDOWN_CHAT: MockChatLine[] = [
  { id: 'cd1', system: true, text: 'tec27 started the countdown.' },
  { id: 'cd2', userId: jaedong.id, text: 'oh sweet, made it just in time to watch' },
]

// --- 4. in-game -----------------------------------------------------------------------------

const inGameTeam1 = [human(tec27), human(twoPacalypse), human(dronebabo), human(pachi)]
const inGameTeam2 = [human(heyoka), human(legionnaire), human(boesthius), human(harem)]

const IN_GAME_LOBBY: Lobby = {
  id: lobbyId('in-game'),
  name: LOBBY_NAME,
  map: BIG_GAME_HUNTERS,
  gameType: GameType.TeamMelee,
  gameSubType: 2,
  teams: [team(0, 'Team 1', inGameTeam1), team(1, 'Team 2', inGameTeam2)],
  bench: [onBench(stork, 40_000)],
  host: inGameTeam1[0],
  useLegacyLimits: false,
  visibility: 'listed',
}

const IN_GAME_RUN_STATE: LobbyRunStateJson = {
  gameId: 'redesign-mock-game-in-progress',
  // harem dropped out of the game early -- everyone else is still in.
  inGameUsers: [tec27, twoPacalypse, dronebabo, pachi, heyoka, legionnaire, boesthius].map(
    u => u.id,
  ),
  elapsedMs: 8 * 60_000 + 42_000,
}

const IN_GAME_CHAT: MockChatLine[] = [
  { id: 'ig1', system: true, text: 'harem left the match.' },
  { id: 'ig2', userId: harem.id, text: 'sorry guys, dc, hang tight' },
  { id: 'ig3', system: true, text: 'Stork joined the bench.' },
  { id: 'ig4', userId: stork.id, text: 'saw a slot open up, hopping in when it wraps' },
]

// --- 5. regroup -----------------------------------------------------------------------------

const regroupTeam1 = [human(tec27), human(twoPacalypse), human(dronebabo), human(pachi)]
const regroupTeam2 = [human(heyoka), human(legionnaire), human(boesthius), human(harem)]

const REGROUP_LOBBY: Lobby = {
  id: lobbyId('regroup'),
  name: LOBBY_NAME,
  map: BIG_GAME_HUNTERS,
  gameType: GameType.TeamMelee,
  gameSubType: 2,
  teams: [team(0, 'Team 1', regroupTeam1), team(1, 'Team 2', regroupTeam2)],
  bench: [],
  host: regroupTeam1[0],
  useLegacyLimits: false,
  visibility: 'listed',
}

const REGROUP_CHAT: MockChatLine[] = [
  { id: 'rg1', system: true, text: 'Game finished.' },
  { id: 'rg2', text: 'results', resultsCard: true },
  { id: 'rg3', userId: tec27.id, text: 'gg, run it back?' },
  { id: 'rg4', system: true, text: 'Replay available: Big Game Hunters - Team Melee.' },
]

// --- 6. settings changed + bench displacement ------------------------------------------------

const settingsTeam1 = [human(tec27), human(twoPacalypse), human(dronebabo)]
const settingsTeam2 = [human(heyoka), human(legionnaire), human(boesthius)]

const SETTINGS_CHANGED_LOBBY: Lobby = {
  id: lobbyId('settings-changed'),
  name: LOBBY_NAME,
  // The host shrank the map from the 8-player Big Game Hunters down to 6-player Destination,
  // which is one seat short of the previous 4v4 -- harem didn't fit and landed on the bench.
  map: DESTINATION,
  gameType: GameType.TeamMelee,
  gameSubType: 2,
  teams: [team(0, 'Team 1', settingsTeam1), team(1, 'Team 2', settingsTeam2)],
  bench: [onBench(harem, 5_000)],
  host: settingsTeam1[0],
  useLegacyLimits: false,
  visibility: 'listed',
}

const SETTINGS_CHANGED_CHAT: MockChatLine[] = [
  { id: 'sc1', system: true, text: 'tec27 changed the map to Destination.' },
  { id: 'sc2', system: true, text: 'harem moved to the bench.' },
  { id: 'sc3', userId: harem.id, text: 'aw, beaten by the map change, no worries' },
]

const SCENARIO_DATA: Record<RedesignScenario, ScenarioData> = {
  gathering: { lobby: GATHERING_LOBBY, chat: GATHERING_CHAT },
  fullWithBench: { lobby: FULL_WITH_BENCH_LOBBY, chat: FULL_WITH_BENCH_CHAT },
  countdown: { lobby: COUNTDOWN_LOBBY, chat: COUNTDOWN_CHAT, countdownTimer: 3 },
  inGame: { lobby: IN_GAME_LOBBY, runState: IN_GAME_RUN_STATE, chat: IN_GAME_CHAT },
  regroup: { lobby: REGROUP_LOBBY, chat: REGROUP_CHAT, seriesScore: [2, 1] },
  settingsChanged: {
    lobby: SETTINGS_CHANGED_LOBBY,
    chat: SETTINGS_CHANGED_CHAT,
    changedSettings: ['map'],
  },
}

/** Returns the full lifecycle snapshot for one of the spec's 6 required scenarios. */
export function getScenarioData(scenario: RedesignScenario): ScenarioData {
  return SCENARIO_DATA[scenario]
}

/**
 * Picks which lobby member the viewer-role control represents, so variant pages can derive a
 * "self" user without each re-implementing the same fallbacks. Falls back to the host whenever
 * the lobby doesn't actually have a member in the requested role (e.g. `benched` with an empty
 * bench).
 */
export function resolveViewerUserId(lobby: Lobby, viewer: ViewerRole): SbUserId {
  if (viewer === 'host') {
    return lobby.host.userId!
  }
  if (viewer === 'benched') {
    return lobby.bench[0]?.userId ?? lobby.host.userId!
  }

  const nonHostMember = getLobbySlots(lobby).find(
    slot => slot.type === SlotType.Human && slot.id !== lobby.host.id,
  )
  return nonHostMember?.userId ?? lobby.host.userId!
}
