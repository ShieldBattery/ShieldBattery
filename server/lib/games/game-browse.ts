import { singleton } from 'tsyringe'
import {
  GameDurationFilter,
  GameFormat,
  GameSortOption,
  GameSourceFilter,
} from '../../../common/games/game-filters'
import {
  BROWSE_SHELF_SIZE,
  BROWSE_TOP_MAPS,
  BROWSE_TOP_MAPS_WINDOW_MS,
  GameBrowseMapCount,
  GameBrowseShelf,
  GameBrowseShelfId,
  GameRecord,
} from '../../../common/games/games'
import { MapInfo } from '../../../common/maps'
import { PublicMatchmakingRatingChangeJson } from '../../../common/matchmaking'
import { AssignedRaceChar } from '../../../common/races'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import { DbClient, withDbClient } from '../db'
import logger from '../logging/logger'
import { getMapInfos } from '../maps/map-models'
import { Clock } from '../time/clock'
import { getGameListViewerFreeSideData } from './game-list-data'
import {
  getGames,
  getGamesForUser,
  getMostPlayedRanked1v1Race,
  getTopMapsSince,
} from './game-models'

/**
 * How long the All games shelves are reused before they're reloaded. Every viewer sees the same
 * shelves, so this bounds their queries to one load per period however many people are browsing.
 */
export const BROWSE_SHELVES_TTL_MS = 60 * 1000
/** How long the map counts are reused. They cover a week of games, so an hour behind is invisible. */
export const BROWSE_TOP_MAPS_TTL_MS = 60 * 60 * 1000
/**
 * How far back through a user's games the My games shelves look, so a shelf that matches few of
 * their games (or a sort by length) doesn't read their whole history.
 */
export const MY_GAMES_WINDOW = 500

/** Shelves of games along with the side data their cards need that is the same for every viewer. */
export interface BrowseShelfSet {
  shelves: GameBrowseShelf[]
  /** Every game on any shelf, once each. */
  games: GameRecord[]
  users: SbUser[]
  maps: MapInfo[]
  mmrChanges: PublicMatchmakingRatingChangeJson[]
}

export interface BrowseShelves {
  shelves: GameBrowseShelf[]
  /** Every game on any shelf, once each. */
  games: GameRecord[]
}

/** Collects shelves of games into the shelf list and the de-duplicated games they reference. */
function collectShelves(
  entries: ReadonlyArray<readonly [GameBrowseShelfId, ReadonlyArray<GameRecord>]>,
): BrowseShelves {
  const gamesById = new Map<string, GameRecord>()
  const shelves: GameBrowseShelf[] = []
  for (const [id, games] of entries) {
    if (!games.length) {
      continue
    }
    for (const g of games) {
      gamesById.set(g.id, g)
    }
    shelves.push({ id, gameIds: games.map(g => g.id) })
  }
  return { shelves, games: Array.from(gamesById.values()) }
}

const LATEST_PAGE = { limit: BROWSE_SHELF_SIZE, offset: 0, sort: GameSortOption.LatestFirst }

/**
 * Loads the All games shelves that are the same for every viewer, in display order. The queries
 * run one after another on `client`, so a load takes one pooled connection rather than one per
 * shelf.
 */
export async function loadSharedShelves(client: DbClient): Promise<BrowseShelves> {
  const ranked = (format: GameFormat) =>
    getGames({ ...LATEST_PAGE, source: GameSourceFilter.Ranked, format }, client)

  const entries: Array<readonly [GameBrowseShelfId, GameRecord[]]> = []
  entries.push([GameBrowseShelfId.Ranked1v1, await ranked('1v1')])
  entries.push([GameBrowseShelfId.Ranked2v2, await ranked('2v2')])
  entries.push([GameBrowseShelfId.Ranked3v3, await ranked('3v3')])
  entries.push([
    GameBrowseShelfId.Marathons,
    await getGames({ ...LATEST_PAGE, duration: GameDurationFilter.Over30 }, client),
  ])
  entries.push([
    GameBrowseShelfId.Custom,
    await getGames({ ...LATEST_PAGE, source: GameSourceFilter.Custom }, client),
  ])
  return collectShelves(entries)
}

