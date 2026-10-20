import { TFunction } from 'i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import * as React from 'react'
import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { useLocationProperty } from 'wouter/use-browser-location'
import { MapCatalogTab, urlForMapCatalog } from '../../common/map-url'
import { ALL_TILESETS, Tileset, tilesetToName } from '../../common/maps'
import { useTrackPageView } from '../analytics/analytics'
import { redirectToLogin, useSelfUser } from '../auth/auth-utils'
import { FileDropZone } from '../file-browser/file-drop-zone'
import { graphql } from '../gql'
import { EudFilter, MapFilter, MapLens, MapSizeClass } from '../gql/graphql'
import { MaterialIcon } from '../icons/material/material-icon'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { LoadErrorRow } from '../lists/load-error-row'
import { FilledButton, OutlinedButton, TextButton } from '../material/button'
import { FilterChip } from '../material/filter-chip'
import { SelectableMenuItem } from '../material/menu/selectable-item'
import { SegmentedButtonGroup } from '../material/segmented-button'
import { elevationPlus1 } from '../material/shadows'
import { TabItem, Tabs } from '../material/tabs'
import { useHistoryEntryKey, useScrollMemory } from '../navigation/router-hooks'
import { push, replace } from '../navigation/routing'
import { createViewStateStore } from '../navigation/view-state-store'
import { LoadingDotsArea } from '../progress/dots'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { SearchInput } from '../search/search-input'
import { CenteredContentContainer } from '../styles/centered-container'
import { bodyLarge, bodyMedium, displaySmall, labelLarge } from '../styles/typography'
import {
  ALL_CATALOG_PLAYERS,
  ALL_MAP_SIZE_CLASSES,
  BROWSE_SORTS,
  CatalogFilters,
  CatalogParams,
  CatalogPlayers,
  CatalogSort,
  catalogSortToMapSort,
  DEFAULT_CATALOG_FILTERS,
  effectiveSort,
  filtersOf,
  hasCatalogParams,
  hasNonDefaultFilters,
  parseCatalogParams,
  serializeCatalogParams,
  toMapFilter,
  validateSavedFilters,
  validateSavedSort,
} from './map-catalog-params'
import { MapTile, MapTileSignal, PendingMapTile } from './map-tile'
import {
  MAP_FILE_EXTENSIONS,
  mapLibraryVersionAtom,
  pendingMapUploadsAtom,
  useUploadMapFiles,
} from './map-uploads'

const LoadableLocalMaps = lazy(async () => ({
  default: (await import('./browse-local-maps')).BrowseLocalMaps,
}))

const PAGE_SIZE = 40

/** How densely the catalog lays out its tiles. */
enum CatalogDensity {
  Cozy = 'cozy',
  Compact = 'compact',
}

const DENSITY_LAYOUT: Readonly<
  Record<CatalogDensity, { minTileWidth: number; imageSize: number }>
> = {
  [CatalogDensity.Cozy]: { minTileWidth: 200, imageSize: 280 },
  [CatalogDensity.Compact]: { minTileWidth: 150, imageSize: 200 },
}

function validateDensity(value: unknown): CatalogDensity | undefined {
  return Object.values(CatalogDensity).includes(value as CatalogDensity)
    ? (value as CatalogDensity)
    : undefined
}

/**
 * Typing faster than this apart coalesces the search into one update once typing pauses. A
 * keystroke after a longer pause searches right away.
 */
const SEARCH_COALESCE_MS = 150

const Root = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
`

const Content = styled.div`
  min-height: 100%;
  padding-block: 16px 48px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Header = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px 24px;
`

const Title = styled.h1`
  ${displaySmall};
  margin: 0;
`

const HeaderControls = styled.div`
  flex: 1 1 auto;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
`

const StyledSearchInput = styled(SearchInput)`
  width: 280px;
  max-width: 100%;
`

const DropZone = styled(FileDropZone)`
  position: absolute;
  inset: 0;
  z-index: 1;
`

const DropContents = styled.div`
  ${elevationPlus1};
  ${bodyLarge};
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;

  background-color: rgb(from var(--theme-primary-container) r g b / 0.9);
  color: var(--theme-on-primary-container);
  pointer-events: none;
