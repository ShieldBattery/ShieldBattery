import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useLocationProperty } from 'wouter/use-browser-location'
import { MapCatalogTab, urlForMapCatalog } from '../../common/map-url'
import { useTrackPageView } from '../analytics/analytics'
import { redirectToLogin, useSelfUser } from '../auth/auth-utils'
import { FileDropZone } from '../file-browser/file-drop-zone'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { FilledButton } from '../material/button'
import { elevationPlus1 } from '../material/shadows'
import { TabItem, Tabs } from '../material/tabs'
import { useHistoryEntryKey, useScrollMemory } from '../navigation/router-hooks'
import { push, replace } from '../navigation/routing'
import { createViewStateStore } from '../navigation/view-state-store'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { SearchInput, SearchInputHandle } from '../search/search-input'
import { CenteredContentContainer } from '../styles/centered-container'
import { bodyLarge, bodyMedium, singleLine, titleMedium } from '../styles/typography'
import {
  CatalogDensity,
  EmptyState,
  EmptyText,
  ListWindowStore,
  MapCatalogList,
  useCoalescedSearch,
  validateDensity,
} from './map-catalog-list'
import {
  CatalogFilters,
  CatalogParams,
  CatalogSort,
  DEFAULT_CATALOG_FILTERS,
  defaultSortForListing,
  effectiveSort,
  filtersOf,
  hasCatalogParams,
  LOCAL_SORTS,
  MapListing,
  parseCatalogParams,
  serializeCatalogParams,
  ServerMapListing,
  toMapFilter,
  validateSavedFilters,
  validateSavedSort,
  withSearch,
} from './map-catalog-params'
import {
  LocalMapList,
  LocalMapView,
  LocalMatchesLink,
  validateLocalMapView,
} from './map-local-list'
import { MAP_FILE_EXTENSIONS, mapLibraryVersionAtom, useUploadMapFiles } from './map-uploads'

interface StoredListWindow {
  listKey: string
  pageCursors: Array<string | null>
}

/** The pages each catalog visit had loaded, so going back to it can show them again. */
const listWindows = createViewStateStore<StoredListWindow>('map-catalog', {
  maxAgeMs: 30 * 60 * 1000,
})

const Root = styled.div`
  position: relative;
  width: 100%;
  height: 100%;

  display: flex;
  flex-direction: column;
`

/** The catalog's controls, kept in view above the scrolling list. */
const HeaderBar = styled.div`
  flex-shrink: 0;
  min-height: 64px;
  padding: 20px 24px 12px;
  /* Reserves the same gutters as the list below so the two line up */
  overflow: hidden;
  scrollbar-gutter: stable both-edges;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;

  border-bottom: 1px solid var(--theme-outline-variant);
`

const Scroller = styled(CenteredContentContainer)`
  flex: 1 1 auto;
  height: auto;
  min-height: 0;
`

const Content = styled.div`
  min-height: 100%;
  padding-block: 16px 48px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Title = styled.h1`
  ${titleMedium};
  margin: 0;
  font-size: 20px;
`

/** Gives up its width first when the bar tightens, so the rest of the bar keeps its line. */
const StyledSearchInput = styled(SearchInput)`
  flex: 1 1 0;
  min-width: 140px;
  max-width: 400px;
  margin-left: auto;

  & label {
    right: 12px;
    ${singleLine};
  }
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

const HiddenFileInput = styled.input`
  display: none;
`

/**
 * The search field of the catalog's header bar, focused by pressing `/` anywhere outside a text
 * field.
 */
export function CatalogSearchInput({
  value,
  label,
  maxLength,
  onChange,
}: {
  value: string
  label: string
  /** The most characters that can be typed. */
  maxLength?: number
  /** Called with each change of the text, coalesced while typing quickly. */
  onChange: (value: string) => void
}) {
  const searchInputRef = useRef<SearchInputHandle>(null)
  const onSearchChange = useCoalescedSearch(onChange)
  useKeyListener({
    onKeyDown: event => {
      if (event.key !== '/' || event.ctrlKey || event.altKey || event.metaKey) {
        return false
      }
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return false
      }
      searchInputRef.current?.focus()
      return true
    },
  })

  return (
    <StyledSearchInput
      ref={searchInputRef}
      searchQuery={value}
      onSearchChange={onSearchChange}
      label={label}
      maxLength={maxLength}
    />
  )
}

/**
 * The layout every catalog tab and collection page shares: the header bar with the catalog's tabs
 * and `search` (a {@link CatalogSearchInput}, or nothing), the scrolling content below it, and the
 * drop zone that uploads map files to the viewer's maps.
 */
