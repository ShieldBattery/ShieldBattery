import { assertUnreachable } from '../../../common/assert-unreachable'
import { ReconciledResult } from '../../../common/games/results'
import { Lobby } from '../../../common/lobbies'
import {
  BestOfSideIndex,
  checkBestOfRoster,
  getBestOfGameNumber,
  getBestOfSideName,
  getRunningBestOf,
  isBestOfAddedResult,
  LobbyBestOfAddedResultJson,
  LobbyBestOfJson,
  LobbyBestOfLaunchedGameJson,
} from '../../../common/lobbies/lobby-best-of'
import { LobbySeriesGameJson } from '../../../common/lobbies/lobby-network'
import { findSeriesGameWinner } from '../../../common/lobbies/lobby-series'
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
  bestOfGame?: LobbyBestOfLaunchedGameJson
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
    if (isBestOfAddedResult(bestOfGame)) {
      return []
    }
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
 * lobby's latest business exactly while the lobby's last finished game is one of its own, and no
 * game is on its way (`isLaunching`: counting down, loading or being played). A series that ended
 * without any finished game has no place among the lobby's games to show it at, so it isn't shown.
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
  const lastGameId = series.at(-1)?.gameId
  if (!last || isLaunching || lastGameId === undefined) {
    return undefined
  }
  return last.games.some(game => !isBestOfAddedResult(game) && game.gameId === lastGameId)
    ? last
    : undefined
}

/**
 * How a finished best-of series ended for one of its sides, for marking the side with a result:
 * a win or loss for a series that one side won, a draw for each side of a drawn one, and nothing
 * for a series that is still running or that the host ended before it was decided.
 */
export function getBestOfSideResult(
  bestOf: Pick<LobbyBestOfJson, 'outcome'>,
  sideIndex: BestOfSideIndex,
): ReconciledResult | undefined {
  switch (bestOf.outcome?.kind) {
    case 'won':
      return bestOf.outcome.winner === sideIndex ? 'win' : 'loss'
    case 'drawn':
      return 'draw'
    case undefined:
    case 'unfinished':
      return undefined
    default:
      return assertUnreachable(bestOf.outcome)
  }
}

/** The two players of a game played one against one, and who won it. */
export interface OneAgainstOneResult {
  winner: SbUserId
  loser: SbUserId
}

/**
 * Returns who won a finished game that was played one against one, or `undefined` when it wasn't
 * played that way or has no winner to name.
 *
 * A game of a best-of series is one against one when exactly one player was seated for each side,
 * and its winner is the one its series counts (which a host can set against the game's own
 * results). Any other game is one against one when its roster is exactly two humans and no
 * computers, and its winner is the one `findSeriesGameWinner` finds.
 */
export function getOneAgainstOneResult(
  game: LobbySeriesGameJson,
  bestOfGame?: LobbyBestOfLaunchedGameJson,
): OneAgainstOneResult | undefined {
  if (bestOfGame) {
    const [side0, side1] = bestOfGame.players
    if (bestOfGame.status !== 'won' || side0.length !== 1 || side1.length !== 1) {
      return undefined
    }
    return bestOfGame.winner === 0
      ? { winner: side0[0], loser: side1[0] }
      : { winner: side1[0], loser: side0[0] }
  }

  const roster = game.teams.flatMap(team => team.players)
  if (roster.length !== 2) {
    return undefined
  }
  const [first, second] = roster
  if (first.type !== 'human' || second.type !== 'human') {
    return undefined
  }

  const winner = findSeriesGameWinner(game)
  if (!winner) {
    return undefined
  }
  const winnerId =
    winner.kind === 'player'
      ? winner.userId
      : game.teams
          .find(team => team.teamId === winner.teamId)
          ?.players.find(p => p.type === 'human')?.userId
  if (winnerId === first.userId) {
    return { winner: first.userId, loser: second.userId }
  } else if (winnerId === second.userId) {
    return { winner: second.userId, loser: first.userId }
  }
  return undefined
}

/** One row of the lobby's full list of games, with a key unique within the list. */
export type SessionGamesEntry =
  /** Begins a run of games that belong to a best-of series. */
  | { kind: 'bestOf'; key: string; bestOf: LobbyBestOfJson }
  | ({ kind: 'game'; key: string } & NumberedSeriesGame)
  /** A result the host added to a best-of series by hand, with no game behind it. */
  | {
      kind: 'addedResult'
      key: string
      bestOf: LobbyBestOfJson
      result: LobbyBestOfAddedResultJson
      /** Counted the way the series counts its games. */
      gameNumber: number
    }

/**
 * Lays out the lobby's finished games in the order they were played, with each best-of series'
 * games headed by the series. Games within a series are numbered the way the series counts them,
 * and the rest by their place among the lobby's games.
 *
 * A series' games are usually played one after another, but a correction can reopen a series after
 * the lobby has played games outside it, and the games it plays then join it again. Each unbroken
 * run of a series' games is headed by the series, so one can be headed more than once.
 *
 * The results the host added to a series by hand are listed among its games in the order the
 * series holds them: one added before a finished game of the series comes just before that game,
 * and those after its last finished game close the run that game ends.
 *
 * The running series is headed even before it has a finished game, at the end of the list, since
 * that's where its games will go, and lists the results added to it there. A series that ended
 * without any finished game has no place in the list, so it is left out.
 */
