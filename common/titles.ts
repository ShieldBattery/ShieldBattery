import { RaceChar } from './races'
import type { SbUser } from './users/sb-user'

/**
 * Every title a user can hold, in display order. The ids are stored in the database
 * (`user_titles.title_id`), so they must never be renamed or reused for a different title.
 */
export const ALL_TITLE_IDS = [
  'novice',
  'additionalPylons',
  'enTaroAdun',
  'stormCaller',
  'powerOverwhelming',
  'khalasChosen',
  'executor',
  'spawnMoreOverlords',
  'lingFlood',
  'mutaStacker',
  'darkSwarm',
  'hiveMind',
  'cerebrate',
  'supplyBlocked',
  'stimJunkie',
  'spiderMiner',
  'mechManiac',
  'nuclearLaunchDetected',
  'magistrate',
  'coinFlip',
  'wildcard',
  'identityCrisis',
  'agentOfChaos',
  'chimera',
  'xelNaga',
  'dabbler',
  'offRacer',
  'tripleThreat',
  'triumvirate',
  'bronzeAge',
  'silverBullet',
  'goldStandard',
  'wentPlatinum',
  'gosu',
  'bonjwa',
  'onTheBoard',
  'bracketBuster',
  'contender',
  'leagueMenace',
  'hallOfFamer',
  'loneWolf',
  'dynamicDuo',
  'bigGameHunter',
  'freeForAllStar',
  'funMapFanatic',
  'freshMeat',
  'oneMoreGame',
  'grinder',
  'warMachine',
  'broodWarDemigod',
  'clockedIn',
  'overtime',
  'noLifer',
  'touchGrass',
  'established',
  'seasonTicketHolder',
  'perfectAttendance',
  'cheesemonger',
  'minedOut',
  'siblingRivalry',
  'keyboardWarrior',
  'leagueChampion',
  'exterminator',
  'playByPlay',
  'administrator',
  'moderator',
  'developer',
] as const

export type TitleId = (typeof ALL_TITLE_IDS)[number]

const TITLE_ID_SET: ReadonlySet<string> = new Set(ALL_TITLE_IDS)

export function isTitleId(value: unknown): value is TitleId {
  return typeof value === 'string' && TITLE_ID_SET.has(value)
}

/** The title every user holds, and the one displayed when a user hasn't equipped another. */
export const DEFAULT_TITLE_ID: TitleId = 'novice'

/** Groups of titles that are displayed together, each usually a progression of tiers. */
export enum TitleTrack {
  Starter = 'starter',
  Protoss = 'protoss',
  Zerg = 'zerg',
  Terran = 'terran',
  Random = 'random',
  EveryRace = 'everyRace',
  Rank = 'rank',
  League = 'league',
  Mode = 'mode',
  GamesPlayed = 'gamesPlayed',
  TimePlayed = 'timePlayed',
  Veteran = 'veteran',
  Feats = 'feats',
  Community = 'community',
  Staff = 'staff',
}

/** How a title's text is colored when displayed. */
export enum TitleTone {
  Standard = 'standard',
  Protoss = 'protoss',
  Zerg = 'zerg',
  Terran = 'terran',
  Random = 'random',
  Staff = 'staff',
}

/**
 * Divisions that rank titles are awarded for, in ascending order. Reaching a division in any
 * ranked mode awards that division's title and every one below it.
 */
export enum TitleDivision {
  Bronze = 1,
  Silver = 2,
  Gold = 3,
  Platinum = 4,
  Diamond = 5,
  Champion = 6,
}

/** Ranked modes (or groups of them) that mode titles count wins in. */
export enum TitleMode {
  OneVOne = 'oneVOne',
  TwoVTwo = 'twoVTwo',
  Bgh = 'bgh',
}

