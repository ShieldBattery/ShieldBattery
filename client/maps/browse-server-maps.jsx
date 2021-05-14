import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { List, Map, Set } from 'immutable'
import { debounce } from 'lodash-es'
import styled from 'styled-components'

import { openSimpleDialog } from '../dialogs/action-creators'
import { openOverlay } from '../activities/action-creators'
import {
  clearMapsList,
  getMapsList,
  toggleFavoriteMap,
  getMapPreferences,
  updateMapPreferences,
} from './action-creators'

import ActivityBackButton from '../activities/activity-back-button'
import { BrowserFooter as Footer } from './browser-footer'
import ImageList from '../material/image-list'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import LoadingIndicator from '../progress/dots'
import MapPreview from './map-preview'
import { MapThumbnail } from './map-thumbnail'
import Tabs, { TabItem } from '../material/tabs'

import {
  MAP_VISIBILITY_OFFICIAL,
  MAP_VISIBILITY_PRIVATE,
  MAP_VISIBILITY_PUBLIC,
} from '../../common/constants'
import { ALL_TILESETS, SORT_BY_NAME } from '../../common/maps'

import { colorDividers, colorError, colorTextSecondary } from '../styles/colors'
import { Subtitle1, subtitle1, Headline5 } from '../styles/typography'

const MAPS_LIMIT = 30

const LoadingArea = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  height: 100%;
`

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
`

const TitleBar = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  margin: 16px;

  & > h3 {
    margin: 0;
  }
`

const Contents = styled.div`
  flex-grow: 1;
  contain: strict;
  overflow-y: auto;
`

const ContentsBody = styled.div`
  padding: 0 24px;
`

const SectionHeader = styled.div`
  ${subtitle1};
  color: ${colorTextSecondary};
  margin-top: 24px;
  margin-bottom: 16px;
`

const ErrorText = styled.div`
  ${subtitle1};
  color: ${colorError};
`

const ScrollDivider = styled.div`
  width: 100%;
  height: 1px;
  margin-top: ${props => (props.position === 'top' ? '-1px' : '0')};
  margin-bottom: ${props => (props.position === 'bottom' ? '-1px' : '0')};
  background-color: ${colorDividers};