`

const BackRow = styled.div`
  display: flex;
`

/** The local maps browser sizes itself to its box, so this gives it the rest of the page. */
const LocalMapsArea = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 480px;

  & > * {
    position: absolute;
    inset: 0;
  }
`

const HiddenFileInput = styled.input`
  display: none;
`

/** The route for the map catalog's tabs: `/maps/:tab`. */
export function MapCatalogRoute({ tab }: { tab: MapCatalogTab }) {
  useTrackPageView(`/maps/${tab}`)
  return <MapCatalog key={tab} tab={tab} />
}

/** Sends `/maps` to the All maps tab, keeping any filters in its URL. */
export function MapCatalogRedirect() {
  useEffect(() => {
    replace(urlForMapCatalog(MapCatalogTab.All, location.search.slice(1)))
  }, [])
  return null
}

function MapCatalog({ tab }: { tab: MapCatalogTab }) {
  const { t } = useTranslation()
  const selfUser = useSelfUser()
  const uploadFiles = useUploadMapFiles()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [browsingLocalMaps, setBrowsingLocalMaps] = useState(false)

  const search = useLocationProperty(() => location.search)
  const params = parseCatalogParams(new URLSearchParams(search))

  const [savedFilters, setSavedFilters] = useUserLocalStorageValue<CatalogFilters>(
    'maps.catalog.filters',
    DEFAULT_CATALOG_FILTERS,
    validateSavedFilters,
  )
  const [savedSort, setSavedSort] = useUserLocalStorageValue<CatalogSort | undefined>(
    `maps.catalog.sort.${tab}`,
    undefined,
    validateSavedSort,
  )
  const [density, setDensity] = useUserLocalStorageValue<CatalogDensity>(
    'maps.catalog.density',
    CatalogDensity.Cozy,
    validateDensity,
  )
  const sort = effectiveSort(params, savedSort, tab)

  // A visit with no filters in its URL starts from the viewer's saved ones, written into the URL
  // so it always describes what's shown (and a link copied from it shows the same maps).
  const applySavedDefaults = useEffectEvent(() => {
    const current = new URLSearchParams(location.search)
    if (hasCatalogParams(current)) {
      return
    }
    const withDefaults = serializeCatalogParams(
      { ...savedFilters, search: '', sort: savedSort },
      current,
    )
    if (withDefaults !== current.toString()) {
      replace(`${location.pathname}?${withDefaults}`)
    }
  })
  useEffect(() => {
    applySavedDefaults()
  }, [])

  const navigate = (next: CatalogParams, transition: typeof push = push) => {
    const nextSearch = serializeCatalogParams(next, new URLSearchParams(location.search))
    transition(location.pathname + (nextSearch ? `?${nextSearch}` : ''))
  }

  const onFiltersChange = (changes: Partial<CatalogFilters>) => {
    const next = { ...params, ...changes }
    navigate(next)
    setSavedFilters(filtersOf(next))
  }

  const onSortChange = (nextSort: CatalogSort) => {
    navigate({ ...params, sort: nextSort })
    if (nextSort !== CatalogSort.BestMatch) {
      setSavedSort(nextSort)
    }
  }

  const onClearFilters = () => {
    onFiltersChange(DEFAULT_CATALOG_FILTERS)
  }

  const lastSearchApplyRef = useRef(0)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const applySearch = (value: string) => {
    lastSearchApplyRef.current = performance.now()
    const current = parseCatalogParams(new URLSearchParams(location.search))
    const wasSearching = !!current.search.trim()
    const searching = !!value.trim()
    let nextSort = current.sort
    // Starting a search switches to Best match; ending one leaves it for the saved sort
    if (searching && !wasSearching) {
      nextSort = undefined
    } else if (!searching && nextSort === CatalogSort.BestMatch) {
      nextSort = undefined
    }
    navigate({ ...current, search: value, sort: nextSort }, replace)
  }
  const onSearchChange = (value: string) => {
    clearTimeout(searchTimerRef.current)
    if (performance.now() - lastSearchApplyRef.current > SEARCH_COALESCE_MS) {
      applySearch(value)
    } else {
      searchTimerRef.current = setTimeout(() => applySearch(value), SEARCH_COALESCE_MS)
    }
  }
  useEffect(() => () => clearTimeout(searchTimerRef.current), [])

  const onTabChange = (nextTab: MapCatalogTab) => {
    const nextSearch = serializeCatalogParams({
      ...filtersOf(params),
      search: params.search,
      sort: undefined,
    })
    push(urlForMapCatalog(nextTab, nextSearch))
  }

  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  useScrollMemory(scroller)

  const needsLogin = !selfUser && tab !== MapCatalogTab.All
  const libraryVersion = useAtomValue(mapLibraryVersionAtom)
  const filter = toMapFilter(params)
  const listKey = JSON.stringify([tab, filter, sort, tab === MapCatalogTab.Yours && libraryVersion])

  let body: React.ReactNode
  if (needsLogin) {
    body = (
      <EmptyState>
        <EmptyText>{t('maps.catalog.logInToSee', 'Log in to see your maps.')}</EmptyText>
        <FilledButton
          label={t('maps.catalog.logIn', 'Log in')}
          onClick={() => redirectToLogin(push)}
        />
      </EmptyState>
    )
  } else if (IS_ELECTRON && tab === MapCatalogTab.Yours && browsingLocalMaps) {
    body = (
      <>
        <BackRow>
          <TextButton
            label={t('maps.catalog.backToYourMaps', 'Back to your maps')}
            iconStart='arrow_back'
            onClick={() => setBrowsingLocalMaps(false)}
          />
        </BackRow>
        <LocalMapsArea>
          <Suspense fallback={<LoadingDotsArea />}>
            <LoadableLocalMaps onMapUpload={() => setBrowsingLocalMaps(false)} />
          </Suspense>
        </LocalMapsArea>
      </>
    )
  } else {
    body = (
      <>
        {tab === MapCatalogTab.Yours ? (
          <UploadBanner
            onUpload={() => fileInputRef.current?.click()}
            onBrowseLocalMaps={IS_ELECTRON ? () => setBrowsingLocalMaps(true) : undefined}
          />
        ) : null}
        <MapCatalogList
          key={listKey}
          tab={tab}
          params={params}
          filter={filter}
          sort={sort}
          density={density}
          onFiltersChange={onFiltersChange}
          onSortChange={onSortChange}
          onDensityChange={setDensity}
          onClearFilters={onClearFilters}
        />
      </>
    )
  }

  return (
    <Root>
      <CenteredContentContainer ref={setScroller}>
        <Content>
          <Header>
            <Title>{t('maps.activity.title', 'Maps')}</Title>
            {selfUser ? (
              <Tabs activeTab={tab} onChange={onTabChange}>
                <TabItem text={t('maps.catalog.allMaps', 'All maps')} value={MapCatalogTab.All} />
                <TabItem
                  text={t('maps.catalog.yourMaps', 'Your maps')}
                  value={MapCatalogTab.Yours}
                />
                <TabItem
                  text={t('maps.catalog.favorites', 'Favorites')}
                  value={MapCatalogTab.Favorites}
                />
              </Tabs>
            ) : null}
            <HeaderControls>
              <StyledSearchInput
                searchQuery={params.search}
                onSearchChange={onSearchChange}
                label={t('maps.catalog.searchMaps', 'Search maps')}
              />
              <SegmentedButtonGroup
                ariaLabel={t('maps.catalog.lens', 'Map type')}
                value={params.lens}
                onChange={lens => onFiltersChange({ lens })}
                segments={[
                  { value: MapLens.All, label: t('maps.catalog.lensAll', 'All'), neutral: true },
                  { value: MapLens.Melee, label: t('maps.catalog.lensMelee', 'Melee') },
                  { value: MapLens.Ums, label: t('maps.catalog.lensUms', 'UMS') },
                ]}
              />
              {selfUser ? (
                <FilledButton
                  label={t('maps.catalog.upload', 'Upload')}
                  iconStart='upload'
                  onClick={() => fileInputRef.current?.click()}
                />
              ) : null}
            </HeaderControls>
          </Header>
          {body}
        </Content>
      </CenteredContentContainer>
      {selfUser ? (
        <>
          <HiddenFileInput
            ref={fileInputRef}
            type='file'
            multiple={true}
            accept={MAP_FILE_EXTENSIONS.map(e => `.${e}`).join(',')}
            onChange={event => {
              uploadFiles(event.target.files ?? [])
              event.target.value = ''
            }}
          />
          <DropZone extensions={[...MAP_FILE_EXTENSIONS]} onFilesDropped={uploadFiles}>
            <DropContents>
              <MaterialIcon icon='upload_file' size={48} />
              {t('maps.catalog.dropToUpload', 'Drop maps here to upload them to your maps.')}
            </DropContents>
          </DropZone>
        </>
      ) : null}
    </Root>
  )
}

