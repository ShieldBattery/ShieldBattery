import { ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { MAX_MAP_QUEUE } from '../../common/lobbies'
import { makeSbMapId, SbMapId } from '../../common/maps'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapCollectionKind } from '../gql/graphql'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { LoadErrorRow } from '../lists/load-error-row'
import { OutlinedButton, TextButton } from '../material/button'
import { LoadingDotsArea } from '../progress/dots'
import { bodyMedium, singleLine, titleMedium } from '../styles/typography'
import {
  CatalogDensity,
  DENSITY_LAYOUT,
  EmptyState,
  EmptyText,
  Grid,
  MapPickOptions,
  tilePick,
} from './map-catalog-list'
import { useLastSettledData } from './map-collection-actions'
import {
  MapCollectionCard,
  MapCollectionCard_CollectionFragment,
  MapCollectionGrid,
} from './map-collection-card'
import {
  collectionSearchArg,
  collectionTitle,
  collectionTitleMatches,
  mapCountText,
} from './map-collection-text'
import { MapTile, MapTileSignal } from './map-tile'

const MapPickerCollectionsQuery = graphql(/* GraphQL */ `
  query MapPickerCollections($search: String, $first: Int!) {
    currentUser {
      id
      mapCollections {
        id
        kind
        title
        ...MapCollectionCard_CollectionFragment
      }
    }
    ladder: mapCollections(section: LADDER, search: $search, first: $first) {
      edges {
        node {
          id
          ...MapCollectionCard_CollectionFragment
        }
      }
    }
    staff: mapCollections(section: STAFF, search: $search, first: $first) {
      edges {
        node {
          id
          ...MapCollectionCard_CollectionFragment
        }
      }
    }
  }
`)

const MapPickerCollectionMapsQuery = graphql(/* GraphQL */ `
  query MapPickerCollectionMaps($id: UUID!, $after: String, $first: Int!, $withCount: Boolean!) {
    mapCollection(id: $id) {
      id
      maps(after: $after, first: $first) {
        totalCount @include(if: $withCount)
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          node {
            id
            family {
              id
            }
            ...MapTile_SbMapFragment
          }
        }
      }
    }
  }
`)

/** How many staff collections and ladder pools are loaded, which is all of them in practice. */
const SECTION_LIMIT = 100
/**
 * How many maps each page of an opened collection loads. More than a lobby's queue holds, so the
 * first page has every map that adding all of them to the queue can use.
 */
const MAPS_PAGE_SIZE = Math.max(40, MAX_MAP_QUEUE)

/**
 * Requests results without suspending: the picker renders its own loading states. Module-level so
 * the queries see the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

/** A collection opened in the picker, listing its maps. */
export interface PickerCollection {
  id: string
  /** Its title, as the viewer sees it. */
  title: string
}

/** Adding all of an opened collection's maps to a lobby's queue at once. */
export interface PickerAddAll {
  /** Adds the maps to the end of the queue in order, as many as it has room for. */
  onAddAll: (mapIds: ReadonlyArray<SbMapId>) => void
  /** Whether the queue has no room left. */
  disabled: boolean
}

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const SectionTitle = styled.h2`
  ${titleMedium};
  margin: 0;
`

