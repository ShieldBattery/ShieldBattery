import { TFunction } from 'i18next'
import { SetRequired, Simplify, Tagged } from 'type-fest'
import { assertUnreachable } from './assert-unreachable'
import { binarySearch } from './data-structures/arrays'
import { GameRoute } from './game-launch-config'
import { Jsonify } from './json'
import { Slot } from './lobbies/slot'
import { MapInfoJson } from './maps'
import { BwTurnRate, BwUserLatency } from './network'
import { AssignedRaceChar, RaceChar } from './races'
import { SbUserId } from './users/sb-user'

/**
 * How long after a season has ended that rankings are considered "finalized" and will not be
 * altered further.
 */
export const MATCHMAKING_SEASON_FINALIZED_TIME_MS = 6 * 60 * 60 * 1000 // 6 hours

/**
 * A string representation of each of the matchmaking types that we support.
 */
export enum MatchmakingType {
  Match1v1 = '1v1',
  Match1v1Fastest = '1v1fastest',
  Match2v2 = '2v2',
}

export const ALL_MATCHMAKING_TYPES: ReadonlyArray<MatchmakingType> = Object.values(MatchmakingType)

export function matchmakingTypeToLabel(type: MatchmakingType, t: TFunction): string {
  switch (type) {
    case MatchmakingType.Match1v1:
      return t ? t('matchmaking.type.1v1', '1v1') : '1v1'
    case MatchmakingType.Match1v1Fastest:
      return t ? t('matchmaking.type.1v1fastest', '1v1 Fastest') : '1v1 Fastest'
    case MatchmakingType.Match2v2:
      return t ? t('matchmaking.type.2v2', '2v2') : '2v2'
    default:
      return assertUnreachable(type)
  }
}

/**
 * Returns whether or not a given `MatchmakingType` has vetoes (versus positive map selections,
 * e.g. select the maps you want to play on).
 */
export function hasVetoes(type: MatchmakingType): boolean {
  return type !== MatchmakingType.Match1v1Fastest
}

/**
 * The factor we use to determine the "target" points for a player of a given rating. For example, a
 * player with rating `R` would be expected to achieve about `R * POINTS_FOR_RATING_TARGET_FACTOR`
 * points.
 */
export const POINTS_FOR_RATING_TARGET_FACTOR = 4

/**
 * Divisions that players can place into, based on their points.
 *
 * NOTE(tec27): Be careful changing the values of these, they are expected to match image filenames.
 */
export enum MatchmakingDivision {
  Unrated = 'unrated',
  Bronze1 = 'bronze1',
  Bronze2 = 'bronze2',
  Bronze3 = 'bronze3',
  Silver1 = 'silver1',
  Silver2 = 'silver2',
  Silver3 = 'silver3',
  Gold1 = 'gold1',
  Gold2 = 'gold2',
  Gold3 = 'gold3',
  Platinum1 = 'platinum1',
  Platinum2 = 'platinum2',
  Platinum3 = 'platinum3',
  Diamond1 = 'diamond1',
  Diamond2 = 'diamond2',
  Diamond3 = 'diamond3',
  Champion = 'champion',
}

export const ALL_MATCHMAKING_DIVISIONS: ReadonlyArray<MatchmakingDivision> =
  Object.values(MatchmakingDivision)

