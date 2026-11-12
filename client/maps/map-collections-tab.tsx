import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { useLocationProperty } from 'wouter/use-browser-location'
import { MapCatalogTab } from '../../common/map-url'
import { useTrackPageView } from '../analytics/analytics'
import { useSelfUser } from '../auth/auth-utils'
import { graphql } from '../gql'
import { LoadErrorRow } from '../lists/load-error-row'
import { FilledButton } from '../material/button'
import { replace } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
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
import {
  CollectionsSection,
  CollectionsSectionTitle,
  PlayersCollectionsSection,
  usePlayersCollectionsPage,
} from './players-collections-section'

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

/** Requests results without suspending: the tab renders its own loading states. */
const NO_SUSPENSE_CONTEXT = { suspense: false }

const TopRow = styled.div`
  display: flex;
  justify-content: flex-end;
`

/** The route for the catalog's Collections tab: `/maps/collections`. */
export function MapCollectionsRoute() {
  useTrackPageView('/maps/collections')
  return <MapCollectionsTab />
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
  const firstPlayersPage = usePlayersCollectionsPage({ search }, null)

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
          <CollectionsSection>
            <CollectionsSectionTitle>
              {t('maps.collections.yours', 'Yours')}
            </CollectionsSectionTitle>
            <MapCollectionGrid>
              {yours.map(c => (
                <MapCollectionCard key={c.id} collection={c} />
              ))}
            </MapCollectionGrid>
          </CollectionsSection>
        ) : null}
        {ladder.length ? (
          <CollectionsSection>
            <CollectionsSectionTitle>
              {t('maps.collections.ladderPools', 'Ladder pools')}
            </CollectionsSectionTitle>
            <MapCollectionGrid>
              {ladder.map(c => (
                <MapCollectionCard key={c.id} collection={c} />
              ))}
            </MapCollectionGrid>
          </CollectionsSection>
        ) : null}
        {staff.length ? (
          <CollectionsSection>
            <CollectionsSectionTitle>
              {t('maps.collections.fromStaff', 'From SB staff')}
            </CollectionsSectionTitle>
            <MapCollectionGrid>
              {staff.map(c => (
                <MapCollectionCard key={c.id} collection={c} />
              ))}
            </MapCollectionGrid>
          </CollectionsSection>
        ) : null}
        <PlayersCollectionsSection
          key={search ?? ''}
          title={t('maps.collections.fromPlayers', 'From players')}
          filter={{ search }}
        />
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
