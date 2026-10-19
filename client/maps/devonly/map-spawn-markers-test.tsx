import { useState } from 'react'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { SbMapId } from '../../../common/maps'
import { CheckBox } from '../../material/check-box'
import { bodySmall, titleLarge, titleSmall } from '../../styles/typography'
import { MapThumbnail } from '../map-thumbnail'
import { MapByIdQuery } from './map-spawns-test'

/**
 * Dev maps for each tileset, spanning 2-8 spawns and square and non-square sizes. The IDs only
 * exist in a dev DB the maps were uploaded to; missing ones are skipped.
 */
const TILESETS: ReadonlyArray<{ name: string; ids: SbMapId[] }> = [
  {
    name: 'Badlands / Jungle',
    ids: [
      '01982448-cec0-776d-b3e5-6c831e9870c2', // Challenger
      '01a149d8-825f-7056-ba80-186c8146c42a', // Vermeer SE 2.1
      '0198245e-4517-734f-8af0-934d91a305de', // Holy Ground
      '01925c23-be3e-7a4a-a2f8-474c97ded483', // Leto Hunters
    ] as SbMapId[],
  },
  {
    name: 'Space / Installation',
    ids: [
      '01925cbc-5936-749b-90c2-342776891b45', // Catwalk Alley
      '01a15559-ff71-7627-9b4c-4c849460b572', // Nightmare Station
      '01a1555a-03f7-70ee-9302-6c1b8878b165', // Station Unrest
    ] as SbMapId[],
  },
  {
    name: 'Ashworld',
    ids: [
      '01a15559-f504-7177-8e12-864173c35a1c', // Volcanis
      '01a15559-fb07-7d0f-a623-58d8b93ddff6', // Char Magma
    ] as SbMapId[],
  },
  {
    name: 'Desert',
    ids: [
      '01a15559-d177-7845-a818-47a7416873f7', // Dust Bowl
      '01a1555a-0867-761c-b5f9-251e7371c84b', // Hot Zone
      '01a15559-d643-7726-83d0-254cf934f16b', // Scorched Earth
      '01a15559-d9ea-75b8-ab7f-95c24952f608', // Wasteland
    ] as SbMapId[],
  },
  {
    name: 'Ice',
    ids: [
      '01a15559-e256-77cf-b22d-6a79e8386a1c', // Ice Floes
      '01a15559-e717-7427-92c0-1ee6c3cd7778', // Ice Mountain
      '01a15559-ecd4-7cf0-95a9-b3a2110ea126', // Arctic Station
      '01a15559-f149-7041-99b7-ef2a6c946199', // Spring Thaw
    ] as SbMapId[],
  },
  {
    name: 'Twilight',
    ids: [
      '0198245e-fdcc-7976-88a7-ca1c4a453a80', // Blue Storm 1.2
      '01a14be8-92ed-74ee-aeb7-c88c281f7727', // Azure Plains
      '01a1555a-0cca-71ab-ad0d-45af3a41c6a3', // Sanctuary
      '01a15559-de8e-7964-be2c-34c30a9ed556', // Desolation
    ] as SbMapId[],
  },
]

const Root = styled.div`
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Title = styled.div`
  ${titleLarge};
`

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const TilesetRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const TilesetName = styled.div`
  ${titleSmall};
`

const Tiles = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
`

const Tile = styled.div<{ $size: number }>`
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;
`

const TileLabel = styled.div`
  ${bodySmall};
  margin-top: 4px;
  color: var(--theme-on-surface-variant);
`

const SIZES = [176, 220, 280, 512]

const noop = () => {}

function MarkerTile({ id, size, square }: { id: SbMapId; size: number; square: boolean }) {
  const [{ data }] = useQuery({ query: MapByIdQuery, variables: { id } })
  const m = data?.map
  if (!m) {
    return null
  }
  return (
    <div>
      <Tile $size={size}>
        <MapThumbnail
          map={{
            id,
            name: m.name,
            image256Url: m.file.image256Url,
            image512Url: m.file.image512Url,
            image1024Url: m.file.image1024Url,
            image2048Url: m.file.image2048Url,
            imageSpawnsBaked: m.file.imageSpawnsBaked,
            mapData: {
              width: m.file.width,
              height: m.file.height,
              startLocations: m.file.startLocations,
              umsContent: m.file.umsContent ?? undefined,
            },
          }}
          size={size}
          forceAspectRatio={square ? 1 : undefined}
          showInfoLayer={true}
          onClick={noop}
          onPreview={noop}
          onAddToFavorites={noop}
          onRemoveFromFavorites={noop}
          onMapDetails={noop}
        />
      </Tile>
      <TileLabel>
        {m.file.width}×{m.file.height}, {m.file.startLocations.length} spawns
      </TileLabel>
    </div>
  )
}

/** Shows spawn markers on real map browser tiles across every tileset. */
export function MapSpawnMarkersTest() {
  const [size, setSize] = useState(220)
  const [square, setSquare] = useState(true)

  return (
    <Root>
      <Title>Spawn markers by tileset</Title>
      <Controls>
        {SIZES.map(s => (
          <CheckBox key={s} label={`${s}px`} checked={size === s} onChange={() => setSize(s)} />
        ))}
        <CheckBox
          label='Square tiles'
          checked={square}
          onChange={e => setSquare(e.target.checked)}
        />
      </Controls>
      {TILESETS.map(tileset => (
        <TilesetRow key={tileset.name}>
          <TilesetName>{tileset.name}</TilesetName>
          <Tiles>
            {tileset.ids.map(id => (
              <MarkerTile key={id} id={id} size={size} square={square} />
            ))}
          </Tiles>
        </TilesetRow>
      ))}
    </Root>
  )
}