/** Loads the "Because you play {race}" shelf: the latest ranked 1v1s with `race` in them. */
export async function loadRaceShelf(
  client: DbClient,
  race: AssignedRaceChar,
): Promise<BrowseShelves> {
  const games = await getGames(
    {
      ...LATEST_PAGE,
      source: GameSourceFilter.Ranked,
      format: '1v1',
      matchup: { team1: [race], team2: [undefined] },
    },
    client,
  )
  return collectShelves([[GameBrowseShelfId.YourRace, games]])
}

/** Loads the maps with the most public games over the past week, and their infos. */
export async function loadTopMaps(
  client: DbClient,
  now: Date,
): Promise<{ topMaps: GameBrowseMapCount[]; maps: MapInfo[] }> {
  const topMaps = await getTopMapsSince(
    new Date(Number(now) - BROWSE_TOP_MAPS_WINDOW_MS),
    BROWSE_TOP_MAPS,
    client,
  )
  const maps = await getMapInfos(topMaps.map(m => m.mapId))
  return { topMaps, maps }
}

/** Loads the My games tab's shelves for `userId`, in display order. */
export async function loadMyGamesShelves(
  client: DbClient,
  userId: SbUserId,
): Promise<BrowseShelves> {
  const page = { userId, limit: BROWSE_SHELF_SIZE, offset: 0 }
  // Recent games come straight off the front of the user's history; the rest filter or sort it,
  // so they only look at its latest stretch.
  const windowed = { ...page, latestGames: MY_GAMES_WINDOW }
  const vs = (race: AssignedRaceChar) =>
    getGamesForUser({ ...windowed, format: '1v1', opponentRace: race }, client)

  const entries: Array<readonly [GameBrowseShelfId, GameRecord[]]> = []
  entries.push([GameBrowseShelfId.Recent, await getGamesForUser(page, client)])
  entries.push([
    GameBrowseShelfId.Losses,
    await getGamesForUser({ ...windowed, result: 'loss' }, client),
  ])
  entries.push([GameBrowseShelfId.VsTerran, await vs('t')])
  entries.push([GameBrowseShelfId.VsZerg, await vs('z')])
  entries.push([GameBrowseShelfId.VsProtoss, await vs('p')])
  entries.push([
    GameBrowseShelfId.TeamGames,
    await getGamesForUser({ ...windowed, teamGames: true }, client),
  ])
  entries.push([
    GameBrowseShelfId.Longest,
    await getGamesForUser({ ...windowed, sort: GameSortOption.LongestFirst }, client),
  ])

  return collectShelves(entries)
}

async function withViewerFreeSideData(shelves: BrowseShelves): Promise<BrowseShelfSet> {
  return { ...shelves, ...(await getGameListViewerFreeSideData(shelves.games)) }
}

/** Combines shelf sets into one, listing each game, user, map and rating change once. */
export function mergeShelfSets(sets: ReadonlyArray<BrowseShelfSet>): BrowseShelfSet {
  const games = new Map<string, GameRecord>()
  const users = new Map<SbUserId, SbUser>()
  const maps = new Map<string, MapInfo>()
  const mmrChanges = new Map<string, PublicMatchmakingRatingChangeJson>()
  for (const set of sets) {
    for (const g of set.games) games.set(g.id, g)
    for (const u of set.users) users.set(u.id, u)
    for (const m of set.maps) maps.set(m.id, m)
    for (const c of set.mmrChanges) mmrChanges.set(`${c.gameId}|${c.userId}`, c)
  }
  return {
    shelves: sets.flatMap(s => s.shelves),
    games: Array.from(games.values()),
    users: Array.from(users.values()),
    maps: Array.from(maps.values()),
    mmrChanges: Array.from(mmrChanges.values()),
  }
}