export function matchmakingDivisionToLabel(rank: MatchmakingDivision, t: TFunction): string {
  switch (rank) {
    case MatchmakingDivision.Unrated:
      return t ? t('matchmaking.division.unrated', 'Unrated') : 'Unrated'
    case MatchmakingDivision.Bronze1:
      return t
        ? t('matchmaking.division.bronze', {
            defaultValue: 'Bronze {{level}}',
            level: 1,
          })
        : 'Bronze 1'
    case MatchmakingDivision.Bronze2:
      return t
        ? t('matchmaking.division.bronze', {
            defaultValue: 'Bronze {{level}}',
            level: 2,
          })
        : 'Bronze 2'
    case MatchmakingDivision.Bronze3:
      return t
        ? t('matchmaking.division.bronze', {
            defaultValue: 'Bronze {{level}}',
            level: 3,
          })
        : 'Bronze 3'
    case MatchmakingDivision.Silver1:
      return t
        ? t('matchmaking.division.silver', {
            defaultValue: 'Silver {{level}}',
            level: 1,
          })
        : 'Silver 1'
    case MatchmakingDivision.Silver2:
      return t
        ? t('matchmaking.division.silver', {
            defaultValue: 'Silver {{level}}',
            level: 2,
          })
        : 'Silver 2'
    case MatchmakingDivision.Silver3:
      return t
        ? t('matchmaking.division.silver', {
            defaultValue: 'Silver {{level}}',
            level: 3,
          })
        : 'Silver 3'
    case MatchmakingDivision.Gold1:
      return t
        ? t('matchmaking.division.gold', {
            defaultValue: 'Gold {{level}}',
            level: 1,
          })
        : 'Gold 1'
    case MatchmakingDivision.Gold2:
      return t
        ? t('matchmaking.division.gold', {
            defaultValue: 'Gold {{level}}',
            level: 2,
          })
        : 'Gold 2'
    case MatchmakingDivision.Gold3:
      return t
        ? t('matchmaking.division.gold', {
            defaultValue: 'Gold {{level}}',
            level: 3,
          })
        : 'Gold 3'
    case MatchmakingDivision.Platinum1:
      return t
        ? t('matchmaking.division.platinum', {
            defaultValue: 'Platinum {{level}}',
            level: 1,
          })
        : 'Platinum 1'
    case MatchmakingDivision.Platinum2:
      return t
        ? t('matchmaking.division.platinum', {
            defaultValue: 'Platinum {{level}}',
            level: 2,
          })
        : 'Platinum 2'
    case MatchmakingDivision.Platinum3:
      return t
        ? t('matchmaking.division.platinum', {
            defaultValue: 'Platinum {{level}}',
            level: 3,
          })
        : 'Platinum 3'
    case MatchmakingDivision.Diamond1:
      return t
        ? t('matchmaking.division.diamond', {
            defaultValue: 'Diamond {{level}}',
            level: 1,
          })
        : 'Diamond 1'
    case MatchmakingDivision.Diamond2:
      return t
        ? t('matchmaking.division.diamond', {
            defaultValue: 'Diamond {{level}}',
            level: 2,
          })
        : 'Diamond 2'
    case MatchmakingDivision.Diamond3:
      return t
        ? t('matchmaking.division.diamond', {
            defaultValue: 'Diamond {{level}}',
            level: 3,
          })
        : 'Diamond 3'
    case MatchmakingDivision.Champion:
      return t ? t('matchmaking.division.champion', 'Champion') : 'Champion'
    default:
      return assertUnreachable(rank)
  }
}

export type MatchmakingDivisionWithBounds = [
  division: MatchmakingDivision,
  low: number,
  high: number,
]

type MatchmakingDivisionWithBoundsAndBonusFactor = [
  division: MatchmakingDivision,
  low: number,
  high: number,
  bonusFactorLow: number,
  bonusFactorHigh: number,
]

