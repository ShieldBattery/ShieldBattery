import { useAtomValue } from 'jotai'
import * as React from 'react'
import { lazy, Suspense, useEffect, useEffectEvent, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useLocationProperty } from 'wouter/use-browser-location'
import { MapCatalogTab, urlForMapCatalog } from '../../common/map-url'
import { useTrackPageView } from '../analytics/analytics'
import { redirectToLogin, useSelfUser } from '../auth/auth-utils'
import { FileDropZone } from '../file-browser/file-drop-zone'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { FilledButton, OutlinedButton, TextButton } from '../material/button'
import { elevationPlus1 } from '../material/shadows'
import { TabItem, Tabs } from '../material/tabs'
import { useHistoryEntryKey, useScrollMemory } from '../navigation/router-hooks'
import { push, replace } from '../navigation/routing'
import { createViewStateStore } from '../navigation/view-state-store'
import { LoadingDotsArea } from '../progress/dots'
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
  defaultSortForTab,
  effectiveSort,
  filtersOf,
  hasCatalogParams,
  parseCatalogParams,
  serializeCatalogParams,
  toMapFilter,
  validateSavedFilters,
  validateSavedSort,
  withSearch,
} from './map-catalog-params'
import { MAP_FILE_EXTENSIONS, mapLibraryVersionAtom, useUploadMapFiles } from './map-uploads'

const LoadableLocalMaps = lazy(async () => ({
  default: (await import('./browse-local-maps')).BrowseLocalMaps,
}))

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
  const sort = effectiveSort(params, savedSort, defaultSortForTab(tab))

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

  const onSearchChange = useCoalescedSearch(value => {
    const current = parseCatalogParams(new URLSearchParams(location.search))
    navigate(withSearch(current, value), replace)
  })

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

  const entryKey = useHistoryEntryKey()
  const windowStore: ListWindowStore = {
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

  const searchInputRef = useRef<SearchInputHandle>(null)
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
          windowStore={windowStore}
          onFiltersChange={onFiltersChange}
          onSortChange={onSortChange}
          onDensityChange={setDensity}
          onClearFilters={onClearFilters}
        />
      </>
    )
  }

  return (
    <Root data-content-fullbleed=''>
      <HeaderBar>
        <Title>{t('maps.activity.title', 'Maps')}</Title>
        {selfUser ? (
          <Tabs activeTab={tab} onChange={onTabChange}>
            <TabItem text={t('maps.catalog.allMaps', 'All maps')} value={MapCatalogTab.All} />
            <TabItem text={t('maps.catalog.yourMaps', 'Your maps')} value={MapCatalogTab.Yours} />
            <TabItem
              text={t('maps.catalog.favorites', 'Favorites')}
              value={MapCatalogTab.Favorites}
            />
          </Tabs>
        ) : null}
        <StyledSearchInput
          ref={searchInputRef}
          searchQuery={params.search}
          onSearchChange={onSearchChange}
          label={t('maps.catalog.searchMaps', 'Search maps')}
        />
      </HeaderBar>
      <Scroller ref={setScroller} $fullWidth={true}>
        <Content>{body}</Content>
      </Scroller>
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
      <MaterialIcon icon='upload' />
      <BannerText>
        <Trans t={t} i18nKey='maps.catalog.uploadBannerText'>
          Drop a <strong>.scm</strong> or <strong>.scx</strong> file anywhere to upload it. It lands
          here as a private map.
        </Trans>
      </BannerText>
      {onBrowseLocalMaps ? (
        <OutlinedButton
          label={t('maps.catalog.browseLocalMaps', 'Browse local maps')}
          onClick={onBrowseLocalMaps}
        />
      ) : null}
      <FilledButton
        label={t('maps.catalog.uploadMaps', 'Upload maps')}
        iconStart='upload'
        onClick={onUpload}
      />
    </Banner>
  )
}
