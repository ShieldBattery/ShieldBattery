import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { useLocationProperty } from 'wouter/use-browser-location'
import { MapCatalogTab } from '../../common/map-url'
import { useTrackPageView } from '../analytics/analytics'
import { useSelfUser } from '../auth/auth-utils'
import { graphql } from '../gql'
import { LoadErrorRow } from '../lists/load-error-row'
import { FilledButton, OutlinedButton } from '../material/button'
import { replace } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { titleMedium } from '../styles/typography'
import { openMapCollectionCreateDialog } from './action-creators'
import { CatalogSearchInput, MapCatalogFrame } from './map-catalog'
import { EmptyState, EmptyText } from './map-catalog-list'
import { MapCollectionCard, MapCollectionGrid } from './map-collection-card'
import {
  collectionSearchArg,
  collectionTitle,
  collectionTitleMatches,
  MAX_COLLECTION_SEARCH_LENGTH,
} from './map-collection-text'

/** How many players' collections each page of "From players" loads. */
const PLAYERS_PAGE_SIZE = 40
/** How many staff collections and ladder pools are loaded, which is all of them in practice. */
const SECTION_LIMIT = 100

const MapCollectionsTabQuery = graphql(/* GraphQL */ `
  query MapCollectionsTab($search: String, $loggedIn: Boolean!, $first: Int!) {
    currentUser @include(if: $loggedIn) {
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

const MapCollectionsPlayersQuery = graphql(/* GraphQL */ `
  query MapCollectionsPlayers($search: String, $after: String, $first: Int!, $withCount: Boolean!) {
    mapCollections(section: PLAYERS, search: $search, after: $after, first: $first) {
      totalCount @include(if: $withCount)
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          ...MapCollectionCard_CollectionFragment
        }
      }
    }
  }
`)

/** Requests results without suspending: the tab renders its own loading states. */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const TopRow = styled.div`
  display: flex;
  justify-content: flex-end;
`

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const SectionTitle = styled.h2`
  ${titleMedium};
  margin: 0;
`

const ShowMoreRow = styled.div`
  display: flex;
  justify-content: center;
