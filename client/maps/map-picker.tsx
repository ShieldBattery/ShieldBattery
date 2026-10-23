import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GameType } from '../../common/games/game-type'
import { MapCatalogTab } from '../../common/map-url'
import { SbMapId } from '../../common/maps'
import { MapLens } from '../gql/graphql'
import { FilledButton, OutlinedButton, TextButton } from '../material/button'
import { TabItem, Tabs } from '../material/tabs'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { useAppDispatch } from '../redux-hooks'
import { SearchInput, SearchInputHandle } from '../search/search-input'
import { bodyMedium, singleLine, titleLarge } from '../styles/typography'
import { getMapInfo } from './action-creators'
import {
  CatalogDensity,
  ListWindowStore,
  MapCatalogList,
  ServerCatalogTab,
  useCoalescedSearch,
  validateDensity,
} from './map-catalog-list'
import {
  CatalogFilters,
  CatalogParams,
  CatalogSort,
  DEFAULT_CATALOG_FILTERS,
  defaultPickerSortForTab,
  effectiveSort,
  filtersOf,
  LOCAL_SORTS,
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
import { MAP_FILE_EXTENSIONS, mapLibraryVersionAtom } from './map-uploads'

/** What picking a map in the picker does. */
export enum MapPickerMode {
  /** Chooses the lobby's map, closing the picker. */
  Map,
  /** Adds maps to the lobby's map queue, one per pick, keeping the picker open. */
  Queue,
}

/** The picker's tabs, in display order. */
const PICKER_TABS: ReadonlyArray<MapCatalogTab> = [
  MapCatalogTab.Yours,
  MapCatalogTab.Local,
  MapCatalogTab.Favorites,
  MapCatalogTab.All,
]

/** The most listings whose loaded pages the picker remembers. */
const MAX_REMEMBERED_WINDOWS = 20

/** Where the picker was left, so opening it again (e.g. for the next queued map) returns there. */
interface MapPickerSession {
  tab: MapCatalogTab
  params: CatalogParams
  /**
   * Whether the lens is UMS because the lobby's game type was Use Map Settings when the picker
   * opened, rather than because the viewer picked it.
   */
  lensFromGameType: boolean
  /** The pages loaded for each listing, keyed by the listing. */
  windows: ReadonlyMap<string, Array<string | null>>
  /** The folder shown in the maps on this PC, in the folders view. */
  localFolder?: string
}

const mapPickerSessionAtom = atom<MapPickerSession | undefined>(undefined)

type PickerSorts = Partial<Record<MapCatalogTab, CatalogSort>>

function validateTab(value: unknown): MapCatalogTab | undefined {
  return PICKER_TABS.includes(value as MapCatalogTab) ? (value as MapCatalogTab) : undefined
}

function validateSorts(value: unknown): PickerSorts | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const sorts: PickerSorts = {}
  for (const tab of PICKER_TABS) {
    const sort = validateSavedSort((value as Record<string, unknown>)[tab])
    if (sort) {
      sorts[tab] = sort
    }
  }
  return sorts
}

/**
 * The viewer's saved picker choices, kept apart from the catalog's so picking maps for a lobby
 * doesn't change how the catalog opens (and the other way around).
 */
function useSavedPickerChoices() {
  const [tab, setTab] = useUserLocalStorageValue<MapCatalogTab>(
    'maps.picker.tab',
    MapCatalogTab.All,
    validateTab,
  )
  const [filters, setFilters] = useUserLocalStorageValue<CatalogFilters>(
    'maps.picker.filters',
    DEFAULT_CATALOG_FILTERS,
    validateSavedFilters,
  )
  const [sorts, setSorts] = useUserLocalStorageValue<PickerSorts>(
    'maps.picker.sorts',
    {},
    validateSorts,
  )
  const [density, setDensity] = useUserLocalStorageValue<CatalogDensity>(
    'maps.picker.density',
    CatalogDensity.Cozy,
    validateDensity,
  )
  const [localView, setLocalView] = useUserLocalStorageValue<LocalMapView>(
    'maps.picker.localView',
    LocalMapView.Folders,
    validateLocalMapView,
  )
  return {
    tab: IS_ELECTRON || tab !== MapCatalogTab.Local ? tab : MapCatalogTab.All,
    setTab,
    filters,
    setFilters,
    sorts,
    setSorts,
    density,
    setDensity,
    localView,
    setLocalView,
  }
}

function newSession(tab: MapCatalogTab, filters: CatalogFilters): MapPickerSession {
  return {
    tab,
    params: { ...filters, search: '', sort: undefined },
    lensFromGameType: false,
    windows: new Map(),
  }
}

