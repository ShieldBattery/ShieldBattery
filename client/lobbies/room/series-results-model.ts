import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  BestOfSideIndex,
  getBestOfGameNumber,
  isBestOfAddedResult,
  LobbyBestOfJson,
  LobbyBestOfLaunchedGameJson,
} from '../../../common/lobbies/lobby-best-of'
import { LobbySeriesGameJson } from '../../../common/lobbies/lobby-network'
import { SbMapId } from '../../../common/maps'
import { RaceChar } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user-id'

/** How a launched game of a best-of series counts towards it, as its results list it. */
export type SeriesResultsGameStatus =
  /** Counts as a win for `winner`, by its own results or because the host set it so. */
  | { kind: 'won'; winner: BestOfSideIndex; setByHost: boolean }
  /** Counts for nobody: its results gave no side a win, or the host set it not to count. */
  | { kind: 'notCounted' }
  /** Is over, and its results haven't settled yet. */
  | { kind: 'waiting' }
  /** Is being played right now. */
  | { kind: 'playing' }

/**
 * Someone who played a game of a best-of series. `race` is the race they had picked when the game
 * launched, as its record holds it (so Random, for someone who picked it, rather than the race they
 * were dealt), and absent when there is no record of the game.
 */
export type SeriesResultsPlayer =
  | { kind: 'human'; userId: SbUserId; race?: RaceChar }
  | { kind: 'computer'; race: RaceChar }

/** One entry of a best-of series' results, in the order the series holds them. */
export type SeriesResultsRow =
  | {
      kind: 'game'
      /** Unique within the series. */
      key: string
      gameId: string
      /** Counted the way the series counts its games (see `getBestOfGameNumber`). */
      gameNumber: number
      status: SeriesResultsGameStatus
      /** Whether the lobby has the finished game's record, which the map and length come from. */
      hasRecord: boolean
      mapId?: SbMapId
      durationMs?: number
      /**
       * Who played the game for each side, in side order: the side's members seated as players when
       * it launched, then the computers on their team.
       */
      players: [side0: SeriesResultsPlayer[], side1: SeriesResultsPlayer[]]
    }
  /** A result the host added by hand, with no game or players behind it. */
  | {
      kind: 'addedResult'
      /** Unique within the series. */
      key: string
      resultId: string
      gameNumber: number
      winner: BestOfSideIndex
    }

function toGameStatus(
  entry: LobbyBestOfLaunchedGameJson,
  playingGameId: string | undefined,
): SeriesResultsGameStatus {
  switch (entry.status) {
    case 'won':
      return { kind: 'won', winner: entry.winner, setByHost: !!entry.setByHost }
    case 'noWinner':
    case 'notCounted':
      return { kind: 'notCounted' }
    case 'pending':
      return entry.gameId === playingGameId ? { kind: 'playing' } : { kind: 'waiting' }
    default:
      return assertUnreachable(entry)
  }
}

/**
 * Lists who played a game for each side. The humans are the side's members seated as players when it
 * launched, in that order, with the races they had picked when the game launched, as its record holds them. In a game played between
 * several teams, a team's computers played for the side whose members sat on that team, after them;
 * in a game of a single team, a computer played for nobody in particular, so it is left out.
 */
function getGamePlayers(
  entry: LobbyBestOfLaunchedGameJson,
  record: LobbySeriesGameJson | undefined,
): [SeriesResultsPlayer[], SeriesResultsPlayer[]] {
  const races = new Map<SbUserId, RaceChar>()
  for (const team of record?.teams ?? []) {
    for (const player of team.players) {
      if (player.type === 'human') {
        races.set(player.userId, player.race)
      }
    }
  }
  const players: [SeriesResultsPlayer[], SeriesResultsPlayer[]] = [
    entry.players[0].map(userId => ({ kind: 'human', userId, race: races.get(userId) })),
    entry.players[1].map(userId => ({ kind: 'human', userId, race: races.get(userId) })),
  ]

  if (record && record.teams.length > 1) {
    const sideByUser = new Map<SbUserId, BestOfSideIndex>()
    entry.players[0].forEach(userId => sideByUser.set(userId, 0))
    entry.players[1].forEach(userId => sideByUser.set(userId, 1))
    for (const team of record.teams) {
      let side: BestOfSideIndex | undefined
      for (const player of team.players) {
        if (player.type === 'human' && sideByUser.has(player.userId)) {
          side = sideByUser.get(player.userId)
          break
        }
      }
      if (side === undefined) {
        continue
      }
      for (const player of team.players) {
        if (player.type === 'computer') {
          players[side].push({ kind: 'computer', race: player.race })
        }
      }
    }
  }

  return players
}

/**
 * Lays out a best-of series' results in the order it holds them: each game launched as part of it,
 * with how it counts and who played it for which side, and each result the host added by hand.
 *
 * A game counts the way the series counts it, whatever its own results say, so a win the host set
 * shows the side the host gave it to. `games` are the finished games the series' games are looked
 * up in for their map, length and races; a game with no record there is listed without them.
 * `playingGameId` is the game being played right now, if any: a game of the series still waiting
 * on its result is being played when it is that one.
 */
