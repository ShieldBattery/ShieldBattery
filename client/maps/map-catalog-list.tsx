import { TFunction } from 'i18next'
import { useAtomValue, useSetAtom } from 'jotai'
import * as React from 'react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import { MapCatalogTab } from '../../common/map-url'
import { ALL_TILESETS, SbMapId, Tileset, tilesetToName } from '../../common/maps'
import { graphql } from '../gql'
import { EudFilter, MapFilter, MapLens, MapSizeClass } from '../gql/graphql'
import { MaterialIcon } from '../icons/material/material-icon'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { LoadErrorRow } from '../lists/load-error-row'
import { IconButton, TextButton } from '../material/button'
import { FilterChip } from '../material/filter-chip'
import { SelectableMenuItem } from '../material/menu/selectable-item'
import { SegmentedButtonGroup } from '../material/segmented-button'
import { Tooltip } from '../material/tooltip'
import { LoadingDotsArea } from '../progress/dots'
import { bodyLarge, bodyMedium } from '../styles/typography'
import {
  ALL_CATALOG_PLAYERS,
  ALL_MAP_SIZE_CLASSES,
  BROWSE_SORTS,
  CatalogFilters,
  CatalogParams,
  CatalogPlayers,
  CatalogSort,
  catalogSortToMapSort,
  hasNonDefaultFilters,
} from './map-catalog-params'
import { MapTile, MapTileSignal, PendingMapTile } from './map-tile'
import { mapLibraryVersionAtom, pendingMapUploadsAtom } from './map-uploads'

const PAGE_SIZE = 40

/** How densely a map listing lays out its tiles. */
export enum CatalogDensity {
  Cozy = 'cozy',
  Compact = 'compact',
}

export const DENSITY_LAYOUT: Readonly<
  Record<CatalogDensity, { minTileWidth: number; imageSize: number }>
> = {
  [CatalogDensity.Cozy]: { minTileWidth: 232, imageSize: 280 },
  [CatalogDensity.Compact]: { minTileWidth: 150, imageSize: 200 },
}

export function validateDensity(value: unknown): CatalogDensity | undefined {
  return Object.values(CatalogDensity).includes(value as CatalogDensity)
    ? (value as CatalogDensity)
    : undefined
}

/**
 * Typing faster than this apart coalesces the search into one update once typing pauses. A
 * keystroke after a longer pause searches right away.
 */
const SEARCH_COALESCE_MS = 150

/**
 * Returns a function to call with each change of a search field's text. It calls `apply` right
 * away after a pause in typing, and otherwise once typing pauses.
 */
export function useCoalescedSearch(apply: (value: string) => void): (value: string) => void {
  const lastApplyRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const applyNow = (value: string) => {
    lastApplyRef.current = performance.now()
    apply(value)
  }
  return value => {
    clearTimeout(timerRef.current)
    if (performance.now() - lastApplyRef.current > SEARCH_COALESCE_MS) {
      applyNow(value)
    } else {
      timerRef.current = setTimeout(() => applyNow(value), SEARCH_COALESCE_MS)
    }
  }
}

/** Remembers which pages of each listing were loaded, so returning to one shows them again. */
export interface ListWindowStore {
  /** The cursors of the pages last loaded for the listing `listKey`, if any. */
  get(listKey: string): Array<string | null> | undefined
  set(listKey: string, pageCursors: Array<string | null>): void
}

/** Turns a listing's tiles into buttons that pick a map (for a lobby) rather than links. */
export interface MapPickOptions {
  onPick: (mapId: SbMapId) => void
  /** The map currently chosen, marked on its tile. */
  selectedMapId?: SbMapId
  /** Where each map sits in the lobby's map queue (1-based), for maps that are queued. */
  queuePositions?: ReadonlyMap<SbMapId, ReadonlyArray<number>>
  /** The map whose pick is being completed. */
  pendingMapId?: SbMapId
  /** The map whose last pick failed. */
  failedMapId?: SbMapId
  /** Whether no more maps can be picked. */
  disabled?: boolean
}

const FilterRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
`

/** Set apart from the filter chips after it, since it picks which maps the others narrow down. */
const LensControl = styled(SegmentedButtonGroup)`
  margin-right: 8px;
` as typeof SegmentedButtonGroup

const CountLabel = styled.div`
  ${bodyMedium};
  margin-right: 8px;
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

/**
 * Right-aligned via margin rather than a spacer so that when the row wraps, the view controls
 * keep their alignment on the new line.
 */
const ViewControls = styled.div`
  margin-left: auto;

  display: flex;
  align-items: center;
  gap: 8px;
`

export const Grid = styled.div<{ $minTileWidth: number }>`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(${props => props.$minTileWidth}px, 1fr));
  gap: 18px 16px;
`

export const EmptyState = styled.div`
  padding: 48px 16px;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
`