/** Sets up the picker's session before it opens, and points it at new uploads. */
export function useMapPickerSession() {
  const saved = useSavedPickerChoices()
  const setSession = useSetAtom(mapPickerSessionAtom)

  return {
    /**
     * Readies the picker to open for a lobby of `gameType`: a Use Map Settings lobby starts on UMS
     * maps, and a lens set that way is undone once the lobby isn't one anymore.
     */
    prepare: (gameType: GameType) => {
      setSession(prev => {
        const session = prev ?? newSession(saved.tab, saved.filters)
        const isUms = gameType === GameType.UseMapSettings
        if (isUms && session.params.lens !== MapLens.Ums) {
          return {
            ...session,
            params: { ...session.params, lens: MapLens.Ums },
            lensFromGameType: true,
          }
        } else if (!isUms && session.lensFromGameType) {
          return {
            ...session,
            params: { ...session.params, lens: saved.filters.lens },
            lensFromGameType: false,
          }
        }
        return session
      })
    },
    /** Shows the viewer's maps, newest first and unfiltered, so new uploads land in view. */
    showUploads: () => {
      setSession(prev => ({
        ...(prev ?? newSession(saved.tab, saved.filters)),
        tab: MapCatalogTab.Yours,
        params: { ...DEFAULT_CATALOG_FILTERS, search: '', sort: CatalogSort.Newest },
        lensFromGameType: false,
      }))
    },
  }
}

const Root = styled.div`
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  min-height: 0;
  flex-grow: 1;

  display: flex;
  flex-direction: column;
`

const Header = styled.div`
  flex-shrink: 0;
  padding: 16px 24px 12px;

  display: flex;
  flex-direction: column;
  gap: 12px;

  border-bottom: 1px solid var(--theme-outline-variant);
`

const TopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const Title = styled.div`
  ${titleLarge};
  ${singleLine};
  flex-grow: 1;
`

const QueueStatus = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
  white-space: nowrap;
`

const ControlsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
`

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

const Scroller = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
`

const Content = styled.div`
  min-height: 100%;
  padding: 16px 24px 48px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const HiddenFileInput = styled.input`
  display: none;
`

export interface MapPickerProps {
  mode: MapPickerMode
  /** The lobby's current map, marked in the listing. */
  selectedMapId?: SbMapId
  /** The maps in the lobby's queue, in order. Their tiles show where they sit in it. */
  queuedMapIds?: ReadonlyArray<SbMapId>
  /** Whether the queue has room for more maps. Only used for {@link MapPickerMode.Queue}. */
  canQueueMore?: boolean
  /** Called with each picked map, once its info is loaded. */
  onPick: (mapId: SbMapId) => void
  /** Uploads map files the viewer picked from disk. */
  onUploadFiles: (files: Iterable<File>) => void
  onClose: () => void
}

/**
 * Picks maps for a lobby: the map catalog's listings (the viewer's maps, their favorites and every
 * map) with its search and filters, where choosing a tile picks that map instead of opening its
 * page. Where it was left is remembered until the app closes.
 */
