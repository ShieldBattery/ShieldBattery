import styled from 'styled-components'
import { GameConfigPlayer, GameSource, LobbyGameConfig } from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import { GameRecordJson } from '../../../common/games/games'
import { LadderPlayer } from '../../../common/ladder/ladder'
import { LobbySummaryResponse } from '../../../common/lobbies/lobby-network'
import { makeSbMapId, MapInfoJson, MapVisibility, Tileset } from '../../../common/maps'
import {
  makeSeasonId,
  MatchmakingDivision,
  MatchmakingSeasonJson,
  MatchmakingType,
} from '../../../common/matchmaking'
import { RaceChar, RaceStats } from '../../../common/races'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { UserProfileJson } from '../../../common/users/user-network'
import { ReduxAction } from '../../action-types'
import { GameLinkCardContent, GameLinkLoadState } from '../../games/game-link-card'
import { IsolatedReduxProvider } from '../../lobbies/devonly/isolated-redux'
import {
  MOCK_LOBBY_SUMMARY,
  MOCK_LOBBY_SUMMARY_IN_GAME,
} from '../../lobbies/devonly/lobby-landing-test'
import {
  LobbyInviteCardContent,
  LobbyInviteDisplayData,
  LobbyInviteJoinedCard,
} from '../../lobbies/lobby-invite-card'
import { LobbySummaryLoadState } from '../../lobbies/lobby-summary'
import { makeServerUrl } from '../../network/server-url'
import { useAppSelector } from '../../redux-hooks'
import { labelLarge, titleLarge } from '../../styles/typography'
import { UserCardContent, UserCardState } from '../../users/user-card'

/** Map images served by a local dev server that has these maps uploaded. */
function devMapImages(hash: string) {
  const base = `/files/map_images/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`
  return {
    image256Url: makeServerUrl(`${base}-256.jpg?v=1`),
    image512Url: makeServerUrl(`${base}-512.jpg?v=1`),
  }
}

const ECLIPSE_HASH = 'a34a9fb5056ed95c219d6bf7fbc341f9f078eccacd67eeff5112669c7695761c'
const BGH_HASH = 'ec813eb402398295529f92e99d6c27ea85c59d21ff843879a7d6635806adadca'

// ---------------------------------------------------------------------------
// Lobby invite card
// ---------------------------------------------------------------------------

const ECLIPSE_LOBBY_IMAGES = devMapImages(ECLIPSE_HASH)
const BGH_LOBBY_IMAGES = devMapImages(BGH_HASH)

const LONG_NAME_HOST: SbUser = {
  id: makeSbUserId(2),
  name: 'AnExtremelyLongHostName',
  created: 0,
}

function withSummary(
  base: LobbySummaryResponse,
  summary: Partial<LobbySummaryResponse['summary']>,
  host = base.host,
): LobbySummaryResponse {
  return { ...base, host, summary: { ...base.summary, ...summary } }
}

const LOBBY_LOADED = withSummary(MOCK_LOBBY_SUMMARY, {
  map: { ...MOCK_LOBBY_SUMMARY.summary.map, name: 'Eclipse 1.2', ...ECLIPSE_LOBBY_IMAGES },
})
const LOBBY_IN_GAME = withSummary(MOCK_LOBBY_SUMMARY_IN_GAME, {
  map: LOBBY_LOADED.summary.map,
  playerSlots: { taken: 4, total: 4, open: 0 },
})
const LOBBY_STARTING = withSummary(LOBBY_LOADED, {
  lifecycle: 'countingDown',
  playerSlots: { taken: 2, total: 2, open: 0 },
})
const LOBBY_LONG_NAME = withSummary(
  LOBBY_LOADED,
  { name: 'Casual 2v2 anyone welcome, no rush, all skill levels, bring your friends pls' },
  LONG_NAME_HOST,
)
const LOBBY_LONG_MAP_NAME = withSummary(LOBBY_LOADED, {
  map: {
    ...LOBBY_LOADED.summary.map,
    name: '| iCCup | Heartbreak Ridge 2.1 (Remastered Tournament Edition) by a very long author',
  },
  gameType: GameType.TopVsBottom,
})
const LOBBY_NEARLY_FULL = withSummary(LOBBY_LOADED, {
  name: 'BGH FFA',
  map: { ...LOBBY_LOADED.summary.map, name: 'Big Game Hunters', ...BGH_LOBBY_IMAGES },
  gameType: GameType.FreeForAll,
  playerSlots: { taken: 7, total: 8, open: 1 },
})
const LOBBY_WITH_CLOSED = withSummary(LOBBY_LOADED, {
  name: '1v1 me',
  playerSlots: { taken: 1, total: 4, open: 1 },
  gameType: GameType.OneVsOne,
})