/**
 * A value loaded on demand and then reused for `ttlMs`. Once it's stale, the next caller gets the
 * stale value right away while a single reload runs in the background; only the very first load
 * (or one after every load so far has failed) is waited on. Concurrent demand shares one load.
 */
export class ReloadingValue<T> {
  private value: T | undefined
  private loadedAt = 0
  private inFlight: Promise<T> | undefined

  constructor(
    private readonly ttlMs: number,
    private readonly load: () => Promise<T>,
    private readonly clock: Clock,
  ) {}

  get(): Promise<T> {
    if (this.value === undefined) {
      return this.reload()
    }
    if (this.clock.monotonicNow() - this.loadedAt >= this.ttlMs) {
      this.reload().catch(err => {
        logger.error({ err }, 'Error reloading cached games browse data')
      })
    }
    return Promise.resolve(this.value)
  }

  private reload(): Promise<T> {
    if (!this.inFlight) {
      this.inFlight = this.load()
        .then(value => {
          this.value = value
          this.loadedAt = this.clock.monotonicNow()
          return value
        })
        .finally(() => {
          this.inFlight = undefined
        })
    }
    return this.inFlight
  }
}

/**
 * Serves the All games tab's shelves from memory. The shelves and the side data for their cards
 * are the same for every viewer apart from the race shelf (one of three), so they're loaded at most
 * once per `BROWSE_SHELVES_TTL_MS`, and the week's map counts once per `BROWSE_TOP_MAPS_TTL_MS`.
 * Per request, only the viewer's race is looked up.
 */
@singleton()
export class GameBrowseService {
  private readonly shared: ReloadingValue<BrowseShelfSet>
  private readonly raceShelves = new Map<AssignedRaceChar, ReloadingValue<BrowseShelfSet>>()
  private readonly topMaps: ReloadingValue<{ topMaps: GameBrowseMapCount[]; maps: MapInfo[] }>

  constructor(private clock: Clock) {
    this.shared = new ReloadingValue(
      BROWSE_SHELVES_TTL_MS,
      async () => withViewerFreeSideData(await withDbClient(loadSharedShelves)),
      clock,
    )
    this.topMaps = new ReloadingValue(
      BROWSE_TOP_MAPS_TTL_MS,
      () => withDbClient(client => loadTopMaps(client, new Date(this.clock.now()))),
      clock,
    )
  }

  private raceShelf(race: AssignedRaceChar): ReloadingValue<BrowseShelfSet> {
    let value = this.raceShelves.get(race)
    if (!value) {
      value = new ReloadingValue(
        BROWSE_SHELVES_TTL_MS,
        async () => withViewerFreeSideData(await withDbClient(c => loadRaceShelf(c, race))),
        this.clock,
      )
      this.raceShelves.set(race, value)
    }
    return value
  }

  /**
   * Returns the All games shelves for `viewerId` (or a signed-out viewer). The race shelf is
   * included for a viewer who has a race they play (see `getMostPlayedRanked1v1Race`) and there
   * are games for it.
   */
  async getAllGamesShelves(viewerId: SbUserId | undefined): Promise<
    BrowseShelfSet & {
      yourRace?: AssignedRaceChar
      topMaps: GameBrowseMapCount[]
    }
  > {
    const [shared, top, race] = await Promise.all([
      this.shared.get(),
      this.topMaps.get(),
      viewerId ? getMostPlayedRanked1v1Race(viewerId) : undefined,
    ])
    const raceSet = race ? await this.raceShelf(race).get() : undefined
    const topMapsSet: BrowseShelfSet = {
      shelves: [],
      games: [],
      users: [],
      maps: top.maps,
      mmrChanges: [],
    }

    const merged = mergeShelfSets(raceSet ? [shared, raceSet, topMapsSet] : [shared, topMapsSet])
    return {
      ...merged,
      yourRace: raceSet?.shelves.length ? race : undefined,
      topMaps: top.topMaps,
    }
  }
}
