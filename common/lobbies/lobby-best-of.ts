import { USERNAME_MAXLENGTH } from '../constants'
import { ReconciledResult } from '../games/results'
import { SbUserId } from '../users/sb-user-id'
import { Lobby, Team } from './index'
import { SlotType } from './slot'

/** The longest best-of series a lobby can play. */
export const BEST_OF_MAX_LENGTH = 99
/**
 * The most characters a best-of series' title can have, once trimmed, counted in code points (see
 * `countBestOfTextCharacters`).
 */
export const BEST_OF_TITLE_MAX_LENGTH = 50
/**
 * The most people either side of a best-of series can hold. A side can hold more people than a game
 * seats, since only the ones seated as players play its next game.
 */
export const BEST_OF_MAX_SIDE_SIZE = 8
/**
 * The most characters a best-of series side's name can have, once trimmed, counted in code points
 * (see `countBestOfTextCharacters`).
 */
export const BEST_OF_SIDE_NAME_MAX_LENGTH = 24
/**
 * The most characters a display name given to someone on a best-of series' side can have, once
 * trimmed, counted in code points (see `countBestOfTextCharacters`). The same as an account name's.
 */
export const BEST_OF_DISPLAY_NAME_MAX_LENGTH = USERNAME_MAXLENGTH
/** The lengths offered as one-click choices; any odd length up to BEST_OF_MAX_LENGTH is valid. */
export const BEST_OF_PRESET_LENGTHS: ReadonlyArray<number> = [1, 3, 5, 7, 9]
/**
 * The most characters either text line of a best-of series' caster overlay can have, once trimmed,
 * counted in code points (see `countBestOfTextCharacters`).
 */
export const BEST_OF_OVERLAY_LINE_MAX_LENGTH = 60
/** The largest logo file a host can upload for a best-of series' caster overlay, in bytes. */
export const BEST_OF_LOGO_MAX_SIZE_BYTES = 2 * 1024 * 1024
/**
 * The longest side, in pixels, a PNG or WebP logo for a best-of series' caster overlay can have. An
 * SVG logo is drawn at whatever size the overlay needs, so only its file size is limited.
 */
export const BEST_OF_LOGO_MAX_DIMENSION = 1024
/**
 * The file types a best-of series' logo can be uploaded as. The server tells them apart by the
 * file's content, so these are only for file pickers.
 */
export const BEST_OF_LOGO_ACCEPTED_TYPES: ReadonlyArray<string> = [
  'image/png',
  'image/webp',
  'image/svg+xml',
]

/** Which of a best-of series' two sides something refers to, in the order the host gave them. */
export type BestOfSideIndex = 0 | 1

/** The people playing a best-of series, as two sides of user ids. */
export type LobbyBestOfSides = [side0: SbUserId[], side1: SbUserId[]]

/** The names of a best-of series' two sides, in side order, with `null` for a side that has none. */
export type LobbyBestOfSideNames = [side0: string | null, side1: string | null]

/**
 * A name the host gave someone on a side of a best-of series, which the in-game observer overlay
 * shows in place of their account name. Nothing else shows it.
 */
export interface BestOfDisplayName {
  userId: SbUserId
  name: string
}

/**
 * A display name a host sets or clears for someone on a side of a best-of series. `null` or a name
 * that is empty once trimmed clears it.
 */
export interface BestOfDisplayNameChange {
  userId: SbUserId
  name: string | null
}

/** One game launched as part of a best-of series, and how it counts towards it. */
export type LobbyBestOfGameJson =
  /** The game is running, or is over with results that haven't settled yet. */
  | { gameId: string; status: 'pending' }
  | { gameId: string; status: 'won'; winner: BestOfSideIndex }
  /** The game's results settled without exactly one side having a win, so it counts for nobody. */
  | { gameId: string; status: 'noWinner' }
  /** The host discarded the game before its results settled, so it counts for nobody. */
  | { gameId: string; status: 'notCounted' }

/** How a best-of series that is over ended. */
export type LobbyBestOfOutcome =
  /** One side won more than half of its games. */
  | { kind: 'won'; winner: BestOfSideIndex }
  /** The host ended it before either side had won. */
  | { kind: 'unfinished' }

/** A logo a host uploaded for the caster overlay of their best-of series. */
export interface LobbyBestOfLogoJson {
  /** Where the logo is served from, always as a PNG whatever format it was uploaded in. */
  url: string
  /** The name of the file the host uploaded it from. */
  fileName: string
}

/**
 * What a best-of series shows observers on the in-game scoreboard beyond the score. Every part is
 * optional, and a part that isn't set is absent.
 */
