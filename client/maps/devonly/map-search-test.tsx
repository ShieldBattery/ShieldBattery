import { ResultOf } from '@graphql-typed-document-node/core'
import React, { useState } from 'react'
import styled from 'styled-components'
import { useMutation, useQuery } from 'urql'
import { SbMapId } from '../../../common/maps'
import { graphql } from '../../gql'
import { EudFilter, MapFilter, MapLens, MapSizeClass, MapSort } from '../../gql/graphql'
import { OutlinedButton, TextButton } from '../../material/button'
import { CheckBox } from '../../material/check-box'
import { SelectOption } from '../../material/select/option'
import { Select } from '../../material/select/select'
import { TextField } from '../../material/text-field'
import { LoadingDotsArea } from '../../progress/dots'
import { bodyMedium, bodySmall, labelMedium, titleLarge } from '../../styles/typography'

const MapFieldsFragment = graphql(/* GraphQL */ `
  fragment MapSearchTest_Map on SbMap {
    id
    name
    kind
    playerCount
    listed
    official
    publishedAt
    favoriteCount
    isFavorited
    inLibrary
    publisher {
      id
      name
    }
    stats {
      id
      games7d
      games28d
      games90d
      gamesTotal
      players90d
      medianLength90d
      lastPlayedAt
    }
    file {
      id
      tileset
      width
      height
      isEud
      image256Url
    }
  }
`)

const MapsQuery = graphql(/* GraphQL */ `
  query MapSearchTestMaps($filter: MapFilter, $sort: MapSort, $after: String, $first: Int) {
    maps(filter: $filter, sort: $sort, after: $after, first: $first) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          ...MapSearchTest_Map
        }
      }
    }
  }
`)

const LibraryQuery = graphql(/* GraphQL */ `
  query MapSearchTestLibrary($filter: MapFilter, $sort: MapSort, $after: String, $first: Int) {
    currentUser {
      id
      mapLibrary(filter: $filter, sort: $sort, after: $after, first: $first) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          addedAt
          node {
            ...MapSearchTest_Map
          }
        }
      }
    }
  }
`)

const FavoritesQuery = graphql(/* GraphQL */ `
  query MapSearchTestFavorites($filter: MapFilter, $sort: MapSort, $after: String, $first: Int) {
    currentUser {
      id
      favoriteMaps(filter: $filter, sort: $sort, after: $after, first: $first) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          addedAt
          node {
            ...MapSearchTest_Map
          }
        }
      }
    }
  }
`)

const MapByIdQuery = graphql(/* GraphQL */ `
  query MapSearchTestMap($id: SbMapId!) {
    map(id: $id) {
      ...MapSearchTest_Map
    }
  }
`)

const AddFavoriteMutation = graphql(/* GraphQL */ `
  mutation MapSearchTestAddFavorite($id: SbMapId!) {
    mapAddFavorite(id: $id) {
      ...MapSearchTest_Map
    }
  }
`)

const RemoveFavoriteMutation = graphql(/* GraphQL */ `
  mutation MapSearchTestRemoveFavorite($id: SbMapId!) {
    mapRemoveFavorite(id: $id) {
      ...MapSearchTest_Map
    }
  }
`)

// At runtime `useFragment` is the identity function, so reading the unmasked fragment type
// directly is equivalent for a dev page.
type TestMap = ResultOf<typeof MapFieldsFragment>

type Scope = 'maps' | 'library' | 'favorites'

interface ListedEdge {
  cursor: string
  addedAt?: string | null
  node: TestMap
}

interface ListingPage {
  edges: ListedEdge[]
  pageInfo: { hasNextPage: boolean; endCursor?: string | null }
}

const SORTS: Array<[MapSort | undefined, string]> = [
  [undefined, 'Default'],
  [MapSort.Relevance, 'Relevance'],
  [MapSort.Trending, 'Trending'],
  [MapSort.Popular_7D, 'Popular (7 days)'],
  [MapSort.Popular_28D, 'Popular (28 days)'],
  [MapSort.Popular_90D, 'Popular (90 days)'],
  [MapSort.PopularAllTime, 'Popular (all time)'],
  [MapSort.Newest, 'Newest'],
  [MapSort.MostFavorited, 'Most favorited'],
  [MapSort.Name, 'Name'],
  [MapSort.Players, 'Players'],
]

const SIZES: Array<[MapSizeClass, string]> = [
  [MapSizeClass.Tiny, 'Tiny'],
  [MapSizeClass.Small, 'Small'],
  [MapSizeClass.Medium, 'Medium'],
  [MapSizeClass.Large, 'Large'],
  [MapSizeClass.Huge, 'Huge'],
]

const PAGE_SIZE_DEFAULT = '10'

function parseIntList(text: string): number[] | undefined {
  const values = text
    .split(',')
    .map(v => v.trim())
    .filter(v => v !== '')
    .map(Number)
    .filter(v => Number.isInteger(v))
  return values.length ? values : undefined
}

const Root = styled.div`
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Title = styled.div`
  ${titleLarge};
