import { atom } from 'jotai'
import {
  GameServerRegion,
  GameServerRegionId,
  GameServerRegionLatencies,
} from '../../common/game-server-regions'

/**
 * The server-provided game server region list, published over the site socket at connect and on
 * any change (see `/gameServerRegions`). Empty when the coordinator has no regions configured (dev
 * loopback), in which case region selection is not offered anywhere in the UI.
 */
export const gameServerRegionsAtom = atom<GameServerRegion[]>([])

/**
 * Whether {@link gameServerRegionsAtom} holds a settled answer. False until the first
 * `/gameServerRegions` event whose `ready` says the server's cache is past its cold-start window
 * (see `GameServerRegionsEvent.ready`) — until then an empty list only means "not loaded yet",
 * and region resolution waits briefly instead of proceeding regionless.
 */
export const gameServerRegionsReadyAtom = atom<boolean>(false)

/**
 * The app's latest measured region -> latency table, mirrored from `gameServerRegionsGetLatencies`
 * and the `gameServerRegionsLatenciesUpdated` push that follows each measurement sweep.
 */
export const gameServerRegionLatenciesAtom = atom<GameServerRegionLatencies>({})

/**
 * Mirrors the `gameServerRegion` local setting (undefined = Auto). Kept in sync by the settings IPC
 * handler alongside the other side effects it already runs off `settingsLocalChanged`, so
 * non-React code (region resolution before queueing/joining) can read the current setting without
 * needing a Redux `getState`.
 */
export const manualGameServerRegionAtom = atom<GameServerRegionId | undefined>(undefined)
