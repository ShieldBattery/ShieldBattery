import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { List, Map, Set } from 'immutable'
import styled from 'styled-components'

import { openOverlay } from '../activities/action-creators'
import { clearMapsList, getMapsList, toggleFavoriteMap } from './action-creators'

import ActivityBackButton from '../activities/activity-back-button.jsx'
import FloatingActionButton from '../material/floating-action-button.jsx'
import IconButton from '../material/icon-button.jsx'
import ImageList from '../material/image-list.jsx'
import InfiniteScrollList from '../lists/infinite-scroll-list.jsx'
import MapThumbnail from './map-thumbnail.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'
import Tabs, { TabItem } from '../material/tabs.jsx'
import {
  MAP_VISIBILITY_OFFICIAL,
  MAP_VISIBILITY_PRIVATE,
  MAP_VISIBILITY_PUBLIC,
} from '../../app/common/constants'

import FilterIcon from '../icons/material/baseline-filter_list-24px.svg'
import FolderIcon from '../icons/material/baseline-folder_open-24px.svg'
import SearchIcon from '../icons/material/baseline-search-24px.svg'
import SizeIcon from '../icons/material/baseline-view_list-24px.svg'
import SortIcon from '../icons/material/baseline-sort_by_alpha-24px.svg'

import { colorDividers, colorError, colorTextSecondary } from '../styles/colors'
import { Headline, Subheading } from '../styles/typography'

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

const ActionsContainer = styled.div`
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 56px;
  padding: 16px;
`

const LeftActions = styled.div`
  flex-shrink: 0;
`

const ActionButton = styled(IconButton)`
  & > span {
    color: ${colorTextSecondary} !important;
  }

  ${LeftActions} > & {
    margin-right: 8px;
  }
`

const PositionedFloatingActionButton = styled(FloatingActionButton)`
  position: absolute;
  top: -28px;
  left: calc(50% - 28px);
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
    onToggleFavoriteMap: PropTypes.func,
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
      onToggleFavoriteMap,
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
          onToggleFavorite={onToggleFavoriteMap ? () => onToggleFavoriteMap(map) : undefined}
          onRemove={canRemoveMap ? () => onRemoveMap(map) : undefined}
        />
      )
    })
  }
}

@connect(state => ({ auth: state.auth, maps: state.maps }))
export default class Maps extends React.Component {
  static propTypes = {
    title: PropTypes.string.isRequired,
    uploadedMap: PropTypes.object,
    onMapSelect: PropTypes.func,
    onLocalMapSelect: PropTypes.func,
    onRemoveMap: PropTypes.func,
  }

  state = {
    activeTab: this.props.uploadedMap ? TAB_MY_MAPS : TAB_OFFICIAL_MAPS,
    scrolledDown: false,
  }

  infiniteList = null
  _setInfiniteListRef = elem => {
    this.infiniteList = elem
  }

  componentWillUnmount() {
    this.props.dispatch(clearMapsList())
  }

  componentDidUpdate(prevProps, prevState) {
    const { activeTab } = this.state

    if (prevState.activeTab !== activeTab) {
      // Since we're using the same instance of the InfiniteList component to render maps, gotta
      // reset it each time we change tabs
      this.infiniteList.reset()
      this.props.dispatch(clearMapsList())
    }
  }

  _renderMaps(header, maps) {
    const {
      auth,
      maps: { favoriteStatusRequests },
      onMapSelect,
      onRemoveMap,
    } = this.props

    return (
      <>
        <Underline>{header}</Underline>
        <ImageList columnCount={3} padding={4}>
          <MapList
            list={maps.list}
            byId={maps.byId}
            user={auth.user}
            canManageMaps={auth.permissions.manageMaps}
            favoriteStatusRequests={favoriteStatusRequests}
            onMapSelect={onMapSelect}
            onToggleFavoriteMap={this.onToggleFavoriteMap}
            onRemoveMap={onRemoveMap}
          />
        </ImageList>
      </>
    )
  }

  renderUploadedMap() {
    const { uploadedMap } = this.props
    const { activeTab } = this.state

    if (!uploadedMap || activeTab !== TAB_MY_MAPS) return null

    const uploadedMapRecord = {
      list: new List([uploadedMap.hash]),
      byId: new Map([[uploadedMap.hash, uploadedMap]]),
    }
    return this._renderMaps('Uploaded map', uploadedMapRecord)
  }

  renderAllMaps() {
    const { maps } = this.props

    if (maps.total === -1) return null
    if (maps.total === 0) {
      return (
        <>
          <Underline>All maps</Underline>
          <Subheading>There are no maps.</Subheading>
        </>
      )
    }

    return this._renderMaps('All maps', maps)
  }

  render() {
    const { title, maps } = this.props
    const { activeTab, scrolledDown } = this.state

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
          {scrolledDown ? <ScrollDivider position='top' /> : null}
          <ScrollableContent onUpdate={this.onScrollUpdate}>
            <ContentsBody>
              {maps.lastError ? (
                <ErrorText>Something went wrong: {maps.lastError.message}</ErrorText>
              ) : (
                <>
                  {this.renderUploadedMap()}
                  <InfiniteScrollList
                    ref={this._setInfiniteListRef}
                    isLoading={maps.isRequesting}
                    onLoadMoreData={this.onLoadMoreMaps}>
                    {this.renderAllMaps()}
                  </InfiniteScrollList>
                </>
              )}
            </ContentsBody>
          </ScrollableContent>
          <ScrollDivider position='bottom' />
        </Contents>
        <ActionsContainer>
          <PositionedFloatingActionButton
            title='Browse local maps'
            icon={<FolderIcon />}
            onClick={this.onBrowseLocalMapsClick}
          />
          <LeftActions>
            <ActionButton icon={<SizeIcon />} title='View size' />
            <ActionButton icon={<FilterIcon />} title='Filter options' />
            <ActionButton icon={<SortIcon />} title='Sort maps' />
          </LeftActions>
          <ActionButton icon={<SearchIcon />} title='Search' />
        </ActionsContainer>
      </Container>
    )
  }

  onScrollUpdate = values => {
    const { scrollTop } = values
    const scrolledDown = scrollTop > 0

    if (scrolledDown !== this.state.scrolledDown) {
      this.setState({ scrolledDown })
    }
  }

  onLoadMoreMaps = () => {
    const { activeTab } = this.state

    this.props.dispatch(getMapsList(tabToVisibility(activeTab)))
  }

  onTabChange = value => {
    this.setState({ activeTab: value })
  }

  onToggleFavoriteMap = map => {
    this.props.dispatch(toggleFavoriteMap(map))
  }

  onBrowseLocalMapsClick = () => {
    const localMapsProps = {
      onMapSelect: this.props.onLocalMapSelect,
    }
    this.props.dispatch(openOverlay('browseLocalMaps', localMapsProps))
  }
}
