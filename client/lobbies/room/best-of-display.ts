import { Lobby } from '../../../common/lobbies'
import {
  checkBestOfRoster,
  getBestOfGameNumber,
  getRunningBestOf,
  LobbyBestOfGameJson,
  LobbyBestOfJson,
} from '../../../common/lobbies/lobby-best-of'
import { LobbySeriesGameJson } from '../../../common/lobbies/lobby-network'
import { SlotType } from '../../../common/lobbies/slot'
import { SbUserId } from '../../../common/users/sb-user-id'

/** A finished game of the lobby, with the number the room shows it under. */
export interface NumberedSeriesGame {
  game: LobbySeriesGameJson
  /**
   * 1-based. Within a best-of series, counted the way the series counts its games (a replayed game
   * shares its number with the one it replaces); otherwise, its place among the lobby's games.
   */
  gameNumber: number
  /** The best-of series the game was played in, if it was played in one. */
  bestOf?: LobbyBestOfJson
  /** How the game counts towards that best-of series. */
  bestOfGame?: LobbyBestOfGameJson
}

/**
 * The games of a best-of series that the lobby has finished (and so carries in its `series`), in
 * the order they were played, numbered the way the series counts them.
 */
export function getBestOfSeriesGames(
  bestOf: LobbyBestOfJson,
  series: ReadonlyArray<LobbySeriesGameJson>,
): NumberedSeriesGame[] {
  const seriesById = new Map(series.map(game => [game.gameId, game]))
  return bestOf.games.flatMap((bestOfGame, index) => {
    const game = seriesById.get(bestOfGame.gameId)
    return game
      ? [{ game, gameNumber: getBestOfGameNumber(bestOf, index), bestOf, bestOfGame }]
      : []
  })
}

/**
 * The best-of series the room shows in place of the lobby's plain run of games: the running one,
 * or else the one that ended last, for as long as the lobby hasn't moved on to a game outside it.
 *
 * Every game the lobby launches while a series runs belongs to it, so an ended series is still the
 * lobby's latest business exactly while no finished game follows its own, and no game is on its way
 * (`isLaunching`: counting down, loading or being played). A series that ended without any finished
 * game has no place among the lobby's games to show it at, so it isn't shown.
 */
export function getDisplayedBestOf(
  bestOfs: ReadonlyArray<LobbyBestOfJson>,
  series: ReadonlyArray<LobbySeriesGameJson>,
  isLaunching: boolean,
): LobbyBestOfJson | undefined {
  const running = getRunningBestOf(bestOfs)
  if (running) {
    return running
  }

  const last = bestOfs.at(-1)
  if (!last || isLaunching) {
    return undefined
  }

  const gameIds = new Set(last.games.map(game => game.gameId))
  const firstIndex = series.findIndex(game => gameIds.has(game.gameId))
  if (firstIndex === -1) {
    return undefined
  }
  return series.slice(firstIndex).every(game => gameIds.has(game.gameId)) ? last : undefined
}

/** One row of the lobby's full list of games. */
export type SessionGamesEntry =
  /** Begins the run of games that belong to a best-of series. */
  { kind: 'bestOf'; bestOf: LobbyBestOfJson } | ({ kind: 'game' } & NumberedSeriesGame)

/**
 * Lays out the lobby's finished games in the order they were played, with each best-of series'
 * games headed by the series. Games within a series are numbered the way the series counts them,
 * and the rest by their place among the lobby's games.
 *
 * The running series is headed even before it has a finished game, at the end of the list, since
 * that's where its games will go. A series that ended without any finished game has no place in
 * the list, so it is left out.
 */
export function groupSessionGames(
  series: ReadonlyArray<LobbySeriesGameJson>,
  bestOfs: ReadonlyArray<LobbyBestOfJson>,
): SessionGamesEntry[] {
  const byGameId = new Map<string, { bestOf: LobbyBestOfJson; index: number }>()
  for (const bestOf of bestOfs) {
    bestOf.games.forEach((game, index) => byGameId.set(game.gameId, { bestOf, index }))
  }

  const entries: SessionGamesEntry[] = []
  const headed = new Set<string>()
  let currentBestOf: LobbyBestOfJson | undefined
  series.forEach((game, seriesIndex) => {
    const owner = byGameId.get(game.gameId)
    if (owner && owner.bestOf !== currentBestOf) {
      entries.push({ kind: 'bestOf', bestOf: owner.bestOf })
      headed.add(owner.bestOf.id)
    }
    currentBestOf = owner?.bestOf

    entries.push(
      owner
        ? {
            kind: 'game',
            game,
            gameNumber: getBestOfGameNumber(owner.bestOf, owner.index),
            bestOf: owner.bestOf,
            bestOfGame: owner.bestOf.games[owner.index],
          }
        : { kind: 'game', game, gameNumber: seriesIndex + 1 },
    )
  })

  const running = getRunningBestOf(bestOfs)
  if (running && !headed.has(running.id)) {
    entries.push({ kind: 'bestOf', bestOf: running })
  }

  return entries
}