const LOBBY_JOINED_DISPLAY: LobbyInviteDisplayData = {
  id: LOBBY_LOADED.summary.id,
  name: LOBBY_LOADED.summary.name,
  map: LOBBY_LOADED.summary.map,
  gameType: LOBBY_LOADED.summary.gameType,
  hostId: LOBBY_LOADED.host.id,
  playerSlots: { taken: 2, total: 4, open: 2 },
  lifecycle: 'gathering',
}

type LobbyScenario =
  | { label: string; state: LobbySummaryLoadState | undefined }
  | { label: string; joined: LobbyInviteDisplayData }

const LOBBY_SCENARIOS: LobbyScenario[] = [
  { label: 'Loading', state: undefined },
  { label: 'Loaded', state: { status: 'loaded', data: LOBBY_LOADED } },
  { label: 'In game', state: { status: 'loaded', data: LOBBY_IN_GAME } },
  { label: 'Starting game', state: { status: 'loaded', data: LOBBY_STARTING } },
  { label: 'Long lobby + host name', state: { status: 'loaded', data: LOBBY_LONG_NAME } },
  { label: 'Long map name', state: { status: 'loaded', data: LOBBY_LONG_MAP_NAME } },
  { label: 'Nearly full (8 slots)', state: { status: 'loaded', data: LOBBY_NEARLY_FULL } },
  { label: 'Closed seats (1 of 4 open)', state: { status: 'loaded', data: LOBBY_WITH_CLOSED } },
  { label: 'Not found', state: { status: 'notFound' } },
  { label: 'Error (renders nothing)', state: { status: 'error' } },
  { label: 'Joined (own lobby)', joined: LOBBY_JOINED_DISPLAY },
  { label: 'Joined, in game', joined: { ...LOBBY_JOINED_DISPLAY, lifecycle: 'inGame' } },
]

function LobbyRow({ scenario }: { scenario: LobbyScenario }) {
  return (
    <Cell>
      <RowLabel>{scenario.label}</RowLabel>
      {'joined' in scenario ? (
        <LobbyInviteJoinedCard display={scenario.joined} onClick={() => {}} />
      ) : (
        <div>
          <LobbyInviteCardContent
            state={scenario.state}
            onClick={() => {}}
            onJoinClick={() => {}}
          />
        </div>
      )}
    </Cell>
  )
}

// ---------------------------------------------------------------------------
// Game link card
// ---------------------------------------------------------------------------

function makeMapInfo(hash: string, name: string): MapInfoJson {
  return {
    id: makeSbMapId(hash),
    hash,
    name,
    description: '',
    uploadedBy: makeSbUserId(1),
    uploadDate: Date.now(),
    visibility: MapVisibility.Public,
    mapData: {
      format: 'scx',
      tileset: Tileset.Jungle,
      originalName: name,
      originalDescription: '',
      slots: 8,
      umsSlots: 0,
      umsForces: [],
      width: 128,
      height: 128,
      isEud: false,
      parserVersion: 1,
    },
    imageVersion: 1,
    ...devMapImages(hash),
  }
}

const ECLIPSE_MAP = makeMapInfo(ECLIPSE_HASH, 'Eclipse 1.2')
const BGH_MAP = makeMapInfo(BGH_HASH, 'Big Game Hunters')

function player(id: SbUserId, race: RaceChar, isComputer = false): GameConfigPlayer {
  return { id, race, isComputer }
}

