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
        players: Array.from(range(0, 4), (i: number): MapForcePlayer => ({
          id: i,
          race: 'any',
          typeId: 5,
          computer: false,
        })),
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
 * An 8-player testing map, for pages that need a lobby bigger than a 1v1. Its image URLs point at
 * Fighting Spirit's artwork so thumbnails render — nothing is uploaded under this map's hash.
 */
export const BigGameHunters: MapInfoJson = {
  ...FightingSpirit,
  id: makeSbMapId('big-game-hunters'),
  hash: 'ab0a91b32e2c6dbd0f0d4bd60e5a1d9d24c30bd0dbb4a91b0b8e6f2c4f5a7d13',
  name: 'Big Game Hunters',
  description: 'Minerals for everyone',
  uploadDate: 1630903355713,
  mapData: {
    ...FightingSpirit.mapData,
    originalName: 'Big Game Hunters',
    originalDescription: 'Minerals for everyone',
    slots: 8,
    umsSlots: 8,
    umsForces: [
      {
        name: 'Players',
        teamId: 0,
        players: Array.from(range(0, 8), (i: number): MapForcePlayer => ({
          id: i,
          race: 'any',
          typeId: 5,
          computer: false,
        })),
      },
    ],
  },
}

/**
 * Put testing maps into the redux store. This is safe to do in development because their IDs will
 * never collide with real maps.
 */
export function loadMapsForTesting(): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@maps/loadMapInfos',
      payload: [FightingSpirit, BigGameHunters],
    })
  }
}
