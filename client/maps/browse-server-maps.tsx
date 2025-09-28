import { TFunction } from 'i18next'
import { debounce } from 'lodash-es'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  ALL_TILESETS,
  MapSortType,
  MapVisibility,
  NumPlayers,
  SbMapId,
  Tileset,
} from '../../common/maps'
import { useSelfUser } from '../auth/auth-utils'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import ImageList from '../material/image-list'
import { TabItem, Tabs } from '../material/tabs'
import { useRefreshToken } from '../network/refresh-token'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { useAppDispatch } from '../redux-hooks'
import { bodyLarge, BodyLarge, labelLarge, TitleLarge } from '../styles/typography'
import { getFavorites as getFavoritedMaps, getMaps } from './action-creators'
import { BrowserFooter as Footer } from './browser-footer'
import { ReduxMapThumbnail } from './map-thumbnail'
import { MapThumbnailSize } from './thumbnail-size'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`

const TitleBar = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  margin: 16px 24px;
`

const Contents = styled.div`
  flex-grow: 1;
  contain: strict;
  overflow-y: auto;
`

const ContentsBody = styled.div`
  padding: 0 24px 40px;
`

const SectionHeader = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
  margin-top: 24px;
  margin-bottom: 16px;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);

  margin-top: 16px;
`

const TabArea = styled.div`
  position: relative;
  padding: 0px 24px 8px;
`

const ScrollDivider = styled.div<{ $position: 'top' | 'bottom' }>`
  width: 100%;
  height: 1px;
  margin-top: ${props => (props.$position === 'top' ? '-1px' : '0')};
  margin-bottom: ${props => (props.$position === 'bottom' ? '-1px' : '0')};
  background-color: var(--theme-outline-variant);