function makeGame(
  fields: Pick<GameRecordJson, 'id' | 'config' | 'mapId'> &
    Partial<Omit<GameRecordJson, 'id' | 'config' | 'mapId'>>,
): GameRecordJson {
  return {
    startTime: Date.now() - 1000 * 60 * 30,
    disputable: false,
    disputeRequested: false,
    disputeReviewed: false,
    gameLength: 754_000,
    results: null,
    selectedMatchup: null,
    assignedMatchup: null,
    manuallyResolved: false,
    ...fields,
  }
}

const R1V1_TEC27 = makeSbUserId(940_001)
const R1V1_BISU = makeSbUserId(940_002)

const RANKED_1V1_GAME = makeGame({
  id: 'game-ranked-1v1',
  mapId: ECLIPSE_MAP.id,
  config: {
    gameSource: GameSource.Matchmaking,
    gameSourceExtra: { type: MatchmakingType.Match1v1 },
    gameType: GameType.OneVsOne,
    gameSubType: 0,
    teams: [[player(R1V1_TEC27, 'p')], [player(R1V1_BISU, 'z')]],
  },
  results: [
    [R1V1_TEC27, { result: 'win', race: 'p', apm: 320 }],
    [R1V1_BISU, { result: 'loss', race: 'z', apm: 280 }],
  ],
})
const RANKED_1V1_DIVISIONS = new Map<SbUserId, MatchmakingDivision>([
  [R1V1_TEC27, MatchmakingDivision.Diamond2],
  [R1V1_BISU, MatchmakingDivision.Champion],
])

const R2V2_FLASH = makeSbUserId(940_011)
const R2V2_LIGHT = makeSbUserId(940_012)
const R2V2_JAEDONG = makeSbUserId(940_013)
const R2V2_STORK = makeSbUserId(940_014)

const RANKED_2V2_GAME = makeGame({
  id: 'game-ranked-2v2',
  mapId: BGH_MAP.id,
  config: {
    gameSource: GameSource.Matchmaking,
    gameSourceExtra: {
      type: MatchmakingType.Match2v2,
      parties: [
        [R2V2_FLASH, R2V2_LIGHT],
        [R2V2_JAEDONG, R2V2_STORK],
      ],
    },
    gameType: GameType.TopVsBottom,
    gameSubType: 0,
    teams: [
      [player(R2V2_FLASH, 't'), player(R2V2_LIGHT, 'p')],
      [player(R2V2_JAEDONG, 'z'), player(R2V2_STORK, 't')],
    ],
  },
  results: [
    [R2V2_FLASH, { result: 'win', race: 't', apm: 410 }],
    [R2V2_LIGHT, { result: 'win', race: 'p', apm: 250 }],
    [R2V2_JAEDONG, { result: 'loss', race: 'z', apm: 390 }],
    [R2V2_STORK, { result: 'loss', race: 't', apm: 300 }],
  ],
})

const LOBBY4V4_A1 = makeSbUserId(940_021)
const LOBBY4V4_A2 = makeSbUserId(940_022)
const LOBBY4V4_A3 = makeSbUserId(940_023)
const LOBBY4V4_A4 = makeSbUserId(940_024)
const LOBBY4V4_B1 = makeSbUserId(940_025)
const LOBBY4V4_B2 = makeSbUserId(940_026)
const LOBBY4V4_B3 = makeSbUserId(940_027)
const LOBBY4V4_B4 = makeSbUserId(940_028)

const CUSTOM_4V4_CONFIG: LobbyGameConfig = {
  gameSource: GameSource.Lobby,
  gameType: GameType.TopVsBottom,
  gameSubType: 2,
  teams: [
    [
      player(LOBBY4V4_A1, 't'),
      player(LOBBY4V4_A2, 'p'),
      player(LOBBY4V4_A3, 'z'),
      player(LOBBY4V4_A4, 't'),
    ],
    [
      player(LOBBY4V4_B1, 'p'),
      player(LOBBY4V4_B2, 't'),
      player(LOBBY4V4_B3, 'z'),
      player(LOBBY4V4_B4, 'p'),
    ],
  ],
}
const CUSTOM_4V4_GAME = makeGame({
  id: 'game-custom-4v4',
  mapId: ECLIPSE_MAP.id,
  config: CUSTOM_4V4_CONFIG,
  results: [
    [LOBBY4V4_A1, { result: 'win', race: 't', apm: 200 }],
    [LOBBY4V4_A2, { result: 'win', race: 'p', apm: 180 }],
    [LOBBY4V4_A3, { result: 'win', race: 'z', apm: 220 }],
    [LOBBY4V4_A4, { result: 'win', race: 't', apm: 190 }],
    [LOBBY4V4_B1, { result: 'loss', race: 'p', apm: 210 }],
    [LOBBY4V4_B2, { result: 'loss', race: 't', apm: 170 }],
    [LOBBY4V4_B3, { result: 'loss', race: 'z', apm: 230 }],
    [LOBBY4V4_B4, { result: 'loss', race: 'p', apm: 160 }],
  ],
})

