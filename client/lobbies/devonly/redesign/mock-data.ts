import { GameType } from '../../../../common/games/game-type'
import { BenchedUser, Lobby, Team } from '../../../../common/lobbies'
import { LobbyRunStateJson } from '../../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../../common/lobbies/sb-lobby-id'
import {
  createClosed,
  createComputer,
  createHuman,
  createObserver,
  createOpen,
  Slot,
} from '../../../../common/lobbies/slot'
import { makeSbMapId, MapInfo, MapInfoJson, MapVisibility, Tileset } from '../../../../common/maps'
import { RaceChar } from '../../../../common/races'
import { SbUser } from '../../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../../common/users/sb-user-id'

/**
 * The lifecycle snapshots the in-lobby redesign page can render. These are points in one lobby's
 * evening rather than separate lobbies: `gathering` -> `launching` -> `inGame` -> `regroup` is a
 * continuous story, `fullWithBench` and `settingsChanged` branch off `gathering`, and
 * `navigatedAway` is the same lobby seen from elsewhere in the app.
 */
export type RedesignScenario =
  | 'gathering'
  | 'fullWithBench'
  | 'settingsChanged'
  | 'launching'
  | 'inGame'
  | 'regroup'
  | 'navigatedAway'

/** Whose perspective the page renders the lobby from. */
export type ViewerRole = 'host' | 'member' | 'benched'

/** The header's settings chips, named so a scenario can mark one of them as just-changed. */
export type SettingChipId = 'gameType' | 'turnRate' | 'observers'

export type MockChatLine =
  | { kind: 'text'; id: string; userId: SbUserId; time: string; text: string }
  /** A short notice about the room itself, rendered as a quiet indented line. */
  | { kind: 'system'; id: string; icon: string; text: string }
  /** A host settings change, rendered as an amber card. */
  | {
      kind: 'settingsChange'
      id: string
      icon: string
      userId: SbUserId
      setting: string
      change: string
      /** Whether the change reset everyone's ready state. */
      readyReset: boolean
    }
  /** An arrival, rendered as a card because joins are social events rather than list mutations. */
  | { kind: 'joinCard'; id: string; userId: SbUserId; text: string; detail: string }
  /** Where the finished game's result card lands in the log. */
  | { kind: 'victoryCard'; id: string }

/** The result of the game a `regroup` lobby just finished. */
export interface VictoryResult {
  winner: string
  duration: string
  roster: string
}

/** One finished game in the evening's series. */
export interface SeriesGame {
  label: string
  winner: string
  duration: string
}

/** The evening's running score between the two teams. */
export interface SeriesState {
  teamNames: [string, string]
  score: [number, number]
  games: SeriesGame[]
}

/** How far along a launching lobby's players are in loading the game. */
export interface LaunchState {
  secondsLeft: number
  loadedUserIds: SbUserId[]
}

/** Everything the page needs to render one lifecycle snapshot of the mock lobby. */
export interface ScenarioData {
  lobby: Lobby
  /** Which game of the evening this lobby is on. */
  gameNumber: number
  chat: MockChatLine[]
  /** Members who have readied up, while the lobby runs ready checks. */
  readyUserIds: SbUserId[]
  /** The turn rate the header chip reports. */
  turnRate: string
  /** Which settings chip the host just moved. */
  updatedChip?: SettingChipId
  runState?: LobbyRunStateJson
  launch?: LaunchState
  series?: SeriesState
  victory?: VictoryResult
  /** A bench member inheriting a seat as the lobby regroups. */
  promotion?: { userId: SbUserId; note: string }
  /** Series wins per player, shown beside the seats a regrouping lobby kept. */
  winsByUser?: ReadonlyMap<SbUserId, number>
  /** Candidates for the next game's map, voted on while a game runs. */
  mapVote?: Array<{ name: string; votes: number }>
}

// High enough that no dev-DB user ever collides with these ids -- a collision lets a background
// `@users/loadUsers` fetch for the real user overwrite these mock names out from under us.
const tec27: SbUser = { id: makeSbUserId(90001), name: 'tec27', created: 0 }
const pachi: SbUser = { id: makeSbUserId(90002), name: 'Pachi', created: 0 }
const dronebro: SbUser = { id: makeSbUserId(90003), name: 'dronebro', created: 0 }
const sunn0: SbUser = { id: makeSbUserId(90004), name: 'sunn0', created: 0 }
const heartcutter: SbUser = { id: makeSbUserId(90005), name: 'Heartcutter', created: 0 }
const nerdRage: SbUser = { id: makeSbUserId(90006), name: 'NerdRage', created: 0 }
const blueSky: SbUser = { id: makeSbUserId(90007), name: 'blueSky', created: 0 }
const heyoka: SbUser = { id: makeSbUserId(90008), name: 'Heyoka', created: 0 }
const legionnaire: SbUser = { id: makeSbUserId(90009), name: 'Legionnaire', created: 0 }
const stork: SbUser = { id: makeSbUserId(90010), name: 'Stork', created: 0 }