// Divisions have a specific range of points they cover and have a separate factor for how much the
// bonus pool applies to them. This bonus pool factor allows us to let people progress at a similar
// rate through the lower divisions throughout the season but makes it harder to progress through
// the upper divisions as the season goes on. (It is divided into a low and high factor to ensure
// the division bounds are continuous)
const DIVISIONS_TO_POINTS: ReadonlyArray<MatchmakingDivisionWithBoundsAndBonusFactor> = [
  [MatchmakingDivision.Bronze1, -Infinity, 750, 0, 0],
  [MatchmakingDivision.Bronze2, 750, 1500, 0, 0],
  [MatchmakingDivision.Bronze3, 1500, 2250, 0, 0],
  [MatchmakingDivision.Silver1, 2250, 3000, 0, 0.3],
  [MatchmakingDivision.Silver2, 3000, 3750, 0.3, 0.3],
  [MatchmakingDivision.Silver3, 3750, 4500, 0.3, 0.3],
  [MatchmakingDivision.Gold1, 4500, 5250, 0.3, 0.6],
  [MatchmakingDivision.Gold2, 5250, 6000, 0.6, 0.6],
  [MatchmakingDivision.Gold3, 6000, 6750, 0.6, 0.6],
  [MatchmakingDivision.Platinum1, 6750, 7070, 0.6, 1],
  [MatchmakingDivision.Platinum2, 7070, 7390, 1, 1],
  [MatchmakingDivision.Platinum3, 7390, 7710, 1, 1],
  [MatchmakingDivision.Diamond1, 7710, 8030, 1, 1],
  [MatchmakingDivision.Diamond2, 8030, 8350, 1, 1],
  [MatchmakingDivision.Diamond3, 8350, 9600, 1, 1],
  [MatchmakingDivision.Champion, 9600, Infinity, 1, 1],
]

const UNRATED_BOUNDS: Readonly<MatchmakingDivisionWithBounds> = [
  MatchmakingDivision.Unrated,
  -Infinity,
  Infinity,
]

function binarySearchPoints(points: number, bonusPool: number): number {
  return binarySearch(
    DIVISIONS_TO_POINTS,
    points,
    ([_, low, high, bonusFactorLow, bonusFactorHigh], points) => {
      if (low + bonusPool * bonusFactorLow > points) {
        return 1
      } else if (high + bonusPool * bonusFactorHigh <= points) {
        return -1
      } else {
        return 0
      }
    },
  )
}

function addBonusPoolToDivisionBounds(
  [
    division,
    low,
    high,
    bonusFactorLow,
    bonusFactorHigh,
  ]: Readonly<MatchmakingDivisionWithBoundsAndBonusFactor>,
  bonusPool: number,
): MatchmakingDivisionWithBounds {
  return [
    division,
    Math.max(0, low + bonusPool * bonusFactorLow),
    high + bonusPool * bonusFactorHigh,
  ]
}

/** Converts a given points value into a matching `MatchmakingDivision`. */
export function pointsToMatchmakingDivision(
  points: number,
  bonusPool: number,
): MatchmakingDivision {
  const index = binarySearchPoints(points, bonusPool)
  return index >= 0 ? DIVISIONS_TO_POINTS[index][0] : MatchmakingDivision.Unrated
}

/**
 * Converts a given points value into a matching `MatchmakingDivision` and returns it, as well as
 * the low (inclusive) and high (exclusive) points bound for the division.
 */
export function pointsToMatchmakingDivisionAndBounds(
  points: number,
  bonusPool: number,
): Readonly<MatchmakingDivisionWithBounds> {
  const index = binarySearchPoints(points, bonusPool)
  return index >= 0
    ? addBonusPoolToDivisionBounds(DIVISIONS_TO_POINTS[index], bonusPool)
    : UNRATED_BOUNDS
}

/**
 * Retrieves all the relevant divisions for a points change (that is, if a player goes from
 * Silver 1 to Gold 2, it would return a list of [Silver 1, Silver 2, Silver 3, Gold 1, Gold 2]).
 * The resulting list will be ordered correctly such that the starting division is first, and ending
 * is last.
 */
export function getDivisionsForPointsChange(
  startingPoints: number,
  endingPoints: number,
  bonusPool: number,
): Array<Readonly<MatchmakingDivisionWithBounds>> {
  const startingIndex = binarySearchPoints(startingPoints, bonusPool)
  const endingIndex = binarySearchPoints(endingPoints, bonusPool)

  if (startingIndex === -1 && endingIndex === -1) {
    return [UNRATED_BOUNDS]
  } else if (startingIndex === -1) {
    return [
      UNRATED_BOUNDS,
      addBonusPoolToDivisionBounds(DIVISIONS_TO_POINTS[endingIndex], bonusPool),
    ]
  } else if (endingIndex === -1) {
    return [
      UNRATED_BOUNDS,
      addBonusPoolToDivisionBounds(DIVISIONS_TO_POINTS[startingIndex], bonusPool),
    ]
  }

  if (startingIndex > endingIndex) {
    return DIVISIONS_TO_POINTS.slice(endingIndex, startingIndex + 1)
      .reverse()
      .map(b => addBonusPoolToDivisionBounds(b, bonusPool))
  } else {
    return DIVISIONS_TO_POINTS.slice(startingIndex, endingIndex + 1).map(b =>
      addBonusPoolToDivisionBounds(b, bonusPool),
    )
  }
}

