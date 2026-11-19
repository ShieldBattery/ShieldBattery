import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { useLocationProperty } from 'wouter/use-browser-location'
import { MapCatalogTab, urlForMapCatalog, urlForMapCollections } from '../../common/map-url'
import { filterColorCodes } from '../../common/maps'
import { urlPath } from '../../common/urls'
import { useTrackPageView } from '../analytics/analytics'
import { useSelfUser } from '../auth/auth-utils'
import { Avatar } from '../avatars/avatar'
import { FragmentType, graphql, useFragment } from '../gql'
import { MapLens } from '../gql/graphql'
import { relativeTimeFormat, useFormat } from '../i18n/locale-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { LoadErrorRow } from '../lists/load-error-row'
import { TextButton } from '../material/button'
import { Card } from '../material/card'
import { LinkButton } from '../material/link-button'
import { Tooltip } from '../material/tooltip'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { bodyMedium, bodySmall, singleLine, titleLarge, titleSmall } from '../styles/typography'
import { UserProfileSubPage } from '../users/user-profile-sub-page'
import { VerifiedMakerChip } from './map-byline'
import { CatalogSearchInput, MapCatalogFrame, useSavedCatalogFilters } from './map-catalog'
import {
  CatalogDensity,
  CatalogLensControl,
  DENSITY_LAYOUT,
  EmptyState,
  EmptyText,
} from './map-catalog-list'
import {
  catalogSearchForTag,
  CatalogSort,
  filtersOf,
  hasCatalogParams,
  parseCatalogParams,
  serializeCatalogParams,
  withSearch,
} from './map-catalog-params'
import { MapCollectionCard } from './map-collection-card'
import { mapCountText } from './map-collection-text'
import { MapDiscoverHero } from './map-discover-hero'
import {
  browseTags,
  catalogSearchForRail,
  COLLECTION_RAIL_SIZE,
  collectionsRail,
  DiscoverLens,
  discoverLensKind,
  FRESH_FETCH_COUNT,
  freshRail,
  freshSince,
  isDiscoverLens,
  MAKER_RAIL_SIZE,
  MAP_RAIL_SIZE,
  MIN_RECENT_MAPS,
  RAIL_GAP,
  railColumnSteps,
  RECENT_MAPS_COUNT,
  recommendationShowAllTag,
  recommendationSubtitle,
  resolveDiscoverLens,
  shownRail,
  trendingRail,
  validateSavedDiscoverLens,
} from './map-discover-rails'
import { urlForMapFile } from './map-family-files'
import { useMapHostAction } from './map-host-action'
import { MapFileImage } from './map-image'
import {
  MapRowControlButton,
  MapRowLink,
  MapRowMeta,
  MapRowName,
  MapRowText,
  MapRowThumbnail,
} from './map-row-parts'
import { TagChip, TagLink } from './map-tag-chip'
import { mapTagLabel, tagsForLens } from './map-tags'
import { MapTile, MapTileSignal } from './map-tile'