const CUSTOM_6V2_GAME = makeGame({
  id: 'game-custom-6v2',
  mapId: BGH_MAP.id,
  config: {
    ...CUSTOM_4V4_CONFIG,
    gameSubType: 6,
    teams: [
      [...CUSTOM_4V4_CONFIG.teams[0], ...CUSTOM_4V4_CONFIG.teams[1].slice(0, 2)],
      CUSTOM_4V4_CONFIG.teams[1].slice(2),
    ],
  },
  results: CUSTOM_4V4_GAME.results,
})

const FFA_1 = makeSbUserId(940_031)
const FFA_2 = makeSbUserId(940_032)
const FFA_3 = makeSbUserId(940_033)
const FFA_4 = makeSbUserId(940_034)
const FFA_5 = makeSbUserId(940_035)

const FFA_GAME = makeGame({
  id: 'game-ffa',
  mapId: BGH_MAP.id,
  config: {
    gameSource: GameSource.Lobby,
    gameType: GameType.FreeForAll,
    gameSubType: 0,
    teams: [
      [
        player(FFA_1, 'z'),
        player(FFA_2, 't'),
        player(FFA_3, 'p'),
        player(FFA_4, 'z'),
        player(FFA_5, 't'),
      ],
    ],
  },
  results: [
    [FFA_1, { result: 'win', race: 'z', apm: 240 }],
    [FFA_2, { result: 'loss', race: 't', apm: 200 }],
    [FFA_3, { result: 'loss', race: 'p', apm: 260 }],
    [FFA_4, { result: 'loss', race: 'z', apm: 180 }],
    [FFA_5, { result: 'loss', race: 't', apm: 150 }],
  ],
})

const NO_RESULTS_SOULKEY = makeSbUserId(940_041)
const NO_RESULTS_SHARP = makeSbUserId(940_042)

const NO_RESULTS_GAME = makeGame({
  id: 'game-no-results',
  mapId: ECLIPSE_MAP.id,
  config: {
    gameSource: GameSource.Lobby,
    gameType: GameType.OneVsOne,
    gameSubType: 0,
    teams: [[player(NO_RESULTS_SOULKEY, 'z')], [player(NO_RESULTS_SHARP, 'p')]],
  },
  gameLength: 512_000,
  results: null,
})

const COMPUTER_SHUTTLE = makeSbUserId(940_051)
const COMPUTER_AI = makeSbUserId(940_999)

const COMPUTER_GAME = makeGame({
  id: 'game-computer',
  mapId: BGH_MAP.id,
  config: {
    gameSource: GameSource.Lobby,
    gameType: GameType.OneVsOne,
    gameSubType: 0,
    teams: [[player(COMPUTER_SHUTTLE, 'p')], [player(COMPUTER_AI, 'z', true)]],
  },
  results: [[COMPUTER_SHUTTLE, { result: 'win', race: 'p', apm: 275 }]],
})

const LONG_NAME_A = makeSbUserId(940_061)
const LONG_NAME_B = makeSbUserId(940_062)

const LONG_NAMES_GAME = makeGame({
  id: 'game-long-names',
  mapId: ECLIPSE_MAP.id,
  config: {
    gameSource: GameSource.Lobby,
    gameType: GameType.OneVsOne,
    gameSubType: 0,
    teams: [[player(LONG_NAME_A, 't')], [player(LONG_NAME_B, 'z')]],
  },
  results: [
    [LONG_NAME_A, { result: 'win', race: 't', apm: 300 }],
    [LONG_NAME_B, { result: 'loss', race: 'z', apm: 260 }],
  ],
})

