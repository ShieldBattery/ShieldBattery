import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { SbUserId } from '../../common/users/sb-user-id'
import { graphql } from '../gql'
import { LoadErrorRow } from '../lists/load-error-row'
import { CatalogDensity, DENSITY_LAYOUT, EmptyText, Grid } from '../maps/map-catalog-list'
import { MapTile, MapTileSignal } from '../maps/map-tile'
import {
  PlayersCollectionsSection,
  usePlayersCollectionsPage,
} from '../maps/players-collections-section'
import { OutlinedButton } from '../material/button'
import { LoadingDotsArea } from '../progress/dots'

const PAGE_SIZE = 40

const UserOwnedMapsQuery = graphql(/* GraphQL */ `
  query UserProfileOwnedMaps($owner: SbUserId!, $after: String, $first: Int) {
    maps(filter: { owner: $owner }, sort: NEWEST, after: $after, first: $first) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          ...MapTile_SbMapFragment
        }
      }
    }
  }
`)

const UserHasMapsTabQuery = graphql(/* GraphQL */ `
  query UserProfileHasMapsTab($owner: SbUserId!) {
    maps(filter: { owner: $owner }, first: 1) {
      edges {
        cursor
      }
    }
    mapCollections(section: PLAYERS, owner: $owner, first: 1) {
      edges {
        cursor
      }
    }
  }
`)

/**
 * Requests results without suspending: the profile renders its own loading states. Module-level so
 * the query sees the same context every render.
 */
const NO_SUSPENSE_CONTEXT = { suspense: false }

/**
 * Whether a user owns any listed map or has a public collection, so their profile shows a Maps tab.
 * Undefined until that's known, which keeps the tab from showing and then going away.
 */
export function useHasMapsTab(userId: SbUserId): boolean | undefined {
  const [{ data }] = useQuery({
    query: UserHasMapsTabQuery,
    variables: { owner: userId },
    requestPolicy: 'cache-and-network',
    context: NO_SUSPENSE_CONTEXT,
  })
  return data ? data.maps.edges.length > 0 || data.mapCollections.edges.length > 0 : undefined
}

const Root = styled.div`
  width: 100%;
  max-width: 720px;
  padding: 0 24px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const LoadMoreRow = styled.div`
  display: flex;
  justify-content: center;
`

/**
 * The maps a user made: the listed maps they own, newest first, as the catalog's tiles, then their
 * public collections. Everyone, the user included, sees the same collections.
 */
export function UserProfileMaps({ userId }: { userId: SbUserId }) {
  const { t } = useTranslation()
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null])
  const layout = DENSITY_LAYOUT[CatalogDensity.Cozy]
  const collectionsFilter = { owner: userId }
  const firstCollectionsPage = usePlayersCollectionsPage(collectionsFilter, null)
  const hasCollections = firstCollectionsPage.connection
    ? firstCollectionsPage.connection.edges.length > 0
    : undefined

  return (
    <Root>
      <Grid $minTileWidth={layout.minTileWidth}>
        {pageCursors.map((cursor, i) => (
          <OwnedMapsPage
            key={cursor ?? 'first'}
            userId={userId}
            after={cursor}
            isFirst={i === 0}
            isLast={i === pageCursors.length - 1}
            // A user with collections but no maps shows just the collections
            showEmpty={hasCollections === false || !!firstCollectionsPage.error}
            imageSize={layout.imageSize}
            onLoadMore={endCursor =>
              setPageCursors(prev => (prev.includes(endCursor) ? prev : [...prev, endCursor]))
            }
          />
        ))}
      </Grid>
      <PlayersCollectionsSection
        title={t('users.profile.collections', 'Collections')}
        filter={collectionsFilter}
      />
    </Root>
  )
}

/** Spans the whole grid, for the rows that aren't tiles. */
const FullRow = styled.div`
  grid-column: 1 / -1;
`

function OwnedMapsPage({
  userId,
  after,
  isFirst,
  isLast,
  showEmpty,
  imageSize,
  onLoadMore,
}: {
  userId: SbUserId
  after: string | null
  isFirst: boolean
  isLast: boolean
  /** Whether a first page with no maps says so. */
  showEmpty: boolean
  imageSize: number
  onLoadMore: (endCursor: string) => void
}) {
  const { t } = useTranslation()
  const [{ data, error }, reexecute] = useQuery({
    query: UserOwnedMapsQuery,
    variables: { owner: userId, after: after ?? undefined, first: PAGE_SIZE },
    requestPolicy: 'cache-and-network',
    context: NO_SUSPENSE_CONTEXT,
  })

  const connection = data?.maps
  if (!connection) {
    return (
      <FullRow>
        {error ? (
          <LoadErrorRow
            message={t('maps.catalog.loadError', "Couldn't load maps")}
            onRetry={() => reexecute({ requestPolicy: 'network-only' })}
          />
        ) : (
          <LoadingDotsArea />
        )}
      </FullRow>
    )
  }

  const { hasNextPage, endCursor } = connection.pageInfo
  return (
    <>
      {connection.edges.map(edge => (
        <MapTile
          key={edge.node.id}
          map={edge.node}
          signal={MapTileSignal.Total}
          imageSize={imageSize}
        />
      ))}
      {isFirst && showEmpty && !connection.edges.length ? (
        <FullRow>
          <EmptyText>{t('users.profile.noMaps', "This user hasn't made any maps yet.")}</EmptyText>
        </FullRow>
      ) : null}
      {isLast && hasNextPage && endCursor ? (
        <FullRow>
          <LoadMoreRow>
            <OutlinedButton
              label={t('users.profile.moreMaps', 'Show more maps')}
              onClick={() => onLoadMore(endCursor)}
            />
          </LoadMoreRow>
        </FullRow>
      ) : null}
    </>
  )
}
