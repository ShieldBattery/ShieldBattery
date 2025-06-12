import { debounce } from 'lodash-es'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import {
  ALL_TILESETS,
  MapInfoJson,
  MapSortType,
  MapVisibility,
  NumPlayers,
  Tileset,
} from '../../common/maps'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfPermissions, useSelfUser } from '../auth/auth-utils'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import ImageList from '../material/image-list'
import { TabItem, Tabs } from '../material/tabs'
import { useRefreshToken } from '../network/refresh-token'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { bodyLarge, BodyLarge, labelLarge, TitleLarge } from '../styles/typography'
import {
  clearMapsList,
  getMapsList,
  openMapPreviewDialog,
  regenMapImage,
  removeMap,
  toggleFavoriteMap,
} from './action-creators'
import { BrowserFooter as Footer } from './browser-footer'
import { MapThumbnail } from './map-thumbnail'
import { MapThumbnailSize } from './thumbnail-size'

const MAPS_LIMIT = 30

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

interface MapListProps {
  maps: ReadonlyDeep<MapInfoJson[]>
  userId?: SbUserId
  canManageMaps: boolean
  thumbnailSize: MapThumbnailSize
  favoriteStatusRequests: ReadonlySet<string>
  onMapSelect?: (map: ReadonlyDeep<MapInfoJson>) => void
  onMapPreview?: (map: ReadonlyDeep<MapInfoJson>) => void
  onToggleFavoriteMap?: (map: ReadonlyDeep<MapInfoJson>) => void
  onMapDetails?: (map: ReadonlyDeep<MapInfoJson>) => void
  onRemoveMap?: (map: ReadonlyDeep<MapInfoJson>) => void
  onRegenMapImage?: (map: ReadonlyDeep<MapInfoJson>) => void
}

function MapList({
  maps,
  userId,
  canManageMaps,
  thumbnailSize,
  favoriteStatusRequests,
  onMapSelect,
  onMapPreview,
  onToggleFavoriteMap,
  onMapDetails,
  onRemoveMap,
  onRegenMapImage,
}: MapListProps) {
  return (
    <>
      {maps.map(map => {
        const canRemoveMap =
          onRemoveMap &&
          ((map.visibility !== MapVisibility.Private && canManageMaps) ||
            (map.visibility === MapVisibility.Private && map.uploadedBy === userId))
        const canRegenMapImage = onRegenMapImage && canManageMaps

        const layout = thumbnailSizeToLayout(thumbnailSize)

        return (
          <MapThumbnail
            key={map.id}
            map={map}
            forceAspectRatio={1}
            size={layout.columnCount === 2 ? 512 : 256}
            showMapName={true}
            isFavoriting={favoriteStatusRequests.has(map.id)}
            onClick={onMapSelect ? () => onMapSelect(map) : undefined}
            onPreview={onMapPreview ? () => onMapPreview(map) : undefined}
            onToggleFavorite={onToggleFavoriteMap ? () => onToggleFavoriteMap(map) : undefined}
            onMapDetails={onMapDetails ? () => onMapDetails(map) : undefined}
            onRemove={canRemoveMap ? () => onRemoveMap(map) : undefined}
            onRegenMapImage={canRegenMapImage ? () => onRegenMapImage(map) : undefined}
          />
        )
      })}
    </>
  )
}

interface BrowseServerMapsProps {
  title: string
  uploadedMap?: ReadonlyDeep<MapInfoJson>
  onMapSelect?: (map: ReadonlyDeep<MapInfoJson>) => void
  onMapDetails?: (map: ReadonlyDeep<MapInfoJson>) => void
  onBrowseLocalMaps?: () => void
}