`

/** The route for the catalog's Collections tab: `/maps/collections`. */
export function MapCollectionsRoute() {
  useTrackPageView('/maps/collections')
  return <MapCollectionsTab />
}

/**
 * Loads one page of the players' collections. Every caller asking for the same page shares one
 * request, so the section can read the last page's cursor from the same results its pages render.
 */
function usePlayersPage(search: string | undefined, after: string | null) {
  const [{ data, fetching, error }, reexecute] = useQuery({
    query: MapCollectionsPlayersQuery,
    variables: {
      search,
      after: after ?? undefined,
      first: PLAYERS_PAGE_SIZE,
      withCount: after === null,
    },
    requestPolicy: 'cache-and-network',
    context: NO_SUSPENSE_CONTEXT,
  })
  return {
    connection: data?.mapCollections,
    fetching,
    error,
    retry: () => reexecute({ requestPolicy: 'network-only' }),
  }
}

/**
 * The catalog's Collections tab: the viewer's own collections (Starred first, then the ones they
 * made, then the ones they saved), the current ladder pools, the staff's collections and players'
 * public collections, each section filtered by the header's search.
 */
function MapCollectionsTab() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const locationSearch = useLocationProperty(() => location.search)
  const searchText = new URLSearchParams(locationSearch).get('q') ?? ''
  const search = collectionSearchArg(searchText)

  const onSearchChange = (value: string) => {
    const next = new URLSearchParams(location.search)
    if (value) {
      next.set('q', value)
    } else {
      next.delete('q')
    }
    const nextSearch = next.toString()
    replace(location.pathname + (nextSearch ? `?${nextSearch}` : ''))
  }

  const [{ data, error }, reexecute] = useQuery({
    query: MapCollectionsTabQuery,
    variables: { search, loggedIn: !!selfUser, first: SECTION_LIMIT },
    requestPolicy: 'cache-and-network',
    context: NO_SUSPENSE_CONTEXT,
  })
  const firstPlayersPage = usePlayersPage(search, null)

  let body: React.ReactNode
  if (!data) {
    body = error ? (
      <LoadErrorRow
        message={t('maps.collections.loadError', "Couldn't load collections")}
        onRetry={() => reexecute({ requestPolicy: 'network-only' })}
      />
    ) : (
      <LoadingDotsArea />
    )
  } else {
    const yours = (data.currentUser?.mapCollections ?? []).filter(c =>
      collectionTitleMatches(collectionTitle(c, t), searchText),
    )
    const ladder = data.ladder.edges.map(e => e.node)
    const staff = data.staff.edges.map(e => e.node)
    const playersEmpty =
      !!firstPlayersPage.connection && firstPlayersPage.connection.edges.length === 0

    const nothingShown =
      !yours.length && !ladder.length && !staff.length && (playersEmpty || !!firstPlayersPage.error)
    body = nothingShown ? (
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
    ) : (
      <>
        {yours.length ? (
          <Section>
            <SectionTitle>{t('maps.collections.yours', 'Yours')}</SectionTitle>
            <MapCollectionGrid>
              {yours.map(c => (
                <MapCollectionCard key={c.id} collection={c} />
              ))}
            </MapCollectionGrid>
          </Section>
        ) : null}
        {ladder.length ? (
          <Section>
            <SectionTitle>{t('maps.collections.ladderPools', 'Ladder pools')}</SectionTitle>
            <MapCollectionGrid>
              {ladder.map(c => (
                <MapCollectionCard key={c.id} collection={c} />
              ))}
            </MapCollectionGrid>
          </Section>
        ) : null}
        {staff.length ? (
          <Section>
            <SectionTitle>{t('maps.collections.fromStaff', 'From SB staff')}</SectionTitle>
            <MapCollectionGrid>
              {staff.map(c => (
                <MapCollectionCard key={c.id} collection={c} />
              ))}
            </MapCollectionGrid>
          </Section>
        ) : null}
        <PlayersSection key={search ?? ''} search={search} />
      </>
    )
  }

  return (
    <MapCatalogFrame
      tab={MapCatalogTab.Collections}
      search={
        <CatalogSearchInput
          value={searchText}
          label={t('maps.collections.search', 'Search collections')}
          maxLength={MAX_COLLECTION_SEARCH_LENGTH}
          onChange={onSearchChange}
        />
      }>
      {selfUser ? (
        <TopRow>
          <FilledButton
            label={t('maps.collections.newCollection', 'New collection')}
            iconStart='add'
            onClick={() => dispatch(openMapCollectionCreateDialog())}
          />
        </TopRow>
      ) : null}
      {body}
    </MapCatalogFrame>
  )
}

/** Players' public collections, the most saved first, a page at a time. */
function PlayersSection({ search }: { search: string | undefined }) {
  const { t } = useTranslation()
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null])
  const firstPage = usePlayersPage(search, null)
  const lastPage = usePlayersPage(search, pageCursors[pageCursors.length - 1])

  // The cursors are offsets into the listing, so once it changes (a collection was saved, made
  // public or hidden) the later pages could repeat or skip collections. Paging starts over then.
  const firstPageContents = firstPage.connection
    ? JSON.stringify([
        firstPage.connection.totalCount,
        firstPage.connection.edges.map(e => e.node.id),
      ])
    : undefined
  const [pagedContents, setPagedContents] = useState(firstPageContents)
  if (firstPageContents !== undefined && firstPageContents !== pagedContents) {
    setPagedContents(firstPageContents)
    if (pagedContents !== undefined) {
      setPageCursors([null])
    }
  }

  if (!firstPage.connection) {
    return firstPage.error ? (
      <LoadErrorRow
        message={t('maps.collections.loadError', "Couldn't load collections")}
        onRetry={firstPage.retry}
      />
    ) : null
  }
  if (!firstPage.connection.edges.length) {
    return null
  }

  const endCursor = lastPage.connection?.pageInfo.endCursor
  return (
    <Section>
      <SectionTitle>{t('maps.collections.fromPlayers', 'From players')}</SectionTitle>
      <MapCollectionGrid>
        {pageCursors.map(cursor => (
          <PlayersChunk key={cursor ?? 'first'} search={search} after={cursor} />
        ))}
      </MapCollectionGrid>
      {lastPage.error ? (
        <LoadErrorRow
          message={t('maps.collections.loadMoreError', "Couldn't load more collections")}
          onRetry={lastPage.retry}
        />
      ) : null}
      {lastPage.connection?.pageInfo.hasNextPage && endCursor ? (
        <ShowMoreRow>
          <OutlinedButton
            label={t('maps.collections.showMore', 'Show more')}
            disabled={lastPage.fetching}
            onClick={() =>
              setPageCursors(prev => (prev.includes(endCursor) ? prev : [...prev, endCursor]))
            }
          />
        </ShowMoreRow>
      ) : null}
    </Section>
  )
}

function PlayersChunk({ search, after }: { search: string | undefined; after: string | null }) {
  const { connection } = usePlayersPage(search, after)
  return (
    <>
      {connection?.edges.map(edge => (
        <MapCollectionCard key={edge.node.id} collection={edge.node} />
      ))}
    </>
  )
}