export function getDivisionColor(division: MatchmakingDivision) {
  switch (division) {
    case MatchmakingDivision.Bronze1:
    case MatchmakingDivision.Bronze2:
    case MatchmakingDivision.Bronze3:
      return '#BD7956'
    case MatchmakingDivision.Silver1:
    case MatchmakingDivision.Silver2:
    case MatchmakingDivision.Silver3:
      return '#9CA1A3'
    case MatchmakingDivision.Gold1:
    case MatchmakingDivision.Gold2:
    case MatchmakingDivision.Gold3:
      return '#D5BF6D'
    case MatchmakingDivision.Platinum1:
    case MatchmakingDivision.Platinum2:
    case MatchmakingDivision.Platinum3:
      return '#72CBF4'
    case MatchmakingDivision.Diamond1:
    case MatchmakingDivision.Diamond2:
    case MatchmakingDivision.Diamond3:
      return '#B96CED'
    case MatchmakingDivision.Champion:
      return '#F27537'
    case MatchmakingDivision.Unrated:
      return '#87ABCA'
    default:
      return assertUnreachable(division)
  }
}

/**
 * Rating floors to be used to determine if a user is still converging towards their target point
 * total. If they are still converging, they'll receive extra points for each win until they hit
 * the value listed here.
 */
const RATING_CONVERGENCE_BUCKETS: ReadonlyArray<[minRating: number, extraPoints: number]> = [
  [960, 100],
  [1200, 150],
  [1440, 200],
  [1680, 250],
  [1920, 300],
]

function getRatingConvergenceBucket(rating: number) {
  let index = 0
  for (
    ;
    index < RATING_CONVERGENCE_BUCKETS.length - 1 &&
    RATING_CONVERGENCE_BUCKETS[index + 1][0] <= rating;
    index++
  ) {
    // This space intentionally left blank
  }
  return RATING_CONVERGENCE_BUCKETS[index]
}

export function getConvergencePoints(rating: number): number {
  const [_, extraPoints] = getRatingConvergenceBucket(rating)
  return extraPoints
}

export function arePointsConverged(rating: number, points: number): boolean {
  const [minRating, _] = getRatingConvergenceBucket(rating)
  return points >= minRating * 4
}

/** How many matches a user must play before we calculate a division for them. */
export const NUM_PLACEMENT_MATCHES = 5

export type SeasonId = Tagged<number, 'SeasonId'>

/**
 * Converts a season ID number into a properly typed version. Alternative methods of retrieving a
 * SeasonId should be preferred, such as using a value retrieved rom the database.
 */
export function makeSeasonId(id: number): SeasonId {
  return id as SeasonId
}

export interface MatchmakingSeason {
  id: SeasonId
  startDate: Date
  endDate?: Date
  name: string
  resetMmr: boolean
}

export type MatchmakingSeasonJson = Jsonify<MatchmakingSeason>

export function toMatchmakingSeasonJson(season: MatchmakingSeason): MatchmakingSeasonJson {
  return {
    id: season.id,
    startDate: Number(season.startDate),
    endDate: season.endDate ? Number(season.endDate) : undefined,
    name: season.name,
    resetMmr: season.resetMmr,
  }
}

/**
 * The amount of bonus points accrued per millisecond since the start of a season. Bonus points are
 * used to improve wins and offset losses, until the bonus pool has been exhausted.
 */
export const MATCHMAKING_BONUS_EARNED_PER_MS = 200 / (7 * 24 * 60 * 60 * 1000) // 200 per week