/** Why the running best-of series keeps the lobby from starting its next game. */
export type BestOfStartBlocker =
  | { kind: 'bestOfGamePending' }
  | { kind: 'bestOfMissingPlayer'; userId: SbUserId }
  | { kind: 'bestOfExtraPlayer'; userId: SbUserId }
  | { kind: 'bestOfMixedTeams' }

/**
 * Returns what keeps the lobby's next game from being a game of its running best-of series, which
 * the server refuses to start, or `undefined` when nothing does (or no series is running).
 *
 * A game of the series still waiting for its result comes first, since nothing about the seats can
 * fix that. A roster problem names only the first person it's about.
 */
export function getBestOfStartBlocker(
  lobby: Lobby,
  bestOfs: ReadonlyArray<LobbyBestOfJson>,
): BestOfStartBlocker | undefined {
  const running = getRunningBestOf(bestOfs)
  if (!running) {
    return undefined
  }
  if (running.games.some(game => game.status === 'pending')) {
    return { kind: 'bestOfGamePending' }
  }

  const roster = checkBestOfRoster(lobby, running.sides)
  if (roster.ok) {
    return undefined
  } else if (roster.missing.length) {
    return { kind: 'bestOfMissingPlayer', userId: roster.missing[0] }
  } else if (roster.extra.length) {
    return { kind: 'bestOfExtraPlayer', userId: roster.extra[0] }
  } else {
    return { kind: 'bestOfMixedTeams' }
  }
}

/** A lobby member the host can put on a side of a best-of series, and where they are now. */
export interface BestOfCandidate {
  userId: SbUserId
  seat: 'player' | 'observer' | 'bench'
}

/**
 * The lobby's members who aren't on either side yet: the seated players first, then the observers,
 * then the bench, each in seat or queue order.
 */
export function getBestOfCandidates(
  lobby: Lobby,
  sides: ReadonlyArray<ReadonlyArray<SbUserId>>,
): BestOfCandidate[] {
  const taken = new Set(sides.flat())
  const players: BestOfCandidate[] = []
  const observers: BestOfCandidate[] = []
  for (const team of lobby.teams) {
    for (const slot of team.slots) {
      if (slot.userId === undefined || taken.has(slot.userId)) {
        continue
      }
      if (team.isObserver) {
        observers.push({ userId: slot.userId, seat: 'observer' })
      } else if (slot.type === SlotType.Human) {
        players.push({ userId: slot.userId, seat: 'player' })
      }
    }
  }
  const bench = lobby.bench
    .filter(benched => !taken.has(benched.userId))
    .map((benched): BestOfCandidate => ({ userId: benched.userId, seat: 'bench' }))
  return [...players, ...observers, ...bench]
}

/** The timeline width a best-of score tile takes up ahead of the games, including the strip gap. */
export const SCORE_TILE_ROOM = 208 + 8
/**
 * The width a recent game tile is budgeted beside a best-of score tile, including the strip gap
 * before it. Tiles stay usable down to their CSS minimum width (96px), so this is tighter than
 * `PLAIN_GAME_TILE_ROOM`.
 */
export const GAME_TILE_ROOM = 120 + 8
/**
 * The width a recent game tile is budgeted when no series is shown, including the strip gap before
 * it. Pins the thresholds the plain timeline has always used (2 tiles from 480px, or 620px with
 * queued maps).
 */
export const PLAIN_GAME_TILE_ROOM = 160 + 8
/** The width of the earlier-games chip, including the strip gap before it. */
export const OVERFLOW_CHIP_ROOM = 40
/** The next-game slot's minimum width (it grows to its content) plus the strip gap before it. */
export const NEXT_GAME_ROOM = 96 + 8
/** The width the queued-maps tile takes up, including the strip gap before it. */
export const QUEUED_MAPS_ROOM = 140

/**
 * How many of the lobby's most recent games the timeline shows as tiles (the rest collapse into the
 * earlier-games chip), given the strip's measured width and which of its other elements are
 * rendered.
 *
 * Without a best-of series the timeline always shows at least one game, and two once there is room
 * for both. With a series its score tile has first claim on the room, so the games can yield
 * entirely.
 */
export function getRecentGameLimit({
  stripWidth,
  hasScoreTile,
  hasNextGame,
  hasQueuedMaps,
}: {
  stripWidth: number
  hasScoreTile: boolean
  hasNextGame: boolean
  hasQueuedMaps: boolean
}): 0 | 1 | 2 {
  const tileRoom = hasScoreTile ? GAME_TILE_ROOM : PLAIN_GAME_TILE_ROOM
  const fixedRoom =
    OVERFLOW_CHIP_ROOM +
    (hasScoreTile ? SCORE_TILE_ROOM : 0) +
    (hasNextGame ? NEXT_GAME_ROOM : 0) +
    (hasQueuedMaps ? QUEUED_MAPS_ROOM : 0)
  if (stripWidth >= fixedRoom + 2 * tileRoom) {
    return 2
  }
  if (!hasScoreTile || stripWidth >= fixedRoom + tileRoom) {
    return 1
  }
  return 0
}