export interface LobbyBestOfOverlayJson {
  /** Trimmed, at most `BEST_OF_OVERLAY_LINE_MAX_LENGTH` characters, never empty. */
  line1?: string
  /** Trimmed, at most `BEST_OF_OVERLAY_LINE_MAX_LENGTH` characters, never empty. */
  line2?: string
  logo?: LobbyBestOfLogoJson
}

/**
 * A best-of series the host of a lobby started: a set number of games between two sides the host
 * picked, which ends as soon as one side has won more than half of them.
 */
export interface LobbyBestOfJson {
  /** Unique within its lobby. */
  id: string
  title?: string
  length: number
  /**
   * The people currently playing for each side. The host can change these while the series runs,
   * and the games already won stay with the side, not with the people who won them. A side can hold
   * more people than play any one game: its next game is played by those of them seated as players.
   */
  sides: LobbyBestOfSides
  /**
   * The sides' names: trimmed, never empty, at most `BEST_OF_SIDE_NAME_MAX_LENGTH` characters, with
   * `null` for a side that has none. Absent when neither side has a name.
   */
  sideNames?: LobbyBestOfSideNames
  /**
   * The display names the host gave people on either side, for the in-game observer overlay only:
   * trimmed, never empty, at most `BEST_OF_DISPLAY_NAME_MAX_LENGTH` characters. Ordered as the
   * people are on `sides`, and only ever for someone on a side. Absent when nobody has one.
   */
  displayNames?: BestOfDisplayName[]
  /** The games launched as part of it, oldest first. */
  games: LobbyBestOfGameJson[]
  /** Absent when it shows observers nothing beyond the score. */
  overlay?: LobbyBestOfOverlayJson
  /** Absent while it is running. */
  outcome?: LobbyBestOfOutcome
}

/** Where a best-of series stands as one of its games launches, for showing it alongside the game. */
export interface BestOfLaunchInfo {
  title?: string
  length: number
  /** 1-based: games won so far (by either side) + 1. */
  gameNumber: number
  /**
   * Always two entries, in side order. `players` holds only the side's members seated as players
   * in the game, in side order; `name` is absent when the side has none.
   */
  sides: Array<{ players: SbUserId[]; score: number; name?: string }>
  /**
   * The display names of the people seated as players in the game who have one, in side order.
   * Absent when none of them does.
   */
  displayNames?: BestOfDisplayName[]
  /** The caster overlay's text lines that are set, line 1 first. Absent when neither is. */
  lines?: string[]
  /** Where the caster overlay's logo is served from, as a PNG. Absent when it has none. */
  logoUrl?: string
}

/**
 * Returns a best-of series' caster overlay as it is kept: absent when none of its parts is set, and
 * otherwise holding only the parts that are.
 */
export function toBestOfOverlayJson({
  line1,
  line2,
  logo,
}: LobbyBestOfOverlayJson): LobbyBestOfOverlayJson | undefined {
  if (!line1 && !line2 && !logo) {
    return undefined
  }
  return {
    ...(line1 ? { line1 } : {}),
    ...(line2 ? { line2 } : {}),
    ...(logo ? { logo } : {}),
  }
}

/** Returns the text lines of a caster overlay that are set, line 1 first. */
export function getBestOfOverlayLines(overlay: LobbyBestOfOverlayJson | undefined): string[] {
  return [overlay?.line1, overlay?.line2].filter((line): line is string => !!line)
}

/**
 * Characters no text a host types for a best-of series (its title, caster overlay lines, side names
 * and display names) can contain. The lobby and the in-game overlay draw each of these as a single
 * line of text that has to look the way it reads, and the game has to be able to decode it:
 *
 * - control characters (line breaks and tabs among them), and the line and paragraph separators
 * - lone surrogates, which are no character at all and which the game can't decode, so its whole
 *   setup would fail to load
 * - invisible formatting characters, among them the bidirectional overrides, embeddings, isolates
 *   and marks that reorder the text around them, zero-width spaces, word joiners, soft hyphens and
 *   tag characters. Zero-width joiners and non-joiners are kept, since emoji sequences and the
 *   writing of several scripts depend on them.
 */
const REFUSED_TEXT_CHARACTERS = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}]|(?!\p{Join_Control})\p{Cf}/u

/** Why text a host typed for a best-of series can't be used. */
export type BestOfTextProblem =
  /** It has more characters than the limit once trimmed. */
  | 'tooLong'
  /** It contains a character `getBestOfTextProblem` refuses. */
  | 'invalidCharacters'