/**
 * The amount of time before the end of the season that the bonus pool is frozen and does not
 * continue accruing more points. This is intended to allow users to play out the rest of their
 * bonus points and to not penalize players for not playing in the last couple days/hours of the
 * season.
 */
export const MATCHMAKING_BONUS_FREEZE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Returns the total number of bonus points in the pool so far, taking into account the
 * end-of-season bonus pool freeze.
 */
export function getTotalBonusPool(at: Date, seasonStart: Date, seasonEnd?: Date): number {
  const freezeStart = seasonEnd
    ? Number(seasonEnd) - MATCHMAKING_BONUS_FREEZE_PERIOD_MS
    : Number.MAX_SAFE_INTEGER
  const time = Math.min(Number(at), freezeStart)
  const timeSinceSeasonStart = time - Number(seasonStart)
  return Math.max(0, Math.floor(timeSinceSeasonStart * MATCHMAKING_BONUS_EARNED_PER_MS))
}

function isMatchmakingSeason(
  season: MatchmakingSeason | MatchmakingSeasonJson,
): season is MatchmakingSeason {
  return typeof season.startDate !== 'number'
}

/**
 * Returns the total number of bonus points in the pool so far for a season, taking into account the
 * end-of-season bonus pool freeze.
 */
export function getTotalBonusPoolForSeason(
  at: Date,
  season: MatchmakingSeason | MatchmakingSeasonJson,
): number {
  const [start, end] = isMatchmakingSeason(season)
    ? [season.startDate, season.endDate]
    : [new Date(season.startDate), season.endDate ? new Date(season.endDate) : undefined]
  return getTotalBonusPool(at, start, end)
}

/**
 * A Record of MatchmakingType -> the size of a team within a match.
 */
export const TEAM_SIZES: Readonly<Record<MatchmakingType, number>> = {
  [MatchmakingType.Match1v1]: 1,
  [MatchmakingType.Match1v1Fastest]: 1,
  [MatchmakingType.Match2v2]: 2,
}

export function isValidMatchmakingType(type: string) {
  return Object.values(MatchmakingType).includes(type as MatchmakingType)
}

/** The time period after which a user who has played no games will be considered "inactive". */
export const MATCHMAKING_INACTIVE_TIME_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

/**
 * Returns whether a player was considered inactive by the system given the last time they played a
 * game and the time of a new game.
 */
export function wasPlayerInactive(lastPlayedDate: Date, gameDate: Date): boolean {
  return Number(lastPlayedDate) > 0
    ? Number(gameDate) - Number(lastPlayedDate) >= MATCHMAKING_INACTIVE_TIME_MS
    : false
}

/** How long users have to accept a match, in milliseconds. */
export const MATCHMAKING_ACCEPT_MATCH_TIME_MS = 30000

/**
 * Describes a player in the matchmaking. This only includes information that are relevant and safe
 * to send to other players in the matchmaking.
 */
export interface MatchmakingPlayer {
  id: number
  // TODO(2Pac): Don't send `name` and instead get it from the store
  name: string
  race: RaceChar
  rating: number
}

export type MatchmakingResult = 'loss' | 'win'

/**
 * The change that occurred to a player's matchmaking rating as a result of a game. This only
 * contains fields that can be publicly visible (keeping internal factors hidden).
 */
export interface PublicMatchmakingRatingChange {
  userId: SbUserId
  matchmakingType: MatchmakingType
  gameId: string
  /**
   * When the change occurred (this is when the game was reconciled, not necessarily when it was
   * played or finished).
   */
  changeDate: Date
  outcome: MatchmakingResult
  /** The player's rating after this game. If the user is in placement matches, this will be 0. */
  rating: number
  /** The delta between the user's old rating and their new rating. */
  ratingChange: number
  /** The player's ranked points after this game. */
  points: number
  /** The delta between the user's old points and their new points. */
  pointsChange: number
  /** The amount of bonus points this user has used this season. */
  bonusUsed: number
  /** The amount of bonus points used for this game. */
  bonusUsedChange: number
  /** The number of games this user has played since the last MMR reset. */
  lifetimeGames: number
}

