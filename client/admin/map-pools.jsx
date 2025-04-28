import { List, OrderedMap } from 'immutable'
import React, { useCallback } from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { MapVisibility } from '../../common/maps'
import {
  ALL_MATCHMAKING_TYPES,
  hasVetoes,
  MatchmakingType,
  matchmakingTypeToLabel,
} from '../../common/matchmaking'
import { MaterialIcon } from '../icons/material/material-icon'
import KeyListener from '../keyboard/key-listener'
import Carousel from '../lists/carousel'
import { MapThumbnail } from '../maps/map-thumbnail'
import { ElevatedButton, IconButton, TextButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { NumberTextField } from '../material/number-text-field'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { TabItem, Tabs } from '../material/tabs'
import { TextField } from '../material/text-field'
import LoadingIndicator from '../progress/dots'
import { bodyLarge, bodyMedium } from '../styles/typography'
import {
  clearSearch,
  createMapPool,
  deleteMapPool,
  getMapPoolHistory,
  searchMaps,
} from './action-creators'

const MAP_POOLS_LIMIT = 10
const SEARCH_MAPS_LIMIT = 30

const dateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

const Container = styled.div`
  padding: 0 16px;
`

const StyledTabs = styled(Tabs)`
  max-width: 600px;
`

const EditorContainer = styled.div`
  margin-bottom: 24px;
`

const SearchContainer = styled.div`
  display: flex;
  align-items: center;
  max-width: 600px;
`

const SearchInput = styled(TextField)`
  flex-grow: 1;
`

const SearchMapsButton = styled(TextButton)`
  margin-left: 8px;
`

const MapContainer = styled.div`
  flex-shrink: 0;
  width: 200px;
  height: 200px;

  &:not(:first-child) {
    margin-left: 4px;
  }
`

const StyledSelectedIcon = styled(MaterialIcon).attrs({ icon: 'check_circle', size: 64 })`
  text-shadow: 0 0 8px #000;
`

const SectionTitle = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-secondary);
`

const DateInputContainer = styled.div`
  display: flex;
  align-items: center;
`

const DateInput = styled.input`
  color: #000;
`

const InvalidDateInput = styled.div`
  ${bodyMedium};
  margin-left: 16px;
  color: var(--theme-error);
`

const ValidDateIcon = styled(MaterialIcon).attrs({ icon: 'check_circle' })`
  color: var(--theme-success);
  margin-left: 8px;
`

const CreatePoolButton = styled(ElevatedButton)`
  margin: 16px 0;
`

const HistoryContainer = styled.table`
  width: 100%;

  th,
  td {
    border: 5px solid transparent;
    padding: 5px 0px;
  }

  th {
    color: var(--theme-on-surface-secondary);
    text-align: left;
    font-weight: 500;
  }

  td {
    width: 1px;
    vertical-align: top;
    white-space: nowrap;
  }

  th:first-child,
  td:first-child {
    border-left: none;
  }
`

const MapPoolActionButton = styled(IconButton)`
  margin-left: 8px;
`

const LoadingArea = styled.div`
  margin: 16px 0;
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

export class MapPoolEditor extends React.Component {
  state = {
    maps: new OrderedMap(),
    startDate: '',
    searchQuery: '',
    maxVetoCount: 3,
    invalidDate: false,
    searchFocused: false,
    currentSearchPage: 0,
  }

  _carouselRef = React.createRef()

  componentDidUpdate(prevProps) {
    if (prevProps.initialMaps !== this.props.initialMaps) {
      this.setState({ maps: new OrderedMap(this.props.initialMaps.map(m => [m.id, m])) })
    }
  }

  renderSearchMapsResult() {
    const {
      searchResult: { list, byId, total, isRequesting, lastError },
    } = this.props
    const { maps } = this.state

    if (lastError) {
      return (
        <>
          <p>Something went wrong while trying to search maps. The error message was:</p>
          <ErrorText as='p'>{lastError.message}</ErrorText>
        </>
      )
    }

    if (total === 0) {
      return <p>No results</p>
    }

    const mapItems = list.map(id => {
      const map = byId.get(id)
      return (
        <MapContainer key={id}>
          <MapThumbnail
            map={map}
            showMapName={true}
            isSelected={maps.has(id)}
            selectedIcon={<StyledSelectedIcon />}
            onClick={() => this.onToggleMapSelection(map)}
          />
        </MapContainer>
      )
    })

    const hasMoreMaps = total === -1 || total > list.size
    return (
      <Carousel
        ref={this._carouselRef}
        isLoading={isRequesting}
        hasMoreItems={hasMoreMaps}
        onLoadMoreData={this.onLoadMoreMaps}>
        {mapItems}
      </Carousel>
    )
  }

