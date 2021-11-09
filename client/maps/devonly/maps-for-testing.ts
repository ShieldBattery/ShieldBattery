import { MapForcePlayer, MapInfoJson, MapVisibility, Tileset } from '../../../common/maps'
import { range } from '../../../common/range'

export const FightingSpirit: MapInfoJson = {
  id: 'fighting-spirit',
  hash: '0924d3cbab0061cdbcc1dc2e20586cf514df8c5391126dae71a280616afdc03c',
  name: 'Fighting Spirit',
  description: 'Something something fighting spirit',
  uploadedBy: {
    id: 27,
    name: 'SomePerson',
  },
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
  },
  isFavorited: false,
  mapUrl: 'https://example.org/map.scx',
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