const Banner = styled.div`
  ${bodyMedium};
  padding: 16px;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;

  border: 2px dashed var(--theme-outline-variant);
  border-radius: 8px;
  color: var(--theme-on-surface-variant);
`

const BannerText = styled.div`
  flex: 1 1 280px;
`

function UploadBanner({
  onUpload,
  onBrowseLocalMaps,
}: {
  onUpload: () => void
  onBrowseLocalMaps?: () => void
}) {
  const { t } = useTranslation()
  return (
    <Banner>
      <MaterialIcon icon='upload_file' size={32} />
      <BannerText>
        {t(
          'maps.catalog.uploadBanner',
          'Drop a .scm or .scx file anywhere here to upload it. It lands here as a private map.',
        )}
      </BannerText>
      {onBrowseLocalMaps ? (
        <OutlinedButton
          label={t('maps.catalog.browseLocalMaps', 'Browse local maps')}
          onClick={onBrowseLocalMaps}
        />
      ) : null}
      <OutlinedButton label={t('maps.catalog.chooseFiles', 'Choose files')} onClick={onUpload} />
    </Banner>
  )
}

const FilterRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
`

const ChipGroup = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`

const GroupLabel = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
`

const CountLabel = styled.div`
  ${labelLarge};
  min-width: 64px;
  color: var(--theme-on-surface);
  font-variant-numeric: tabular-nums;
