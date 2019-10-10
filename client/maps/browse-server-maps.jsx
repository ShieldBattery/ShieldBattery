import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { List, Map } from 'immutable'
import styled from 'styled-components'

import { goBack } from '../activities/action-creators'
import { clearMapsList, getMapsList } from './action-creators'
import { openOverlay } from '../activities/action-creators'

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

import BackIcon from '../icons/material/baseline-arrow_back-24px.svg'
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

const BackButton = styled(IconButton)`
  margin-right: 16px;
`

const Contents = styled.div`
  flex-grow: 1;
`

const ContentsBody = styled.div`
  padding: 0 24px;
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
    byHash: PropTypes.instanceOf(Map),
    onMapSelect: PropTypes.func,
  }

  render() {
    const { list, byHash } = this.props

    return list.map((hash, i) => (
      <MapThumbnail
        key={hash}
        map={byHash.get(hash)}
        showMapName={true}
        canHover={true}
        onClick={() => this.onClick(hash)}
      />
    ))
  }

  onClick = hash => {
    if (this.props.onMapSelect) {
      this.props.onMapSelect(hash)
    }
  }
}

const MAPS_LIMIT = 30

@connect(state => ({ maps: state.maps }))
export default class Maps extends React.Component {
  state = {
    activeTab: TAB_OFFICIAL_MAPS,
    scrolledDown: false,
    currentPage: 0,
  }

  infiniteList = null
  _setInfiniteListRef = elem => {
    this.infiniteList = elem
  }

  componentDidUpdate(prevProps, prevState) {
    const { activeTab } = this.state

    if (prevState.activeTab !== activeTab) {
      // Since we're using the same instance of the InfiniteList component to render maps, gotta
      // reset it each time we change tabs
      this.infiniteList.reset()
      this.props.dispatch(clearMapsList())
      this.setState({ currentPage: 0 })
    }
  }

  renderMaps() {
    const { maps } = this.props

    if (maps.total === -1) return null
    if (maps.total === 0) return <Subheading>There are no maps.</Subheading>

    return (
      <ImageList columnCount={3} padding={4}>
        <MapList list={maps.list} byHash={maps.byHash} onMapSelect={this.onMapSelect} />
      </ImageList>
    )
  }

  render() {
    const { maps } = this.props
    const { activeTab, scrolledDown } = this.state

    return (
      <Container>
        <TitleBar>
          <BackButton icon={<BackIcon />} title='Click to go back' onClick={this.onBackClick} />
          <Headline>Select map</Headline>
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
                <InfiniteScrollList
                  ref={this._setInfiniteListRef}
                  isLoading={maps.isRequesting}
                  onLoadMoreData={this.onLoadMoreMaps}>
                  {this.renderMaps()}
                </InfiniteScrollList>
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
    const { activeTab, currentPage } = this.state

    this.props.dispatch(getMapsList(tabToVisibility(activeTab), MAPS_LIMIT, currentPage))
    this.setState({ currentPage: currentPage + 1 })
  }

  onBackClick = () => {
    this.props.dispatch(goBack())
  }

  onTabChange = value => {
    this.setState({ activeTab: value })
  }

  onMapSelect = map => {
    this.props.dispatch(openOverlay('createLobby', { map: this.props.maps.byHash.get(map) }))
  }

  onBrowseLocalMapsClick = () => {
    this.props.dispatch(openOverlay('browseLocalMaps'))
  }
}