/** The requirement for unlocking a title. */
export type TitleCriterion =
  /** Held by everyone. */
  | { kind: 'always' }
  /** Win `wins` non-UMS games with a race selected (random games count toward `r`). */
  | { kind: 'raceWins'; race: RaceChar; wins: number }
  /** Win `wins` non-UMS games with each of Protoss, Terran, and Zerg. */
  | { kind: 'everyRaceWins'; wins: number }
  /** Reach `division` in any ranked mode, in any season. */
  | { kind: 'division'; division: TitleDivision }
  /** Win `wins` league games, summed across all leagues. */
  | { kind: 'leagueWins'; wins: number }
  /** Win `wins` ranked games in `mode`, summed across seasons. */
  | { kind: 'modeWins'; mode: TitleMode; wins: number }
  /** Win `wins` Free for all games. */
  | { kind: 'ffaWins'; wins: number }
  /** Complete `games` Use map settings games. */
  | { kind: 'umsGames'; games: number }
  /** Play `games` non-UMS games with a known result. */
  | { kind: 'gamesPlayed'; games: number }
  /** Spend `hours` hours in games. */
  | { kind: 'hoursPlayed'; hours: number }
  /** Play a game. Displayed with the year the account was created. */
  | { kind: 'established' }
  /** Play ranked games in `seasons` different seasons. */
  | { kind: 'rankedSeasons'; seasons: number }
  /** Win `wins` ranked games that end in under `minutes` minutes. */
  | { kind: 'quickWins'; wins: number; minutes: number }
  /** Win a ranked game that lasts longer than `minutes` minutes. */
  | { kind: 'longWin'; minutes: number }
  /** Win `wins` ranked 1v1 games against the same race. */
  | { kind: 'mirrorWins'; wins: number }
  /** Average at least `apm` APM over the last `games` ranked games. */
  | { kind: 'averageApm'; apm: number; games: number }
  /** Granted by an admin rather than earned, and revocable. */
  | { kind: 'granted' }

export interface TitleDefinition {
  id: TitleId
  track: TitleTrack
  criterion: TitleCriterion
  tone: TitleTone
  /** Whether the requirement is hidden until the title is unlocked. */
  secret?: boolean
}

const RACE_TRACKS: ReadonlyArray<
  [track: TitleTrack, race: RaceChar, tone: TitleTone, ids: ReadonlyArray<TitleId>]
> = [
  [
    TitleTrack.Protoss,
    'p',
    TitleTone.Protoss,
    [
      'additionalPylons',
      'enTaroAdun',
      'stormCaller',
      'powerOverwhelming',
      'khalasChosen',
      'executor',
    ],
  ],
  [
    TitleTrack.Zerg,
    'z',
    TitleTone.Zerg,
    ['spawnMoreOverlords', 'lingFlood', 'mutaStacker', 'darkSwarm', 'hiveMind', 'cerebrate'],
  ],
  [
    TitleTrack.Terran,
    't',
    TitleTone.Terran,
    [
      'supplyBlocked',
      'stimJunkie',
      'spiderMiner',
      'mechManiac',
      'nuclearLaunchDetected',
      'magistrate',
    ],
  ],
  [
    TitleTrack.Random,
    'r',
    TitleTone.Random,
    ['coinFlip', 'wildcard', 'identityCrisis', 'agentOfChaos', 'chimera', 'xelNaga'],
  ],
]

/** Win thresholds for each tier of the race tracks. */
export const RACE_TITLE_WINS: ReadonlyArray<number> = [25, 100, 250, 500, 1000, 2500]
/** The first race tier (0-based) displayed in the race's color rather than the standard one. */
const FIRST_RACE_TONED_TIER = 3

function tiers(
  track: TitleTrack,
  ids: ReadonlyArray<TitleId>,
  makeCriterion: (index: number) => TitleCriterion,
): TitleDefinition[] {
  return ids.map((id, i) => ({ id, track, criterion: makeCriterion(i), tone: TitleTone.Standard }))
}