export function MapCatalogFrame({
  tab,
  search,
  children,
}: {
  /** The tab shown as active. */
  tab: MapCatalogTab
  search?: React.ReactNode
  children: React.ReactNode
}) {
  const { t } = useTranslation()
  const selfUser = useSelfUser()
  const uploadFiles = useUploadMapFiles()
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  useScrollMemory(scroller)

  // Switching tabs keeps the filters and search, so the same maps are looked for on the next tab
  const onTabChange = (nextTab: MapCatalogTab) => {
    const params = parseCatalogParams(new URLSearchParams(location.search))
    const nextSearch = serializeCatalogParams({
      ...filtersOf(params),
      search: params.search,
      sort: undefined,
    })
    push(urlForMapCatalog(nextTab, nextSearch))
  }

  return (
    <Root data-content-fullbleed=''>
      <HeaderBar>
        <Title>{t('maps.activity.title', 'Maps')}</Title>
        <Tabs activeTab={tab} onChange={onTabChange}>
          <TabItem text={t('maps.catalog.allMaps', 'All maps')} value={MapCatalogTab.All} />
          <TabItem
            text={t('maps.collections.tab', 'Collections')}
            value={MapCatalogTab.Collections}
          />
          {selfUser ? (
            <TabItem text={t('maps.catalog.yourMaps', 'Your maps')} value={MapCatalogTab.Yours} />
          ) : null}
          {selfUser && IS_ELECTRON ? (
            <TabItem text={t('maps.local.onThisPc', 'On this PC')} value={MapCatalogTab.Local} />
          ) : null}
        </Tabs>
        {search}
      </HeaderBar>
      <Scroller ref={setScroller} $fullWidth={true}>
        <Content>{children}</Content>
      </Scroller>
      {selfUser ? (
        <DropZone extensions={[...MAP_FILE_EXTENSIONS]} onFilesDropped={uploadFiles}>
          <DropContents>
            <MaterialIcon icon='upload_file' size={48} />
            {t('maps.catalog.dropToUpload', 'Drop maps here to upload them to your maps.')}
          </DropContents>
        </DropZone>
      ) : null}
    </Root>
  )
}

/** The listing of maps each catalog tab that lists maps shows. */
function listingForTab(tab: MapCatalogTab): MapListing {
  switch (tab) {
    case MapCatalogTab.Yours:
      return MapListing.Yours
    case MapCatalogTab.Local:
      return MapListing.Local
    default:
      return MapListing.All
  }
}

/**
 * The filters, sort and search of a listing of maps, as the page's URL holds them, and the ways to
 * change them. A visit with no filters in its URL starts from the viewer's saved ones. Filters are
 * saved for every listing alike, and sorts for each listing.
 */
export function useCatalogUrlParams(listing: MapListing) {
  const search = useLocationProperty(() => location.search)
  const params = parseCatalogParams(new URLSearchParams(search))

  const [savedFilters, setSavedFilters] = useUserLocalStorageValue<CatalogFilters>(
    'maps.catalog.filters',
    DEFAULT_CATALOG_FILTERS,
    validateSavedFilters,
  )
  const [savedSort, setSavedSort] = useUserLocalStorageValue<CatalogSort | undefined>(
    `maps.catalog.sort.${listing}`,
    undefined,
    validateSavedSort,
  )
  const sort = effectiveSort(
    params,
    savedSort,
    defaultSortForListing(listing),
    listing === MapListing.Local ? LOCAL_SORTS : undefined,
  )

  // The saved filters are written into the URL so it always describes what's shown (and a link
  // copied from it shows the same maps).
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

  return {
    params,
    sort,
    onFiltersChange,
    onSortChange: (nextSort: CatalogSort) => {
      navigate({ ...params, sort: nextSort })
      if (nextSort !== CatalogSort.BestMatch) {
        setSavedSort(nextSort)
      }
    },
    onClearFilters: () => onFiltersChange(DEFAULT_CATALOG_FILTERS),
    /** Applies a change of the search text. Meant for a {@link CatalogSearchInput}. */
    onSearchChange: (value: string) => {
      const current = parseCatalogParams(new URLSearchParams(location.search))
      navigate(withSearch(current, value), replace)
    },
  }
}

/** Remembers the pages loaded for a catalog listing for the current visit to the page. */
export function useCatalogWindowStore(): ListWindowStore {
  const entryKey = useHistoryEntryKey()
  return {
    get: listKey => {
      const stored = entryKey ? listWindows.get(entryKey) : undefined
      return stored?.listKey === listKey ? stored.pageCursors : undefined
    },
    set: (listKey, pageCursors) => {
      if (entryKey) {
        listWindows.set(entryKey, { listKey, pageCursors })
      }
    },
  }
}