export const EmptyText = styled.div`
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

function playersLabel(players: CatalogPlayers | undefined, t: TFunction): string {
  switch (players) {
    case undefined:
      return t('maps.catalog.playersLabel', 'Players')
    case CatalogPlayers.FivePlus:
      return t('maps.catalog.playersFivePlus', '5+ players')
    default:
      return t('maps.catalog.players', {
        defaultValue: '{{count}} players',
        defaultValue_one: '{{count}} player',
        count: Number(players),
      })
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
    case CatalogSort.Players:
      return t('maps.catalog.sortPlayers', 'Players')
    case CatalogSort.BestMatch:
      return t('maps.catalog.sortBestMatch', 'Best match')
    default:
      return sort satisfies never
  }
}

function toggled<T>(values: ReadonlyArray<T>, value: T): T[] {
  return values.includes(value) ? values.filter(v => v !== value) : [...values, value]
}

/** The row of lens, filter, sort and density controls above a listing of maps. */
export function CatalogFilterRow({
  params,
  sort,
  density,
  totalCount,
  sorts: browseSorts = BROWSE_SORTS,
  offersBestMatch = true,
  showOfficial = true,
  besideCount,
  viewToggle,
  onFiltersChange,
  onSortChange,
  onDensityChange,
  onClearFilters,
}: {
  params: CatalogParams
  sort: CatalogSort
  density: CatalogDensity
  totalCount: number | undefined
  /** The sorts offered while not searching. */
  sorts?: ReadonlyArray<CatalogSort>
  /** Whether Best match is offered while searching. */
  offersBestMatch?: boolean
  showOfficial?: boolean
  /** Shown next to the count, e.g. a link to the same search elsewhere. */
  besideCount?: React.ReactNode
  /** Shown before the density toggle, e.g. a choice of how to lay out the listing. */
  viewToggle?: React.ReactNode
  onFiltersChange: (changes: Partial<CatalogFilters>) => void
  onSortChange: (sort: CatalogSort) => void
  onDensityChange: (density: CatalogDensity) => void
  onClearFilters: () => void
}) {
  const { t } = useTranslation()
  const searching = !!params.search.trim()
  const sorts = searching && offersBestMatch ? [CatalogSort.BestMatch, ...browseSorts] : browseSorts

  const densityToggleLabel =
    density === CatalogDensity.Cozy
      ? t('maps.catalog.showCompact', 'Show smaller tiles')
      : t('maps.catalog.showCozy', 'Show larger tiles')

  let eudLabel = t('maps.catalog.eud', 'EUD')
  if (params.eud === EudFilter.Exclude) {
    eudLabel = t('maps.catalog.eudHidden', 'No EUD')
  } else if (params.eud === EudFilter.Only) {
    eudLabel = t('maps.catalog.eudOnly', 'EUD only')
  }

  return (
    <FilterRow>
      <LensControl
        ariaLabel={t('maps.catalog.lens', 'Map type')}
        value={params.lens}
        onChange={lens => onFiltersChange({ lens })}
        segments={[
          { value: MapLens.All, label: t('maps.catalog.lensAll', 'All'), neutral: true },
          { value: MapLens.Melee, label: t('maps.catalog.lensMelee', 'Melee') },
          { value: MapLens.Ums, label: t('maps.catalog.lensUms', 'UMS') },
        ]}
      />
      <FilterChip label={playersLabel(params.players, t)} selected={params.players !== undefined}>
        <SelectableMenuItem
          text={t('maps.catalog.playersAny', 'Any number of players')}
          selected={params.players === undefined}
          onClick={() => onFiltersChange({ players: undefined })}
        />
        {ALL_CATALOG_PLAYERS.map(players => (
          <SelectableMenuItem
            key={players}
            text={playersLabel(players, t)}
            selected={params.players === players}
            onClick={() => onFiltersChange({ players })}
          />
        ))}
      </FilterChip>
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
      {showOfficial ? (
        <FilterChip
          label={t('maps.page.official', 'Official')}
          selected={params.official}
          onClick={() => onFiltersChange({ official: !params.official })}
        />
      ) : null}
      {hasNonDefaultFilters(params) ? (
        <TextButton
          label={t('common.actions.clear', 'Clear')}
          iconStart='close'
          onClick={onClearFilters}
        />
      ) : null}
      <ViewControls>
        <CountLabel>
          {totalCount !== undefined
            ? t('maps.catalog.mapCount', {
                defaultValue: '{{count}} maps',
                defaultValue_one: '{{count}} map',
                count: totalCount,
              })
            : null}
        </CountLabel>
        {besideCount}
        <FilterChip label={sortLabel(sort, t)} icon={<MaterialIcon icon='sort' size={18} />}>
          {sorts.map(s => (
            <SelectableMenuItem
              key={s}
              text={sortLabel(s, t)}
              selected={sort === s}
              onClick={() => onSortChange(s)}
            />
          ))}
        </FilterChip>
        {viewToggle}
        <Tooltip text={densityToggleLabel} position='bottom' tabIndex={-1}>
          <IconButton
            icon={
              <MaterialIcon icon={density === CatalogDensity.Cozy ? 'view_comfy' : 'grid_view'} />
            }
            ariaLabel={densityToggleLabel}
            onClick={() =>
              onDensityChange(
                density === CatalogDensity.Cozy ? CatalogDensity.Compact : CatalogDensity.Cozy,
              )
            }
          />
        </Tooltip>
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

/** The catalog tabs listed by the server (every tab but the maps on this PC). */
export type ServerCatalogTab = Exclude<MapCatalogTab, MapCatalogTab.Local>

const CATALOG_QUERIES: Readonly<Record<ServerCatalogTab, typeof MapCatalogAllQuery>> = {
  [MapCatalogTab.All]: MapCatalogAllQuery,
  // The three queries take the same variables and differ only in where their connection is
  [MapCatalogTab.Yours]: MapCatalogLibraryQuery as unknown as typeof MapCatalogAllQuery,
  [MapCatalogTab.Favorites]: MapCatalogFavoritesQuery as unknown as typeof MapCatalogAllQuery,
}

/** Requests results without suspending: the catalog renders its own loading states. */
const NO_SUSPENSE_CONTEXT = { suspense: false }

/**
 * Loads one page of a tab's listing. Every caller asking for the same page shares one request, so
 * the list can read the first page's count and the last page's cursor from the same results its
 * pages render.
 */
function useCatalogPage(
  tab: ServerCatalogTab,
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
    query: CATALOG_QUERIES[tab],
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

function signalFor(tab: ServerCatalogTab, sort: CatalogSort): MapTileSignal {
  if (tab === MapCatalogTab.Yours) {
    return MapTileSignal.Added
  }
  switch (sort) {
    case CatalogSort.Trending:
      return MapTileSignal.Trending
    case CatalogSort.Newest:
      return tab === MapCatalogTab.All ? MapTileSignal.Published : MapTileSignal.Total
    default:
      return MapTileSignal.Total
  }
}

/**
 * One tab's listing of maps: the filter and sort row, then the maps as a grid of tiles, loaded a
 * page at a time as the list scrolls.
 */
export function MapCatalogList({
  tab,
  params,
  filter,
  sort,
  density,
  windowStore,
  pick,
  besideCount,
  onFiltersChange,
  onSortChange,
  onDensityChange,
  onClearFilters,
}: {
  tab: ServerCatalogTab
  params: CatalogParams
  filter: MapFilter
  sort: CatalogSort
  density: CatalogDensity
  windowStore: ListWindowStore
  /** When set, tiles pick maps instead of linking to their pages. */
  pick?: MapPickOptions
  /** Shown next to the count, e.g. a link to the same search among the maps on this PC. */
  besideCount?: React.ReactNode
  onFiltersChange: (changes: Partial<CatalogFilters>) => void
  onSortChange: (sort: CatalogSort) => void
  onDensityChange: (density: CatalogDensity) => void
  onClearFilters: () => void
}) {
  const { t } = useTranslation()
  const listKey = JSON.stringify([tab, filter, sort])
  const pendingUploads = useAtomValue(pendingMapUploadsAtom)
  const [pageCursors, setPageCursors] = useState<Array<string | null>>(
    () => windowStore.get(listKey) ?? [null],
  )

  const storeWindow = useEffectEvent((key: string, cursors: Array<string | null>) => {
    windowStore.set(key, cursors)
  })
  useEffect(() => {
    storeWindow(listKey, pageCursors)
  }, [listKey, pageCursors])

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
              pick={pick}
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
        besideCount={besideCount}
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
  pick,
}: {
  tab: ServerCatalogTab
  filter: MapFilter
  sort: CatalogSort
  after: string | null
  signal: MapTileSignal
  imageSize: number
  pick?: MapPickOptions
}) {
  const { connection } = useCatalogPage(tab, filter, sort, after)
  const bumpLibrary = useSetLibraryVersion()

  return (
    <>
      {connection?.edges.map(edge => {
        const mapId = edge.node.id as SbMapId
        return (
          <MapTile
            key={mapId}
            map={edge.node}
            signal={signal}
            addedAt={edge.addedAt ?? undefined}
            onRemovedFromLibrary={!pick && tab === MapCatalogTab.Yours ? bumpLibrary : undefined}
            imageSize={imageSize}
            pick={
              pick
                ? {
                    onPick: () => pick.onPick(mapId),
                    selected: pick.selectedMapId === mapId,
                    queuePositions: pick.queuePositions?.get(mapId),
                    pending: pick.pendingMapId === mapId,
                    failed: pick.failedMapId === mapId,
                    disabled:
                      !!pick.disabled || (!!pick.pendingMapId && pick.pendingMapId !== mapId),
                  }
                : undefined
            }
          />
        )
      })}
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
          progress={upload.progress}
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
