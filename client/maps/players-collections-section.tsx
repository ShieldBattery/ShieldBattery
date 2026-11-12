import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { SbUserId } from '../../common/users/sb-user-id'
import { graphql } from '../gql'
import { LoadErrorRow } from '../lists/load-error-row'
import { OutlinedButton } from '../material/button'
import { titleMedium } from '../styles/typography'
import { MapCollectionCard, MapCollectionGrid } from './map-collection-card'

/** How many players' collections each page loads. */
const PAGE_SIZE = 40

const PlayersCollectionsQuery = graphql(/* GraphQL */ `
  query PlayersCollections(
    $owner: SbUserId
    $search: String
    $after: String
    $first: Int!
    $withCount: Boolean!
  ) {
    mapCollections(section: PLAYERS, owner: $owner, search: $search, after: $after, first: $first) {
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

/** Requests results without suspending: the section renders its own loading states. */
const NO_SUSPENSE_CONTEXT = { suspense: false }

export const CollectionsSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

export const CollectionsSectionTitle = styled.h2`
  ${titleMedium};
  margin: 0;
`

const ShowMoreRow = styled.div`
  display: flex;
  justify-content: center;
`

/** Which players' public collections are listed: optionally one player's, matching a search. */
export interface PlayersCollectionsFilter {
  owner?: SbUserId
  search?: string
}

/**
 * Loads one page of players' public collections. Every caller asking for the same page shares one
 * request, so a section can read the last page's cursor from the same results its pages render.
 */
export function usePlayersCollectionsPage(
  { owner, search }: PlayersCollectionsFilter,
  after: string | null,
) {
  const [{ data, fetching, error }, reexecute] = useQuery({
    query: PlayersCollectionsQuery,
    variables: {
      owner,
      search,
      after: after ?? undefined,
      first: PAGE_SIZE,
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
 * Players' public collections as cards under `title`, the most saved first, a page at a time.
 * Shows nothing when there are none. Key it by its filter, so a different filter starts at the
 * first page.
 */
export function PlayersCollectionsSection({
  title,
  filter,
}: {
  title: string
  filter: PlayersCollectionsFilter
}) {
  const { t } = useTranslation()
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null])
  const firstPage = usePlayersCollectionsPage(filter, null)
  const lastPage = usePlayersCollectionsPage(filter, pageCursors[pageCursors.length - 1])

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
    <CollectionsSection>
      <CollectionsSectionTitle>{title}</CollectionsSectionTitle>
      <MapCollectionGrid>
        {pageCursors.map(cursor => (
          <PlayersCollectionsChunk key={cursor ?? 'first'} filter={filter} after={cursor} />
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
    </CollectionsSection>
  )
}

function PlayersCollectionsChunk({
  filter,
  after,
}: {
  filter: PlayersCollectionsFilter
  after: string | null
}) {
  const { connection } = usePlayersCollectionsPage(filter, after)
  return (
    <>
      {connection?.edges.map(edge => (
        <MapCollectionCard key={edge.node.id} collection={edge.node} />
      ))}
    </>
  )
}