`

const TAB_OFFICIAL_MAPS = 0
const TAB_MY_MAPS = 1
const TAB_COMMUNITY_MAPS = 2

function tabToVisibility(tab) {
  switch (tab) {
    case TAB_OFFICIAL_MAPS:
      return MAP_VISIBILITY_OFFICIAL
    case TAB_MY_MAPS:
      return MAP_VISIBILITY_PRIVATE
    case TAB_COMMUNITY_MAPS:
      return MAP_VISIBILITY_PUBLIC
    default:
      throw new Error('Invalid tab value')
  }
}

function visibilityToTab(visibility) {
  switch (visibility) {
    case MAP_VISIBILITY_OFFICIAL:
      return TAB_OFFICIAL_MAPS
    case MAP_VISIBILITY_PRIVATE:
      return TAB_MY_MAPS
    case MAP_VISIBILITY_PUBLIC:
      return TAB_COMMUNITY_MAPS
    default:
      throw new Error('Invalid tab value')
  }
}

const THUMBNAIL_SIZES = [
  { columnCount: 4, padding: 4 },
  { columnCount: 3, padding: 4 },
  { columnCount: 2, padding: 4 },
]

// A pure component that just renders the map elements, to avoid re-rendering all of them if some
// other state (eg. `loading`) changes.
class MapList extends React.PureComponent {
  static propTypes = {
    list: PropTypes.instanceOf(List),
    byId: PropTypes.instanceOf(Map),
    user: PropTypes.object.isRequired,
    canManageMaps: PropTypes.bool.isRequired,
    thumbnailSize: PropTypes.number,
    favoriteStatusRequests: PropTypes.instanceOf(Set),
    onMapSelect: PropTypes.func,
    onMapPreview: PropTypes.func,
    onToggleFavoriteMap: PropTypes.func,
    onMapDetails: PropTypes.func,
    onRemoveMap: PropTypes.func,
    onRegenMapImage: PropTypes.func,
  }

  render() {
    const {
      list,
      byId,
      user,
      canManageMaps,
      thumbnailSize,
      favoriteStatusRequests,
      onMapSelect,
      onMapPreview,
      onToggleFavoriteMap,
      onMapDetails,
      onRemoveMap,
      onRegenMapImage,
    } = this.props

    return list.map((id, i) => {
      const map = byId.get(id)
      const canRemoveMap =
        onRemoveMap &&
        ((map.visibility !== MAP_VISIBILITY_PRIVATE && canManageMaps) ||
          (map.visibility === MAP_VISIBILITY_PRIVATE && map.uploadedBy.id === user.id))
      const canRegenMapImage = onRegenMapImage && canManageMaps

      return (
        <MapThumbnail
          key={id}
          map={map}
          size={THUMBNAIL_SIZES[thumbnailSize].columnCount === 2 ? 512 : 256}
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
    })
  }
}

@connect(state => ({ auth: state.auth, maps: state.maps, mapPreferences: state.mapPreferences }))
export default class Maps extends React.Component {
  static propTypes = {
    title: PropTypes.string.isRequired,
    uploadedMap: PropTypes.object,
    onMapSelect: PropTypes.func,
    onLocalMapSelect: PropTypes.func,
    onMapDetails: PropTypes.func,
    onRemoveMap: PropTypes.func,
    onRegenMapImage: PropTypes.func,
  }

  state = {
    activeTab: this.props.uploadedMap ? TAB_MY_MAPS : TAB_OFFICIAL_MAPS,
    currentPage: 0,
    thumbnailSize: 1,
    sortOption: SORT_BY_NAME,
    numPlayersFilter: new Set([2, 3, 4, 5, 6, 7, 8]),
    tilesetFilter: new Set(ALL_TILESETS),
    searchQuery: '',
    hasInitializedState: false,
  }

  _refreshToken = 0

  _savePreferences = () => {
    const { activeTab, thumbnailSize, sortOption, numPlayersFilter, tilesetFilter } = this.state

    this.props.dispatch(
      updateMapPreferences({
        visibility: tabToVisibility(activeTab),
        thumbnailSize,
        sortOption,
        numPlayers: numPlayersFilter.toArray(),
        tileset: tilesetFilter.toArray(),
      }),
    )
  }

  componentDidMount() {
    this.props.dispatch(getMapPreferences())
    window.addEventListener('beforeunload', this._savePreferences)
  }

  componentDidUpdate(prevProps, prevState) {
    const {
      mapPreferences: {
        isRequesting,
        visibility,
        thumbnailSize,
        sortOption,
        numPlayersFilter,
        tilesetFilter,
        lastError,
      },
    } = this.props
    const { activeTab } = this.state

    if (prevProps.mapPreferences.isRequesting && !isRequesting) {
      this.setState({ hasInitializedState: true })

      if (!lastError) {
        this.setState({
          activeTab: visibilityToTab(visibility),
          thumbnailSize,
          sortOption,
          numPlayersFilter: new Set(numPlayersFilter),
          tilesetFilter: new Set(tilesetFilter),
        })
      }
    }

    if (prevState.activeTab !== activeTab) {
      this._reset()
    }
  }

  componentWillUnmount() {
    this.props.dispatch(clearMapsList())

    // Saves the map preferences if the component had time to unmount. If it didn't, eg. the page
    // was refreshed, the 'beforeunload' event listener will handle it.
    this._savePreferences()
    window.removeEventListener('beforeunload', this._savePreferences)

    this._resetDebounced.cancel()
  }

  // This method should be called every time a tab changes or a new/different filter is applied
  _reset() {
    this._resetDebounced.cancel()
    this.props.dispatch(clearMapsList())
    // Since we're using the same instance of the InfiniteList component to render maps, gotta
    // reset it each time we change tabs, or apply different filters. Also, make sure to do it
    // before resetting the `currentPage` to 0, since the refresh token is a regular class field
    // which doesn't cause a re-render.
    this._refreshToken++
    this.setState({ currentPage: 0 })
  }

  _renderMaps(header, maps) {
    const {
      auth,
      maps: { favoriteStatusRequests },
      onMapSelect,
      onMapDetails,
      onRemoveMap,
      onRegenMapImage,
    } = this.props
    const { thumbnailSize } = this.state

    return (
      <>
        <SectionHeader>{header}</SectionHeader>
        <ImageList
          columnCount={THUMBNAIL_SIZES[thumbnailSize].columnCount}
          padding={THUMBNAIL_SIZES[thumbnailSize].padding}>
          <MapList
            list={maps.list}
            byId={maps.byId}
            user={auth.user}
            canManageMaps={auth.permissions.manageMaps}
            thumbnailSize={thumbnailSize}
            favoriteStatusRequests={favoriteStatusRequests}
            onMapSelect={onMapSelect}
            onMapPreview={this.onMapPreview}
            onToggleFavoriteMap={this.onToggleFavoriteMap}
            onMapDetails={onMapDetails}
            onRemoveMap={onRemoveMap}
            onRegenMapImage={onRegenMapImage}
          />
        </ImageList>
      </>
    )
  }

  renderUploadedMap() {
    const { uploadedMap, maps } = this.props
    const { activeTab } = this.state

    if (!uploadedMap || activeTab !== TAB_MY_MAPS || !maps.list.includes(uploadedMap.id)) {
      return null
    }

    const uploadedMapRecord = {
      list: new List([uploadedMap.id]),
      byId: maps.byId.filter(m => m.id === uploadedMap.id),
    }
    return this._renderMaps('Uploaded map', uploadedMapRecord)
  }

  renderFavoritedMaps() {
    const { maps } = this.props

    if (maps.favoritedMaps.list.size < 1) return null

    return this._renderMaps('Favorited maps', maps.favoritedMaps)
  }

  renderAllMaps() {
    const { maps } = this.props
    const { activeTab, searchQuery } = this.state

    if (maps.total === -1) return null
    if (maps.total === 0) {
      let text
      if (searchQuery) {
        text = 'No results.'
      } else if (activeTab === TAB_OFFICIAL_MAPS) {
        text = 'No official maps have been uploaded yet.'
      } else if (activeTab === TAB_MY_MAPS) {
        text =
          "You haven't uploaded any maps. You can upload a map by clicking on the browse " +
          'button below.'
      } else if (activeTab === TAB_COMMUNITY_MAPS) {
        text = 'No maps by the community have been made public yet.'
      }
      return (
        <>
          <SectionHeader>All maps</SectionHeader>
          <Subtitle1>{text}</Subtitle1>
        </>
      )
    }

    return this._renderMaps('All maps', maps)
  }

  render() {
    const { title, maps, mapPreferences } = this.props
    const {
      activeTab,
      thumbnailSize,
      numPlayersFilter,
      tilesetFilter,
      sortOption,
      searchQuery,
      hasInitializedState,
    } = this.state

    if (mapPreferences.isRequesting) {
      return (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }

    // We don't want to render the `BrowserFooter` until we initialize the state by fetching the map
    // preferences, because some its state is initialized with the fetched one. Hopefully this won't
    // be necessary anymore once Suspense finally comes?
    if (!hasInitializedState) return null

    const hasMoreMaps = maps.total === -1 || maps.total > maps.list.size
    return (
      <Container>
        <TitleBar>
          <ActivityBackButton />
          <Headline5>{title}</Headline5>
        </TitleBar>
        <Tabs activeTab={activeTab} onChange={this.onTabChange} bottomDivider={true}>
          <TabItem text='Official' />
          <TabItem text='My maps' />
          <TabItem text='Community' />
        </Tabs>
        <Contents>
          <ContentsBody>
            {maps.lastError ? (
              <ErrorText>Something went wrong: {maps.lastError.message}</ErrorText>
            ) : (
              <>
                {this.renderUploadedMap()}
                {this.renderFavoritedMaps()}
                <InfiniteScrollList
                  nextLoadingEnabled={true}
                  isLoadingNext={maps.isRequesting}
                  hasNextData={hasMoreMaps}
                  refreshToken={this._refreshToken}
                  onLoadNextData={this.onLoadMoreMaps}>
                  {this.renderAllMaps()}
                </InfiniteScrollList>
              </>
            )}
          </ContentsBody>
        </Contents>
        <ScrollDivider position='bottom' />
        <Footer
          onBrowseLocalMaps={this.onBrowseLocalMaps}
          thumbnailSize={thumbnailSize}
          onSizeChange={this.onThumbnailSizeChange}
          numPlayersFilter={numPlayersFilter}
          tilesetFilter={tilesetFilter}
          onFilterApply={this.onFilterApply}
          sortOption={sortOption}
          onSortChange={this.onSortOptionChange}
          searchQuery={searchQuery}
          onSearchChange={this.onSearchChange}
        />
      </Container>
    )
  }

  onLoadMoreMaps = () => {
    const {
      activeTab,
      currentPage,
      sortOption,
      numPlayersFilter,
      tilesetFilter,
      searchQuery,
    } = this.state

    this.props.dispatch(
      getMapsList(
        tabToVisibility(activeTab),
        MAPS_LIMIT,
        currentPage,
        sortOption,
        numPlayersFilter.toArray(),
        tilesetFilter.toArray(),
        searchQuery,
      ),
    )
    this.setState(state => ({ currentPage: state.currentPage + 1 }))
  }

  onTabChange = value => {
    this.setState({ activeTab: value })
  }

  onMapPreview = map => {
    this.props.dispatch(openSimpleDialog(map.name, <MapPreview map={map} />, false /* hasButton */))
  }

  onToggleFavoriteMap = map => {
    this.props.dispatch(toggleFavoriteMap(map))
  }

  onBrowseLocalMaps = () => {
    const localMapsProps = {
      onMapSelect: this.props.onLocalMapSelect,
    }
    this.props.dispatch(openOverlay('browseLocalMaps', localMapsProps))
  }

  onThumbnailSizeChange = size => {
    if (this.state.thumbnailSize !== size) {
      this.setState({ thumbnailSize: size })
    }
  }

  onFilterApply = (numPlayersFilter, tilesetFilter) => {
    this.setState(() => ({ numPlayersFilter, tilesetFilter }), this._reset)
  }

  onSortOptionChange = sortOption => {
    if (this.state.sortOption !== sortOption) {
      this.setState(() => ({ sortOption }), this._reset)
    }
  }

  _resetDebounced = debounce(this._reset, 450)

  onSearchChange = searchQuery => {
    this.setState(() => ({ searchQuery }), this._resetDebounced)
    // TODO(2Pac): Display something else when a user starts typing and before the search starts?
    this.props.dispatch(clearMapsList())
  }
}