`

const ViewControls = styled.div`
  margin-left: auto;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
`

const Grid = styled.div<{ $minTileWidth: number }>`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(${props => props.$minTileWidth}px, 1fr));
  gap: 18px 16px;
`

const EmptyState = styled.div`
  padding: 48px 16px;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
`

const EmptyText = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
  text-align: center;
`

function tilesetLabel(tilesets: ReadonlyArray<Tileset>, t: TFunction) {
  if (tilesets.length === 1) {
    return tilesetToName(tilesets[0], t)
  } else if (tilesets.length > 1) {
    return t('maps.catalog.tilesetCount', {
      defaultValue: '{{count}} tilesets',
      count: tilesets.length,
    })
  }
  return t('maps.catalog.tileset', 'Tileset')
}

function sizesLabel(sizes: ReadonlyArray<MapSizeClass>, t: TFunction) {
  if (sizes.length === 1) {
    return sizeClassLabel(sizes[0], t)
  } else if (sizes.length > 1) {
    return t('maps.catalog.sizeCount', {
      defaultValue: '{{count}} sizes',
      count: sizes.length,
    })
  }
  return t('maps.catalog.size', 'Size')
}

function sizeClassLabel(size: MapSizeClass, t: TFunction): string {
  switch (size) {
    case MapSizeClass.Tiny:
      return t('maps.catalog.sizeTiny', 'Tiny (up to 64)')
    case MapSizeClass.Small:
      return t('maps.catalog.sizeSmall', 'Small (up to 96)')
    case MapSizeClass.Medium:
      return t('maps.catalog.sizeMedium', 'Medium (up to 128)')
    case MapSizeClass.Large:
      return t('maps.catalog.sizeLarge', 'Large (up to 192)')
    case MapSizeClass.Huge:
      return t('maps.catalog.sizeHuge', 'Huge (over 192)')
    default:
      return size satisfies never
  }
}