const Sections = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`

/**
 * The picker's Collections tab: the collections a host is likely to pick from (their own and the
 * ones they saved, the current ladder pools and the staff collections) as cards, and once one is
 * opened, its maps as pick tiles.
 */
export function MapPickerCollections({
  search,
  opened,
  excludeId,
  pick,
  addAll,
  density,
  onOpen,
  onBack,
}: {
  /** The picker's search text, which filters the collections by title. */
  search: string
  /** The collection whose maps are shown, if one is opened. */
  opened?: PickerCollection
  /** A collection left out of the list, e.g. the one maps are being added to. */
  excludeId?: string
  pick: MapPickOptions
  /** When set, an opened collection offers to add all of its maps to the queue. */
  addAll?: PickerAddAll
  density: CatalogDensity
  onOpen: (collection: PickerCollection) => void
  onBack: () => void
}) {
  return opened ? (
    <OpenedCollection
      key={opened.id}
      collection={opened}
      pick={pick}
      addAll={addAll}
      density={density}
      onBack={onBack}
    />
  ) : (
    <CollectionList search={search} excludeId={excludeId} onOpen={onOpen} />
  )
}

function CollectionList({
  search: searchText,
  excludeId,
  onOpen,
}: {
  search: string
  excludeId?: string
  onOpen: (collection: PickerCollection) => void
}) {
  const { t } = useTranslation()
  const search = collectionSearchArg(searchText)
  const [result, reexecute] = useQuery({
    query: MapPickerCollectionsQuery,
    variables: { search, first: SECTION_LIMIT },
    requestPolicy: 'cache-and-network',
    context: NO_SUSPENSE_CONTEXT,
  })
  // A change to a collection makes the lists load again, so the last ones show until then
  const data = useLastSettledData(result)

  if (!data) {
    return result.error ? (
      <LoadErrorRow
        message={t('maps.collections.loadError', "Couldn't load collections")}
        onRetry={() => reexecute({ requestPolicy: 'network-only' })}
      />
    ) : (
      <LoadingDotsArea />
    )
  }

  // Starred has a tab of its own
  const yours = (data.currentUser?.mapCollections ?? []).filter(
    c =>
      c.kind !== MapCollectionKind.Starred &&
      c.id !== excludeId &&
      collectionTitleMatches(collectionTitle(c, t), searchText),
  )
  const ladder = data.ladder.edges.map(e => e.node).filter(c => c.id !== excludeId)
  const staff = data.staff.edges.map(e => e.node).filter(c => c.id !== excludeId)

  if (!yours.length && !ladder.length && !staff.length) {
    return (
      <EmptyState>
        <EmptyText>
          {search
            ? t('maps.collections.noSearchMatches', {
                defaultValue: 'No collections match "{{search}}".',
                search,
              })
            : t('maps.collections.noCollections', 'There are no collections yet.')}
        </EmptyText>
      </EmptyState>
    )
  }

  const sections: Array<
    [
      title: string,
      collections: ReadonlyArray<
        { id: string } & FragmentType<typeof MapCollectionCard_CollectionFragment>
      >,
    ]
  > = [
    [t('maps.collections.yours', 'Yours'), yours],
    [t('maps.collections.ladderPools', 'Ladder pools'), ladder],
    [t('maps.collections.fromStaff', 'From SB staff'), staff],
  ]
  return (
    <Sections>
      {sections
        .filter(([, collections]) => collections.length)
        .map(([title, collections]) => (
          <Section key={title}>
            <SectionTitle>{title}</SectionTitle>
            <MapCollectionGrid>
              {collections.map(c => (
                <PickerCollectionCard key={c.id} collection={c} onOpen={onOpen} />
              ))}
            </MapCollectionGrid>
          </Section>
        ))}
    </Sections>
  )
}

function PickerCollectionCard({
  collection: collectionRef,
  onOpen,
}: {
  collection: FragmentType<typeof MapCollectionCard_CollectionFragment>
  onOpen: (collection: PickerCollection) => void
}) {
  const { t } = useTranslation()
  const collection = useFragment(MapCollectionCard_CollectionFragment, collectionRef)
  return (
    <MapCollectionCard
      collection={collectionRef}
      onOpen={() => onOpen({ id: collection.id, title: collectionTitle(collection, t) })}
    />
  )
}

const OpenedHeader = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
`

const OpenedTitle = styled.h2`
  ${titleMedium};
  ${singleLine};
  min-width: 0;
  margin: 0;
`

const OpenedCount = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
  white-space: nowrap;
