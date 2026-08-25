import { EventEmitter } from 'node:events'
import { isDeepStrictEqual } from 'node:util'
import { singleton } from 'tsyringe'
import { GameServerRegion } from '../../common/game-server-regions'

type GameServerRegionListEvents = {
  change: [regions: GameServerRegion[]]
}

/**
 * Holds the game server region list forwarded from the site socket. Deliberately dumb: it stores
 * the latest list and notifies listeners when it changes, with no measurement or ranking logic of
 * its own — that belongs to whatever consumes `change` (the region latency measurement manager).
 */
@singleton()
export class GameServerRegionList extends EventEmitter<GameServerRegionListEvents> {
  private regions: GameServerRegion[] = []

  getRegions(): ReadonlyArray<GameServerRegion> {
    return this.regions
  }

  setRegions(regions: GameServerRegion[]) {
    // An unchanged list fires nothing: the site socket re-delivers the full list on every
    // reconnect, and each `change` triggers a full measurement sweep downstream.
    if (isDeepStrictEqual(regions, this.regions)) {
      return
    }
    this.regions = regions
    this.emit('change', regions)
  }
}