const MapDiscoverQuery = graphql(/* GraphQL */ `
  query MapDiscover(
    $lens: MapLens!
    $kind: MapKind!
    $loggedIn: Boolean!
    $freshSince: DateTime!
    $recentCount: Int!
    $railSize: Int!
    $freshCount: Int!
    $makerCount: Int!
    $collectionCount: Int!
  ) {
    currentUser @include(if: $loggedIn) {
      id
      recentMaps(first: $recentCount, lens: $lens) {
        id
        ...MapDiscover_RecentMapFragment
      }
      mapRecommendation(lens: $lens) {
        id
        seed {
          id
          name
        }
        tags {
          id
          kind
          name
          names {
            locale
            name
          }
        }
        maps {
          id
          ...MapTile_SbMapFragment
        }
      }
    }
    mapFeature(kind: $kind) {
      id
      ...MapDiscoverHero_FeatureFragment
    }
    trending: maps(filter: { lens: $lens }, sort: TRENDING, first: $railSize) {
      edges {
        node {
          id
          family {
            id
            stats {
              id
              trendingScore
            }
          }
          ...MapTile_SbMapFragment
        }
      }
    }
    fresh: maps(
      filter: { lens: $lens, publishedSince: $freshSince }
      sort: NEWEST
      first: $freshCount
    ) {
      edges {
        node {
          id
          publisher {
            id
          }
          ...MapTile_SbMapFragment
        }
      }
    }
    mapTags {
      id
      kind
      name
      names {
        locale
        name
      }
      mapCount
    }
    staffCollections: mapCollections(section: STAFF, lens: $lens, first: $collectionCount) {
      edges {
        node {
          id
          ...MapCollectionCard_CollectionFragment
        }
      }
    }
    playerCollections: mapCollections(section: PLAYERS, lens: $lens, first: $collectionCount) {
      edges {
        node {
          id
          ...MapCollectionCard_CollectionFragment
        }
      }
    }
    mapMakers(lens: $lens, first: $makerCount) {
      id
      ...MapDiscover_MakerFragment
    }
  }
`)

const MapDiscover_RecentMapFragment = graphql(/* GraphQL */ `
  fragment MapDiscover_RecentMapFragment on RecentMap {
    id
    lastPlayedAt
    map {
      id
      name
      family {
        id
        name
        current {
          id
        }
      }
      file {
        id
        ...MapFileImage_FileFragment
      }
    }
  }
`)

const MapDiscover_MakerFragment = graphql(/* GraphQL */ `
  fragment MapDiscover_MakerFragment on MapMaker {
    id
    verified
    mapCount
    user {
      id
      name
      avatarUrl
    }
  }
`)

/** Requests results without suspending: the page renders its own loading state. */
const NO_SUSPENSE_CONTEXT = { suspense: false }

/** The tiles of the rails of maps are the catalog's, at the catalog's larger size. */
const TILE_LAYOUT = DENSITY_LAYOUT[CatalogDensity.Cozy]

/** How wide a collection card in the Collections rail is at least, as on the Collections tab. */
const COLLECTION_MIN_WIDTH = 200

/** How wide a mapmaker card is at least. */
const MAKER_MIN_WIDTH = 180

const relativeTime = relativeTimeFormat({ numeric: 'auto' })

const TopRow = styled.div`
  display: flex;
  align-items: center;
`

const Sections = styled.div`
  display: flex;
  flex-direction: column;
  gap: 40px;
`

const Section = styled.section`
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const SectionHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`

const SectionTitles = styled.div`
  flex: 1 1 auto;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const SectionTitle = styled.h2`
  ${titleLarge};
  margin: 0;
  overflow-wrap: anywhere;
`

const SectionSubtitle = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

/** The width a rail's grid lays out its columns against. */
const RailContainer = styled.div`
  container: discover-rail / inline-size;
`

/**
 * The container queries giving a rail of cards at least `minCardWidth` wide one column per card
 * that fits, up to `maxColumns`, and taking the cards past the last column out of the layout, so
 * they can't be reached by keyboard either.
 */
function railColumnRules(minCardWidth: number, maxColumns: number): string {
  const steps = railColumnSteps(minCardWidth, RAIL_GAP, maxColumns)
  return steps
    .map((step, i) => {
      const next = steps[i + 1]
      const conditions = [
        step.fromWidth > 0 ? `(width >= ${step.fromWidth}px)` : undefined,
        next ? `(width < ${next.fromWidth}px)` : undefined,
      ]
        .filter(condition => !!condition)
        .join(' and ')
      return `
        @container discover-rail ${conditions} {
          grid-template-columns: repeat(${step.columns}, minmax(0, 1fr));

          & > :nth-child(n + ${step.columns + 1}) {
            display: none;
          }
        }
      `
    })
    .join('')
}

/**
 * One row of cards, as many as fit the width in equal columns, never scrolling sideways. The cards
 * that don't fit aren't shown at all.
 */
const RailGrid = styled.div<{ $minCardWidth: number; $maxColumns: number }>`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  column-gap: ${RAIL_GAP}px;

  ${props => railColumnRules(props.$minCardWidth, props.$maxColumns)}