export type PublicMatchmakingRatingChangeJson = Jsonify<PublicMatchmakingRatingChange>

export function toPublicMatchmakingRatingChangeJson(
  input: Readonly<PublicMatchmakingRatingChange>,
): PublicMatchmakingRatingChangeJson {
  const inPlacements = input.lifetimeGames < NUM_PLACEMENT_MATCHES

  return {
    userId: input.userId,
    matchmakingType: input.matchmakingType,
    gameId: input.gameId,
    changeDate: Number(input.changeDate),
    outcome: input.outcome,
    rating: inPlacements ? 0 : input.rating,
    ratingChange: inPlacements ? 0 : input.ratingChange,
    points: input.points,
    pointsChange: input.pointsChange,
    bonusUsed: input.bonusUsed,
    bonusUsedChange: input.bonusUsedChange,
    lifetimeGames: input.lifetimeGames,
  }
}

/**
 * The body data of the API route for adding new matchmaking times.
 */
export interface AddMatchmakingTimeBody {
  /**
   * The start date of the new matchmaking time. As with the JavaScript's `Date` object, the number
   * should represent the amount of milliseconds since January 1st 1970 UTC. No automatic time zone
   * conversions are done on the server side. Similarly, daylight savings time is also not accounted
   * for and should be dealt with manually.
   */
  startDate: number
  /** A boolean flag indicating whether the matchmaking is enabled or not. */
  enabled: boolean
}

/**
 * Describes a map pool that is used in a matchmaking.
 */
export interface MatchmakingMapPool {
  id: number
  matchmakingType: MatchmakingType
  startDate: Date
  maps: string[]
  maxVetoCount: number
}

export type MatchmakingMapPoolJson = Jsonify<MatchmakingMapPool>

export function fromMatchmakingMapPoolJson(pool: MatchmakingMapPoolJson): MatchmakingMapPool {
  return {
    id: pool.id,
    matchmakingType: pool.matchmakingType,
    startDate: new Date(pool.startDate),
    maps: pool.maps,
    maxVetoCount: pool.maxVetoCount,
  }
}

export interface GetMatchmakingMapPoolBody {
  pool: MatchmakingMapPoolJson
  mapInfos: MapInfoJson[]
}

export interface MatchmakingPreferencesData1v1 {
  /**
   * A flag indicating whether the user has selected to use the alternate race in mirror matchups.
   */
  useAlternateRace?: boolean
  /** The race the user has selected to use in mirror matchups. */
  alternateRace?: AssignedRaceChar
}

interface BaseMatchmakingPreferences<T extends MatchmakingType, D> {
  userId: SbUserId
  matchmakingType: T
  /** The main race the user has selected to play in the matchmaking with. */
  race: RaceChar
  /**
   * The ID of the map pool that will be used in the matchmaking. The way in which this map pool
   * will be used depends on the matchmaking type, as each matchmaking type can create its own rules
   * in which to use it (e.g. preferred maps, map vetoes, etc.). This can also be used to determine
   * if the map pool has changed.
   */
  mapPoolId: number
  /**
   * An array of map IDs that the user has selected through a map selection process. The meaning
   * of this selection depends on the matchmaking type and the system it's using. E.g. 1v1/2v2 might
   * use this list as maps the user has vetoed, while in 3v3 it might be used as as a list of maps
   * that the user wants to queue on.
   */
  mapSelections: string[]
  data: D
}

export type MatchmakingPreferences1v1 = BaseMatchmakingPreferences<
  MatchmakingType.Match1v1,
  MatchmakingPreferencesData1v1
>

export type MatchmakingPreferences2v2 = BaseMatchmakingPreferences<
  MatchmakingType.Match2v2,
  Record<string, never>
>

// NOTE(tec27): At the moment we can share the data between 1v1 and 1v1Fastest but if need be we
// could use a separate data type
export type MatchmakingPreferences1v1Fastest = BaseMatchmakingPreferences<
  MatchmakingType.Match1v1Fastest,
  MatchmakingPreferencesData1v1
