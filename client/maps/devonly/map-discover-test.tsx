import * as React from 'react'
import styled from 'styled-components'
import { makeSbMapId, Tileset } from '../../../common/maps'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { FragmentType } from '../../gql'
import { MapCollectionKind, MapKind, MapOwnerKind } from '../../gql/graphql'
import { titleMedium } from '../../styles/typography'
import { MapMakerCard, RecentMapCard } from '../map-discover'
import { MapDiscoverHero, MapDiscoverHero_FeatureFragment } from '../map-discover-hero'
import { tileMap } from './map-tiles-test'
import { BigGameHunters, FightingSpirit } from './maps-for-testing'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()

const FAMILY_ID = '00000000-0000-4000-8000-00000000a001'
const MAP_ID = '00000000-0000-4000-8000-00000000a002'

function imageFile(id: string, image: typeof FightingSpirit) {
  return {
    id: `file:${id}`,
    image256Url: image.image256Url,
    image512Url: image.image512Url,
    image1024Url: image.image1024Url,
    image2048Url: image.image2048Url,
    imageSpawnsBaked: false,
    width: image.mapData.width,
    height: image.mapData.height,
    startLocations: image.mapData.startLocations ?? [],
    umsContent: false,
    tileset: image.mapData.tileset ?? Tileset.Jungle,
  }
}

/** A feature of a map, as plain fixture data standing in for the fragment's (masked) result. */
function mapFeature({
  automatic,
  blurb,
}: {
  automatic: boolean
  blurb: string
}): FragmentType<typeof MapDiscoverHero_FeatureFragment> {
  // The recommended file is new, so the map's play as a whole is well ahead of the file's own
  const tile = tileMap({
    id: MAP_ID,
    name: 'Fighting Spirit',
    stats: { games7d: 18, games28d: 18, gamesTotal: 18, trendingScore: 0 },
  }) as unknown as Record<string, unknown>
  return {
    id: `map-feature:2026-11-09:melee:map:${FAMILY_ID}`,
    blurb,
    automatic,
    map: {
      ...tile,
      description: 'A classic four player map, now with a wider natural.',
      listed: true,
      publisher: { id: makeSbUserId(1) },
      family: {
        id: FAMILY_ID,
        name: 'Fighting Spirit',
        current: { id: makeSbMapId(MAP_ID) },
        owner: { id: makeSbUserId(1) },
        ownerKind: MapOwnerKind.Staff,
        credit: null,
        stats: {
          id: `map-family-stats:${FAMILY_ID}`,
          games7d: 212,
          trendingScore: automatic ? 412 : 120,
        },
      },
    },
    collection: null,
  } as unknown as FragmentType<typeof MapDiscoverHero_FeatureFragment>
}

const COLLECTION_FEATURE = {
  id: 'map-feature:2026-11-09:melee:collection:00000000-0000-4000-8000-00000000a010',
  blurb: '',
  automatic: false,
  map: null,
  collection: {
    id: '00000000-0000-4000-8000-00000000a010',
    kind: MapCollectionKind.Staff,
    title: 'SB Invitational 2026',
    description: 'The five maps of this year’s invitational, as the players got them.',
    public: true,
    mapCount: 5,
    owner: null,
    hidden: null,
    pool: null,
    cover: [
      { id: makeSbMapId(MAP_ID), name: 'Fighting Spirit', file: imageFile('c1', FightingSpirit) },
      {
        id: makeSbMapId('00000000-0000-4000-8000-00000000a011'),
        name: 'Big Game Hunters',
        file: imageFile('c2', BigGameHunters),
      },
    ],
  },
} as unknown as FragmentType<typeof MapDiscoverHero_FeatureFragment>

const RECENT_MAP = {
  id: `recent-map:${FAMILY_ID}`,
  lastPlayedAt: new Date(NOW - 2 * DAY).toISOString(),
  map: {
    id: makeSbMapId(MAP_ID),
    name: 'Fighting Spirit',
    kind: MapKind.Melee,
    family: { id: FAMILY_ID, name: 'Fighting Spirit', current: { id: makeSbMapId(MAP_ID) } },
    file: imageFile('r1', FightingSpirit),
  },
} as unknown as React.ComponentProps<typeof RecentMapCard>['recent']

function maker(id: number, name: string, verified: boolean, mapCount: number) {
  return {
    id: `map-maker:${id}`,
    verified,
    mapCount,
    user: { id: makeSbUserId(id), name, avatarUrl: null },
  } as unknown as React.ComponentProps<typeof MapMakerCard>['maker']
}

const Root = styled.div`
  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 24px;
`

const RecentList = styled.ol`
  max-width: 400px;
  margin: 0;
  padding: 0;
  list-style: none;
`

const Label = styled.div`
  ${titleMedium};
  color: var(--theme-on-surface-variant);
`

const Row = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
`

/** Renders the Discover page's hero in each of its forms, a mapmaker card and a Jump back in card. */
export function MapDiscoverTest() {
  return (
    <Root>
      <Label>Staff pick of a map</Label>
      <MapDiscoverHero
        feature={mapFeature({
          automatic: false,
          blurb:
            'A second pass on a classic that trades the safe third for a wide-open middle. Our map of the week.',
        })}
      />
      <Label>Automatic pick (on the rise)</Label>
      <MapDiscoverHero feature={mapFeature({ automatic: true, blurb: '' })} />
      <Label>Staff pick of a collection</Label>
      <MapDiscoverHero feature={COLLECTION_FEATURE} />
      <Label>Narrow hero (text only)</Label>
      <div style={{ maxWidth: 560 }}>
        <MapDiscoverHero feature={mapFeature({ automatic: false, blurb: '' })} />
      </div>
      <Label>Jump back in card</Label>
      <RecentList>
        <RecentMapCard recent={RECENT_MAP} />
      </RecentList>
      <Label>Mapmaker cards</Label>
      <Row>
        <MapMakerCard maker={maker(1, 'Ederos', true, 3)} />
        <MapMakerCard maker={maker(2, 'kiseyras', false, 1)} />
      </Row>
    </Root>
  )
}
