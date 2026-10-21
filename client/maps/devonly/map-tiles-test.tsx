import styled from 'styled-components'
import { makeSbMapId, SbMapId, Tileset } from '../../../common/maps'
import { FragmentType } from '../../gql'
import { MapKind } from '../../gql/graphql'
import { titleMedium } from '../../styles/typography'
import { MapTile, MapTile_SbMapFragment, MapTileSignal, PendingMapTile } from '../map-tile'
import { BigGameHunters, FightingSpirit } from './maps-for-testing'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()

function tileMap({
  id,
  name,
  kind = MapKind.Melee,
  playerCount = 4,
  official = false,
  publishedDaysAgo = 200,
  stats = { games7d: 40, games28d: 412, gamesTotal: 18_342, trendingScore: 0 },
  forces,
  isEud = false,
  image = FightingSpirit,
}: {
  id: string
  name: string
  kind?: MapKind
  playerCount?: number
  official?: boolean
  publishedDaysAgo?: number
  stats?: { games7d: number; games28d: number; gamesTotal: number; trendingScore: number } | null
  forces?: Array<{ humans: number; computers?: number }>
  isEud?: boolean
  image?: typeof FightingSpirit
}): FragmentType<typeof MapTile_SbMapFragment> {
  const mapId = makeSbMapId(id) as SbMapId
  const umsForces = (forces ?? [{ humans: playerCount }]).map((force, teamId) => ({
    name: `Force ${teamId + 1}`,
    teamId,
    players: [
      ...Array.from({ length: force.humans }, (_, i) => ({ playerId: i, isComputer: false })),
      ...Array.from({ length: force.computers ?? 0 }, (_, i) => ({
        playerId: force.humans + i,
        isComputer: true,
      })),
    ],
  }))
  // Plain fixture data stands in for the fragment's (masked) result
  return {
    id: mapId,
    name,
    kind,
    playerCount,
    official,
    publishedAt: new Date(NOW - publishedDaysAgo * DAY).toISOString(),
    isFavorited: false,
    stats: stats ? { id: `map-stats:${mapId}`, ...stats } : null,
    file: {
      id: `file:${id}`,
      image256Url: image.image256Url,
      image512Url: image.image512Url,
      image1024Url: image.image1024Url,
      image2048Url: image.image2048Url,
      imageSpawnsBaked: false,
      width: image.mapData.width,
      height: image.mapData.height,
      startLocations: image.mapData.startLocations ?? [],
      umsContent: kind === MapKind.Ums,
      tileset: image.mapData.tileset ?? Tileset.Jungle,
      isEud,
      umsForces,
    },
  } as unknown as FragmentType<typeof MapTile_SbMapFragment>
}

const TILES: ReadonlyArray<{
  label: string
  signal: MapTileSignal
  map: FragmentType<typeof MapTile_SbMapFragment>
  addedAt?: string
  library?: boolean
}> = [
  {
    label: 'Official, trending (rising)',
    signal: MapTileSignal.Trending,
    map: tileMap({
      id: '00000000-0000-4000-8000-000000009001',
      name: 'Fighting Spirit',
      official: true,
      stats: { games7d: 170, games28d: 230, gamesTotal: 9_120, trendingScore: 862 },
    }),
  },
  {
    label: 'Trending, not rising',
    signal: MapTileSignal.Trending,
    map: tileMap({ id: '00000000-0000-4000-8000-000000009002', name: 'Polypoid 1.75' }),
  },
  {
    label: 'New, newest',
    signal: MapTileSignal.Published,
    map: tileMap({
      id: '00000000-0000-4000-8000-000000009003',
      name: 'Radeon 1.2',
      publishedDaysAgo: 2,
      stats: null,
    }),
  },
  {
    label: 'Most played (total)',
    signal: MapTileSignal.Total,
    map: tileMap({
      id: '00000000-0000-4000-8000-000000009004',
      name: 'Big Game Hunters',
      image: BigGameHunters,
    }),
  },
  {
    label: 'UMS with computers, EUD',
    signal: MapTileSignal.Total,
    map: tileMap({
      id: '00000000-0000-4000-8000-000000009005',
      name: 'EUD 3:3 빠른무한 컴까기 with a very long name that has to be cut',
      kind: MapKind.Ums,
      playerCount: 6,
      forces: [{ humans: 3 }, { humans: 3, computers: 2 }],
      isEud: true,
    }),
  },
  {
    label: 'Never played',
    signal: MapTileSignal.Total,
    map: tileMap({
      id: '00000000-0000-4000-8000-000000009006',
      name: 'Sunken Test 07',
      stats: null,
    }),
  },
  {
    label: 'Your maps (menu)',
    signal: MapTileSignal.Added,
    addedAt: new Date(NOW - 3 * DAY).toISOString(),
    library: true,
    map: tileMap({
      id: '00000000-0000-4000-8000-000000009007',
      name: 'FallOut 0.2',
      publishedDaysAgo: 30,
    }),
  },
]

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
  gap: 24px 16px;
  padding: 16px;
`

const Cell = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const Label = styled.div`
  ${titleMedium};
  color: var(--theme-on-surface-variant);
`

/** Renders the catalog's map tile in each of the states it can be in. */
export function MapTilesTest() {
  return (
    <Grid>
      {TILES.map(tile => (
        <Cell key={tile.label}>
          <Label>{tile.label}</Label>
          <MapTile
            map={tile.map}
            signal={tile.signal}
            addedAt={tile.addedAt}
            onRemovedFromLibrary={tile.library ? () => {} : undefined}
            imageSize={280}
          />
        </Cell>
      ))}
      <Cell>
        <Label>Uploading</Label>
        <PendingMapTile fileName='(4)New Map.scx' onDismiss={() => {}} />
      </Cell>
      <Cell>
        <Label>Upload failed</Label>
        <PendingMapTile
          fileName='broken.scm'
          error="This file couldn't be read as a StarCraft map. It may be corrupted or protected in a way we cannot read."
          onDismiss={() => {}}
        />
      </Cell>
    </Grid>
  )
}