`

/**
 * Loads one page of an opened collection's maps. Every caller asking for the same page shares one
 * request, so the list can read the last page's cursor from the same results its pages render.
 */
function useCollectionMapsPage(collectionId: string, after: string | null) {
  const [{ data, fetching, error }, reexecute] = useQuery({
    query: MapPickerCollectionMapsQuery,
    variables: {
      id: collectionId,
      after: after ?? undefined,
      first: MAPS_PAGE_SIZE,
      withCount: after === null,
    },
    requestPolicy: 'cache-and-network',
    context: NO_SUSPENSE_CONTEXT,
  })
  return {
    data,
    connection: data?.mapCollection?.maps,
    fetching,
    error,
    retry: () => reexecute({ requestPolicy: 'network-only' }),
  }
}

/**
 * A collection's maps in its own order, as tiles that pick them. A ladder pool's tiles are the
 * exact files it holds, so picking one picks that file.
 */
function OpenedCollection({
  collection,
  pick,
  addAll,
  density,
  onBack,
}: {
  collection: PickerCollection
  pick: MapPickOptions
  addAll?: PickerAddAll
  density: CatalogDensity
  onBack: () => void
}) {
  const { t } = useTranslation()
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null])
  const firstPage = useCollectionMapsPage(collection.id, null)
  const lastPage = useCollectionMapsPage(collection.id, pageCursors[pageCursors.length - 1])
  const layout = DENSITY_LAYOUT[density]
  const totalCount = firstPage.connection?.totalCount
  // The queue holds no more than this many, so the rest of the collection never fits
  const addAllIds = (firstPage.connection?.edges ?? [])
    .slice(0, MAX_MAP_QUEUE)
    .map(edge => makeSbMapId(edge.node.id))

  const onLoadMore = () => {
    const endCursor = lastPage.connection?.pageInfo.endCursor
    if (lastPage.connection?.pageInfo.hasNextPage && endCursor) {
      setPageCursors(prev => (prev.includes(endCursor) ? prev : [...prev, endCursor]))
    }
  }

  let content: ReactNode
  if (!firstPage.data) {
    content = firstPage.error ? (
      <LoadErrorRow
        message={t('maps.catalog.loadError', "Couldn't load maps")}
        onRetry={firstPage.retry}
      />
    ) : (
      <LoadingDotsArea />
    )
  } else if (!firstPage.connection) {
    content = (
      <EmptyState>
        <EmptyText>
          {t('maps.collections.notFound', 'This collection could not be found.')}
        </EmptyText>
      </EmptyState>
    )
  } else if (!firstPage.connection.edges.length) {
    content = (
      <EmptyState>
        <EmptyText>{t('maps.collections.empty', 'There are no maps here yet.')}</EmptyText>
      </EmptyState>
    )
  } else {
    content = (
      <InfiniteScrollList
        nextLoadingEnabled={true}
        isLoadingNext={lastPage.fetching}
        hasNextData={!!lastPage.connection?.pageInfo.hasNextPage}
        nextError={
          lastPage.error ? (
            <LoadErrorRow
              message={t('maps.catalog.loadMoreError', "Couldn't load more maps")}
              onRetry={lastPage.retry}
            />
          ) : undefined
        }
        refreshToken={collection.id}
        onLoadNextData={onLoadMore}>
        <Grid $minTileWidth={layout.minTileWidth}>
          {pageCursors.map(cursor => (
            <CollectionMapsChunk
              key={cursor ?? 'first'}
              collectionId={collection.id}
              after={cursor}
              imageSize={layout.imageSize}
              pick={pick}
            />
          ))}
        </Grid>
      </InfiniteScrollList>
    )
  }

  return (
    <>
      <OpenedHeader>
        <TextButton
          label={t('maps.collections.tab', 'Collections')}
          iconStart='arrow_back'
          onClick={onBack}
        />
        <OpenedTitle>{collection.title}</OpenedTitle>
        {totalCount !== undefined ? <OpenedCount>{mapCountText(totalCount, t)}</OpenedCount> : null}
        {addAll ? (
          <OutlinedButton
            label={t('maps.picker.addAll', 'Add all')}
            iconStart='playlist_add'
            disabled={addAll.disabled || !addAllIds.length || !!pick.pendingMapId}
            onClick={() => addAll.onAddAll(addAllIds)}
          />
        ) : null}
      </OpenedHeader>
      {content}
    </>
  )
}

function CollectionMapsChunk({
  collectionId,
  after,
  imageSize,
  pick,
}: {
  collectionId: string
  after: string | null
  imageSize: number
  pick: MapPickOptions
}) {
  const { connection } = useCollectionMapsPage(collectionId, after)
  return (
    <>
      {connection?.edges.map(edge => (
        <MapTile
          key={edge.node.id}
          map={edge.node}
          signal={MapTileSignal.Total}
          imageSize={imageSize}
          pick={tilePick(pick, edge.node.id as SbMapId, edge.node.family.id)}
        />
      ))}
    </>
  )
}