  render() {
    const { searchQuery, maps, startDate, invalidDate } = this.state
    const selectedMaps = maps.valueSeq().map(m => (
      <MapContainer key={m.id}>
        <MapThumbnail map={m} showMapName={true} />
      </MapContainer>
    ))

    let dateValidationContents
    if (invalidDate) {
      dateValidationContents = (
        <InvalidDateInput>Start date must be set into the future</InvalidDateInput>
      )
    } else if (startDate && !invalidDate) {
      dateValidationContents = <ValidDateIcon />
    }

    return (
      <EditorContainer>
        <KeyListener onKeyDown={this.onKeyDown} />
        <SearchContainer>
          <SearchInput
            label='Find a map'
            value={searchQuery}
            allowErrors={false}
            leadingIcons={[<MaterialIcon icon='search' key='search' />]}
            onChange={this.onSearchChange}
            onFocus={this.onSearchFocus}
            onBlur={this.onSearchBlur}
          />
          <SearchMapsButton label='Find' color='accent' onClick={this.onSearchClick} />
        </SearchContainer>
        <SectionTitle>Search results</SectionTitle>
        {this.renderSearchMapsResult()}
        <SectionTitle>Selected maps</SectionTitle>
        {selectedMaps.size > 0 ? (
          <Carousel>{selectedMaps}</Carousel>
        ) : (
          <p>Use the search above to find maps and select them to be used in the map pool</p>
        )}
        {this.props.hasVetoes ? (
          <>
            <SectionTitle>Maximum veto count</SectionTitle>
            <NumberTextField
              dense={true}
              value={this.state.maxVetoCount}
              onChange={this.onMaxVetoCountChange}
            />
          </>
        ) : undefined}
        <SectionTitle>Start date</SectionTitle>
        <p>Choose a date and time (in your local timezone) when the map pool will start</p>
        <DateInputContainer>
          <DateInput
            type='datetime-local'
            value={this.state.startDate}
            onChange={this.onStartDateChange}
          />
          {dateValidationContents}
        </DateInputContainer>
        <CreatePoolButton
          label='Create'
          disabled={maps.size < 1 || startDate === '' || invalidDate}
          onClick={this.onCreate}
        />
      </EditorContainer>
    )
  }

  onLoadMoreMaps = () => {
    const { searchQuery, currentSearchPage } = this.state

    this.props.onLoadMoreMaps(searchQuery, currentSearchPage)
    this.setState({ currentSearchPage: currentSearchPage + 1 })
  }

  onStartDateChange = event => {
    if (event.target.validity.valid && Date.parse(event.target.value) > Date.now()) {
      this.setState({
        startDate: event.target.value,
        invalidDate: false,
      })
    } else {
      this.setState({
        startDate: event.target.value,
        invalidDate: true,
      })
    }
  }

  onMaxVetoCountChange = value => {
    this.setState({ maxVetoCount: value })
  }

  onSearchChange = event => {
    this.setState({ searchQuery: event.target.value })
  }

  onSearchFocus = () => {
    this.setState({ searchFocused: true })
  }

  onSearchBlur = () => {
    this.setState({ searchFocused: false })
  }

  onSearchClick = () => {
    this.props.onSearchClick()
    this.setState(
      () => ({ currentSearchPage: 0 }),
      () => this._carouselRef.current.reset(),
    )
  }

  onKeyDown = event => {
    if ((event.code === ENTER || event.code === ENTER_NUMPAD) && this.state.searchFocused) {
      this.onSearchClick()
      return true
    }

    return false
  }

  onToggleMapSelection = map => {
    const { maps } = this.state

    this.setState({
      maps: maps.has(map.id) ? maps.delete(map.id) : maps.set(map.id, map),
    })
  }

  onCreate = () => {
    this.props.onCreate(
      this.state.maps.keySeq().toArray(),
      this.props.hasVetoes ? this.state.maxVetoCount : 0,
      Date.parse(this.state.startDate),
    )
    this.setState({ maps: new OrderedMap(), startDate: '' })
  }
}

