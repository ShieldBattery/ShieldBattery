import { useState } from 'react'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { SbMapId } from '../../../common/maps'
import { graphql } from '../../gql'
import { CheckBox } from '../../material/check-box'
import { LoadingDotsArea } from '../../progress/dots'
import { bodySmall, titleLarge } from '../../styles/typography'
import { UploadedMapImage } from '../map-image'

export const MapsQuery = graphql(/* GraphQL */ `
  query MapSpawnsTestMaps {
    maps(first: 100) {
      edges {
        node {
          id
          name
          file {
            id
            image256Url
            image512Url
            image1024Url
            image2048Url
            imageSpawnsBaked
            width
            height
            startLocations {
              id
              slot
              x
              y
            }
            umsContent
          }
        }
      }
    }
  }
`)

export const MapByIdQuery = graphql(/* GraphQL */ `
  query MapSpawnsTestMap($id: SbMapId!) {
    map(id: $id) {
      id
      name
      file {
        id
        image256Url
        image512Url
        image1024Url
        image2048Url
        imageSpawnsBaked
        width
        height
        startLocations {
          id
          slot
          x
          y
        }
        umsContent
      }
    }
  }
`)

const Root = styled.div`
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Title = styled.div`
  ${titleLarge};
`

const Grid = styled.div<{ $size: number }>`
  display: grid;
  grid-template-columns: repeat(auto-fill, ${props => props.$size}px);
  gap: 12px;
`

const Tile = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
`

const TileImage = styled.div<{ $size: number }>`
  width: ${props => props.$size}px;
  border-radius: 4px;
  overflow: hidden;
  background-color: var(--theme-container-low);
`

const TileLabel = styled.div`
  ${bodySmall};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const SIZES = [64, 128, 196, 256]

interface TileOptions {
  size: number
  square: boolean
  showSpawns: boolean
}

interface TestMap {
  name: string
  file: React.ComponentProps<typeof UploadedMapImage>['map']['mapFile'] & {
    umsContent?: boolean | null
  }
}

function MapTile({ map, size, square, showSpawns }: TileOptions & { map: TestMap }) {
  return (
    <Tile>
      <TileImage $size={size}>
        <UploadedMapImage
          map={{ name: map.name, mapFile: map.file }}
          size={size}
          forceAspectRatio={square ? 1 : undefined}
          showSpawns={showSpawns}
        />
      </TileImage>
      <TileLabel title={map.name}>
        {map.name} ({map.file.width}×{map.file.height}
        {map.file.umsContent ? ', UMS' : ''})
      </TileLabel>
    </Tile>
  )
}

function MapByIdTile({ id, ...options }: TileOptions & { id: SbMapId }) {
  const [{ data }] = useQuery({ query: MapByIdQuery, variables: { id } })
  return data?.map ? <MapTile map={data.map} {...options} /> : null
}

/**
 * Shows every listed map with its spawn markers, plus any maps given by id in the `ids` query
 * param (comma-separated), e.g. unlisted ones.
 */
export function MapSpawnsTest() {
  const [{ data, fetching }] = useQuery({ query: MapsQuery })
  const [square, setSquare] = useState(true)
  const [showSpawns, setShowSpawns] = useState(true)
  const [size, setSize] = useState(196)
  const [extraIds] = useState(
    () =>
      (new URLSearchParams(location.search).get('ids') ?? '')
        .split(',')
        .filter(Boolean) as SbMapId[],
  )

  if (fetching && !data) {
    return <LoadingDotsArea />
  }
  const maps = data?.maps.edges.map(e => e.node) ?? []
  const options = { size, square, showSpawns }

  return (
    <Root>
      <Title>Map spawns ({maps.length} listed maps)</Title>
      <div>
        <CheckBox
          label='Square tiles'
          checked={square}
          onChange={e => setSquare(e.target.checked)}
        />
        <CheckBox
          label='Show spawns'
          checked={showSpawns}
          onChange={e => setShowSpawns(e.target.checked)}
        />
        {SIZES.map(s => (
          <CheckBox key={s} label={`${s}px`} checked={size === s} onChange={() => setSize(s)} />
        ))}
      </div>
      <Grid $size={size}>
        {extraIds.map(id => (
          <MapByIdTile key={id} id={id} {...options} />
        ))}
        {maps.map(m => (
          <MapTile key={m.id} map={m} {...options} />
        ))}
      </Grid>
    </Root>
  )
}