`

function Rail({
  minCardWidth,
  maxColumns,
  children,
}: {
  /** The narrowest a card can be. */
  minCardWidth: number
  /** The most cards the rail holds. */
  maxColumns: number
  children: React.ReactNode
}) {
  return (
    <RailContainer>
      <RailGrid $minCardWidth={minCardWidth} $maxColumns={maxColumns}>
        {children}
      </RailGrid>
    </RailContainer>
  )
}

/** The breakpoints at which the Jump back in grid narrows, by the width of its container. */
const RecentGridContainer = styled.div`
  container-type: inline-size;
`

const RecentGrid = styled.ol`
  margin: 0;
  padding: 0;
  list-style: none;

  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;

  @container (width < 760px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  @container (width < 440px) {
    grid-template-columns: minmax(0, 1fr);
  }
`

const RecentCard = styled(Card)`
  position: relative;
  min-height: 64px;
  padding: 8px 8px 8px 12px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-radius: 6px;

  &:hover {
    background-color: var(--theme-container);
  }

  &:has(a:focus-visible) {
    outline: 2px solid var(--theme-primary);
  }
`

const RecentLink = styled(MapRowLink)`
  flex: 1 1 auto;
`

/** Sits above the link that covers the card, so it can be used. */
const RecentPlay = styled.div`
  position: relative;
  z-index: 1;
  flex-shrink: 0;
`

const TagChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`

const MakerCard = styled(Card)`
  position: relative;
  min-width: 0;
  padding: 20px 16px;

  border-radius: 8px;

  &:hover {
    background-color: var(--theme-container);
  }

  &:has(a:focus-visible) {
    outline: 2px solid var(--theme-primary);
  }
`

const MakerLink = styled(LinkButton)`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;

  text-align: center;

  &:focus-visible {
    outline: none;
  }

  /* Makes the whole card the link's target */
  &::after {
    position: absolute;
    inset: 0;
    content: '';
    border-radius: 8px;
  }
`

const MakerAvatar = styled(Avatar)`
  width: 56px;
  height: 56px;
`

const MakerName = styled.div`
  ${titleSmall};
  ${singleLine};
  max-width: 100%;
  color: var(--theme-on-surface);
`

const MakerMeta = styled.div`
  ${bodySmall};
  color: var(--theme-on-surface-variant);
`

/** Sits above the link that covers the card, so hovering it shows its tooltip. */
const MakerVerified = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: center;
`

/** The route for the map browser's front page: `/maps`. */
export function MapDiscoverRoute() {
  useTrackPageView('/maps')
  return <MapDiscover />
}

/**
 * The map browser's front page: the maps the viewer played lately, the week's featured map or
 * collection, and rails of maps picked in different ways, each following the lens picked at the
 * top (which the catalog's tabs share).
 */
function MapDiscover() {
  const { t, i18n } = useTranslation()
  const selfUser = useSelfUser()
  const locationSearch = useLocationProperty(() => location.search)
  const urlSearch = new URLSearchParams(locationSearch)
  const [savedFilters, setSavedFilters] = useSavedCatalogFilters()
  // A URL without the catalog's params shows what the viewer last picked, as the catalog does
  const catalogLens = hasCatalogParams(urlSearch)
    ? parseCatalogParams(urlSearch).lens
    : savedFilters.lens
  const [lastPicked, setLastPicked] = useUserLocalStorageValue<DiscoverLens | undefined>(
    'maps.discover.lens',
    undefined,
    validateSavedDiscoverLens,
  )
  // Discover shows one kind of maps; a catalog lens of All falls back to the kind last picked here
  const lens = resolveDiscoverLens(catalogLens, lastPicked)
  // Stays the same all day, so repeat visits share their cached results
  const [since] = useState(() => freshSince(Date.now()))

  const [{ data, error }, reexecute] = useQuery({
    query: MapDiscoverQuery,
    variables: {
      lens,
      kind: discoverLensKind(lens),
      loggedIn: !!selfUser,
      freshSince: since,
      recentCount: RECENT_MAPS_COUNT,
      railSize: MAP_RAIL_SIZE,
      freshCount: FRESH_FETCH_COUNT,
      makerCount: MAKER_RAIL_SIZE,
      collectionCount: COLLECTION_RAIL_SIZE,
    },
    // A game just played or a map just published shows up on the next visit
    requestPolicy: 'cache-and-network',
    context: NO_SUSPENSE_CONTEXT,
  })

  /** The catalog's filters as the URL holds them, or as the viewer saved them if it holds none. */
  const currentFilters = () => {
    const current = new URLSearchParams(location.search)
    const params = parseCatalogParams(current, data?.mapTags)
    return {
      current,
      params,
      filters: hasCatalogParams(current) ? filtersOf(params) : savedFilters,
    }
  }

  const onLensChange = (nextLens: MapLens) => {
    if (isDiscoverLens(nextLens)) {
      setLastPicked(nextLens)
    }
    const { current, params, filters } = currentFilters()
    const next = {
      ...params,
      ...filters,
      lens: nextLens,
      // Tags of the other kind of map no longer apply
      tags: tagsForLens(params.tags, nextLens, data?.mapTags),
    }
    const nextSearch = serializeCatalogParams(next, current)
    push(location.pathname + (nextSearch ? `?${nextSearch}` : ''))
    setSavedFilters(filtersOf(next))
  }

  const onSearchSubmit = (value: string) => {
    if (!value.trim()) {
      return
    }
    const { params, filters } = currentFilters()
    const next = withSearch(
      { ...filters, lens: catalogLens, tags: params.tags, search: '', sort: undefined },
      value,
    )
    push(urlForMapCatalog(MapCatalogTab.All, serializeCatalogParams(next)))
  }

  let body: React.ReactNode
  if (!data) {
    body = error ? (
      <LoadErrorRow
        message={t('maps.discover.loadError', "Couldn't load maps")}
        onRetry={() => reexecute({ requestPolicy: 'network-only' })}
      />
    ) : (
      <LoadingDotsArea />
    )
  } else {
    const recentMaps = shownRail(data.currentUser?.recentMaps, MIN_RECENT_MAPS)
    const trending = shownRail(trendingRail(data.trending.edges.map(e => e.node)))
    const fresh = shownRail(freshRail(data.fresh.edges.map(e => e.node)))
    const recommendation = data.currentUser?.mapRecommendation
    const recommended = shownRail(recommendation?.maps)
    const recommendationTag = recommendation
      ? recommendationShowAllTag(recommendation.tags)
      : undefined
    const tags = shownRail(browseTags(data.mapTags, lens), 1)
    const collections = shownRail(
      collectionsRail(
        data.staffCollections.edges.map(e => e.node),
        data.playerCollections.edges.map(e => e.node),
      ),
    )
    const makers = shownRail(data.mapMakers)

    const sections = [
      recentMaps ? (
        <Section key='recent'>
          <SectionHeading title={t('maps.discover.jumpBackIn', 'Jump back in')} />
          <RecentGridContainer>
            <RecentGrid>
              {recentMaps.map(recent => (
                <RecentMapCard key={recent.id} recent={recent} />
              ))}
            </RecentGrid>
          </RecentGridContainer>
        </Section>
      ) : null,
      data.mapFeature ? <MapDiscoverHero key='hero' feature={data.mapFeature} /> : null,
      trending ? (
        <Section key='trending'>
          <SectionHeading
            title={t('maps.discover.trending', 'Trending this week')}
            showAllUrl={urlForMapCatalog(
              MapCatalogTab.All,
              catalogSearchForRail(lens, CatalogSort.Trending),
            )}
          />
          <Rail minCardWidth={TILE_LAYOUT.minTileWidth} maxColumns={MAP_RAIL_SIZE}>
            {trending.map(map => (
              <MapTile
                key={map.id}
                map={map}
                signal={MapTileSignal.Trending}
                imageSize={TILE_LAYOUT.imageSize}
              />
            ))}
          </Rail>
        </Section>
      ) : null,
      fresh ? (
        <Section key='fresh'>
          <SectionHeading
            title={t('maps.discover.fresh', 'Fresh from the workshop')}
            subtitle={t(
              'maps.discover.freshSubtitle',
              'New maps and new versions from the last 60 days',
            )}
            showAllUrl={urlForMapCatalog(
              MapCatalogTab.All,
              catalogSearchForRail(lens, CatalogSort.Newest),
            )}
          />
          <Rail minCardWidth={TILE_LAYOUT.minTileWidth} maxColumns={MAP_RAIL_SIZE}>
            {fresh.map(map => (
              <MapTile
                key={map.id}
                map={map}
                signal={MapTileSignal.Published}
                imageSize={TILE_LAYOUT.imageSize}
              />
            ))}
          </Rail>
        </Section>
      ) : null,
      recommendation && recommended ? (
        <Section key='recommendation'>
          <SectionHeading
            title={t('maps.discover.becauseYouPlayed', 'Because you played {{name}}', {
              name: filterColorCodes(recommendation.seed.name),
            })}
            subtitle={recommendationSubtitle(recommendation.tags, i18n.language, t)}
            showAllUrl={
              recommendationTag
                ? urlForMapCatalog(MapCatalogTab.All, catalogSearchForTag(recommendationTag))
                : undefined
            }
          />
          <Rail minCardWidth={TILE_LAYOUT.minTileWidth} maxColumns={MAP_RAIL_SIZE}>
            {recommended.map(map => (
              <MapTile
                key={map.id}
                map={map}
                signal={MapTileSignal.Trending}
                imageSize={TILE_LAYOUT.imageSize}
              />
            ))}
          </Rail>
        </Section>
      ) : null,
      tags ? (
        <Section key='tags'>
          <SectionHeading title={t('maps.discover.browseByTag', 'Browse by tag')} />
          <TagChips>
            {tags.map(tag => (
              <TagLink
                key={tag.id}
                href={urlForMapCatalog(MapCatalogTab.All, catalogSearchForTag(tag))}>
                <TagChip>
                  {t('maps.discover.tagWithCount', '{{tag}} · {{count}}', {
                    tag: mapTagLabel(tag, i18n.language),
                    count: tag.mapCount,
                  })}
                </TagChip>
              </TagLink>
            ))}
          </TagChips>
        </Section>
      ) : null,
      collections ? (
        <Section key='collections'>
          <SectionHeading
            title={t('maps.collections.tab', 'Collections')}
            showAllUrl={urlForMapCollections()}
          />
          <Rail minCardWidth={COLLECTION_MIN_WIDTH} maxColumns={COLLECTION_RAIL_SIZE}>
            {collections.map(collection => (
              <MapCollectionCard key={collection.id} collection={collection} />
            ))}
          </Rail>
        </Section>
      ) : null,
      makers ? (
        <Section key='makers'>
          <SectionHeading
            title={t('maps.discover.mapmakers', 'Mapmakers')}
            subtitle={t(
              'maps.discover.mapmakersSubtitle',
              'The makers whose maps were played most this month',
            )}
          />
          <Rail minCardWidth={MAKER_MIN_WIDTH} maxColumns={MAKER_RAIL_SIZE}>
            {makers.map(maker => (
              <MapMakerCard key={maker.id} maker={maker} />
            ))}
          </Rail>
        </Section>
      ) : null,
    ].filter(section => !!section)

    body = sections.length ? (
      <Sections>{sections}</Sections>
    ) : (
      <EmptyState>
        <EmptyText>{t('maps.catalog.noMaps', 'There are no maps here yet.')}</EmptyText>
      </EmptyState>
    )
  }

  return (
    <MapCatalogFrame
      tab={MapCatalogTab.Discover}
      search={
        <CatalogSearchInput
          value=''
          label={t('maps.catalog.searchMaps', 'Search maps')}
          onSubmit={onSearchSubmit}
        />
      }>
      <TopRow>
        <CatalogLensControl lens={lens} onChange={onLensChange} withAll={false} />
      </TopRow>
      {body}
    </MapCatalogFrame>
  )
}

/** The heading row of a section: its title, an optional line under it, and its Show all link. */
function SectionHeading({
  title,
  subtitle,
  showAllUrl,
}: {
  title: string
  subtitle?: string
  /** The catalog view the section is the first page of, if any. */
  showAllUrl?: string
}) {
  const { t } = useTranslation()
  return (
    <SectionHeader>
      <SectionTitles>
        <SectionTitle>{title}</SectionTitle>
        {subtitle ? <SectionSubtitle>{subtitle}</SectionSubtitle> : null}
      </SectionTitles>
      {showAllUrl ? (
        <TextButton
          label={t('maps.discover.showAll', 'Show all')}
          iconEnd='arrow_forward'
          onClick={() => push(showAllUrl)}
        />
      ) : null}
    </SectionHeader>
  )
}

/**
 * A map the viewer played lately, as a compact card linking to the map's page: its image, name and
 * when they last played it. In the app it also opens Create lobby with the map.
 */
export function RecentMapCard({
  recent: recentRef,
}: {
  recent: FragmentType<typeof MapDiscover_RecentMapFragment>
}) {
  const { t } = useTranslation()
  const recent = useFragment(MapDiscover_RecentMapFragment, recentRef)
  const relative = useFormat(relativeTime)
  const { isLobbyHost, play } = useMapHostAction()
  const { map } = recent
  const name = filterColorCodes(map.name)
  const playLabel = isLobbyHost
    ? t('maps.page.useInMyLobby', 'Use in my lobby')
    : t('maps.collections.createLobby', 'Create lobby')

  return (
    <RecentCard as='li'>
      <RecentLink href={urlForMapFile(map.family, map.id)}>
        <MapRowThumbnail>
          <MapFileImage file={map.file} name={name} size={64} forceAspectRatio={1} />
        </MapRowThumbnail>
        <MapRowText>
          <MapRowName>{name}</MapRowName>
          <MapRowMeta>
            {t('maps.discover.playedAgo', 'Played {{time}}', {
              time: relative.format(new Date(recent.lastPlayedAt)),
            })}
          </MapRowMeta>
        </MapRowText>
      </RecentLink>
      {IS_ELECTRON ? (
        <RecentPlay>
          <Tooltip text={playLabel} position='bottom' tabIndex={-1}>
            <MapRowControlButton
              icon={<MaterialIcon icon='play_arrow' />}
              ariaLabel={playLabel}
              onClick={() => play(map.id)}
            />
          </Tooltip>
        </RecentPlay>
      ) : null}
    </RecentCard>
  )
}

/**
 * A maker of listed maps as a card: their avatar and name, whether staff confirmed them as a
 * maker, and how many maps they made. It opens the Maps tab of their profile.
 */
export function MapMakerCard({
  maker: makerRef,
}: {
  maker: FragmentType<typeof MapDiscover_MakerFragment>
}) {
  const { t } = useTranslation()
  const maker = useFragment(MapDiscover_MakerFragment, makerRef)
  const { user } = maker

  return (
    <MakerCard>
      <MakerLink href={urlPath`/users/${user.id}/${user.name}/${UserProfileSubPage.Maps}`}>
        <MakerAvatar user={user.name} image={user.avatarUrl ?? undefined} />
        <MakerName>{user.name}</MakerName>
        <MakerMeta>{mapCountText(maker.mapCount, t)}</MakerMeta>
      </MakerLink>
      {maker.verified ? (
        <MakerVerified>
          <VerifiedMakerChip
            tooltip={t(
              'maps.discover.verifiedMakerTooltip',
              'Staff confirmed this user made some of these maps',
            )}
          />
        </MakerVerified>
      ) : null}
    </MakerCard>
  )
}