const EVERY_RACE_WINS = [10, 25, 100, 250]
const LEAGUE_WINS = [1, 25, 100, 250, 500]
const GAMES_PLAYED = [10, 100, 500, 1000, 5000]
const HOURS_PLAYED = [24, 100, 500, 1000]

/** Every title definition, in display order. */
export const TITLES: ReadonlyArray<TitleDefinition> = [
  {
    id: 'novice',
    track: TitleTrack.Starter,
    criterion: { kind: 'always' },
    tone: TitleTone.Standard,
  },
  ...RACE_TRACKS.flatMap(([track, race, tone, ids]) =>
    ids.map<TitleDefinition>((id, i) => ({
      id,
      track,
      criterion: { kind: 'raceWins', race, wins: RACE_TITLE_WINS[i] },
      tone: i >= FIRST_RACE_TONED_TIER ? tone : TitleTone.Standard,
    })),
  ),
  ...tiers(TitleTrack.EveryRace, ['dabbler', 'offRacer', 'tripleThreat', 'triumvirate'], i => ({
    kind: 'everyRaceWins',
    wins: EVERY_RACE_WINS[i],
  })),
  ...tiers(
    TitleTrack.Rank,
    ['bronzeAge', 'silverBullet', 'goldStandard', 'wentPlatinum', 'gosu', 'bonjwa'],
    i => ({ kind: 'division', division: (i + 1) as TitleDivision }),
  ),
  ...tiers(
    TitleTrack.League,
    ['onTheBoard', 'bracketBuster', 'contender', 'leagueMenace', 'hallOfFamer'],
    i => ({ kind: 'leagueWins', wins: LEAGUE_WINS[i] }),
  ),
  {
    id: 'loneWolf',
    track: TitleTrack.Mode,
    criterion: { kind: 'modeWins', mode: TitleMode.OneVOne, wins: 100 },
    tone: TitleTone.Standard,
  },
  {
    id: 'dynamicDuo',
    track: TitleTrack.Mode,
    criterion: { kind: 'modeWins', mode: TitleMode.TwoVTwo, wins: 250 },
    tone: TitleTone.Standard,
  },
  {
    id: 'bigGameHunter',
    track: TitleTrack.Mode,
    criterion: { kind: 'modeWins', mode: TitleMode.Bgh, wins: 100 },
    tone: TitleTone.Standard,
  },
  {
    id: 'freeForAllStar',
    track: TitleTrack.Mode,
    criterion: { kind: 'ffaWins', wins: 25 },
    tone: TitleTone.Standard,
  },
  {
    id: 'funMapFanatic',
    track: TitleTrack.Mode,
    criterion: { kind: 'umsGames', games: 50 },
    tone: TitleTone.Standard,
  },
  ...tiers(
    TitleTrack.GamesPlayed,
    ['freshMeat', 'oneMoreGame', 'grinder', 'warMachine', 'broodWarDemigod'],
    i => ({ kind: 'gamesPlayed', games: GAMES_PLAYED[i] }),
  ),
  ...tiers(TitleTrack.TimePlayed, ['clockedIn', 'overtime', 'noLifer', 'touchGrass'], i => ({
    kind: 'hoursPlayed',
    hours: HOURS_PLAYED[i],
  })),
  {
    id: 'established',
    track: TitleTrack.Veteran,
    criterion: { kind: 'established' },
    tone: TitleTone.Standard,
  },
  {
    id: 'seasonTicketHolder',
    track: TitleTrack.Veteran,
    criterion: { kind: 'rankedSeasons', seasons: 3 },
    tone: TitleTone.Standard,
  },
  {
    id: 'perfectAttendance',
    track: TitleTrack.Veteran,
    criterion: { kind: 'rankedSeasons', seasons: 10 },
    tone: TitleTone.Standard,
  },
  {
    id: 'cheesemonger',
    track: TitleTrack.Feats,
    criterion: { kind: 'quickWins', wins: 10, minutes: 4 },
    tone: TitleTone.Standard,
    secret: true,
  },
  {
    id: 'minedOut',
    track: TitleTrack.Feats,
    criterion: { kind: 'longWin', minutes: 60 },
    tone: TitleTone.Standard,
    secret: true,
  },
  {
    id: 'siblingRivalry',
    track: TitleTrack.Feats,
    criterion: { kind: 'mirrorWins', wins: 100 },
    tone: TitleTone.Standard,
    secret: true,
  },
  {
    id: 'keyboardWarrior',
    track: TitleTrack.Feats,
    criterion: { kind: 'averageApm', apm: 250, games: 50 },
    tone: TitleTone.Standard,
    secret: true,
  },
  ...(['leagueChampion', 'exterminator', 'playByPlay'] as const).map<TitleDefinition>(id => ({
    id,
    track: TitleTrack.Community,
    criterion: { kind: 'granted' },
    tone: TitleTone.Standard,
  })),
  ...(['administrator', 'moderator', 'developer'] as const).map<TitleDefinition>(id => ({
    id,
    track: TitleTrack.Staff,
    criterion: { kind: 'granted' },
    tone: TitleTone.Staff,
  })),
]