`

enum MapTab {
  OfficialMaps = 'Official',
  MyMaps = 'MyMaps',
  CommunityMaps = 'Community',
}

function tabToVisibility(tab: MapTab): MapVisibility {
  switch (tab) {
    case MapTab.OfficialMaps:
      return MapVisibility.Official
    case MapTab.MyMaps:
      return MapVisibility.Private
    case MapTab.CommunityMaps:
      return MapVisibility.Public
    default:
      return tab satisfies never
  }
}

function thumbnailSizeToLayout(thumbnailSize: MapThumbnailSize): {
  columnCount: number
  padding: number
} {
  switch (thumbnailSize) {
    case MapThumbnailSize.Small:
      return { columnCount: 4, padding: 4 }
    case MapThumbnailSize.Medium:
      return { columnCount: 3, padding: 4 }
    case MapThumbnailSize.Large:
      return { columnCount: 2, padding: 4 }
    default:
      return thumbnailSize satisfies never
  }
}

enum MapsSection {
  Uploaded = 'Uploaded',
  Favorited = 'Favorited',
  All = 'All',
}

function mapsSectionToTitle(section: MapsSection, t: TFunction): string {
  switch (section) {
    case MapsSection.Uploaded:
      return t('maps.server.uploadedMap', 'Uploaded map')
    case MapsSection.Favorited:
      return t('maps.server.favoriteMaps', 'Favorite maps')
    case MapsSection.All:
      return t('maps.server.allMaps', 'All maps')
    default:
      return section satisfies never
  }
}

interface BrowseServerMapsProps {
  title: string
  uploadedMapId?: SbMapId
  onMapRemove?: (mapId: SbMapId) => void
  onMapClick?: (mapId: SbMapId) => void
  onBrowseLocalMaps?: () => void
}

export function BrowseServerMaps({
  title,
  uploadedMapId,
  onMapRemove,
  onMapClick,
  onBrowseLocalMaps,
}: BrowseServerMapsProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()

  const [activeTab, setActiveTab] = useUserLocalStorageValue<MapTab>(
    'maps.browseServer.activeTab',
    MapTab.OfficialMaps,
    (value: unknown) =>
      Object.values(MapTab).includes(value as MapTab) ? (value as MapTab) : undefined,
  )

  const [thumbnailSize, setThumbnailSize] = useUserLocalStorageValue<MapThumbnailSize>(
    'maps.browseServer.thumbnailSize',
    MapThumbnailSize.Medium,
    (value: unknown) =>
      Object.values(MapThumbnailSize).includes(value as MapThumbnailSize)
        ? (value as MapThumbnailSize)
        : undefined,
  )
  const [sortOption, setSortOption] = useUserLocalStorageValue<MapSortType>(
    'maps.browseServer.sortOption',
    MapSortType.Name,
    (value: unknown) =>
      Object.values(MapSortType).includes(value as MapSortType)
        ? (value as MapSortType)
        : undefined,
  )
  const [numPlayersFilter, setNumPlayersFilter] = useUserLocalStorageValue<NumPlayers[]>(
    'maps.browseServer.numPlayersFilter',
    [2, 3, 4, 5, 6, 7, 8],
    (value: unknown) =>
      Array.isArray(value) && value.every(v => typeof v === 'number' && v >= 2 && v <= 8)
        ? (value as NumPlayers[])
        : undefined,
  )
  const [tilesetFilter, setTilesetFilter] = useUserLocalStorageValue<Tileset[]>(
    'maps.browseServer.tilesetFilter',
    ALL_TILESETS.slice(),
    (value: unknown) =>
      Array.isArray(value) && value.every(v => ALL_TILESETS.includes(v))
        ? (value as Tileset[])
        : undefined,
  )

  const [mapIds, setMapIds] = useState<SbMapId[]>()
  const [favoritedMapIds, setFavoritedMapIds] = useState<SbMapId[]>([])

  const [hasMoreMaps, setHasMoreMaps] = useState(true)
  const [isLoadingMoreMaps, setIsLoadingMoreMaps] = useState(false)
  const [getMapsError, setGetMapsError] = useState<Error>()
  const [getFavoritedMapsError, setGetFavoritedMapsError] = useState<Error>()
  const [searchQuery, setSearchQuery] = useState('')

  const getMapsAbortControllerRef = useRef<AbortController>(new AbortController())
  const getFavoritedMapsAbortControllerRef = useRef<AbortController>(new AbortController())

  const [refreshToken, triggerRefresh] = useRefreshToken()

  // NOTE(2Pac): There are basically 2 ways we can reset the state when tab/filters/search changes:
  //  1. We can keep the state in a separate "list" component that gets recreated when each of those
  //     things changes (by concocting a `key` with a combo of all their values).
  //  2. We can do what we did here, which is manually reset the state when needed.
  //
  // Even though the first approach is more declarative in nature and the second approach more
  // imperative, I went with the second approach for now because it seems more straightforward.
  const reset = ({
    query,
    clearFavorites = true,
  }: { query?: string; clearFavorites?: boolean } = {}) => {
    // Just need to clear the search results here and let the infinite scroll list initiate the
    // network request.
    setSearchQuery(query ?? '')
    // TODO(2Pac): Make the infinite scroll list in charge of the loading state, so we don't have
    // to do this here, which is pretty unintuitive.
    setIsLoadingMoreMaps(false)
    setGetMapsError(undefined)
    setGetFavoritedMapsError(undefined)
    setMapIds(undefined)
    // Since favorited maps are shared across tabs, we don't need to clear them when switching tabs,
    // but we do need to clear them when the user changes the search query or other filters.
    if (clearFavorites) {
      setFavoritedMapIds([])
    }
    setHasMoreMaps(true)
    triggerRefresh()
  }

  const debouncedSearchRef = useRef(
    debounce((query: string) => {
      reset({ query })
    }, 100),
  )

  useEffect(() => {
    if (uploadedMapId) {
      setActiveTab(MapTab.MyMaps)
    }
  }, [setActiveTab, uploadedMapId])

  useEffect(() => {
    if (!selfUser) {
      return
    }

    getFavoritedMapsAbortControllerRef.current?.abort()
    getFavoritedMapsAbortControllerRef.current = new AbortController()

    dispatch(
      getFavoritedMaps(
        {
          sort: sortOption,
          numPlayers: numPlayersFilter,
          tilesets: tilesetFilter,
          q: searchQuery,
        },
        {
          signal: getFavoritedMapsAbortControllerRef.current.signal,
          onSuccess: data => {
            setFavoritedMapIds(data.favoritedMaps.map(m => m.id))
          },
          onError: err => {
            setGetFavoritedMapsError(err)
          },
        },
      ),
    )
  }, [selfUser, dispatch, sortOption, numPlayersFilter, tilesetFilter, searchQuery])

  const onLoadMoreMaps = () => {
    setIsLoadingMoreMaps(true)

    getMapsAbortControllerRef.current?.abort()
    getMapsAbortControllerRef.current = new AbortController()

    dispatch(
      getMaps(
        {
          visibility: tabToVisibility(activeTab),
          sort: sortOption,
          numPlayers: numPlayersFilter,
          tilesets: tilesetFilter,
          q: searchQuery,
          offset: mapIds?.length ?? 0,
        },
        {
          signal: getMapsAbortControllerRef.current.signal,
          onSuccess: data => {
            setIsLoadingMoreMaps(false)
            setMapIds((mapIds ?? []).concat(data.maps.map(m => m.id)))
            setHasMoreMaps(data.hasMoreMaps)
          },
          onError: err => {
            setIsLoadingMoreMaps(false)
            setGetMapsError(err)
          },
        },
      ),
    )
  }

  useEffect(() => {
    return () => {
      getMapsAbortControllerRef.current?.abort()
      getFavoritedMapsAbortControllerRef.current?.abort()
    }
  }, [])

  const onRemoveMap = (mapId: SbMapId) => {
    setMapIds(mapIds?.filter(id => id !== mapId))
    onMapRemove?.(mapId)
  }

  const onAddToFavorites = (mapId: SbMapId) => {
    // We always add the newly favorited map to the end of the favorite maps list, even though that
    // might not obey our current sort filter (or even our filters). That seems preferable to me
    // than always having to sort and filter the maps on the client side as well.
    setFavoritedMapIds([...favoritedMapIds, mapId])
  }

  const onRemoveFromFavorites = (mapId: SbMapId) => {
    setFavoritedMapIds(favoritedMapIds.filter(id => id !== mapId))
  }

  let noMapsText: string | undefined
  if (mapIds && mapIds.length === 0) {
    const hasFiltersApplied =
      numPlayersFilter.length < 7 || tilesetFilter.length < ALL_TILESETS.length
    if (searchQuery || hasFiltersApplied) {
      noMapsText = t('maps.server.noResults', 'No results.')
    } else if (activeTab === MapTab.OfficialMaps) {
      noMapsText = t('maps.server.noOfficialMaps', 'No official maps have been uploaded yet.')
    } else if (activeTab === MapTab.MyMaps) {
      if (IS_ELECTRON) {
        noMapsText = t(
          'maps.server.noUploadedMaps',
          "You haven't uploaded any maps. You can upload a map by clicking on the browse button " +
            'below.',
        )
      } else {
        noMapsText = t('maps.server.noUploadedMapsWeb', "You haven't uploaded any maps.")
      }
    } else if (activeTab === MapTab.CommunityMaps) {
      noMapsText = t(
        'maps.server.noCommunityMaps',
        'No maps by the community have been made public yet.',
      )
    }
  }

  // TODO(tec27): Add back button if needed
  return (
    <Container>
      <TitleBar>
        <TitleLarge>{title}</TitleLarge>
      </TitleBar>
      <TabArea>
        <Tabs
          activeTab={activeTab}
          onChange={(value: MapTab) => {
            setActiveTab(value)
            reset({ clearFavorites: false })
          }}>
          <TabItem text={t('maps.server.tab.official', 'Official')} value={MapTab.OfficialMaps} />
          {selfUser ? (
            <TabItem text={t('maps.server.tab.myMaps', 'My maps')} value={MapTab.MyMaps} />
          ) : undefined}
          <TabItem
            text={t('maps.server.tab.community', 'Community')}
            value={MapTab.CommunityMaps}
          />
        </Tabs>
      </TabArea>
      <ScrollDivider $position='top' />
      <Contents>
        <ContentsBody>
          {uploadedMapId && activeTab === MapTab.MyMaps ? (
            <MapSection
              section={MapsSection.Uploaded}
              mapIds={[uploadedMapId]}
              thumbnailSize={thumbnailSize}
              onMapClick={onMapClick}
              onMapRemove={onRemoveMap}
              onAddToFavorites={onAddToFavorites}
              onRemoveFromFavorites={onRemoveFromFavorites}
            />
          ) : null}

          {favoritedMapIds.length > 0 ? (
            <MapSection
              section={MapsSection.Favorited}
              mapIds={favoritedMapIds}
              thumbnailSize={thumbnailSize}
              errorText={
                getFavoritedMapsError
                  ? t(
                      'maps.server.favorites.error',
                      'There was an error retrieving your favorite maps.',
                    )
                  : undefined
              }
              onMapClick={onMapClick}
              onMapRemove={onRemoveMap}
              onAddToFavorites={onAddToFavorites}
              onRemoveFromFavorites={onRemoveFromFavorites}
            />
          ) : null}

          <InfiniteScrollList
            nextLoadingEnabled={true}
            isLoadingNext={isLoadingMoreMaps}
            hasNextData={hasMoreMaps}
            refreshToken={refreshToken}
            onLoadNextData={onLoadMoreMaps}>
            {!mapIds || mapIds.length === 0 ? (
              <>
                <SectionHeader>{t('maps.server.allMaps', 'All maps')}</SectionHeader>
                <BodyLarge>{noMapsText}</BodyLarge>
              </>
            ) : (
              <MapSection
                section={MapsSection.All}
                mapIds={mapIds}
                thumbnailSize={thumbnailSize}
                errorText={
                  getMapsError
                    ? t('maps.server.error', 'There was an error retrieving the maps.')
                    : undefined
                }
                onMapClick={onMapClick}
                onMapRemove={onRemoveMap}
                onAddToFavorites={onAddToFavorites}
                onRemoveFromFavorites={onRemoveFromFavorites}
              />
            )}
          </InfiniteScrollList>
        </ContentsBody>
      </Contents>
      <ScrollDivider $position='bottom' />
      <Footer
        onBrowseLocalMaps={selfUser ? onBrowseLocalMaps : undefined}
        thumbnailSize={thumbnailSize}
        onSizeChange={setThumbnailSize}
        numPlayersFilter={new Set(numPlayersFilter)}
        tilesetFilter={new Set(tilesetFilter)}
        onFilterApply={(players, tileset) => {
          setNumPlayersFilter(Array.from(players))
          setTilesetFilter(Array.from(tileset))
          reset()
        }}
        sortOption={sortOption}
        onSortChange={option => {
          if (sortOption !== option) {
            setSortOption(option)
            reset()
          }
        }}
        searchQuery={searchQuery}
        onSearchChange={query => debouncedSearchRef.current(query)}
      />
    </Container>
  )
}

interface MapSectionProps {
  section: MapsSection
  mapIds: ReadonlyArray<SbMapId>
  thumbnailSize: MapThumbnailSize
  errorText?: string
  onMapClick?: (mapId: SbMapId) => void
  onMapRemove: (mapId: SbMapId) => void
  onAddToFavorites: (mapId: SbMapId) => void
  onRemoveFromFavorites: (mapId: SbMapId) => void
}
function MapSection({
  section,
  mapIds,
  thumbnailSize,
  errorText,
  onMapClick,
  onMapRemove,
  onAddToFavorites,
  onRemoveFromFavorites,
}: MapSectionProps) {
  const { t } = useTranslation()

  const layout = thumbnailSizeToLayout(thumbnailSize)
  return (
    <>
      <SectionHeader>{mapsSectionToTitle(section, t)}</SectionHeader>
      {errorText ? <ErrorText>{errorText}</ErrorText> : null}
      <ImageList $columnCount={layout.columnCount} $padding={layout.padding}>
        {mapIds.map(mapId => {
          // We don't show the remove button in the favorited maps section since that section
          // includes maps that are potentially removed by their original uploader/admin.
          const canRemoveMap = section !== MapsSection.Favorited

          return (
            <ReduxMapThumbnail
              key={mapId}
              mapId={mapId}
              forceAspectRatio={1}
              size={layout.columnCount === 2 ? 512 : 256}
              showMapName={true}
              onClick={onMapClick ? () => onMapClick(mapId) : undefined}
              onAddToFavorites={onAddToFavorites}
              onRemoveFromFavorites={onRemoveFromFavorites}
              onRemove={canRemoveMap ? () => onMapRemove(mapId) : undefined}
            />
          )
        })}
      </ImageList>
    </>
  )
}