/** How densely catalog listings lay out their tiles, as the viewer last picked. */
export function useCatalogDensity() {
  return useUserLocalStorageValue<CatalogDensity>(
    'maps.catalog.density',
    CatalogDensity.Cozy,
    validateDensity,
  )
}

/** The route for the catalog's tabs that list maps: `/maps/:tab`. */
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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadFiles = useUploadMapFiles()

  const listing = listingForTab(tab)
  const { params, sort, onFiltersChange, onSortChange, onClearFilters, onSearchChange } =
    useCatalogUrlParams(listing)
  const search = useLocationProperty(() => location.search)
  const [density, setDensity] = useCatalogDensity()
  const [localView, setLocalView] = useUserLocalStorageValue<LocalMapView>(
    'maps.catalog.localView',
    LocalMapView.Folders,
    validateLocalMapView,
  )
  const isLocal = listing === MapListing.Local
  const localFolder = new URLSearchParams(search).get('folder') ?? undefined

  const onLocalFolderChange = (folder: string | undefined) => {
    const next = new URLSearchParams(location.search)
    if (folder === undefined) {
      next.delete('folder')
    } else {
      next.set('folder', folder)
    }
    const nextSearch = next.toString()
    push(location.pathname + (nextSearch ? `?${nextSearch}` : ''))
  }

  const windowStore = useCatalogWindowStore()

  const needsLogin = !selfUser && listing !== MapListing.All && !isLocal
  const libraryVersion = useAtomValue(mapLibraryVersionAtom)
  const filter = toMapFilter(params)
  const listKey = JSON.stringify([
    listing,
    filter,
    sort,
    listing === MapListing.Yours && libraryVersion,
  ])

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
  } else if (isLocal) {
    body = IS_ELECTRON ? (
      <LocalMapList
        params={params}
        sort={sort}
        density={density}
        view={localView}
        folder={localFolder}
        onFiltersChange={onFiltersChange}
        onSortChange={onSortChange}
        onDensityChange={setDensity}
        onClearFilters={onClearFilters}
        onViewChange={setLocalView}
        onFolderChange={onLocalFolderChange}
      />
    ) : (
      <EmptyState>
        <EmptyText>
          {t(
            'maps.local.desktopOnly',
            'The maps on your PC can only be browsed in the ShieldBattery app.',
          )}
        </EmptyText>
      </EmptyState>
    )
  } else {
    const searchText = params.search.trim()
    body = (
      <>
        {listing === MapListing.Yours ? (
          <UploadBanner onUpload={() => fileInputRef.current?.click()} />
        ) : null}
        <MapCatalogList
          key={listKey}
          listing={listing as ServerMapListing}
          params={params}
          filter={filter}
          sort={sort}
          density={density}
          windowStore={windowStore}
          besideCount={
            IS_ELECTRON && searchText ? (
              <LocalMatchesLink
                search={searchText}
                onOpen={() =>
                  push(
                    urlForMapCatalog(
                      MapCatalogTab.Local,
                      serializeCatalogParams({
                        ...filtersOf(params),
                        search: searchText,
                        sort: undefined,
                      }),
                    ),
                  )
                }
              />
            ) : undefined
          }
          onFiltersChange={onFiltersChange}
          onSortChange={onSortChange}
          onDensityChange={setDensity}
          onClearFilters={onClearFilters}
        />
      </>
    )
  }

  return (
    <MapCatalogFrame
      tab={tab}
      search={
        <CatalogSearchInput
          value={params.search}
          label={t('maps.catalog.searchMaps', 'Search maps')}
          onChange={onSearchChange}
        />
      }>
      {body}
      {listing === MapListing.Yours ? (
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
      ) : null}
    </MapCatalogFrame>
  )
}

const Banner = styled.div`
  ${bodyMedium};
  min-height: 72px;
  padding: 12px 20px;

  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 16px;

  border: 1px dashed var(--theme-outline);
  border-radius: 8px;
  color: var(--theme-on-surface-variant);
`

const BannerText = styled.div`
  flex: 1 1 280px;

  & > strong {
    font-weight: 600;
    color: var(--theme-on-surface);
  }
`

function UploadBanner({ onUpload }: { onUpload: () => void }) {
  const { t } = useTranslation()
  return (
    <Banner>
      <MaterialIcon icon='upload' />
      <BannerText>
        <Trans t={t} i18nKey='maps.catalog.uploadBannerText'>
          Drop a <strong>.scm</strong> or <strong>.scx</strong> file anywhere to upload it. It lands
          here as a private map.
        </Trans>
      </BannerText>
      <FilledButton
        label={t('maps.catalog.uploadMaps', 'Upload maps')}
        iconStart='upload'
        onClick={onUpload}
      />
    </Banner>
  )
}