/**
 * Returns how many characters text typed for a best-of series has, the way its limits count them:
 * in code points, so a character outside the Basic Multilingual Plane (most emoji, for one) counts
 * once.
 */
export function countBestOfTextCharacters(text: string): number {
  return Array.from(text).length
}

/**
 * Returns what keeps text a host typed for a best-of series from being used, once trimmed, or
 * `undefined` when nothing does. Any text works apart from line breaks, other control characters,
 * lone surrogates and invisible formatting characters, up to `maxLength` characters counted by
 * `countBestOfTextCharacters`: `BEST_OF_TITLE_MAX_LENGTH` for the title,
 * `BEST_OF_OVERLAY_LINE_MAX_LENGTH` for a caster overlay line, `BEST_OF_SIDE_NAME_MAX_LENGTH` for a
 * side's name and `BEST_OF_DISPLAY_NAME_MAX_LENGTH` for a display name. Empty text is fine: it is
 * none.
 */
export function getBestOfTextProblem(
  text: string,
  maxLength: number,
): BestOfTextProblem | undefined {
  const trimmed = text.trim()
  if (REFUSED_TEXT_CHARACTERS.test(trimmed)) {
    return 'invalidCharacters'
  }
  return countBestOfTextCharacters(trimmed) > maxLength ? 'tooLong' : undefined
}

/** Returns the name a side of a best-of series has, if it has one. */
export function getBestOfSideName(
  bestOf: Pick<LobbyBestOfJson, 'sideNames'>,
  side: BestOfSideIndex,
): string | undefined {
  return bestOf.sideNames?.[side] ?? undefined
}

/** Returns the display name the host gave someone on a side of a best-of series, if any. */
export function getBestOfDisplayName(
  bestOf: Pick<LobbyBestOfJson, 'displayNames'>,
  userId: SbUserId,
): string | undefined {
  return bestOf.displayNames?.find(entry => entry.userId === userId)?.name
}

/** Whether `length` is a best-of series length a lobby can play: an odd number of games. */
export function isValidBestOfLength(length: number): boolean {
  return Number.isInteger(length) && length >= 1 && length <= BEST_OF_MAX_LENGTH && length % 2 === 1
}

/** Returns how many games of a best-of series each side has won. */
export function getBestOfScore(bestOf: Pick<LobbyBestOfJson, 'games'>): [number, number] {
  const score: [number, number] = [0, 0]
  for (const game of bestOf.games) {
    if (game.status === 'won') {
      score[game.winner] += 1
    }
  }
  return score
}

/** Returns how many games a side has to win to win a best-of series of `length` games. */
export function getBestOfWinsNeeded(length: number): number {
  return Math.floor(length / 2) + 1
}

/**
 * 1-based number of the game at `index` in bestOf.games (or of the next game when index ===
 * games.length): won games before it + 1, so a replayed game shares its number with the one it
 * replaces.
 */
export function getBestOfGameNumber(bestOf: Pick<LobbyBestOfJson, 'games'>, index: number): number {
  let won = 0
  for (const game of bestOf.games.slice(0, index)) {
    if (game.status === 'won') {
      won += 1
    }
  }
  return won + 1
}

/**
 * Returns which side won a game of a best-of series, given who was on each side when it launched
 * and how each player fared. A side has a win when any of its members won, whichever of them played;
 * the game has a winner only when exactly one side does.
 */
export function findBestOfGameWinner(
  sides: Readonly<LobbyBestOfSides>,
  outcomes: ReadonlyArray<{ userId: SbUserId; result: ReconciledResult }>,
): BestOfSideIndex | undefined {
  const winners = new Set(outcomes.filter(o => o.result === 'win').map(o => o.userId))
  const side0Won = sides[0].some(userId => winners.has(userId))
  const side1Won = sides[1].some(userId => winners.has(userId))
  if (side0Won === side1Won) {
    return undefined
  }
  return side0Won ? 0 : 1
}

export type BestOfRosterCheck =
  | { ok: true }
  | {
      ok: false
      /** The sides none of whose members sit in a player seat, in side order. */
      unseatedSides: BestOfSideIndex[]
      /** The people seated as players who are on neither side, in seat order. */
      extra: SbUserId[]
      /** Whether a team of several holds players of both sides. */
      mixedTeams: boolean
    }

/** The user ids of the people seated in a team's player seats, in seat order. */
function getTeamHumans(team: Team): SbUserId[] {
  return team.slots.filter(slot => slot.type === SlotType.Human).map(slot => slot.userId!)
}