function sortLabel(sort: CatalogSort, t: TFunction): string {
  switch (sort) {
    case CatalogSort.Trending:
      return t('maps.catalog.sortTrending', 'Trending')
    case CatalogSort.MostPlayed:
      return t('maps.catalog.sortMostPlayed', 'Most played')
    case CatalogSort.Newest:
      return t('maps.catalog.sortNewest', 'Newest')
    case CatalogSort.Name:
      return t('maps.catalog.sortName', 'Name')
    case CatalogSort.BestMatch:
      return t('maps.catalog.sortBestMatch', 'Best match')
    default:
      return sort satisfies never
  }
}

function toggled<T>(values: ReadonlyArray<T>, value: T): T[] {
  return values.includes(value) ? values.filter(v => v !== value) : [...values, value]
}

function CatalogFilterRow({
  params,
  sort,
  density,
  totalCount,
  onFiltersChange,
  onSortChange,
  onDensityChange,
  onClearFilters,
}: {
  params: CatalogParams
  sort: CatalogSort
  density: CatalogDensity
  totalCount: number | undefined
  onFiltersChange: (changes: Partial<CatalogFilters>) => void
  onSortChange: (sort: CatalogSort) => void
  onDensityChange: (density: CatalogDensity) => void
  onClearFilters: () => void
}) {
  const { t } = useTranslation()
  const searching = !!params.search.trim()
  const sorts = searching ? [CatalogSort.BestMatch, ...BROWSE_SORTS] : BROWSE_SORTS

  let eudLabel = t('maps.catalog.eud', 'EUD')
  if (params.eud === EudFilter.Exclude) {
    eudLabel = t('maps.catalog.eudHidden', 'No EUD')
  } else if (params.eud === EudFilter.Only) {
    eudLabel = t('maps.catalog.eudOnly', 'EUD only')
  }

  return (
    <FilterRow>
      <CountLabel>
        {totalCount !== undefined
          ? t('maps.catalog.mapCount', {
              defaultValue: '{{count}} maps',
              defaultValue_one: '{{count}} map',
              count: totalCount,
            })
          : null}
      </CountLabel>
      <ChipGroup role='group' aria-label={t('maps.catalog.playersLabel', 'Players')}>
        <GroupLabel>{t('maps.catalog.playersLabel', 'Players')}</GroupLabel>
        <FilterChip
          label={t('maps.catalog.playersAny', 'Any')}
          selected={params.players === undefined}
          checkmark={false}
          onClick={() => onFiltersChange({ players: undefined })}
        />
        {ALL_CATALOG_PLAYERS.map(players => (
          <FilterChip
            key={players}
            label={players}
            selected={params.players === players}
            checkmark={false}
            onClick={() =>
              onFiltersChange({
                players: params.players === players ? undefined : (players as CatalogPlayers),
              })
            }
          />
        ))}
      </ChipGroup>
      <ChipGroup>
        <FilterChip label={tilesetLabel(params.tilesets, t)} selected={params.tilesets.length > 0}>
          <SelectableMenuItem
            text={t('maps.catalog.tilesetAny', 'Any tileset')}
            selected={params.tilesets.length === 0}
            onClick={() => onFiltersChange({ tilesets: [] })}
          />
          {ALL_TILESETS.map(tileset => (
            <SelectableMenuItem
              key={tileset}
              text={tilesetToName(tileset, t)}
              selected={params.tilesets.includes(tileset)}
              onClick={() => onFiltersChange({ tilesets: toggled(params.tilesets, tileset) })}
            />
          ))}
        </FilterChip>
        <FilterChip label={sizesLabel(params.sizes, t)} selected={params.sizes.length > 0}>
          <SelectableMenuItem
            text={t('maps.catalog.sizeAny', 'Any size')}
            selected={params.sizes.length === 0}
            onClick={() => onFiltersChange({ sizes: [] })}
          />
          {ALL_MAP_SIZE_CLASSES.map(size => (
            <SelectableMenuItem
              key={size}
              text={sizeClassLabel(size, t)}
              selected={params.sizes.includes(size)}
              onClick={() =>
                onFiltersChange({
                  sizes: ALL_MAP_SIZE_CLASSES.filter(s => toggled(params.sizes, size).includes(s)),
                })
              }
            />
          ))}
        </FilterChip>
        <FilterChip label={eudLabel} selected={params.eud !== EudFilter.Any}>
          <SelectableMenuItem
            text={t('maps.catalog.eudShow', 'Show EUD maps')}
            selected={params.eud === EudFilter.Any}
            onClick={() => onFiltersChange({ eud: EudFilter.Any })}
          />
          <SelectableMenuItem
            text={t('maps.catalog.eudHide', 'Hide EUD maps')}
            selected={params.eud === EudFilter.Exclude}
            onClick={() => onFiltersChange({ eud: EudFilter.Exclude })}
          />
          <SelectableMenuItem
            text={t('maps.catalog.eudOnlyOption', 'Only EUD maps')}
            selected={params.eud === EudFilter.Only}
            onClick={() => onFiltersChange({ eud: EudFilter.Only })}
          />
        </FilterChip>
        <FilterChip
          label={t('maps.page.official', 'Official')}
          selected={params.official}
          onClick={() => onFiltersChange({ official: !params.official })}
        />
        {hasNonDefaultFilters(params) ? (
          <TextButton
            label={t('maps.catalog.clearFilters', 'Clear filters')}
            onClick={onClearFilters}
          />
        ) : null}
      </ChipGroup>
      <ViewControls>
        <ChipGroup role='group' aria-label={t('maps.catalog.sort', 'Sort')}>
          <GroupLabel>{t('maps.catalog.sortLabel', 'Sort')}</GroupLabel>
          {sorts.map(s => (
            <FilterChip
              key={s}
              label={sortLabel(s, t)}
              selected={sort === s}
              checkmark={false}
              onClick={() => onSortChange(s)}
            />
          ))}
        </ChipGroup>
        <SegmentedButtonGroup
          ariaLabel={t('maps.catalog.density', 'Density')}
          value={density}
          onChange={onDensityChange}
          segments={[
            { value: CatalogDensity.Cozy, label: t('maps.catalog.densityCozy', 'Cozy') },
            { value: CatalogDensity.Compact, label: t('maps.catalog.densityCompact', 'Compact') },
          ]}
        />
      </ViewControls>
    </FilterRow>
  )
}