const GAME_USERS: SbUser[] = [
  { id: R1V1_TEC27, name: 'tec27', created: 0 },
  { id: R1V1_BISU, name: 'Bisu', created: 0 },
  { id: R2V2_FLASH, name: 'Flash', created: 0 },
  { id: R2V2_LIGHT, name: 'Light', created: 0 },
  { id: R2V2_JAEDONG, name: 'Jaedong', created: 0 },
  { id: R2V2_STORK, name: 'Stork', created: 0 },
  { id: LOBBY4V4_A1, name: 'Zileas', created: 0 },
  { id: LOBBY4V4_A2, name: 'Grrrl', created: 0 },
  { id: LOBBY4V4_A3, name: 'iloveoov', created: 0 },
  { id: LOBBY4V4_A4, name: 'NaDa', created: 0 },
  { id: LOBBY4V4_B1, name: 'sSak', created: 0 },
  { id: LOBBY4V4_B2, name: 'FanTaSy', created: 0 },
  { id: LOBBY4V4_B3, name: 'Nal_rA', created: 0 },
  { id: LOBBY4V4_B4, name: 'YellOw', created: 0 },
  { id: FFA_1, name: 'Larva', created: 0 },
  { id: FFA_2, name: 'Movie', created: 0 },
  { id: FFA_3, name: 'Snow', created: 0 },
  { id: FFA_4, name: 'Hero', created: 0 },
  { id: FFA_5, name: 'Mini', created: 0 },
  { id: NO_RESULTS_SOULKEY, name: 'Soulkey', created: 0 },
  { id: NO_RESULTS_SHARP, name: 'Sharp', created: 0 },
  { id: COMPUTER_SHUTTLE, name: 'Shuttle', created: 0 },
  { id: LONG_NAME_A, name: 'AnExtremelyLongProNicknameHere', created: 0 },
  { id: LONG_NAME_B, name: 'AnotherRidiculouslyLongNickname', created: 0 },
]

interface GameScenario {
  label: string
  state: GameLinkLoadState | undefined
}

const GAME_SCENARIOS: GameScenario[] = [
  { label: 'Loading', state: undefined },
  {
    label: 'Ranked 1v1 (divisions)',
    state: {
      status: 'loaded',
      game: RANKED_1V1_GAME,
      map: ECLIPSE_MAP,
      divisionById: RANKED_1V1_DIVISIONS,
    },
  },
  {
    label: 'Ranked 2v2 (divisions unknown)',
    state: { status: 'loaded', game: RANKED_2V2_GAME, map: BGH_MAP, divisionById: undefined },
  },
  {
    label: 'Custom lobby 4v4',
    state: { status: 'loaded', game: CUSTOM_4V4_GAME, map: ECLIPSE_MAP, divisionById: undefined },
  },
  {
    label: 'Custom lobby 6v2 (collapsed side)',
    state: { status: 'loaded', game: CUSTOM_6V2_GAME, map: BGH_MAP, divisionById: undefined },
  },
  {
    label: 'Free for all',
    state: { status: 'loaded', game: FFA_GAME, map: BGH_MAP, divisionById: undefined },
  },
  {
    label: 'No recorded results',
    state: { status: 'loaded', game: NO_RESULTS_GAME, map: ECLIPSE_MAP, divisionById: undefined },
  },
  {
    label: 'Computer player',
    state: { status: 'loaded', game: COMPUTER_GAME, map: BGH_MAP, divisionById: undefined },
  },
  {
    label: 'Long player names',
    state: {
      status: 'loaded',
      game: LONG_NAMES_GAME,
      map: ECLIPSE_MAP,
      divisionById: undefined,
    },
  },
  { label: 'Not found', state: { status: 'notFound' } },
  { label: 'Error (renders nothing)', state: { status: 'error' } },
]

function GameRow({ scenario }: { scenario: GameScenario }) {
  return (
    <Cell>
      <RowLabel>{scenario.label}</RowLabel>
      <div>
        <GameLinkCardContent state={scenario.state} onClick={() => {}} />
      </div>
    </Cell>
  )
}

