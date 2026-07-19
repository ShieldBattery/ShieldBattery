import { EventEmitter } from 'node:events'
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
    this.regions = regions
    this.emit('change', regions)
  }
}
