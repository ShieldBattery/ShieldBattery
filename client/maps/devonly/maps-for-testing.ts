import {
  makeSbMapId,
  MapForcePlayer,
  MapInfoJson,
  MapVisibility,
  Tileset,
} from '../../../common/maps'
import { range } from '../../../common/range'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { ThunkAction } from '../../dispatch-registry'

export const FightingSpirit: MapInfoJson = {
  id: makeSbMapId('fighting-spirit'),
  hash: '0924d3cbab0061cdbcc1dc2e20586cf514df8c5391126dae71a280616afdc03c',
  name: 'Fighting Spirit',
  description: 'Something something fighting spirit',
  uploadedBy: makeSbUserId(27),
  uploadDate: 1630903355713,
  visibility: MapVisibility.Official,
  mapData: {
    format: 'scx',
    tileset: Tileset.Jungle,
    originalName: 'Fighting Spirit',
    originalDescription: 'Something something fighting spirit',
    slots: 4,
    umsSlots: 4,
    umsForces: [
      {
        name: 'Players',
        teamId: 0,
        players: Array.from(
          range(0, 4),
          (i: number): MapForcePlayer => ({
            id: i,
            race: 'any',
            typeId: 5,
            computer: false,
          }),
        ),
      },
    ],
    width: 128,
    height: 128,
    isEud: false,
    parserVersion: 1,
  },
  mapUrl: 'https://example.org/map.scx',
  imageVersion: 1,
  image256Url:
    'https://staging-cdn.shieldbattery.net/map_images/' +
    '09/24/0924d3cbab0061cdbcc1dc2e20586cf514df8c5391126dae71a280616afdc03c-256.jpg',
  image512Url:
    'https://staging-cdn.shieldbattery.net/map_images/' +
    '09/24/0924d3cbab0061cdbcc1dc2e20586cf514df8c5391126dae71a280616afdc03c-512.jpg',
  image1024Url:
    'https://staging-cdn.shieldbattery.net/map_images/' +
    '09/24/0924d3cbab0061cdbcc1dc2e20586cf514df8c5391126dae71a280616afdc03c-1024.jpg',
  image2048Url:
    'https://staging-cdn.shieldbattery.net/map_images/' +
    '09/24/0924d3cbab0061cdbcc1dc2e20586cf514df8c5391126dae71a280616afdc03c-2048.jpg',
}

/**
 * Put testing maps into the redux store. This is safe to do in development because their IDs will
 * never collide with real maps.
 */
export function loadMapsForTesting(): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@maps/loadMapInfos',
      payload: [FightingSpirit],
    })
  }
}