// ---------------------------------------------------------------------------
// User card
// ---------------------------------------------------------------------------

const UC_TEC27 = makeSbUserId(900_001)
const UC_LONG_NAME = makeSbUserId(900_002)
const UC_NEWCOMER = makeSbUserId(900_003)

const USER_CARD_USERS: SbUser[] = [
  { id: UC_TEC27, name: 'tec27', created: Date.now() - 1000 * 60 * 60 * 24 * 365 * 6 },
  { id: UC_LONG_NAME, name: 'LurkerWithALongN', created: Date.now() - 1000 * 60 * 60 * 24 * 200 },
  { id: UC_NEWCOMER, name: 'Newcomer', created: Date.now() - 1000 * 60 * 60 * 5 },
]

const UC_SEASON: MatchmakingSeasonJson = {
  id: makeSeasonId(1),
  name: 'Beta Season 3',
  startDate: Date.now() - 1000 * 60 * 60 * 24 * 14,
  resetMmr: true,
}

const NO_RACE_STATS: RaceStats = {
  pWins: 0,
  pLosses: 0,
  tWins: 0,
  tLosses: 0,
  zWins: 0,
  zLosses: 0,
  rWins: 0,
  rLosses: 0,
  rPWins: 0,
  rPLosses: 0,
  rTWins: 0,
  rTLosses: 0,
  rZWins: 0,
  rZLosses: 0,
}

function makeLadderPlayer(
  matchmakingType: MatchmakingType,
  points: number,
  wins: number,
  losses: number,
  /** The race these games were all played as, if any. */
  race?: RaceChar,
): LadderPlayer {
  return {
    ...NO_RACE_STATS,
    ...(race ? { [`${race}Wins`]: wins, [`${race}Losses`]: losses } : {}),
    rank: 12,
    userId: UC_TEC27,
    matchmakingType,
    seasonId: UC_SEASON.id,
    rating: 1750,
    points,
    bonusUsed: 0,
    lifetimeGames: wins + losses,
    wins,
    losses,
    lastPlayedDate: Date.now() - 1000 * 60 * 60 * 3,
  }
}

const RANKED_PROFILE: UserProfileJson = {
  userId: UC_TEC27,
  seasonId: UC_SEASON.id,
  ladder: {
    // Ordered by activity in the card, not by this object's key order.
    [MatchmakingType.Match2v2]: makeLadderPlayer(MatchmakingType.Match2v2, 940, 18, 21, 'z'),
    [MatchmakingType.Match1v1]: makeLadderPlayer(MatchmakingType.Match1v1, 1840, 74, 52, 'p'),
  },
  // Spread across races, so there's no main race overall.
  userStats: {
    ...NO_RACE_STATS,
    userId: UC_TEC27,
    pWins: 40,
    pLosses: 30,
    tWins: 20,
    tLosses: 18,
    zWins: 26,
    zLosses: 20,
    rWins: 6,
    rLosses: 5,
  },
}

const MANY_MODES_PROFILE: UserProfileJson = {
  userId: UC_LONG_NAME,
  seasonId: UC_SEASON.id,
  ladder: {
    [MatchmakingType.Match1v1]: makeLadderPlayer(MatchmakingType.Match1v1, 4210, 160, 88, 'z'),
    [MatchmakingType.Match2v2]: makeLadderPlayer(MatchmakingType.Match2v2, 2380, 61, 40, 'r'),
    [MatchmakingType.Match1v1Fastest]: makeLadderPlayer(
      MatchmakingType.Match1v1Fastest,
      1320,
      30,
      22,
    ),
    [MatchmakingType.Match2v2Hunters]: makeLadderPlayer(
      MatchmakingType.Match2v2Hunters,
      760,
      14,
      11,
    ),
    [MatchmakingType.Match3v3Bgh]: makeLadderPlayer(MatchmakingType.Match3v3Bgh, 300, 5, 6),
  },
  userStats: {
    ...NO_RACE_STATS,
    userId: UC_LONG_NAME,
    zWins: 1204,
    zLosses: 911,
    pWins: 40,
    pLosses: 51,
  },
}

