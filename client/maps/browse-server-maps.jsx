import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { List, Map, Set } from 'immutable'
import debounce from 'lodash.debounce'
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

import ActivityBackButton from '../activities/activity-back-button.jsx'
import Footer from './browser-footer.jsx'
import ImageList from '../material/image-list.jsx'
import InfiniteScrollList from '../lists/infinite-scroll-list.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import MapThumbnail from './map-thumbnail.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'
import Tabs, { TabItem } from '../material/tabs.jsx'
import {
  MAP_VISIBILITY_OFFICIAL,
  MAP_VISIBILITY_PRIVATE,
  MAP_VISIBILITY_PUBLIC,
} from '../../app/common/constants'
import { SORT_BY_NAME } from '../../app/common/maps'

import { colorDividers, colorError, colorTextSecondary } from '../styles/colors'
import { Headline, Subheading } from '../styles/typography'

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
`

const ContentsBody = styled.div`
  padding: 0 24px;
`

const Underline = styled(Subheading)`
  color: ${colorTextSecondary};
`

const ErrorText = styled(Subheading)`
  color: ${colorError};
`

const ScrollDivider = styled.div`
  width: 100%;
  height: 1px;
  margin-top: ${props => (props.position === 'top' ? '-1px' : '0')};
  margin-bottom: ${props => (props.position === 'bottom' ? '-1px' : '0')};
  background-color: ${colorDividers};
`

const MapPreview = styled.img`
  width: 100%;
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
    favoriteStatusRequests: PropTypes.instanceOf(Set),
    onMapSelect: PropTypes.func,
    onMapPreview: PropTypes.func,
    onToggleFavoriteMap: PropTypes.func,
    onMapDetails: PropTypes.func,
    onRemoveMap: PropTypes.func,
  }

  render() {
    const {
      list,
      byId,
      user,
      canManageMaps,
      favoriteStatusRequests,
      onMapSelect,
      onMapPreview,
      onToggleFavoriteMap,
      onMapDetails,
      onRemoveMap,
    } = this.props

    return list.map((id, i) => {
      const map = byId.get(id)
      const canRemoveMap =
        onRemoveMap &&
        ((map.visibility !== MAP_VISIBILITY_PRIVATE && canManageMaps) ||
          (map.visibility === MAP_VISIBILITY_PRIVATE && map.uploadedBy.id === user.id))

      return (
        <MapThumbnail
          key={id}
          map={map}
          showMapName={true}
          isFavoriting={favoriteStatusRequests.has(map.id)}
          onClick={onMapSelect ? () => onMapSelect(map) : undefined}
          onPreview={onMapPreview ? () => onMapPreview(map) : undefined}
          onToggleFavorite={onToggleFavoriteMap ? () => onToggleFavoriteMap(map) : undefined}
          onMapDetails={onMapDetails ? () => onMapDetails(map) : undefined}
          onRemove={canRemoveMap ? () => onRemoveMap(map) : undefined}
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
  }

  state = {
    activeTab: this.props.uploadedMap ? TAB_MY_MAPS : TAB_OFFICIAL_MAPS,
    currentPage: 0,
    thumbnailSize: 1,
    sortOption: SORT_BY_NAME,
    numPlayersFilter: new Set([2, 3, 4, 5, 6, 7, 8]),
    tilesetFilter: new Set([0, 1, 2, 3, 4, 5, 6, 7]),
    searchQuery: '',
    hasInitializedState: false,
  }

  infiniteList = null
  _setInfiniteListRef = elem => {
    this.infiniteList = elem
  }

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

    this.getMapsDebounced.cancel()
  }

  // This method should be called every time a tab changes or a new/different filter is applied
  _reset() {
    this.props.dispatch(clearMapsList())
    // Since we're using the same instance of the InfiniteList component to render maps, gotta
    // reset it each time we change tabs, or apply different filters. Also, make sure to do it
    // after resetting the `currentPage` to 0, since the infinite list will start to load maps
    // with whatever is currently saved in state.
    this.setState(
      () => ({ currentPage: 0 }),
      () => this.infiniteList.reset(),
    )
  }

  _renderMaps(header, maps) {
    const {
      auth,
      maps: { favoriteStatusRequests },
      onMapSelect,
      onMapDetails,
      onRemoveMap,
    } = this.props
    const { thumbnailSize } = this.state

    return (
      <>
        <Underline>{header}</Underline>
        <ImageList
          columnCount={THUMBNAIL_SIZES[thumbnailSize].columnCount}
          padding={THUMBNAIL_SIZES[thumbnailSize].padding}>
          <MapList
            list={maps.list}
            byId={maps.byId}
            user={auth.user}
            canManageMaps={auth.permissions.manageMaps}
            favoriteStatusRequests={favoriteStatusRequests}
            onMapSelect={onMapSelect}
            onMapPreview={this.onMapPreview}
            onToggleFavoriteMap={this.onToggleFavoriteMap}
            onMapDetails={onMapDetails}
            onRemoveMap={onRemoveMap}
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
    const { activeTab } = this.state

    if (activeTab !== TAB_MY_MAPS || maps.favoritedMaps.list.size < 1) return null

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
          "You haven't uploaded any maps. You can upload a map by clicking on the browse" +
          ' button below.'
      } else if (activeTab === TAB_COMMUNITY_MAPS) {
        text = 'No maps by the community have been made public yet.'
      }
      return (
        <>
          <Underline>All maps</Underline>
          <Subheading>{text}</Subheading>
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

    return (
      <Container>
        <TitleBar>
          <ActivityBackButton />
          <Headline>{title}</Headline>
        </TitleBar>
        <Tabs activeTab={activeTab} onChange={this.onTabChange}>
          <TabItem text='Official maps' />
          <TabItem text='My maps' />
          <TabItem text='Community maps' />
        </Tabs>
        <Contents>
          <ScrollDivider position='top' />
          <ScrollableContent>
            <ContentsBody>
              {maps.lastError ? (
                <ErrorText>Something went wrong: {maps.lastError.message}</ErrorText>
              ) : (
                <>
                  {this.renderUploadedMap()}
                  {this.renderFavoritedMaps()}
                  <InfiniteScrollList
                    ref={this._setInfiniteListRef}
                    isLoading={maps.isRequesting}
                    onLoadMoreData={this.onLoadMoreData}>
                    {this.renderAllMaps()}
                  </InfiniteScrollList>
                </>
              )}
            </ContentsBody>
          </ScrollableContent>
          <ScrollDivider position='bottom' />
        </Contents>
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
    const { maps } = this.props
    const {
      activeTab,
      currentPage,
      sortOption,
      numPlayersFilter,
      tilesetFilter,
      searchQuery,
    } = this.state

    if (maps.total > -1 && maps.total <= MAPS_LIMIT * currentPage) return

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
    this.props.dispatch(
      openSimpleDialog(map.name, <MapPreview src={map.imageUrl} alt={map.name} />),
    )
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

  getMapsDebounced = debounce(searchQuery => {
    const { activeTab, sortOption, numPlayersFilter, tilesetFilter } = this.state

    this.props.dispatch(
      getMapsList(
        tabToVisibility(activeTab),
        sortOption,
        numPlayersFilter.toArray(),
        tilesetFilter.toArray(),
        searchQuery,
      ),
    )
  }, 450)

  onSearchChange = searchQuery => {
    this.setState({ searchQuery })
    this.props.dispatch(clearMapsList())
    this.getMapsDebounced(searchQuery)
  }
}