/** Every user any scenario references, for seeding the redux users store. */
export const ALL_MOCK_USERS: SbUser[] = [
  tec27,
  pachi,
  dronebro,
  sunn0,
  heartcutter,
  nerdRage,
  blueSky,
  heyoka,
  legionnaire,
  stork,
]

const RACE_BY_USER: ReadonlyMap<SbUserId, RaceChar> = new Map([
  [tec27.id, 't'],
  [pachi.id, 'z'],
  [dronebro.id, 'p'],
  [sunn0.id, 'r'],
  [heartcutter.id, 'r'],
  [blueSky.id, 'z'],
  [heyoka.id, 't'],
  [legionnaire.id, 'p'],
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

function observerTeam(teamId: number, slots: Slot[]): Team {
  return { teamId, name: 'Observers', isObserver: true, slots, hiddenSlots: [] }
}

// The mock maps carry the shared testing map's imagery so the rail's map card renders a real
// minimap; everything else about them (name, size, tileset, slot count) is their own.
const MAP_IMAGE_HASH = '0924d3cbab0061cdbcc1dc2e20586cf514df8c5391126dae71a280616afdc03c'
const MAP_IMAGE_URLS = {
  image256Url: `https://staging-cdn.shieldbattery.net/map_images/09/24/${MAP_IMAGE_HASH}-256.jpg`,
  image512Url: `https://staging-cdn.shieldbattery.net/map_images/09/24/${MAP_IMAGE_HASH}-512.jpg`,
  image1024Url: `https://staging-cdn.shieldbattery.net/map_images/09/24/${MAP_IMAGE_HASH}-1024.jpg`,
  image2048Url: `https://staging-cdn.shieldbattery.net/map_images/09/24/${MAP_IMAGE_HASH}-2048.jpg`,
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
    description: `A ${slotCount}-player map used by the in-lobby redesign exploration.`,
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
    ...MAP_IMAGE_URLS,
  }
}

function toMapInfo(json: MapInfoJson): MapInfo {
  return { ...json, uploadDate: new Date(json.uploadDate) }
}

const BIG_GAME_HUNTERS_JSON = makeMockMapJson('bgh', 'Big Game Hunters', Tileset.Jungle, 8)
const FIGHTING_SPIRIT_JSON = makeMockMapJson('fs', 'Fighting Spirit', Tileset.Jungle, 4)

const BIG_GAME_HUNTERS = toMapInfo(BIG_GAME_HUNTERS_JSON)

/**
 * The wire form of every mock map, meant to be dispatched into the redux maps store
 * (`@maps/loadMapInfos`) so `ReduxMapThumbnail` and friends can resolve them by id.
 */
export const ALL_MOCK_MAPS: MapInfoJson[] = [BIG_GAME_HUNTERS_JSON, FIGHTING_SPIRIT_JSON]

const LOBBY_NAME = 'BGH no-rush 20'

function lobbyId(suffix: string) {
  return makeSbLobbyId(`redesign-mock-lobby-${suffix}`)
}

function makeLobby(suffix: string, teams: Team[], bench: BenchedUser[], gameSubType = 4): Lobby {
  return {
    id: lobbyId(suffix),
    name: LOBBY_NAME,
    map: BIG_GAME_HUNTERS,
    gameType: GameType.TopVsBottom,
    gameSubType,
    teams,
    bench,
    host: teams[0].slots[0],
    useLegacyLimits: false,
    visibility: 'listed',
  }
}

// --- gathering ---------------------------------------------------------------------------------

const gatheringTop = [human(tec27), human(pachi), createOpen('r'), createComputer('p')]
const gatheringBottom = [human(dronebro), human(heartcutter), human(sunn0), createClosed('r')]
const gatheringObservers = [createObserver(nerdRage.id)]

const GATHERING_LOBBY = makeLobby(
  'gathering',
  [
    team(0, 'Top', gatheringTop),
    team(1, 'Bottom', gatheringBottom),
    observerTeam(2, gatheringObservers),
  ],
  [onBench(blueSky, 4 * 60_000)],
)

const GATHERING_CHAT: MockChatLine[] = [
  {
    kind: 'text',
    id: 'g1',
    userId: pachi.id,
    time: '21:02',
    text: "who's bringing the 4th, we need one more for teams",
  },
  {
    kind: 'text',
    id: 'g2',
    userId: dronebro.id,
    time: '21:03',
    text: "invited sunn0, he's installing the patch",
  },
  {
    kind: 'settingsChange',
    id: 'g3',
    icon: 'map',
    userId: tec27.id,
    setting: 'map',
    change: 'Fighting Spirit → Big Game Hunters',
    readyReset: true,
  },
  {
    kind: 'joinCard',
    id: 'g4',
    userId: sunn0.id,
    text: 'sunn0 joined via invite link',
    detail: 'seated on Team 1 · Bottom',
  },
  { kind: 'system', id: 'g5', icon: 'visibility', text: 'NerdRage is now watching' },
  {
    kind: 'text',
    id: 'g6',
    userId: sunn0.id,
    time: '21:05',
    text: 'yo. one game then I gotta sleep',
  },
  { kind: 'system', id: 'g7', icon: 'swap_vert', text: 'dronebro moved to Team 2, slot 2' },
  {
    kind: 'text',
    id: 'g8',
    userId: pachi.id,
    time: '21:06',
    text: '"one game" — famous last words',
  },
]

// --- full, with people waiting for a seat ------------------------------------------------------

const fullTop = [human(tec27), human(pachi), human(heyoka), createComputer('p')]
const fullBottom = [human(dronebro), human(heartcutter), human(sunn0), human(legionnaire)]

const FULL_WITH_BENCH_LOBBY = makeLobby(
  'full-bench',
  [
    team(0, 'Top', fullTop),
    team(1, 'Bottom', fullBottom),
    observerTeam(2, [createObserver(nerdRage.id)]),
  ],
  [onBench(blueSky, 6 * 60_000), onBench(stork, 40_000)],
)

const FULL_WITH_BENCH_CHAT: MockChatLine[] = [
  {
    kind: 'joinCard',
    id: 'f1',
    userId: blueSky.id,
    text: 'blueSky joined via invite link',
    detail: 'slots were full — first in line for a seat',
  },
  {
    kind: 'text',
    id: 'f2',
    userId: heartcutter.id,
    time: '21:14',
    text: "that's a full house, nobody leave",
  },
  { kind: 'system', id: 'f3', icon: 'arrow_forward', text: 'Stork joined the lobby' },
  {
    kind: 'text',
    id: 'f4',
    userId: stork.id,
    time: '21:15',
    text: "I'll take whatever opens up, no rush",
  },
]

// --- the host just changed a setting -----------------------------------------------------------

const settingsTop = [human(tec27), human(pachi), createOpen('r'), createComputer('p')]
const settingsBottom = [human(dronebro), human(heartcutter), human(sunn0), createClosed('r')]

const SETTINGS_CHANGED_LOBBY = makeLobby(
  'settings-changed',
  [
    team(0, 'Top', settingsTop),
    team(1, 'Bottom', settingsBottom),
    observerTeam(2, [createObserver(nerdRage.id)]),
  ],
  [onBench(blueSky, 4 * 60_000)],
)

const SETTINGS_CHANGED_CHAT: MockChatLine[] = [
  ...GATHERING_CHAT,
  {
    kind: 'settingsChange',
    id: 'sc1',
    icon: 'tune',
    userId: tec27.id,
    setting: 'turn rate',
    change: 'Auto → 12',
    readyReset: true,
  },
  {
    kind: 'text',
    id: 'sc2',
    userId: dronebro.id,
    time: '21:07',
    text: '12 is fine, my wifi is not',
  },
]

// --- launching -----------------------------------------------------------------------------

const LAUNCHING_LOBBY = makeLobby(
  'launching',
  [
    team(0, 'Top', gatheringTop),
    team(1, 'Bottom', gatheringBottom),
    observerTeam(2, gatheringObservers),
  ],
  [onBench(blueSky, 5 * 60_000)],
)

const LAUNCHING_CHAT: MockChatLine[] = [
  ...GATHERING_CHAT,
  { kind: 'system', id: 'l1', icon: 'rocket_launch', text: 'tec27 started the game' },
]

// --- in game -------------------------------------------------------------------------------

const IN_GAME_LOBBY = makeLobby(
  'in-game',
  [
    team(0, 'Top', gatheringTop),
    team(1, 'Bottom', gatheringBottom),
    observerTeam(2, gatheringObservers),
  ],
  [onBench(blueSky, 12 * 60_000), onBench(stork, 2 * 60_000)],
)

const IN_GAME_RUN_STATE: LobbyRunStateJson = {
  gameId: 'redesign-mock-game-in-progress',
  inGameUsers: [tec27.id, pachi.id, dronebro.id, heartcutter.id, sunn0.id, nerdRage.id],
  elapsedMs: 31 * 60_000 + 2_000,
}

const IN_GAME_CHAT: MockChatLine[] = [
  {
    kind: 'text',
    id: 'ig1',
    userId: blueSky.id,
    time: '21:36',
    text: 'they\'re 30 min into a "no rush 20"',
  },
  {
    kind: 'text',
    id: 'ig2',
    userId: stork.id,
    time: '21:37',
    text: 'classic. want to queue up island maps for the next one?',
  },
]

// --- regroup -------------------------------------------------------------------------------

const regroupTop = [human(tec27), human(pachi), human(blueSky)]
const regroupBottom = [human(dronebro), human(heartcutter), createOpen('r')]

const REGROUP_LOBBY = makeLobby(
  'regroup',
  [
    team(0, 'Top', regroupTop),
    team(1, 'Bottom', regroupBottom),
    observerTeam(2, [createObserver(nerdRage.id)]),
  ],
  [],
  3,
)

const REGROUP_CHAT: MockChatLine[] = [
  { kind: 'system', id: 'r1', icon: 'flag', text: "Game 3 ended — everyone's back in the lobby" },
  { kind: 'victoryCard', id: 'r2' },
  {
    kind: 'text',
    id: 'r3',
    userId: dronebro.id,
    time: '21:52',
    text: 'gg wp. that recall was criminal',
  },
  {
    kind: 'text',
    id: 'r4',
    userId: pachi.id,
    time: '21:52',
    text: 'one more, loser buys the server a coffee',
  },
  {
    kind: 'system',
    id: 'r5',
    icon: 'arrow_back',
    text: 'sunn0 left the lobby · blueSky is next up for a seat',
  },
]

const REGROUP_SERIES: SeriesState = {
  teamNames: ['Team 1', 'Team 2'],
  score: [2, 1],
  games: [
    { label: 'G1', winner: 'T1', duration: '18:22' },
    { label: 'G2', winner: 'T2', duration: '31:07' },
    { label: 'G3', winner: 'T1', duration: '23:41' },
  ],
}

const REGROUP_WINS: ReadonlyMap<SbUserId, number> = new Map([
  [tec27.id, 2],
  [pachi.id, 2],
  [dronebro.id, 1],
  [heartcutter.id, 1],
])

const SCENARIO_DATA: Record<RedesignScenario, ScenarioData> = {
  gathering: {
    lobby: GATHERING_LOBBY,
    gameNumber: 1,
    chat: GATHERING_CHAT,
    readyUserIds: [tec27.id, pachi.id, heartcutter.id, nerdRage.id],
    turnRate: '12',
  },
  fullWithBench: {
    lobby: FULL_WITH_BENCH_LOBBY,
    gameNumber: 1,
    chat: FULL_WITH_BENCH_CHAT,
    readyUserIds: [tec27.id, pachi.id, heartcutter.id, heyoka.id, nerdRage.id],
    turnRate: '12',
  },
  settingsChanged: {
    lobby: SETTINGS_CHANGED_LOBBY,
    gameNumber: 1,
    chat: SETTINGS_CHANGED_CHAT,
    // The turn rate change reset everyone's ready state.
    readyUserIds: [],
    turnRate: '12',
    updatedChip: 'turnRate',
  },
  launching: {
    lobby: LAUNCHING_LOBBY,
    gameNumber: 4,
    chat: LAUNCHING_CHAT,
    readyUserIds: [tec27.id, pachi.id, dronebro.id, heartcutter.id, sunn0.id, nerdRage.id],
    turnRate: '12',
    launch: {
      secondsLeft: 12,
      loadedUserIds: [tec27.id, pachi.id, sunn0.id, nerdRage.id],
    },
  },
  inGame: {
    lobby: IN_GAME_LOBBY,
    gameNumber: 4,
    chat: IN_GAME_CHAT,
    readyUserIds: [],
    turnRate: '12',
    runState: IN_GAME_RUN_STATE,
    mapVote: [
      { name: 'Fighting Spirit', votes: 2 },
      { name: 'Polypoid', votes: 0 },
    ],
  },
  regroup: {
    lobby: REGROUP_LOBBY,
    gameNumber: 4,
    chat: REGROUP_CHAT,
    readyUserIds: [],
    turnRate: '12',
    series: REGROUP_SERIES,
    victory: {
      winner: 'Team 1',
      duration: '23:41',
      roster: 'tec27, Pachi, sunn0',
    },
    promotion: { userId: blueSky.id, note: "gets sunn0's seat — he left" },
    winsByUser: REGROUP_WINS,
  },
  navigatedAway: {
    lobby: GATHERING_LOBBY,
    gameNumber: 1,
    chat: GATHERING_CHAT,
    readyUserIds: [tec27.id, pachi.id, heartcutter.id, nerdRage.id],
    turnRate: '12',
  },
}

/** Returns the full lifecycle snapshot for one of the page's scenarios. */
export function getScenarioData(scenario: RedesignScenario): ScenarioData {
  return SCENARIO_DATA[scenario]
}
