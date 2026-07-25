import {
  ALL_GAME_FORMATS,
  decodeMatchup,
  EncodedMatchupString,
  GameDurationFilter,
  GameFormat,
  GameSortOption,
  makeEncodedMatchupString,
} from '../../common/games/game-filters'

/**
 * Parses a `duration` URL search param, shared by every games-list page that stores its filter
 * state in the URL (the games page, match history, a league's games).
 */
export function parseDuration(value: string): GameDurationFilter {
  return Object.values(GameDurationFilter).includes(value as GameDurationFilter)
    ? (value as GameDurationFilter)
    : GameDurationFilter.All
}

/** Parses a `sort` URL search param. */
export function parseSort(value: string): GameSortOption {
  return Object.values(GameSortOption).includes(value as GameSortOption)
    ? (value as GameSortOption)
    : GameSortOption.LatestFirst
}

/** Parses a `format` URL search param. */
export function parseFormat(value: string): GameFormat | undefined {
  return ALL_GAME_FORMATS.includes(value as GameFormat) ? (value as GameFormat) : undefined
}

/** Parses a `matchup` URL search param. */
export function parseMatchup(
  value: string,
  format: GameFormat | undefined,
): EncodedMatchupString | undefined {
  if (!value || !format) {
    return undefined
  }
  // Only keep the matchup if it actually decodes for the current format. This mirrors what the
  // server does and means a hand-edited URL (e.g. `?matchup=foo`) gets ignored rather than sent
  // along to fail server-side validation and show the user a generic error screen.
  const encoded = makeEncodedMatchupString(value)
  return decodeMatchup(format, encoded) ? encoded : undefined
}

/** A date-based sort groups games by calendar day; the duration sorts render as a flat list. */
export function isDateSort(sort: GameSortOption): boolean {
  return sort === GameSortOption.LatestFirst || sort === GameSortOption.OldestFirst
}