const MapCatalogAllQuery = graphql(/* GraphQL */ `
  query MapCatalogAll(
    $filter: MapFilter
    $sort: MapSort
    $after: String
    $first: Int
    $withCount: Boolean!
  ) {
    maps(filter: $filter, sort: $sort, after: $after, first: $first) {
      totalCount @include(if: $withCount)
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

const MapCatalogLibraryQuery = graphql(/* GraphQL */ `
  query MapCatalogLibrary(
    $filter: MapFilter
    $sort: MapSort
    $after: String
    $first: Int
    $withCount: Boolean!
  ) {
    currentUser {
      id
      mapLibrary(filter: $filter, sort: $sort, after: $after, first: $first) {
        totalCount @include(if: $withCount)
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          cursor
          addedAt
          node {
            id
            ...MapTile_SbMapFragment
          }
        }
      }
    }
  }
`)

const MapCatalogFavoritesQuery = graphql(/* GraphQL */ `
  query MapCatalogFavorites(
    $filter: MapFilter
    $sort: MapSort
    $after: String
    $first: Int
    $withCount: Boolean!
  ) {
    currentUser {
      id
      favoriteMaps(filter: $filter, sort: $sort, after: $after, first: $first) {
        totalCount @include(if: $withCount)
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
  }
`)

const CATALOG_QUERIES = {
  [MapCatalogTab.All]: MapCatalogAllQuery,
  [MapCatalogTab.Yours]: MapCatalogLibraryQuery,
  [MapCatalogTab.Favorites]: MapCatalogFavoritesQuery,
}

/** Requests results without suspending: the catalog renders its own loading states. */
const NO_SUSPENSE_CONTEXT = { suspense: false }

/**
 * Loads one page of a tab's listing. Every caller asking for the same page shares one request, so
 * the list can read the first page's count and the last page's cursor from the same results its
 * pages render.
 */
function useCatalogPage(
  tab: MapCatalogTab,
  filter: MapFilter,
  sort: CatalogSort,
  after: string | null,
) {
  const variables = {
    filter,
    sort: catalogSortToMapSort(sort),
    after: after ?? undefined,
    first: PAGE_SIZE,
    withCount: after === null,
  }
  const [{ data, fetching, error }, reexecute] = useQuery({
    // The three queries take the same variables and differ only in where their connection is
    query: CATALOG_QUERIES[tab] as typeof MapCatalogAllQuery,
    variables,
    requestPolicy: 'cache-and-network',
    context: NO_SUSPENSE_CONTEXT,
  })

  const anyData = data as
    | {
        maps?: CatalogConnection
        currentUser?: {
          mapLibrary?: CatalogConnection
          favoriteMaps?: CatalogConnection
        } | null
      }
    | undefined
  const connection =
    anyData?.maps ?? anyData?.currentUser?.mapLibrary ?? anyData?.currentUser?.favoriteMaps

  return {
    connection,
    fetching,
    error,
    retry: () => reexecute({ requestPolicy: 'network-only' }),
  }
}

type CatalogConnection = {
  totalCount?: number
  pageInfo: { hasNextPage: boolean; endCursor?: string | null }
  edges: ReadonlyArray<{
    cursor: string
    addedAt?: string | null
    node: { id: string } & React.ComponentProps<typeof MapTile>['map']
  }>
}

interface StoredListWindow {
  listKey: string
  pageCursors: Array<string | null>
}

/** The pages each catalog visit had loaded, so going back to it can show them again. */
const listWindows = createViewStateStore<StoredListWindow>('map-catalog', {
  maxAgeMs: 30 * 60 * 1000,
})

function signalFor(tab: MapCatalogTab, sort: CatalogSort): MapTileSignal {
  if (tab === MapCatalogTab.Yours) {
    return MapTileSignal.Added
  }
  switch (sort) {
    case CatalogSort.Trending:
      return MapTileSignal.Trending
    case CatalogSort.MostPlayed:
      return MapTileSignal.Month
    case CatalogSort.Newest:
      return tab === MapCatalogTab.All ? MapTileSignal.Published : MapTileSignal.Total
    default:
      return MapTileSignal.Total
  }
}

function MapCatalogList({
  tab,
  params,
  filter,
  sort,
  density,
  onFiltersChange,
  onSortChange,
  onDensityChange,
  onClearFilters,
}: {
  tab: MapCatalogTab
  params: CatalogParams
  filter: MapFilter
  sort: CatalogSort
  density: CatalogDensity
  onFiltersChange: (changes: Partial<CatalogFilters>) => void
  onSortChange: (sort: CatalogSort) => void
  onDensityChange: (density: CatalogDensity) => void
  onClearFilters: () => void
}) {
  const { t } = useTranslation()
  const entryKey = useHistoryEntryKey()
  const listKey = JSON.stringify([tab, filter, sort])
  const pendingUploads = useAtomValue(pendingMapUploadsAtom)
  const [pageCursors, setPageCursors] = useState<Array<string | null>>(() => {
    const stored = entryKey ? listWindows.get(entryKey) : undefined
    return stored?.listKey === listKey ? stored.pageCursors : [null]
  })

  useEffect(() => {
    if (entryKey) {
      listWindows.set(entryKey, { listKey, pageCursors })
    }
  }, [entryKey, listKey, pageCursors])

  const firstPage = useCatalogPage(tab, filter, sort, null)
  const lastPage = useCatalogPage(tab, filter, sort, pageCursors[pageCursors.length - 1])
  const totalCount = firstPage.connection?.totalCount
  const layout = DENSITY_LAYOUT[density]
  const signal = signalFor(tab, sort)
  const showPending = tab === MapCatalogTab.Yours && pendingUploads.length > 0

  const onLoadMore = () => {
    const endCursor = lastPage.connection?.pageInfo.endCursor
    if (lastPage.connection?.pageInfo.hasNextPage && endCursor) {
      setPageCursors(prev => (prev.includes(endCursor) ? prev : [...prev, endCursor]))
    }
  }

  let content: React.ReactNode
  if (!firstPage.connection) {
    content = firstPage.error ? (
      <LoadErrorRow
        message={t('maps.catalog.loadError', "Couldn't load maps")}
        onRetry={firstPage.retry}
      />
    ) : (
      <LoadingDotsArea />
    )
  } else if (firstPage.connection.edges.length === 0 && !showPending) {
    content = (
      <CatalogEmptyState
        tab={tab}
        search={params.search.trim()}
        hasFilters={hasNonDefaultFilters(params)}
        onClearFilters={onClearFilters}
      />
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
        refreshToken={listKey}
        onLoadNextData={onLoadMore}>
        <Grid $minTileWidth={layout.minTileWidth}>
          {showPending ? <PendingUploadTiles /> : null}
          {pageCursors.map(cursor => (
            <MapCatalogChunk
              key={cursor ?? 'first'}
              tab={tab}
              filter={filter}
              sort={sort}
              after={cursor}
              signal={signal}
              imageSize={layout.imageSize}
            />
          ))}
        </Grid>
      </InfiniteScrollList>
    )
  }

  return (
    <>
      <CatalogFilterRow
        params={params}
        sort={sort}
        density={density}
        totalCount={totalCount}
        onFiltersChange={onFiltersChange}
        onSortChange={onSortChange}
        onDensityChange={onDensityChange}
        onClearFilters={onClearFilters}
      />
      {content}
    </>
  )
}

function MapCatalogChunk({
  tab,
  filter,
  sort,
  after,
  signal,
  imageSize,
}: {
  tab: MapCatalogTab
  filter: MapFilter
  sort: CatalogSort
  after: string | null
  signal: MapTileSignal
  imageSize: number
}) {
  const { connection } = useCatalogPage(tab, filter, sort, after)
  const bumpLibrary = useSetLibraryVersion()

  return (
    <>
      {connection?.edges.map(edge => (
        <MapTile
          key={edge.node.id}
          map={edge.node}
          signal={signal}
          addedAt={edge.addedAt ?? undefined}
          onRemovedFromLibrary={tab === MapCatalogTab.Yours ? bumpLibrary : undefined}
          imageSize={imageSize}
        />
      ))}
    </>
  )
}

function useSetLibraryVersion() {
  const setVersion = useSetAtom(mapLibraryVersionAtom)
  return () => setVersion(v => v + 1)
}

function PendingUploadTiles() {
  const pending = useAtomValue(pendingMapUploadsAtom)
  const setPending = useSetAtom(pendingMapUploadsAtom)
  return (
    <>
      {pending.map(upload => (
        <PendingMapTile
          key={upload.key}
          fileName={upload.fileName}
          error={upload.error}
          onDismiss={() => setPending(p => p.filter(u => u.key !== upload.key))}
        />
      ))}
    </>
  )
}

function CatalogEmptyState({
  tab,
  search,
  hasFilters,
  onClearFilters,
}: {
  tab: MapCatalogTab
  search: string
  hasFilters: boolean
  onClearFilters: () => void
}) {
  const { t } = useTranslation()
  let text: string
  if (search) {
    text = t('maps.catalog.noSearchMatches', {
      defaultValue: 'No maps match "{{search}}".',
      search,
    })
  } else if (hasFilters) {
    text = t('maps.catalog.noMatches', 'No maps match these filters.')
  } else if (tab === MapCatalogTab.Yours) {
    text = t('maps.catalog.noLibraryMaps', "You haven't uploaded any maps yet.")
  } else if (tab === MapCatalogTab.Favorites) {
    text = t('maps.catalog.noFavorites', 'Star a map to keep it here.')
  } else {
    text = t('maps.catalog.noMaps', 'There are no maps here yet.')
  }

  return (
    <EmptyState>
      <EmptyText>{text}</EmptyText>
      {hasFilters ? (
        <TextButton
          label={t('maps.catalog.clearFilters', 'Clear filters')}
          onClick={onClearFilters}
        />
      ) : null}
    </EmptyState>
  )
}