export const TITLES_BY_ID: ReadonlyMap<TitleId, TitleDefinition> = new Map(
  TITLES.map(t => [t.id, t]),
)

export function getTitleDefinition(id: TitleId): TitleDefinition {
  return TITLES_BY_ID.get(id)!
}

/** Whether a title is handed out by admins (and so can be revoked) rather than earned. */
export function isGrantedTitle(id: TitleId): boolean {
  return getTitleDefinition(id).criterion.kind === 'granted'
}

/** IDs of every title an admin can grant. */
export const GRANTED_TITLE_IDS: ReadonlyArray<TitleId> = TITLES.filter(
  t => t.criterion.kind === 'granted',
).map(t => t.id)

/**
 * The play statistics that earned titles are checked against, for a single user. Sent to the user
 * themselves so the title picker can show progress toward locked titles.
 */
export interface TitleMetrics {
  /** Non-UMS wins with each selected race, as shown in the profile's race stats. */
  raceWins: Record<RaceChar, number>
  /** Non-UMS games with a known win or loss, as shown in the profile's total games. */
  gamesPlayed: number
  /** Whether the user has a result recorded for any game at all (including UMS games). */
  hasPlayed: boolean
  /** Total length of the user's games, in hours. */
  hoursPlayed: number
  /** Ranked wins per mode title group, summed across seasons. */
  modeWins: Record<TitleMode, number>
  /** League game wins, summed across all leagues. */
  leagueWins: number
  /** Free for all game wins. */
  ffaWins: number
  /** Use map settings games with a result. */
  umsGames: number
  /** Number of seasons the user has played at least one ranked game in. */
  rankedSeasons: number
  /** The highest division reached in any ranked game, or `undefined` if never ranked. */
  peakDivision?: TitleDivision
  /** Ranked wins in games that ended in under 4 minutes. */
  quickWins: number
  /** Ranked wins in games that lasted longer than 60 minutes. */
  longWins: number
  /** Ranked 1v1 wins against the same race. */
  mirrorWins: number
  /** Average APM over the most recent ranked games, and how many games that covers (up to 50). */
  recentApm: { average: number; games: number }
}

export function makeEmptyTitleMetrics(): TitleMetrics {
  return {
    raceWins: { p: 0, t: 0, z: 0, r: 0 },
    gamesPlayed: 0,
    hasPlayed: false,
    hoursPlayed: 0,
    modeWins: { [TitleMode.OneVOne]: 0, [TitleMode.TwoVTwo]: 0, [TitleMode.Bgh]: 0 },
    leagueWins: 0,
    ffaWins: 0,
    umsGames: 0,
    rankedSeasons: 0,
    peakDivision: undefined,
    quickWins: 0,
    longWins: 0,
    mirrorWins: 0,
    recentApm: { average: 0, games: 0 },
  }
}

