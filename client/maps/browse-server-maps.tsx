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
import { useSelfPermissions, useSelfUser } from '../auth/auth-utils'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import ImageList from '../material/image-list'
import { TabItem, Tabs } from '../material/tabs'
import { useRefreshToken } from '../network/refresh-token'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, BodyLarge, labelLarge, TitleLarge } from '../styles/typography'
import {
  addToFavorites,
  getMaps,
  openMapPreviewDialog,
  regenMapImage,
  removeFromFavorites,
  removeMap,
} from './action-creators'
import { BrowserFooter as Footer } from './browser-footer'
import { ConnectedMapThumbnail } from './map-thumbnail'
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
      return t('maps.server.favoritedMaps', 'Favorited maps')
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
  onMapSelect?: (mapId: SbMapId) => void
  onMapDetails?: (mapId: SbMapId) => void
  onBrowseLocalMaps?: () => void
}

export function BrowseServerMaps({
  title,
  uploadedMapId,
  onMapRemove,
  onMapSelect,
  onMapDetails,
  onBrowseLocalMaps,
}: BrowseServerMapsProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const selfUser = useSelfUser()
  const selfPermissions = useSelfPermissions()

  const snackbarController = useSnackbarController()

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
  const favoritedMapIds = useAppSelector(s => s.maps.favoritedMapIds)

  const [hasMoreMaps, setHasMoreMaps] = useState(true)
  const [isLoadingMoreMaps, setIsLoadingMoreMaps] = useState(false)
  const [searchError, setSearchError] = useState<Error>()
  const [searchQuery, setSearchQuery] = useState('')
  const abortControllerRef = useRef<AbortController>(undefined)

  const [refreshToken, triggerRefresh] = useRefreshToken()

  // NOTE(2Pac): There are basically 2 ways we can reset the state when tab/filters/search changes:
  //  1. We can keep the state in a separate "list" component that gets recreated when each of those
  //     things changes (by concocting a `key` with a combo of all their values).
  //  2. We can do what we did here, which is manually reset the state when needed.
  //
  // Even though the first approach is more declarative in nature and the second approach more
  // imperative, I went with the second approach for now because it seems more straightforward.
  const reset = (query?: string) => {
    // Just need to clear the search results here and let the infinite scroll list initiate the
    // network request.
    setSearchQuery(query ?? '')
    // TODO(2Pac): Make the infinite scroll list in charge of the loading state, so we don't have
    // to do this here, which is pretty unintuitive.
    setIsLoadingMoreMaps(false)
    setSearchError(undefined)
    setMapIds(undefined)
    setHasMoreMaps(true)
    triggerRefresh()
  }

  const debouncedSearchRef = useRef(
    debounce((query: string) => {
      reset(query)
    }, 100),
  )

  useEffect(() => {
    if (uploadedMapId) {
      setActiveTab(MapTab.MyMaps)
    }
  }, [setActiveTab, uploadedMapId])

  const onLoadMoreMaps = () => {
    setIsLoadingMoreMaps(true)

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    dispatch(
      getMaps(
        {
          visibility: tabToVisibility(activeTab),
          sort: sortOption,
          numPlayers: numPlayersFilter,
          tileset: tilesetFilter,
          searchQuery,
          offset: mapIds?.length ?? 0,
        },
        {
          signal: abortControllerRef.current.signal,
          onSuccess: data => {
            setIsLoadingMoreMaps(false)
            setMapIds((mapIds ?? []).concat(data.maps.map(m => m.id)))
            setHasMoreMaps(data.hasMoreMaps)
          },
          onError: err => {
            setIsLoadingMoreMaps(false)
            setSearchError(err)
          },
        },
      ),
    )
  }

  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

  const onAddToFavorites = (mapId: SbMapId) => {
    dispatch(
      addToFavorites(mapId, {
        onSuccess: () => {
          snackbarController.showSnackbar(t('maps.server.favorites.added', 'Added to favorites'))
        },
        onError: () => {
          snackbarController.showSnackbar(
            t('maps.server.favorites.addedError', 'An error occurred while adding to favorites'),
          )
        },
      }),
    )
  }

  const onRemoveFromFavorites = (mapId: SbMapId) => {
    dispatch(
      removeFromFavorites(mapId, {
        onSuccess: () => {
          snackbarController.showSnackbar(
            t('maps.server.favorites.removed', 'Removed from favorites'),
          )
        },
        onError: () => {
          snackbarController.showSnackbar(
            t(
              'maps.server.favorites.removedError',
              'An error occurred while removing from favorites',
            ),
          )
        },
      }),
    )
  }

  const onRemoveMap = (mapId: SbMapId) => {
    dispatch(
      removeMap(mapId, {
        onSuccess: () => {
          setMapIds(mapIds?.filter(id => id !== mapId))
          onMapRemove?.(mapId)
        },
        onError: () => {
          snackbarController.showSnackbar(
            t('maps.server.removeError', 'An error occurred while removing the map'),
          )
        },
      }),
    )
  }

  const onRegenMapImage = (mapId: SbMapId) => {
    dispatch(
      regenMapImage(mapId, {
        onSuccess: () => {
          snackbarController.showSnackbar(t('maps.server.regenerated', 'Images regenerated'))
        },
        onError: () => {
          snackbarController.showSnackbar(
            t('maps.server.regenerateError', 'An error occurred while regenerating images'),
          )
        },
      }),
    )
  }

  const renderMaps = (section: MapsSection, mapIds: SbMapId[]) => {
    const layout = thumbnailSizeToLayout(thumbnailSize)
    return (
      <>
        <SectionHeader>{mapsSectionToTitle(section, t)}</SectionHeader>
        <ImageList $columnCount={layout.columnCount} $padding={layout.padding}>
          {mapIds.map(mapId => {
            const isFavorited = favoritedMapIds.has(mapId)

            const canManageMaps = !!selfPermissions?.manageMaps

            // We don't show the remove button in the favorited maps section since that section
            // includes maps that are potentially removed by their original uploader/admin.
            const canRemoveMap = section !== MapsSection.Favorited
            const canRegenMapImage = selfUser && canManageMaps

            return (
              <ConnectedMapThumbnail
                key={mapId}
                map={mapId}
                forceAspectRatio={1}
                size={layout.columnCount === 2 ? 512 : 256}
                showMapName={true}
                isFavorited={isFavorited}
                onClick={onMapSelect ? () => onMapSelect(mapId) : undefined}
                onPreview={() => dispatch(openMapPreviewDialog(mapId))}
                onAddToFavorites={selfUser ? () => onAddToFavorites(mapId) : undefined}
                onRemoveFromFavorites={selfUser ? () => onRemoveFromFavorites(mapId) : undefined}
                onMapDetails={onMapDetails ? () => onMapDetails(mapId) : undefined}
                onRemove={canRemoveMap ? () => onRemoveMap(mapId) : undefined}
                onRegenMapImage={canRegenMapImage ? () => onRegenMapImage(mapId) : undefined}
              />
            )
          })}
        </ImageList>
      </>
    )
  }

  const renderUploadedMap = () => {
    if (!uploadedMapId || activeTab !== MapTab.MyMaps) {
      return null
    }

    return renderMaps(MapsSection.Uploaded, [uploadedMapId])
  }

  const renderFavoritedMaps = () => {
    if (favoritedMapIds.size === 0) {
      return null
    }

    return renderMaps(MapsSection.Favorited, Array.from(favoritedMapIds))
  }

  const renderAllMaps = () => {
    if (!mapIds) {
      return null
    }

    if (mapIds.length === 0) {
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

    return renderMaps(MapsSection.All, mapIds)
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
          {searchError ? (
            <ErrorText>
              {t('maps.server.error', 'There was an error retrieving the maps.')}
            </ErrorText>
          ) : (
            <>
              {renderUploadedMap()}
              {renderFavoritedMaps()}
              <InfiniteScrollList
                nextLoadingEnabled={true}
                isLoadingNext={isLoadingMoreMaps}
                hasNextData={hasMoreMaps}
                refreshToken={refreshToken}
                onLoadNextData={onLoadMoreMaps}>
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
        onSearchChange={query => debouncedSearchRef.current(query)}
      />
    </Container>
  )
}