export function groupSessionGames(
  series: ReadonlyArray<LobbySeriesGameJson>,
  bestOfs: ReadonlyArray<LobbyBestOfJson>,
): SessionGamesEntry[] {
  const byGameId = new Map<
    string,
    { bestOf: LobbyBestOfJson; index: number; bestOfGame: LobbyBestOfLaunchedGameJson }
  >()
  for (const bestOf of bestOfs) {
    bestOf.games.forEach((bestOfGame, index) => {
      if (!isBestOfAddedResult(bestOfGame)) {
        byGameId.set(bestOfGame.gameId, { bestOf, index, bestOfGame })
      }
    })
  }
  // Where each series' last finished game is among the lobby's games, which is the run that lists
  // the results added after it.
  const lastSeriesIndex = new Map<string, number>()
  series.forEach((game, seriesIndex) => {
    const owner = byGameId.get(game.gameId)
    if (owner) {
      lastSeriesIndex.set(owner.bestOf.id, seriesIndex)
    }
  })

  const entries: SessionGamesEntry[] = []
  const runCounts = new Map<string, number>()
  // How far into each series' entries the list has gotten.
  const listedUpTo = new Map<string, number>()

  const head = (bestOf: LobbyBestOfJson) => {
    const run = (runCounts.get(bestOf.id) ?? 0) + 1
    runCounts.set(bestOf.id, run)
    entries.push({
      kind: 'bestOf',
      key: run === 1 ? `best-of-${bestOf.id}` : `best-of-${bestOf.id}-${run}`,
      bestOf,
    })
  }
  const listAddedResults = (bestOf: LobbyBestOfJson, end: number) => {
    const start = listedUpTo.get(bestOf.id) ?? 0
    for (let index = start; index < end; index++) {
      const entry = bestOf.games[index]
      if (isBestOfAddedResult(entry)) {
        entries.push({
          kind: 'addedResult',
          key: `added-${bestOf.id}-${entry.resultId}`,
          bestOf,
          result: entry,
          gameNumber: getBestOfGameNumber(bestOf, index),
        })
      }
    }
    listedUpTo.set(bestOf.id, Math.max(start, end))
  }
  const endRun = (bestOf: LobbyBestOfJson, lastIndexOfRun: number) => {
    if (lastSeriesIndex.get(bestOf.id) === lastIndexOfRun) {
      listAddedResults(bestOf, bestOf.games.length)
    }
  }

  let run: { bestOf: LobbyBestOfJson; lastIndex: number } | undefined
  series.forEach((game, seriesIndex) => {
    const owner = byGameId.get(game.gameId)
    if (run && owner?.bestOf !== run.bestOf) {
      endRun(run.bestOf, run.lastIndex)
      run = undefined
    }

    if (!owner) {
      entries.push({ kind: 'game', key: game.gameId, game, gameNumber: seriesIndex + 1 })
      return
    }

    if (!run) {
      head(owner.bestOf)
    }
    listAddedResults(owner.bestOf, owner.index)
    entries.push({
      kind: 'game',
      key: game.gameId,
      game,
      gameNumber: getBestOfGameNumber(owner.bestOf, owner.index),
      bestOf: owner.bestOf,
      bestOfGame: owner.bestOfGame,
    })
    listedUpTo.set(owner.bestOf.id, Math.max(listedUpTo.get(owner.bestOf.id) ?? 0, owner.index + 1))
    run = { bestOf: owner.bestOf, lastIndex: seriesIndex }
  })
  if (run) {
    endRun(run.bestOf, run.lastIndex)
  }

  const running = getRunningBestOf(bestOfs)
  if (running && !runCounts.has(running.id)) {
    head(running)
    listAddedResults(running, running.games.length)
  }

  return entries
}

/** Why the running best-of series keeps the lobby from starting its next game. */
export type BestOfStartBlocker =
  | { kind: 'bestOfGamePending' }
  | { kind: 'bestOfSideNotSeated'; side: BestOfSideIndex; sideName?: string }
  | { kind: 'bestOfExtraPlayer'; userId: SbUserId }
  | { kind: 'bestOfMixedTeams' }

/**
 * Returns what keeps the lobby's next game from being a game of its running best-of series, which
 * the server refuses to start, or `undefined` when nothing does (or no series is running).
 *
 * A game of the series still waiting for its result comes first, since nothing about the seats can
 * fix that. A roster problem names only the first side or person it's about.
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
  } else if (roster.unseatedSides.length) {
    const side = roster.unseatedSides[0]
    const sideName = getBestOfSideName(running, side)
    return { kind: 'bestOfSideNotSeated', side, ...(sideName !== undefined ? { sideName } : {}) }
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
