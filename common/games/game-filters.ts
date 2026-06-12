import { TFunction } from 'i18next'
import { Tagged } from 'type-fest'
import { AssignedRaceChar } from '../races'

/** Duration filter options. */
export enum GameDurationFilter {
  All = 'all',
  Under10 = 'under10',
  From10To20 = '10to20',
  From20To30 = '20to30',
  Over30 = 'over30',
}

export const getDurationLabel = (d: GameDurationFilter, t: TFunction): string => {
  switch (d) {
    case GameDurationFilter.All:
      return t('game.filters.duration.all', 'All')
    case GameDurationFilter.Under10:
      return t('game.filters.duration.under10', 'Under 10min')
    case GameDurationFilter.From10To20:
      return t('game.filters.duration.10to20', '10-20min')
    case GameDurationFilter.From20To30:
      return t('game.filters.duration.20to30', '20-30min')
    case GameDurationFilter.Over30:
      return t('game.filters.duration.over30', 'Over 30min')
    default:
      return d satisfies never
  }
}

/** Sort options for game lists. */
export enum GameSortOption {
  LatestFirst = 'latest',
  OldestFirst = 'oldest',
  ShortestFirst = 'shortest',
  LongestFirst = 'longest',
}

export const getSortLabel = (s: GameSortOption, t: TFunction): string => {
  switch (s) {
    case GameSortOption.LatestFirst:
      return t('game.filters.sort.latest', 'Latest first')
    case GameSortOption.OldestFirst:
      return t('game.filters.sort.oldest', 'Oldest first')
    case GameSortOption.ShortestFirst:
      return t('game.filters.sort.shortest', 'Shortest first')
    case GameSortOption.LongestFirst:
      return t('game.filters.sort.longest', 'Longest first')
    default:
      return s satisfies never
  }
}

/** Game format (team size). */
export type GameFormat = '1v1' | '2v2' | '3v3' | '4v4'

export const ALL_GAME_FORMATS: ReadonlyArray<GameFormat> = ['1v1', '2v2', '3v3', '4v4']

/**
 * A URL-friendly encoded matchup string, e.g. `'p_-_z'`, `'pt-tz'`. Uses `_` for wildcard slots
 * (any race). Distinct from `MatchupString` which is the canonical form without wildcards.
 */
export type EncodedMatchupString = Tagged<string, 'EncodedMatchupString'>

/**
 * Converts a string to a properly typed `EncodedMatchupString`. Prefer better ways of getting a
 * typed version, such as encoding via `encodeMatchup`. This method should mainly be considered for
 * testing and internal behavior.
 */
export function makeEncodedMatchupString(s: string): EncodedMatchupString {
  return s as EncodedMatchupString
}

/** Matchup race filter - undefined means wildcard (any race). */
export type MatchupRaceSlot = AssignedRaceChar | undefined

/** Team races in a matchup (length = team size). */
export type TeamRaces = MatchupRaceSlot[]

/** Full matchup filter with both teams. */
export interface MatchupFilter {
  team1: TeamRaces
  team2: TeamRaces
}

/**
 * Returns the team size for a given game format.
 */
export function getTeamSizeForFormat(format: GameFormat): number {
  switch (format) {
    case '1v1':
      return 1
    case '2v2':
      return 2
    case '3v3':
      return 3
    case '4v4':
      return 4
    default:
      return format satisfies never
  }
}

/**
 * Creates an empty matchup filter for a given format with all slots set to undefined (any race).
 */
export function createEmptyMatchup(format: GameFormat): MatchupFilter {
  const teamSize = getTeamSizeForFormat(format)
  return {
    team1: Array(teamSize).fill(undefined),
    team2: Array(teamSize).fill(undefined),
  }
}

/**
 * Encodes a matchup filter to a URL-friendly string.
 * Format: "ptz-ttz" where each character is a race or '_' for wildcard.
 */
export function encodeMatchup(matchup: MatchupFilter): EncodedMatchupString {
  const encodeTeam = (team: TeamRaces): string => {
    return team.map(r => r ?? '_').join('')
  }
  return makeEncodedMatchupString(`${encodeTeam(matchup.team1)}-${encodeTeam(matchup.team2)}`)
}

/**
 * Decodes a matchup string for a given format back to a MatchupFilter.
 * Returns undefined if the string is invalid or doesn't match the expected format.
 */
export function decodeMatchup(
  format: GameFormat,
  matchupStr?: EncodedMatchupString,
): MatchupFilter | undefined {
  if (!matchupStr) {
    return undefined
  }

  const teamSize = getTeamSizeForFormat(format)
  const parts = matchupStr.split('-')
  if (parts.length !== 2) {
    return undefined
  }

  const decodeTeam = (teamStr: string): TeamRaces | undefined => {
    if (teamStr.length !== teamSize) {
      return undefined
    }

    const races: TeamRaces = []
    for (const char of teamStr) {
      if (char === '_') {
        races.push(undefined)
      } else if (char === 'p' || char === 't' || char === 'z') {
        races.push(char)
      } else {
        return undefined
      }
    }
    return races
  }

  const team1 = decodeTeam(parts[0])
  const team2 = decodeTeam(parts[1])

  if (!team1 || !team2) {
    return undefined
  }

  return { team1, team2 }
}