export function getSeriesResultRows(
  bestOf: Pick<LobbyBestOfJson, 'games'>,
  games: ReadonlyArray<LobbySeriesGameJson>,
  playingGameId?: string,
): SeriesResultsRow[] {
  const records = new Map(games.map(game => [game.gameId, game]))
  return bestOf.games.map((entry, index): SeriesResultsRow => {
    const gameNumber = getBestOfGameNumber(bestOf, index)
    if (isBestOfAddedResult(entry)) {
      return {
        kind: 'addedResult',
        key: `added-${entry.resultId}`,
        resultId: entry.resultId,
        gameNumber,
        winner: entry.winner,
      }
    }

    const record = records.get(entry.gameId)
    return {
      kind: 'game',
      key: `game-${entry.gameId}`,
      gameId: entry.gameId,
      gameNumber,
      status: toGameStatus(entry, playingGameId),
      hasRecord: !!record,
      ...(record ? { mapId: record.mapId } : {}),
      ...(record?.result ? { durationMs: record.result.durationMs } : {}),
      players: getGamePlayers(entry, record),
    }
  })
}

/** How a game that counted went for one person who played it. */
export type SeriesMemberResult = 'win' | 'loss'

/** Someone listed on one side of a best-of series, with how the games they played for it went. */
export interface SeriesMemberRecord {
  userId: SbUserId
  /** Whether they are on the side now, rather than only having played for it earlier. */
  isOnSide: boolean
  /**
   * Their results in the games they played for the side that counted, in the order played: a win
   * when the side won the game, a loss when the other side did.
   */
  results: SeriesMemberResult[]
  /**
   * How many games they played for the side that have finished counting one way or the other, won
   * or not, leaving out a game still being played or waiting for its result.
   */
  gamesPlayed: number
}

/**
 * Lists each side's people with their results in the series. A game is credited to the people who
 * played it for a side, so someone moved to the other side partway through is listed on both, each
 * with the games they played there.
 *
 * A side lists its current members first, in side order (including those yet to play), then anyone
 * else who played a game for it, in the order they first did. Only games that counted give anyone a
 * result; results the host added by hand belong to nobody.
 */
export function getSeriesRosters(
  bestOf: Pick<LobbyBestOfJson, 'sides' | 'games'>,
): [SeriesMemberRecord[], SeriesMemberRecord[]] {
  return [getSideRoster(bestOf, 0), getSideRoster(bestOf, 1)]
}

function getSideRoster(
  bestOf: Pick<LobbyBestOfJson, 'sides' | 'games'>,
  side: BestOfSideIndex,
): SeriesMemberRecord[] {
  const records = new Map<SbUserId, SeriesMemberRecord>()
  for (const userId of bestOf.sides[side]) {
    records.set(userId, { userId, isOnSide: true, results: [], gamesPlayed: 0 })
  }
  for (const entry of bestOf.games) {
    if (isBestOfAddedResult(entry)) {
      continue
    }
    for (const userId of entry.players[side]) {
      let record = records.get(userId)
      if (!record) {
        record = { userId, isOnSide: false, results: [], gamesPlayed: 0 }
        records.set(userId, record)
      }
      if (entry.status !== 'pending') {
        record.gamesPlayed += 1
      }
      if (entry.status === 'won') {
        record.results.push(entry.winner === side ? 'win' : 'loss')
      }
    }
  }
  return Array.from(records.values())
}

/** The most results a strip shows one by one before it sums up the earlier ones in a tally. */
export const SERIES_STRIP_MAX_RESULTS = 7
/** How many of the latest results a strip that sums up the earlier ones still shows one by one. */
export const SERIES_STRIP_RECENT_RESULTS = 5

/** What a strip of someone's results in a series shows. */
export type SeriesResultStrip =
  | { kind: 'all'; results: SeriesMemberResult[] }
  /** The won-lost tally over all of them, then the latest few, in the order played. */
  | { kind: 'tally'; wins: number; losses: number; recent: SeriesMemberResult[] }

/**
 * Fits someone's results in a series into a strip: up to `SERIES_STRIP_MAX_RESULTS` of them all,
 * one by one; beyond that, the tally of all of them and the last `SERIES_STRIP_RECENT_RESULTS`.
 */
export function getSeriesResultStrip(
  results: ReadonlyArray<SeriesMemberResult>,
): SeriesResultStrip {
  if (results.length <= SERIES_STRIP_MAX_RESULTS) {
    return { kind: 'all', results: results.slice() }
  }
  const wins = results.filter(result => result === 'win').length
  return {
    kind: 'tally',
    wins,
    losses: results.length - wins,
    recent: results.slice(-SERIES_STRIP_RECENT_RESULTS),
  }
}