const MapPoolHistoryRow = React.memo(props => {
  const [actionsOverlayOpen, openActionsOverlay, closeActionsOverlay] = usePopoverController()
  const [anchorRef, anchorX, anchorY] = useRefAnchorPosition('left', 'top')

  const onMapActionClick = useCallback(
    handler => {
      handler()
      closeActionsOverlay()
    },
    [closeActionsOverlay],
  )

  const { id, startDate, maps } = props.mapPool

  const mapThumbnails = maps.valueSeq().map(m => (
    <MapContainer key={m.id}>
      <MapThumbnail map={m} showMapName={true} />
    </MapContainer>
  ))

  const mapPoolActions = [['Use as template', props.onUseAsTemplate]]
  if (startDate > Date.now()) {
    mapPoolActions.push(['Delete', props.onDelete])
  }

  let actionsMenu
  if (mapPoolActions.length < 1) {
    actionsMenu = null
  } else {
    const actions = mapPoolActions.map(([text, handler], i) => (
      <MenuItem key={i} text={text} onClick={() => onMapActionClick(handler)} />
    ))

    actionsMenu = (
      <>
        <MapPoolActionButton
          icon={<MaterialIcon icon='more_vert' />}
          title='Map pool actions'
          ref={anchorRef}
          onClick={openActionsOverlay}
        />
        <Popover
          open={actionsOverlayOpen}
          onDismiss={closeActionsOverlay}
          anchorX={anchorX ?? 0}
          anchorY={anchorY ?? 0}
          originX='left'
          originY='top'>
          <MenuList>{actions}</MenuList>
        </Popover>
      </>
    )
  }

  return (
    <tr key={id}>
      <td>
        {dateFormat.format(startDate)}
        {actionsMenu}
      </td>
      <td>
        <Carousel>{mapThumbnails}</Carousel>
      </td>
    </tr>
  )
})

class MapPoolHistory extends React.PureComponent {
  render() {
    const { history } = this.props

    if (!history) return null

    if (history.isRequesting) {
      return (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }

    if (history.lastError) {
      return (
        <>
          <p>
            Something went wrong while trying to retrieve the map pool history. The error message
            was:
          </p>
          <ErrorText as='p'>{history.lastError.message}</ErrorText>
        </>
      )
    }

    if (history.mapPools.isEmpty()) {
      return <p>This matchmaking type doesn't have map pool history.</p>
    }

    return (
      <HistoryContainer>
        <thead>
          <tr>
            <th>Info</th>
            <th>Maps</th>
          </tr>
        </thead>
        <tbody>
          {history.mapPools.map(id => (
            <MapPoolHistoryRow
              key={id}
              mapPool={history.byId.get(id)}
              onUseAsTemplate={() => this.props.onUseAsTemplate(id)}
              onDelete={() => this.props.onDelete(id)}
            />
          ))}
        </tbody>
      </HistoryContainer>
    )
  }
}

@connect(state => ({ mapPools: state.adminMapPools }))
export default class MapPools extends React.Component {
  state = {
    activeTab: MatchmakingType.Match1v1,
    initialMaps: new List(),
  }

  componentDidMount() {
    this.props.dispatch(getMapPoolHistory(this.state.activeTab, MAP_POOLS_LIMIT, 0))
  }

  componentDidUpdate(prevProps, prevState) {
    const { activeTab: oldTab } = prevState
    const { activeTab: newTab } = this.state

    if (oldTab !== newTab) {
      this.props.dispatch(getMapPoolHistory(newTab, MAP_POOLS_LIMIT, 0))
    }
  }

  render() {
    const { mapPools } = this.props
    const { activeTab, initialMaps } = this.state
    const mapPoolHistory = mapPools.types.get(activeTab)

    return (
      <Container>
        <StyledTabs activeTab={activeTab} onChange={this.onTabChange}>
          {ALL_MATCHMAKING_TYPES.map(type => (
            <TabItem key={type} text={matchmakingTypeToLabel(type)} value={type} />
          ))}
        </StyledTabs>
        <h3>Create a new map pool</h3>
        <MapPoolEditor
          initialMaps={initialMaps}
          searchResult={mapPools.searchResult}
          onSearchClick={this.onSearchClick}
          onLoadMoreMaps={this.onLoadMoreMaps}
          onCreate={this.onCreateNewMapPool}
          hasVetoes={hasVetoes(activeTab)}
        />
        <h3>Map pool history</h3>
        <MapPoolHistory
          history={mapPoolHistory}
          onUseAsTemplate={this.onUseAsTemplate}
          onDelete={this.onDeleteMapPool}
        />
      </Container>
    )
  }

  onTabChange = value => {
    this.setState({ activeTab: value })
  }

  onSearchClick = () => {
    // Just need to clear the search results, and `onLoadMoreMaps` will be called to actually fetch
    // the maps
    this.props.dispatch(clearSearch())
  }

  onLoadMoreMaps = (searchQuery, page) => {
    // Only official maps should be used in matchmaking map pools
    this.props.dispatch(searchMaps(MapVisibility.Official, SEARCH_MAPS_LIMIT, page, searchQuery))
  }

  onCreateNewMapPool = (maps, maxVetoCount, startDate) => {
    this.props.dispatch(createMapPool(this.state.activeTab, maps, maxVetoCount, startDate))
  }

  onUseAsTemplate = id => {
    const mapPoolHistory = this.props.mapPools.types.get(this.state.activeTab)
    const mapPool = mapPoolHistory.byId.get(id)

    if (!mapPool) return

    this.setState({ initialMaps: mapPool.maps })
  }

  onDeleteMapPool = id => {
    this.props.dispatch(deleteMapPool(this.state.activeTab, id))
  }
}
