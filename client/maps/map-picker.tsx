import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GameType } from '../../common/games/game-type'
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
  MapPickOptions,
  useCoalescedSearch,
  validateDensity,
} from './map-catalog-list'
import {
  CatalogFilters,
  CatalogParams,
  CatalogSort,
  DEFAULT_CATALOG_FILTERS,
  defaultPickerSortForListing,
  effectiveSort,
  filtersOf,
  LOCAL_SORTS,
  MapListing,
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
import { MapPickerCollections, PickerCollection } from './map-picker-collections'
import { MAP_FILE_EXTENSIONS, mapLibraryVersionAtom } from './map-uploads'

/** What picking a map in the picker does. */
export enum MapPickerMode {
  /** Chooses the lobby's map, closing the picker. */
  Map,
  /** Adds maps to the lobby's map queue, one per pick, keeping the picker open. */
  Queue,
  /**
   * Adds maps to a collection, one per pick, keeping the picker open (see
   * {@link MapPickerCollectionTarget}).
   */
  Collection,
}

/** The collection that {@link MapPickerMode.Collection} adds maps to. */
export interface MapPickerCollectionTarget {
  id: string
  /** The collection's title, as the viewer sees it. */
  title: string
  /** How many maps the collection holds. */
  mapCount: number
  /** Whether the collection can't hold any more maps. */
  full: boolean
  /** The chip on tiles of maps the collection holds. Defaults to `In this collection`. */
  heldLabel?: string
  /**
   * How many maps the collection holds, as the picker's header says it. Defaults to
   * `{count} maps in this collection`.
   */
  countLabel?: string
  /** Whether the collection holds the map (family) `familyId`. Marked tiles can't be picked. */
  holds: (familyId: string) => boolean
  /**
   * Adds the map the file `mapId` is in to the collection, telling the viewer if that fails.
   * Resolves with whether it was added.
   */
  add: (mapId: SbMapId, familyId?: string) => Promise<boolean>
}

/** The picker's tab of collections, whose maps are picked once a collection is opened. */
const COLLECTIONS_TAB = 'collections'

/** A tab of the picker: a listing of maps, or the collections. */
type PickerTab = MapListing | typeof COLLECTIONS_TAB

/** The picker's tabs, in display order. */
const PICKER_TABS: ReadonlyArray<PickerTab> = [
  MapListing.Yours,
  MapListing.Local,
  MapListing.Starred,
  COLLECTIONS_TAB,
  MapListing.All,
]

/** The most listings whose loaded pages the picker remembers. */
const MAX_REMEMBERED_WINDOWS = 20

/** Where the picker was left, so opening it again (e.g. for the next queued map) returns there. */
interface MapPickerSession {
  tab: PickerTab
  /** The collection opened on the Collections tab, if any. */
  collection?: PickerCollection
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

type PickerSorts = Partial<Record<MapListing, CatalogSort>>

function validateTab(value: unknown): PickerTab | undefined {
  return PICKER_TABS.includes(value as PickerTab) ? (value as PickerTab) : undefined
}

function validateSorts(value: unknown): PickerSorts | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const sorts: PickerSorts = {}
  for (const tab of Object.values(MapListing)) {
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
  const [tab, setTab] = useUserLocalStorageValue<PickerTab>(
    'maps.picker.tab',
    MapListing.All,
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
    tab: IS_ELECTRON || tab !== MapListing.Local ? tab : MapListing.All,
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

function newSession(tab: PickerTab, filters: CatalogFilters): MapPickerSession {
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
        tab: MapListing.Yours,
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
  /** The collection maps are added to. Required for {@link MapPickerMode.Collection}. */
  collection?: MapPickerCollectionTarget
  /**
   * Called with each picked map, once its info is loaded. Unused for
   * {@link MapPickerMode.Collection}, which adds picked maps to `collection` instead.
   */
  onPick?: (mapId: SbMapId) => void
  /** Uploads map files the viewer picked from disk. */
  onUploadFiles: (files: Iterable<File>) => void
  onClose: () => void
}

/**
 * Picks maps for a lobby: the map catalog's listings (the viewer's maps, their Starred maps and
 * every map) with its search and filters, and collections to pick maps from, where choosing a tile
 * picks that map instead of opening its page. Where it was left is remembered until the app closes.
 */
export function MapPicker({
  mode,
  selectedMapId,
  queuedMapIds,
  canQueueMore = true,
  collection,
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

  const isLocal = tab === MapListing.Local
  const isCollections = tab === COLLECTIONS_TAB
  // The Collections tab lists no maps until one is opened, and those are in the collection's order
  const listing = isCollections ? MapListing.All : tab
  const sort = effectiveSort(
    params,
    saved.sorts[listing],
    defaultPickerSortForListing(listing),
    isLocal ? LOCAL_SORTS : undefined,
  )

  const onTabChange = (nextTab: PickerTab) => {
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
      saved.setSorts({ ...saved.sorts, [listing]: nextSort })
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

  const addToCollection = (
    target: MapPickerCollectionTarget,
    mapId: SbMapId,
    familyId?: string,
  ) => {
    setPendingMapId(mapId)
    setFailedMapId(undefined)
    return target.add(mapId, familyId).finally(() => setPendingMapId(undefined))
  }

  const pickMap = (mapId: SbMapId, familyId?: string) => {
    if (mode === MapPickerMode.Collection && collection) {
      return addToCollection(collection, mapId, familyId)
    }
    setPendingMapId(mapId)
    setFailedMapId(undefined)
    return new Promise<boolean>(resolve => {
      // The lobby's setup reads the picked map's info from the store, so it has to be there first
      dispatch(
        getMapInfo(mapId, {
          onSuccess: () => {
            setPendingMapId(undefined)
            onPick?.(mapId)
            resolve(true)
          },
          onError: () => {
            setPendingMapId(undefined)
            setFailedMapId(mapId)
            resolve(false)
          },
        }),
      )
    })
  }

  const inCollectionMode = mode === MapPickerMode.Collection && !!collection
  const pickOptions: MapPickOptions = {
    onPick: pickMap,
    selectedMapId: mode === MapPickerMode.Map ? selectedMapId : undefined,
    queuePositions: mode === MapPickerMode.Queue ? queuePositions : undefined,
    pendingMapId,
    failedMapId,
    disabled:
      (mode === MapPickerMode.Queue && !canQueueMore) || (inCollectionMode && collection.full),
    isMarked: inCollectionMode ? map => collection.holds(map.familyId) : undefined,
    markedLabel: inCollectionMode
      ? (collection.heldLabel ?? t('maps.picker.inThisCollection', 'In this collection'))
      : undefined,
  }
  const searchText = params.search.trim()

  let title: string
  if (inCollectionMode) {
    title = t('maps.picker.addToCollection', {
      defaultValue: 'Add maps to {{title}}',
      title: collection.title,
    })
  } else if (mode === MapPickerMode.Queue) {
    title = t('maps.picker.addToQueue', 'Add maps to the queue')
  } else {
    title = t('lobbies.createLobby.selectMap', 'Select map')
  }

  const libraryVersion = useAtomValue(mapLibraryVersionAtom)
  const filter = toMapFilter(params)
  const listKey = JSON.stringify([tab, filter, sort, tab === MapListing.Yours && libraryVersion])
  const openedCollection = isCollections ? session.collection : undefined

  let content: ReactNode
  if (isCollections) {
    content = (
      <MapPickerCollections
        search={params.search}
        opened={openedCollection}
        excludeId={inCollectionMode ? collection.id : undefined}
        pick={pickOptions}
        density={saved.density}
        onOpen={opened => updateSession(s => ({ ...s, collection: opened }))}
        onBack={() => updateSession(s => ({ ...s, collection: undefined }))}
      />
    )
  } else if (isLocal) {
    content = (
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
    )
  } else {
    content = (
      <MapCatalogList
        key={listKey}
        listing={listing as ServerMapListing}
        params={params}
        filter={filter}
        sort={sort}
        density={saved.density}
        windowStore={windowStore}
        pick={pickOptions}
        besideCount={
          IS_ELECTRON && searchText ? (
            <LocalMatchesLink search={searchText} onOpen={() => onTabChange(MapListing.Local)} />
          ) : undefined
        }
        onFiltersChange={onFiltersChange}
        onSortChange={onSortChange}
        onDensityChange={saved.setDensity}
        onClearFilters={() => onFiltersChange(DEFAULT_CATALOG_FILTERS)}
      />
    )
  }

  return (
    <Root>
      <Header>
        <TopRow>
          <TextButton
            label={t('common.actions.back', 'Back')}
            iconStart='arrow_back'
            onClick={onClose}
          />
          <Title>{title}</Title>
          {inCollectionMode ? (
            <>
              <QueueStatus>
                {collection.full
                  ? t('maps.picker.collectionFull', 'The collection is full')
                  : (collection.countLabel ??
                    t('maps.picker.collectionCount', {
                      defaultValue: '{{count}} maps in this collection',
                      defaultValue_one: '{{count}} map in this collection',
                      count: collection.mapCount,
                    }))}
              </QueueStatus>
              <FilledButton label={t('common.actions.done', 'Done')} onClick={onClose} />
            </>
          ) : null}
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
            <TabItem text={t('maps.catalog.yourMaps', 'Your maps')} value={MapListing.Yours} />
            {IS_ELECTRON ? (
              <TabItem text={t('maps.local.onThisPc', 'On this PC')} value={MapListing.Local} />
            ) : null}
            <TabItem text={t('maps.collections.starred', 'Starred')} value={MapListing.Starred} />
            <TabItem text={t('maps.collections.tab', 'Collections')} value={COLLECTIONS_TAB} />
            <TabItem text={t('maps.catalog.allMaps', 'All maps')} value={MapListing.All} />
          </Tabs>
          {openedCollection ? null : (
            <StyledSearchInput
              ref={searchInputRef}
              searchQuery={params.search}
              onSearchChange={onSearchChange}
              label={
                isCollections
                  ? t('maps.collections.search', 'Search collections')
                  : t('maps.catalog.searchMaps', 'Search maps')
              }
            />
          )}
          <OutlinedButton
            label={t('maps.catalog.uploadMaps', 'Upload maps')}
            iconStart='upload'
            onClick={() => fileInputRef.current?.click()}
          />
        </ControlsRow>
      </Header>
      <Scroller>
        <Content>{content}</Content>
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