`

const Controls = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  align-items: center;
`

const SizeRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
`

const Results = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const Row = styled.div`
  ${bodyMedium};
  display: grid;
  grid-template-columns: 32px 64px 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 8px 12px;

  background-color: var(--theme-container-low);
  border-radius: 4px;
`

const Index = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const Thumb = styled.img`
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 2px;
`

const Details = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

const ErrorText = styled.div`
  ${bodyMedium};
  color: var(--theme-error);
`

export function MapSearchTest() {
  const [scope, setScope] = useState<Scope>('maps')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<MapSort | undefined>(undefined)
  const [lens, setLens] = useState(MapLens.All)
  const [eud, setEud] = useState(EudFilter.Any)
  const [players, setPlayers] = useState('')
  const [minPlayers, setMinPlayers] = useState('')
  const [tilesets, setTilesets] = useState('')
  const [publishedDays, setPublishedDays] = useState('')
  // Computed when the day count changes, so the query variables stay stable between renders.
  const [publishedSince, setPublishedSince] = useState<string | undefined>(undefined)
  const [sizes, setSizes] = useState<MapSizeClass[]>([])
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT)

  const minPlayersValue = Number(minPlayers)
  const filter: MapFilter = {
    search: search || undefined,
    lens,
    eud,
    players: parseIntList(players),
    minPlayers: minPlayers && Number.isInteger(minPlayersValue) ? minPlayersValue : undefined,
    tilesets: parseIntList(tilesets),
    sizes: sizes.length ? sizes : undefined,
    publishedSince,
  }
  const first = Number(pageSize) || undefined
  // A new listing (and so a new set of chunks) whenever any argument changes.
  const listingKey = JSON.stringify({ scope, filter, sort, first })

  return (
    <Root>
      <Title>Map search</Title>
      <Controls>
        <Select label='Scope' value={scope} onChange={setScope} dense={true}>
          <SelectOption value='maps' text='maps (listed)' />
          <SelectOption value='library' text='currentUser.mapLibrary' />
          <SelectOption value='favorites' text='currentUser.favoriteMaps' />
        </Select>
        <TextField
          label='Search'
          value={search}
          dense={true}
          onChange={e => setSearch(e.target.value)}
        />
        <Select label='Sort' value={sort} onChange={setSort} dense={true}>
          {SORTS.map(([value, text]) => (
            <SelectOption key={text} value={value} text={text} />
          ))}
        </Select>
        <Select label='Lens' value={lens} onChange={setLens} dense={true}>
          <SelectOption value={MapLens.All} text='All' />
          <SelectOption value={MapLens.Melee} text='Melee' />
          <SelectOption value={MapLens.Ums} text='UMS' />
        </Select>
        <Select label='EUD' value={eud} onChange={setEud} dense={true}>
          <SelectOption value={EudFilter.Any} text='Any' />
          <SelectOption value={EudFilter.Exclude} text='Exclude' />
          <SelectOption value={EudFilter.Only} text='Only' />
        </Select>
        <TextField
          label='Players (e.g. 2,4)'
          value={players}
          dense={true}
          onChange={e => setPlayers(e.target.value)}
        />
        <TextField
          label='Min players'
          value={minPlayers}
          dense={true}
          onChange={e => setMinPlayers(e.target.value)}
        />
        <TextField
          label='Tilesets (e.g. 0,4)'
          value={tilesets}
          dense={true}
          onChange={e => setTilesets(e.target.value)}
        />
        <TextField
          label='Published within (days)'
          value={publishedDays}
          dense={true}
          onChange={e => {
            const days = Number(e.target.value)
            setPublishedDays(e.target.value)
            setPublishedSince(
              days > 0
                ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
                : undefined,
            )
          }}
        />
        <TextField
          label='Page size'
          value={pageSize}
          dense={true}
          onChange={e => setPageSize(e.target.value)}
        />
      </Controls>
      <SizeRow>
        {SIZES.map(([size, label]) => (
          <CheckBox
            key={size}
            label={label}
            checked={sizes.includes(size)}
            onChange={e =>
              setSizes(e.target.checked ? [...sizes, size] : sizes.filter(s => s !== size))
            }
          />
        ))}
      </SizeRow>
      <Listing key={listingKey} scope={scope} filter={filter} sort={sort} first={first} />
      <MapLookup />
    </Root>
  )
}

function Listing({
  scope,
  filter,
  sort,
  first,
}: {
  scope: Scope
  filter: MapFilter
  sort: MapSort | undefined
  first: number | undefined
}) {
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  return (
    <Results>
      {cursors.map((after, i) => (
        <ListingChunk
          key={after ?? ''}
          scope={scope}
          filter={filter}
          sort={sort}
          first={first}
          after={after}
          startIndex={i * (first ?? 40)}
          isLastChunk={i === cursors.length - 1}
          onLoadMore={cursor => setCursors([...cursors, cursor])}
        />
      ))}
    </Results>
  )
}

function ListingChunk({
  scope,
  filter,
  sort,
  first,
  after,
  startIndex,
  isLastChunk,
  onLoadMore,
}: {
  scope: Scope
  filter: MapFilter
  sort: MapSort | undefined
  first: number | undefined
  after: string | null
  startIndex: number
  isLastChunk: boolean
  onLoadMore: (cursor: string) => void
}) {
  const variables = { filter, sort, first, after: after ?? undefined }
  const [mapsResult] = useQuery({ query: MapsQuery, variables, pause: scope !== 'maps' })
  const [libraryResult] = useQuery({ query: LibraryQuery, variables, pause: scope !== 'library' })
  const [favoritesResult] = useQuery({
    query: FavoritesQuery,
    variables,
    pause: scope !== 'favorites',
  })

  let page: ListingPage | undefined
  let fetching: boolean
  let error: Error | undefined
  if (scope === 'maps') {
    page = mapsResult.data?.maps as ListingPage | undefined
    fetching = mapsResult.fetching
    error = mapsResult.error
  } else if (scope === 'library') {
    page = libraryResult.data?.currentUser?.mapLibrary as ListingPage | undefined
    fetching = libraryResult.fetching
    error = libraryResult.error
  } else {
    page = favoritesResult.data?.currentUser?.favoriteMaps as ListingPage | undefined
    fetching = favoritesResult.fetching
    error = favoritesResult.error
  }

  return (
    <>
      {page?.edges.map((edge, i) => (
        <MapRow key={edge.node.id} index={startIndex + i} map={edge.node} addedAt={edge.addedAt} />
      ))}
      {fetching && !page ? <LoadingDotsArea /> : null}
      {error ? <ErrorText>{error.message}</ErrorText> : null}
      {!fetching && !error && scope !== 'maps' && !page ? (
        <ErrorText>Log in to see this list.</ErrorText>
      ) : null}
      {isLastChunk && page?.pageInfo.hasNextPage && page.pageInfo.endCursor ? (
        <div>
          <OutlinedButton label='Load more' onClick={() => onLoadMore(page.pageInfo.endCursor!)} />
        </div>
      ) : null}
    </>
  )
}

function MapRow({
  index,
  map,
  addedAt,
}: {
  index?: number
  map: TestMap
  addedAt?: string | null
}) {
  const [, addFavorite] = useMutation(AddFavoriteMutation)
  const [, removeFavorite] = useMutation(RemoveFavoriteMutation)
  const stats = map.stats

  return (
    <Row>
      <Index>{index !== undefined ? index + 1 : ''}</Index>
      <Thumb src={map.file.image256Url} alt='' />
      <div>
        <div>
          {map.name} {map.official ? '(official)' : ''} {map.listed ? '' : '(unlisted)'}
        </div>
        <Details>
          {map.kind} · {map.playerCount} players · {map.file.width}x{map.file.height} · tileset{' '}
          {map.file.tileset} {map.file.isEud ? '· EUD' : ''} · favorites {map.favoriteCount}
          {map.isFavorited ? ' (yours)' : ''} {map.inLibrary ? '· in library' : ''}
        </Details>
        <Details>
          {stats
            ? `games 7d/28d/90d/all ${stats.games7d}/${stats.games28d}/${stats.games90d}/` +
              `${stats.gamesTotal} · players 90d ${stats.players90d} · last played ` +
              stats.lastPlayedAt
            : 'never played'}
        </Details>
        <Details>
          {map.id}
          {map.publishedAt ? ` · published ${map.publishedAt} by ${map.publisher?.name}` : ''}
          {addedAt !== undefined ? ` · added ${addedAt ?? 'unknown'}` : ''}
        </Details>
      </div>
      <TextButton
        label={map.isFavorited ? 'Unfavorite' : 'Favorite'}
        onClick={() => {
          if (map.isFavorited) {
            removeFavorite({ id: map.id }).catch(() => {})
          } else {
            addFavorite({ id: map.id }).catch(() => {})
          }
        }}
      />
    </Row>
  )
}

function MapLookup() {
  const [idText, setIdText] = useState('')
  const [id, setId] = useState<string | undefined>(undefined)
  const [{ data, fetching, error }] = useQuery({
    query: MapByIdQuery,
    variables: { id: (id ?? '') as SbMapId },
    pause: !id,
  })

  let lookupResult: React.ReactNode = null
  if (id && data) {
    lookupResult = data.map ? (
      <MapRow map={data.map as TestMap} />
    ) : (
      <ErrorText>No map with that id.</ErrorText>
    )
  }

  return (
    <>
      <Title>Map by id</Title>
      <Controls>
        <TextField
          label='Map id (canonical or old)'
          value={idText}
          dense={true}
          onChange={e => setIdText(e.target.value)}
          onEnterKeyDown={() => setId(idText.trim() || undefined)}
        />
        <div>
          <OutlinedButton label='Look up' onClick={() => setId(idText.trim() || undefined)} />
        </div>
      </Controls>
      {fetching ? <LoadingDotsArea /> : null}
      {error ? <ErrorText>{error.message}</ErrorText> : null}
      {lookupResult}
    </>
  )
}