>

/**
 * Describes a user's preferences for finding a match in matchmaking. Each matchmaking type can have
 * its own custom data, with `race`, `mapPoolId`, and `mapSelections` being common among all
 * matchmaking types.
 */
export type MatchmakingPreferences =
  | MatchmakingPreferences1v1
  | MatchmakingPreferences1v1Fastest
  | MatchmakingPreferences2v2

export type PartialMatchmakingPreferences = SetRequired<
  Partial<MatchmakingPreferences>,
  'matchmakingType' | 'userId'
>

export type MatchmakingPreferencesOfType<M extends MatchmakingType> = Simplify<
  MatchmakingPreferences & {
    matchmakingType: M
  }
>

export type PreferenceData = MatchmakingPreferences['data']

export function defaultPreferenceData<M extends MatchmakingType>(
  matchmakingType: M,
): MatchmakingPreferencesOfType<M>['data'] {
  switch (matchmakingType) {
    case MatchmakingType.Match1v1:
    case MatchmakingType.Match1v1Fastest:
      return {
        useAlternateRace: false,
        alternateRace: 'z',
      }
    case MatchmakingType.Match2v2:
      return {}
    default:
      return assertUnreachable(matchmakingType)
  }
}

export function defaultPreferences<M extends MatchmakingType>(
  matchmakingType: M,
  userId: SbUserId,
  mapPoolId = 1,
): MatchmakingPreferencesOfType<M> {
  return {
    userId,
    matchmakingType: matchmakingType as any,
    race: 'r',
    mapPoolId,
    mapSelections: [] as string[],
    data: defaultPreferenceData<M>(matchmakingType),
  }
}

export interface GetPreferencesResponse {
  preferences: MatchmakingPreferences | Record<string, never>
  mapPoolOutdated: boolean
  currentMapPoolId: number
  mapInfos: MapInfoJson[]
}

export interface StartSearchEvent {
  type: 'startSearch'
  matchmakingType: MatchmakingType
  race: RaceChar
}

export interface MatchFoundEvent {
  type: 'matchFound'
  matchmakingType: MatchmakingType
  numPlayers: number
}

export interface PlayerAcceptedEvent {
  type: 'playerAccepted'
  /** A number of players that have currently accepted the match. */
  acceptedPlayers: number
}

export interface AcceptTimeoutEvent {
  type: 'acceptTimeout'
}

export interface RequeueEvent {
  type: 'requeue'
}

export interface MatchReadyEvent {
  type: 'matchReady'
  matchmakingType: MatchmakingType
  setup: { gameId: string; seed: number; turnRate?: BwTurnRate | 0; userLatency?: BwUserLatency }
  resultCode?: string
  // TODO(tec27): This is not a correct type, this cannot be a Record, it's deserialized from JSON
  slots: Slot[]
  players: MatchmakingPlayer[]
  chosenMap: MapInfoJson
}

export interface SetRoutesEvent {
  type: 'setRoutes'
  routes: GameRoute[]
  gameId: string
}

export interface StartCountdownEvent {
  type: 'startCountdown'
}

export interface StartWhenReadyEvent {
  type: 'startWhenReady'
  gameId: string
}

export interface CancelLoadingEvent {
  type: 'cancelLoading'
  reason: string
}

export interface GameStartedEvent {
  type: 'gameStarted'
}

export interface QueueStatusEvent {
  type: 'queueStatus'
  /**
   * Indicates what type of matchmaking this user is currently queued for, or `undefined` if they
   * are not queued for anything.
   */
  matchmaking?: { type: MatchmakingType }
}

export type MatchmakingEvent =
  | StartSearchEvent
  | MatchFoundEvent
  | PlayerAcceptedEvent
  | AcceptTimeoutEvent
  | RequeueEvent
  | MatchReadyEvent
  | SetRoutesEvent
  | StartCountdownEvent
  | StartWhenReadyEvent
  | CancelLoadingEvent
  | GameStartedEvent
  | QueueStatusEvent