export function BrowseServerMaps({
  title,
  uploadedMap,
  onMapSelect,
  onMapDetails,
  onBrowseLocalMaps,
}: BrowseServerMapsProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const selfPermissions = useSelfPermissions()
  const mapsState = useAppSelector(s => s.maps)

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

  const [currentPage, setCurrentPage] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [refreshToken, triggerRefresh] = useRefreshToken()

  const debouncedSetSearchQuery = useMemo(
    () =>
      debounce((query: string) => {
        setSearchQuery(query)
        dispatch(clearMapsList())
        setCurrentPage(0)
      }, 100),
    [dispatch],
  )
  const reset = () => {
    debouncedSetSearchQuery.cancel()
    dispatch(clearMapsList())
    setCurrentPage(0)
    triggerRefresh()
  }

  useEffect(() => {
    return () => {
      dispatch(clearMapsList())
      debouncedSetSearchQuery.cancel()
    }
  }, [debouncedSetSearchQuery, dispatch])

  useEffect(() => {
    if (uploadedMap) {
      setActiveTab(MapTab.MyMaps)
    }
  }, [setActiveTab, uploadedMap])

  const renderMaps = (header: string, maps: ReadonlyDeep<MapInfoJson[]>) => {
    const layout = thumbnailSizeToLayout(thumbnailSize)
    return (
      <>
        <SectionHeader>{header}</SectionHeader>
        <ImageList $columnCount={layout.columnCount} $padding={layout.padding}>
          <MapList
            maps={maps}
            userId={selfUser?.id}
            canManageMaps={!!selfPermissions?.manageMaps}
            thumbnailSize={thumbnailSize}
            favoriteStatusRequests={mapsState.favoriteStatusRequests}
            onMapSelect={onMapSelect}
            onMapPreview={map => dispatch(openMapPreviewDialog(map.id))}
            onToggleFavoriteMap={selfUser ? map => dispatch(toggleFavoriteMap(map)) : undefined}
            onMapDetails={onMapDetails}
            onRemoveMap={selfUser ? map => dispatch(removeMap(map)) : undefined}
            onRegenMapImage={selfUser ? map => dispatch(regenMapImage(map)) : undefined}
          />
        </ImageList>
      </>
    )
  }

  const renderUploadedMap = () => {
    if (!uploadedMap || activeTab !== MapTab.MyMaps) {
      return null
    }

    return renderMaps(t('maps.server.uploadedMap', 'Uploaded map'), [uploadedMap])
  }

  const renderFavoritedMaps = () => {
    if (mapsState.favoritedById.size < 1) return null

    return renderMaps(
      t('maps.server.favoritedMaps', 'Favorited maps'),
      Array.from(mapsState.favoritedById.values()),
    )
  }

  const renderAllMaps = () => {
    if (mapsState.total === -1) return null
    if (mapsState.total === 0) {
      const hasFiltersApplied =
        numPlayersFilter.length < 7 || tilesetFilter.length < ALL_TILESETS.length
      let text
      if (searchQuery || hasFiltersApplied) {
        text = t('maps.server.noResults', 'No results.')
      } else if (activeTab === MapTab.OfficialMaps) {
        text = t('maps.server.noOfficialMaps', 'No official maps have been uploaded yet.')
      } else if (activeTab === MapTab.MyMaps) {
        if (IS_ELECTRON) {
          text = t(
            'maps.server.noUploadedMaps',
            "You haven't uploaded any maps. You can upload a map by clicking on the browse button " +
              'below.',
          )
        } else {
          text = t('maps.server.noUploadedMapsWeb', "You haven't uploaded any maps.")
        }
      } else if (activeTab === MapTab.CommunityMaps) {
        text = t(
          'maps.server.noCommunityMaps',
          'No maps by the community have been made public yet.',
        )
      }
      return (
        <>
          <SectionHeader>{t('maps.server.allMaps', 'All maps')}</SectionHeader>
          <BodyLarge>{text}</BodyLarge>
        </>
      )
    }

    return renderMaps(t('maps.server.allMaps', 'All maps'), Array.from(mapsState.byId.values()))
  }

  const hasMoreMaps = mapsState.total === -1 || mapsState.total > mapsState.byId.size

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
            reset()
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
          {mapsState.lastError ? (
            <ErrorText>
              {t('maps.server.error', {
                defaultValue: 'Something went wrong: {{errorMessage}}',
                errorMessage: mapsState.lastError.message,
              })}
            </ErrorText>
          ) : (
            <>
              {renderUploadedMap()}
              {renderFavoritedMaps()}
              <InfiniteScrollList
                nextLoadingEnabled={true}
                isLoadingNext={mapsState.isRequesting}
                hasNextData={hasMoreMaps}
                refreshToken={refreshToken}
                onLoadNextData={() => {
                  dispatch(
                    getMapsList({
                      visibility: tabToVisibility(activeTab),
                      limit: MAPS_LIMIT,
                      page: currentPage,
                      sort: sortOption,
                      numPlayers: numPlayersFilter,
                      tileset: tilesetFilter,
                      searchQuery,
                    }),
                  )
                  setCurrentPage(p => p + 1)
                }}>
                {renderAllMaps()}
              </InfiniteScrollList>
            </>
          )}
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
        onSearchChange={debouncedSetSearchQuery}
      />
    </Container>
  )
}
