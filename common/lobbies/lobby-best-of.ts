import { ReconciledResult } from '../games/results'
import { SbUserId } from '../users/sb-user-id'
import { Lobby, Team } from './index'
import { SlotType } from './slot'

/** The longest best-of series a lobby can play. */
export const BEST_OF_MAX_LENGTH = 99
/** The most characters a best-of series' title can have, once trimmed. */
export const BEST_OF_TITLE_MAX_LENGTH = 50
/** The most people either side of a best-of series can hold. */
export const BEST_OF_MAX_SIDE_SIZE = 4
/** The lengths offered as one-click choices; any odd length up to BEST_OF_MAX_LENGTH is valid. */
export const BEST_OF_PRESET_LENGTHS: ReadonlyArray<number> = [1, 3, 5, 7, 9]
/** The most characters either text line of a best-of series' caster overlay can have, once trimmed. */
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
   * and the games already won stay with the side, not with the people who won them.
   */
  sides: LobbyBestOfSides
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
  /** Always two entries, in side order. */
  sides: Array<{ players: SbUserId[]; score: number }>
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
 * Returns which side won a game of a best-of series, given who played for each side and how each
 * player fared. A side has a win when any of its players won; the game has a winner only when
 * exactly one side does.
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
  | { ok: false; missing: SbUserId[]; extra: SbUserId[]; mixedTeams: boolean }

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
 * Checks whether a lobby's seats hold exactly the people of a best-of series, arranged so its next
 * game is played between its two sides.
 *
 * Every member of either side has to sit in a player seat, and nobody else may. When the people sit
 * in more than one team, no team may mix people of both sides; in a game type with a single team
 * (melee, free for all) any arrangement works. Computers and observers make no difference either
 * way.
 *
 * missing = side members not in a human player seat; extra = seated human players on neither side;
 * mixedTeams per the rule above.
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
  const seated = new Set(teams.flat())
  const missing = [...sides[0], ...sides[1]].filter(userId => !seated.has(userId))
  const extra = [...seated].filter(userId => !sideByUser.has(userId))
  const mixedTeams =
    teams.length > 1 &&
    teams.some(humans => {
      const teamSides = new Set(humans.map(userId => sideByUser.get(userId)))
      return teamSides.has(0) && teamSides.has(1)
    })

  return missing.length || extra.length || mixedTeams
    ? { ok: false, missing, extra, mixedTeams }
    : { ok: true }
}

/** The running best-of of a list, if any (the last one when it has no outcome). */
export function getRunningBestOf<T extends { outcome?: LobbyBestOfOutcome }>(
  bestOfs: ReadonlyArray<T>,
): T | undefined {
  const last = bestOfs.at(-1)
  return last && !last.outcome ? last : undefined
}

/** Describes where a best-of series stands for its next game, as that game launches. */
export function toBestOfLaunchInfo(bestOf: LobbyBestOfJson): BestOfLaunchInfo {
  const score = getBestOfScore(bestOf)
  const lines = getBestOfOverlayLines(bestOf.overlay)
  const logoUrl = bestOf.overlay?.logo?.url
  return {
    ...(bestOf.title !== undefined ? { title: bestOf.title } : {}),
    length: bestOf.length,
    gameNumber: getBestOfGameNumber(bestOf, bestOf.games.length),
    sides: [
      { players: [...bestOf.sides[0]], score: score[0] },
      { players: [...bestOf.sides[1]], score: score[1] },
    ],
    ...(lines.length ? { lines } : {}),
    ...(logoUrl !== undefined ? { logoUrl } : {}),
  }
}

/**
 * The sides the current seats suggest, for prefilling a start form: when exactly two non-observer
 * teams hold humans, those two teams' humans; when a single non-observer team holds exactly two
 * humans, one each; otherwise undefined.
 *
 * A team holding more people than a side can is no suggestion either, since it couldn't be
 * submitted as one.
 */
export function suggestBestOfSides(lobby: Lobby): LobbyBestOfSides | undefined {
  const teams = getHumanPlayerTeams(lobby)
  let sides: LobbyBestOfSides | undefined
  if (teams.length === 2) {
    sides = [teams[0], teams[1]]
  } else if (teams.length === 1 && teams[0].length === 2) {
    sides = [[teams[0][0]], [teams[0][1]]]
  }

  return sides && sides.every(side => side.length <= BEST_OF_MAX_SIDE_SIZE) ? sides : undefined
}