/** The player teams of a lobby that have at least one person seated in them, with those people. */
function getHumanPlayerTeams(lobby: Lobby): SbUserId[][] {
  return lobby.teams
    .filter(team => !team.isObserver)
    .map(getTeamHumans)
    .filter(humans => humans.length > 0)
}

/**
 * Returns the members of each side of a best-of series who sit in a player seat of the lobby, so
 * who would play for each side if its next game started now. Each side's members are in side order;
 * members observing or on the bench are left out.
 */
export function getBestOfSeatedSides(
  lobby: Lobby,
  sides: Readonly<LobbyBestOfSides>,
): LobbyBestOfSides {
  const seated = new Set(getHumanPlayerTeams(lobby).flat())
  return [
    sides[0].filter(userId => seated.has(userId)),
    sides[1].filter(userId => seated.has(userId)),
  ]
}

/**
 * Checks whether a lobby's seats are arranged so its next game is played between the two sides of
 * a best-of series.
 *
 * Every person in a player seat has to be on one of the sides, and each side needs at least one of
 * its members in a player seat; side members who observe or wait on the bench don't hold the game
 * up. When the players sit in more than one team, no team may mix people of both sides; in a game
 * type with a single team (melee, free for all) any arrangement works. Computers make no difference
 * either way.
 */
export function checkBestOfRoster(
  lobby: Lobby,
  sides: Readonly<LobbyBestOfSides>,
): BestOfRosterCheck {
  const sideByUser = new Map<SbUserId, BestOfSideIndex>()
  for (const userId of sides[0]) {
    sideByUser.set(userId, 0)
  }
  for (const userId of sides[1]) {
    sideByUser.set(userId, 1)
  }

  const teams = getHumanPlayerTeams(lobby)
  const seatedSides = getBestOfSeatedSides(lobby, sides)
  const unseatedSides = ([0, 1] as const).filter(side => seatedSides[side].length === 0)
  const extra = teams.flat().filter(userId => !sideByUser.has(userId))
  const mixedTeams =
    teams.length > 1 &&
    teams.some(humans => {
      const teamSides = new Set(humans.map(userId => sideByUser.get(userId)))
      return teamSides.has(0) && teamSides.has(1)
    })

  return unseatedSides.length || extra.length || mixedTeams
    ? { ok: false, unseatedSides, extra, mixedTeams }
    : { ok: true }
}

/** The running best-of of a list, if any (the last one when it has no outcome). */
export function getRunningBestOf<T extends { outcome?: LobbyBestOfOutcome }>(
  bestOfs: ReadonlyArray<T>,
): T | undefined {
  const last = bestOfs.at(-1)
  return last && !last.outcome ? last : undefined
}

/**
 * Describes where a best-of series stands for its next game, as that game launches from `lobby`:
 * each side lists only its members seated as players, and only their display names are carried.
 */
export function toBestOfLaunchInfo(bestOf: LobbyBestOfJson, lobby: Lobby): BestOfLaunchInfo {
  const score = getBestOfScore(bestOf)
  const lines = getBestOfOverlayLines(bestOf.overlay)
  const logoUrl = bestOf.overlay?.logo?.url
  const seatedSides = getBestOfSeatedSides(lobby, bestOf.sides)
  const toSide = (side: BestOfSideIndex) => {
    const name = getBestOfSideName(bestOf, side)
    return {
      players: seatedSides[side],
      score: score[side],
      ...(name !== undefined ? { name } : {}),
    }
  }
  const displayNames = seatedSides.flat().flatMap(userId => {
    const name = getBestOfDisplayName(bestOf, userId)
    return name !== undefined ? [{ userId, name }] : []
  })

  return {
    ...(bestOf.title !== undefined ? { title: bestOf.title } : {}),
    length: bestOf.length,
    gameNumber: getBestOfGameNumber(bestOf, bestOf.games.length),
    sides: [toSide(0), toSide(1)],
    ...(displayNames.length ? { displayNames } : {}),
    ...(lines.length ? { lines } : {}),
    ...(logoUrl !== undefined ? { logoUrl } : {}),
  }
}

/**
 * The sides the current seats suggest, for prefilling a start form: when exactly two non-observer
 * teams hold humans, those two teams' humans; when a single non-observer team holds exactly two
 * humans, one each; otherwise undefined. A side holds as many people as a game seats, so any team
 * fits on one.
 */
export function suggestBestOfSides(lobby: Lobby): LobbyBestOfSides | undefined {
  const teams = getHumanPlayerTeams(lobby)
  if (teams.length === 2) {
    return [teams[0], teams[1]]
  } else if (teams.length === 1 && teams[0].length === 2) {
    return [[teams[0][0]], [teams[0][1]]]
  }
  return undefined
}