export function MapPicker({
  mode,
  selectedMapId,
  queuedMapIds,
  canQueueMore = true,
  onPick,
  onUploadFiles,
  onClose,
}: MapPickerProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const saved = useSavedPickerChoices()
  const [storedSession, setSession] = useAtom(mapPickerSessionAtom)
  const session = storedSession ?? newSession(saved.tab, saved.filters)
  const { tab, params } = session
  const fileInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<SearchInputHandle>(null)
  const [pendingMapId, setPendingMapId] = useState<SbMapId>()
  const [failedMapId, setFailedMapId] = useState<SbMapId>()

  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  const updateSession = (update: (session: MapPickerSession) => MapPickerSession) => {
    setSession(prev => update(prev ?? newSession(saved.tab, saved.filters)))
  }

  const isLocal = tab === MapCatalogTab.Local
  const sort = effectiveSort(
    params,
    saved.sorts[tab],
    defaultPickerSortForTab(tab),
    isLocal ? LOCAL_SORTS : undefined,
  )

  const onTabChange = (nextTab: MapCatalogTab) => {
    updateSession(s => ({ ...s, tab: nextTab, params: { ...s.params, sort: undefined } }))
    saved.setTab(nextTab)
  }

  const onFiltersChange = (changes: Partial<CatalogFilters>) => {
    const next = { ...params, ...changes }
    updateSession(s => ({
      ...s,
      params: { ...s.params, ...changes },
      lensFromGameType: s.lensFromGameType && changes.lens === undefined,
    }))
    saved.setFilters(filtersOf(next))
  }

  const onSortChange = (nextSort: CatalogSort) => {
    updateSession(s => ({ ...s, params: { ...s.params, sort: nextSort } }))
    if (nextSort !== CatalogSort.BestMatch) {
      saved.setSorts({ ...saved.sorts, [tab]: nextSort })
    }
  }

  const onSearchChange = useCoalescedSearch(value => {
    updateSession(s => ({ ...s, params: withSearch(s.params, value) }))
  })

  const windowStore: ListWindowStore = {
    get: listKey => session.windows.get(listKey),
    set: (listKey, pageCursors) => {
      updateSession(s => {
        const windows = new Map(s.windows)
        windows.delete(listKey)
        windows.set(listKey, pageCursors)
        while (windows.size > MAX_REMEMBERED_WINDOWS) {
          windows.delete(windows.keys().next().value!)
        }
        return { ...s, windows }
      })
    },
  }

  const queuePositions = new Map<SbMapId, number[]>()
  queuedMapIds?.forEach((mapId, i) => {
    queuePositions.set(mapId, [...(queuePositions.get(mapId) ?? []), i + 1])
  })

  const pickMap = (mapId: SbMapId) => {
    setPendingMapId(mapId)
    setFailedMapId(undefined)
    // The lobby's setup reads the picked map's info from the store, so it has to be there first
    dispatch(
      getMapInfo(mapId, {
        onSuccess: () => {
          setPendingMapId(undefined)
          onPick(mapId)
        },
        onError: () => {
          setPendingMapId(undefined)
          setFailedMapId(mapId)
        },
      }),
    )
  }

  const pickOptions = {
    onPick: pickMap,
    selectedMapId: mode === MapPickerMode.Map ? selectedMapId : undefined,
    queuePositions: mode === MapPickerMode.Queue ? queuePositions : undefined,
    pendingMapId,
    failedMapId,
    disabled: mode === MapPickerMode.Queue && !canQueueMore,
  }
  const searchText = params.search.trim()

  const libraryVersion = useAtomValue(mapLibraryVersionAtom)
  const filter = toMapFilter(params)
  const listKey = JSON.stringify([tab, filter, sort, tab === MapCatalogTab.Yours && libraryVersion])

  return (
    <Root>
      <Header>
        <TopRow>
          <TextButton
            label={t('common.actions.back', 'Back')}
            iconStart='arrow_back'
            onClick={onClose}
          />
          <Title>
            {mode === MapPickerMode.Queue
              ? t('maps.picker.addToQueue', 'Add maps to the queue')
              : t('lobbies.createLobby.selectMap', 'Select map')}
          </Title>
          {mode === MapPickerMode.Queue ? (
            <>
              <QueueStatus>
                {canQueueMore
                  ? t('maps.picker.queuedCount', {
                      defaultValue: '{{count}} maps in the queue',
                      defaultValue_one: '{{count}} map in the queue',
                      count: queuedMapIds?.length ?? 0,
                    })
                  : t('maps.picker.queueFull', 'The queue is full')}
              </QueueStatus>
              <FilledButton label={t('common.actions.done', 'Done')} onClick={onClose} />
            </>
          ) : null}
        </TopRow>
        <ControlsRow>
          <Tabs activeTab={tab} onChange={onTabChange}>
            <TabItem text={t('maps.catalog.yourMaps', 'Your maps')} value={MapCatalogTab.Yours} />
            {IS_ELECTRON ? (
              <TabItem text={t('maps.local.onThisPc', 'On this PC')} value={MapCatalogTab.Local} />
            ) : null}
            <TabItem
              text={t('maps.catalog.favorites', 'Favorites')}
              value={MapCatalogTab.Favorites}
            />
            <TabItem text={t('maps.catalog.allMaps', 'All maps')} value={MapCatalogTab.All} />
          </Tabs>
          <StyledSearchInput
            ref={searchInputRef}
            searchQuery={params.search}
            onSearchChange={onSearchChange}
            label={t('maps.catalog.searchMaps', 'Search maps')}
          />
          <OutlinedButton
            label={t('maps.catalog.uploadMaps', 'Upload maps')}
            iconStart='upload'
            onClick={() => fileInputRef.current?.click()}
          />
        </ControlsRow>
      </Header>
      <Scroller>
        <Content>
          {isLocal ? (
            <LocalMapList
              params={params}
              sort={sort}
              density={saved.density}
              view={saved.localView}
              folder={session.localFolder}
              pick={pickOptions}
              onFiltersChange={onFiltersChange}
              onSortChange={onSortChange}
              onDensityChange={saved.setDensity}
              onClearFilters={() => onFiltersChange(DEFAULT_CATALOG_FILTERS)}
              onViewChange={saved.setLocalView}
              onFolderChange={folder => updateSession(s => ({ ...s, localFolder: folder }))}
            />
          ) : (
            <MapCatalogList
              key={listKey}
              tab={tab as ServerCatalogTab}
              params={params}
              filter={filter}
              sort={sort}
              density={saved.density}
              windowStore={windowStore}
              pick={pickOptions}
              besideCount={
                IS_ELECTRON && searchText ? (
                  <LocalMatchesLink
                    search={searchText}
                    onOpen={() => onTabChange(MapCatalogTab.Local)}
                  />
                ) : undefined
              }
              onFiltersChange={onFiltersChange}
              onSortChange={onSortChange}
              onDensityChange={saved.setDensity}
              onClearFilters={() => onFiltersChange(DEFAULT_CATALOG_FILTERS)}
            />
          )}
        </Content>
      </Scroller>
      <HiddenFileInput
        ref={fileInputRef}
        type='file'
        multiple={true}
        accept={MAP_FILE_EXTENSIONS.map(e => `.${e}`).join(',')}
        onChange={event => {
          onUploadFiles(event.target.files ?? [])
          event.target.value = ''
        }}
      />
    </Root>
  )
}