/**
 * Describes the current status (enabled/disabled) of a particular MatchmakingType on the server.
 */
export interface MatchmakingStatus {
  type: MatchmakingType
  enabled: boolean
  startDate?: Date
  nextStartDate?: Date
  nextEndDate?: Date
}

/** Compares two MatchmakingStatus objects for equality. */
export function statusesEqual(a?: MatchmakingStatus, b?: MatchmakingStatus): boolean {
  if (a === b) {
    return true
  } else if (a === undefined || b === undefined) {
    return false
  } else {
    return (
      a.type === b.type &&
      a.enabled === b.enabled &&
      a.startDate === b.startDate &&
      a.nextStartDate === b.nextStartDate &&
      a.nextEndDate === b.nextEndDate
    )
  }
}

export type MatchmakingStatusJson = Jsonify<MatchmakingStatus>

export function toMatchmakingStatusJson(status: MatchmakingStatus): MatchmakingStatusJson {
  return {
    type: status.type,
    enabled: status.enabled,
    startDate: status.startDate ? Number(status.startDate) : undefined,
    nextStartDate: status.nextStartDate ? Number(status.nextStartDate) : undefined,
    nextEndDate: status.nextEndDate ? Number(status.nextEndDate) : undefined,
  }
}

export function fromMatchmakingStatusJson(status: MatchmakingStatusJson): MatchmakingStatus {
  return {
    type: status.type,
    enabled: status.enabled,
    startDate: status.startDate ? new Date(status.startDate) : undefined,
    nextStartDate: status.nextStartDate ? new Date(status.nextStartDate) : undefined,
    nextEndDate: status.nextEndDate ? new Date(status.nextEndDate) : undefined,
  }
}

/**
 * An event sent by the MatchmakingStatusService to describe the status of MatchmakingTypes on
 * the server. Sent both to initialize all the statuses, as well as for updates to particular types.
 */
export type MatchmakingStatusUpdateEvent = MatchmakingStatusJson[]

/** Describes how a user completed matchmaking (i.e. how their search process was terminated). */
export enum MatchmakingCompletionType {
  /** The user completed matchmaking by finding a match. */
  Found = 'found',
  /** The user completed matchmaking by canceling out of the search process. */
  Cancel = 'cancel',
  /** The user completed matchmaking by disconnecting from the server. */
  Disconnect = 'disconnect',
}

/** A record of a terminated matchmaking search. */
export interface MatchmakingCompletion {
  id: string
  userId: SbUserId
  matchmakingType: MatchmakingType
  completionType: MatchmakingCompletionType
  searchTimeMillis: number
  completionTime: Date
}

export enum MatchmakingServiceErrorCode {
  ClientDisconnected = 'clientDisconnected',
  GameplayConflict = 'gameplayConflict',
  InvalidClient = 'invalidClient',
  InvalidMapPool = 'invalidMapPool',
  InvalidMaps = 'invalidMaps',
  MatchAlreadyStarting = 'matchAlreadyStarting',
  MatchmakingDisabled = 'matchmakingDisabled',
  NotInQueue = 'notInQueue',
  NoActiveMatch = 'noActiveMatch',
  TooManyPlayers = 'tooManyPlayers',
  UserOffline = 'userOffline',
}

export interface FindMatchRequest {
  clientId: string
  preferences: MatchmakingPreferences
  identifiers: [type: number, hashStr: string][]
}

export enum MatchmakingSeasonsServiceErrorCode {
  MustBeInFuture = 'mustBeInFuture',
  NotFound = 'notFound',
}

export interface GetMatchmakingSeasonsResponse {
  seasons: MatchmakingSeasonJson[]
  current: SeasonId
}

export type ServerAddMatchmakingSeasonRequest = Omit<MatchmakingSeason, 'id'>

export type AddMatchmakingSeasonRequest = Jsonify<ServerAddMatchmakingSeasonRequest>

export interface AddMatchmakingSeasonResponse {
  season: MatchmakingSeasonJson
}

export interface GetCurrentMatchmakingSeasonResponse {
  season: MatchmakingSeasonJson
}