const NEW_USER_PROFILE: UserProfileJson = {
  userId: UC_NEWCOMER,
  seasonId: UC_SEASON.id,
  ladder: {},
  userStats: { ...NO_RACE_STATS, userId: UC_NEWCOMER },
}

/** Tried a couple of ranked games, too few to show a rank for. */
const TRIED_RANKED_PROFILE: UserProfileJson = {
  userId: UC_NEWCOMER,
  seasonId: UC_SEASON.id,
  ladder: {
    [MatchmakingType.Match1v1]: makeLadderPlayer(MatchmakingType.Match1v1, 40, 1, 1, 't'),
  },
  userStats: { ...NO_RACE_STATS, userId: UC_NEWCOMER, tWins: 9, tLosses: 6 },
}

interface UserScenario {
  label: string
  userId: SbUserId
  state: UserCardState
}

const USER_SCENARIOS: UserScenario[] = [
  { label: 'Loading', userId: UC_TEC27, state: { status: 'loading' } },
  {
    label: 'Ranked in 2 modes',
    userId: UC_TEC27,
    state: { status: 'loaded', profile: RANKED_PROFILE, season: UC_SEASON },
  },
  {
    label: 'Long name, 5 ranked modes',
    userId: UC_LONG_NAME,
    state: { status: 'loaded', profile: MANY_MODES_PROFILE, season: UC_SEASON },
  },
  {
    label: 'Season unknown',
    userId: UC_LONG_NAME,
    state: { status: 'loaded', profile: MANY_MODES_PROFILE, season: undefined },
  },
  {
    label: 'No ranks, no games',
    userId: UC_NEWCOMER,
    state: { status: 'loaded', profile: NEW_USER_PROFILE, season: UC_SEASON },
  },
  {
    label: 'Tried ranked (2 games)',
    userId: UC_NEWCOMER,
    state: { status: 'loaded', profile: TRIED_RANKED_PROFILE, season: UC_SEASON },
  },
  { label: 'Error', userId: UC_TEC27, state: { status: 'error' } },
]

function UserRow({ scenario }: { scenario: UserScenario }) {
  const user = useAppSelector(s => s.users.byId.get(scenario.userId))
  return (
    <Cell>
      <RowLabel>{scenario.label}</RowLabel>
      <UserCardContent
        userId={scenario.userId}
        user={user}
        state={scenario.state}
        onProfileClick={() => {}}
      />
    </Cell>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const SEED_ACTIONS: ReduxAction[] = [
  {
    type: '@users/loadUsers',
    payload: [MOCK_LOBBY_SUMMARY.host, LONG_NAME_HOST, ...GAME_USERS, ...USER_CARD_USERS],
  },
]

/** One column per kind of card, side by side. */
const PageRoot = styled.div`
  padding: 16px;

  display: flex;
  align-items: flex-start;
  gap: 40px;
`

const Column = styled.div`
  flex-shrink: 0;
`

const SectionHeading = styled.div`
  ${titleLarge};
  margin-bottom: 16px;
  color: var(--theme-on-surface);
`

const Grid = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`

const Cell = styled.div`
  width: 500px;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const RowLabel = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
`

export function ChatCardsTest() {
  return (
    <IsolatedReduxProvider seedActions={SEED_ACTIONS}>
      <PageRoot>
        <Column>
          <SectionHeading>Lobby invite card</SectionHeading>
          <Grid>
            {LOBBY_SCENARIOS.map(scenario => (
              <LobbyRow key={scenario.label} scenario={scenario} />
            ))}
          </Grid>
        </Column>

        <Column>
          <SectionHeading>Game card</SectionHeading>
          <Grid>
            {GAME_SCENARIOS.map(scenario => (
              <GameRow key={scenario.label} scenario={scenario} />
            ))}
          </Grid>
        </Column>

        <Column>
          <SectionHeading>User card</SectionHeading>
          <Grid>
            {USER_SCENARIOS.map(scenario => (
              <UserRow key={scenario.label} scenario={scenario} />
            ))}
          </Grid>
        </Column>
      </PageRoot>
    </IsolatedReduxProvider>
  )
}