/**
 * Progress toward a numeric title requirement. `current` may exceed `target` once the requirement
 * is met.
 */
export interface TitleProgress {
  current: number
  target: number
}

/**
 * Returns numeric progress toward a title's requirement, or `undefined` for requirements that
 * aren't a count (granted titles, divisions, and single-game feats).
 */
export function getTitleProgress(
  criterion: TitleCriterion,
  metrics: TitleMetrics,
): TitleProgress | undefined {
  switch (criterion.kind) {
    case 'raceWins':
      return { current: metrics.raceWins[criterion.race], target: criterion.wins }
    case 'everyRaceWins':
      return {
        current: Math.min(metrics.raceWins.p, metrics.raceWins.t, metrics.raceWins.z),
        target: criterion.wins,
      }
    case 'leagueWins':
      return { current: metrics.leagueWins, target: criterion.wins }
    case 'modeWins':
      return { current: metrics.modeWins[criterion.mode], target: criterion.wins }
    case 'ffaWins':
      return { current: metrics.ffaWins, target: criterion.wins }
    case 'umsGames':
      return { current: metrics.umsGames, target: criterion.games }
    case 'gamesPlayed':
      return { current: metrics.gamesPlayed, target: criterion.games }
    case 'hoursPlayed':
      return { current: Math.floor(metrics.hoursPlayed), target: criterion.hours }
    case 'rankedSeasons':
      return { current: metrics.rankedSeasons, target: criterion.seasons }
    case 'quickWins':
      return { current: metrics.quickWins, target: criterion.wins }
    case 'mirrorWins':
      return { current: metrics.mirrorWins, target: criterion.wins }
    case 'always':
    case 'granted':
    case 'division':
    case 'established':
    case 'longWin':
    case 'averageApm':
      return undefined
    default:
      return criterion satisfies never
  }
}

/** Whether `metrics` satisfy an earned title's requirement. Granted titles are never earned. */
export function meetsTitleCriterion(criterion: TitleCriterion, metrics: TitleMetrics): boolean {
  switch (criterion.kind) {
    case 'always':
      return true
    case 'granted':
      return false
    case 'division':
      return (metrics.peakDivision ?? 0) >= criterion.division
    case 'established':
      return metrics.hasPlayed
    case 'longWin':
      return metrics.longWins > 0
    case 'averageApm':
      return (
        metrics.recentApm.games >= criterion.games && metrics.recentApm.average >= criterion.apm
      )
    case 'raceWins':
    case 'everyRaceWins':
    case 'leagueWins':
    case 'modeWins':
    case 'ffaWins':
    case 'umsGames':
    case 'gamesPlayed':
    case 'hoursPlayed':
    case 'rankedSeasons':
    case 'quickWins':
    case 'mirrorWins': {
      const progress = getTitleProgress(criterion, metrics)!
      return progress.current >= progress.target
    }
    default:
      return criterion satisfies never
  }
}

/** Returns the ids of every earned title whose requirement `metrics` satisfy, in display order. */
export function getEarnedTitleIds(metrics: TitleMetrics): TitleId[] {
  return TITLES.filter(t => meetsTitleCriterion(t.criterion, metrics)).map(t => t.id)
}

/** A title a user holds. */
export interface UnlockedTitleJson {
  id: TitleId
  /** When the title was earned or granted, as a UTC timestamp in milliseconds. */
  unlockedAt: number
}

export interface GetSelfTitlesResponse {
  unlocked: UnlockedTitleJson[]
  /** The title the user displays, or `undefined` for Novice. */
  equipped?: TitleId
  metrics: TitleMetrics
}

export interface EquipTitleRequest {
  titleId: TitleId
}

export interface EquipTitleResponse {
  /** The user's updated info, with the newly equipped title. */
  user: SbUser
}

export interface AdminGetUserTitlesResponse {
  unlocked: UnlockedTitleJson[]
}
