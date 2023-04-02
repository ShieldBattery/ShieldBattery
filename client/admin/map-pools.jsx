import { List, OrderedMap } from 'immutable'
import PropTypes from 'prop-types'
import React, { useCallback } from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { MapVisibility } from '../../common/maps'
import { MatchmakingType } from '../../common/matchmaking'
import {
  default as CheckIcon,
  default as SelectedIcon,
} from '../icons/material/check_circle-24px.svg'
import MapPoolActionsIcon from '../icons/material/more_vert-24px.svg'
import SearchIcon from '../icons/material/search-24px.svg'
import KeyListener from '../keyboard/key-listener'
import Carousel from '../lists/carousel'
import { MapThumbnail } from '../maps/map-thumbnail'
import { IconButton, RaisedButton, TextButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, useAnchorPosition, usePopoverController } from '../material/popover'
import { TabItem, Tabs } from '../material/tabs'
import { TextField } from '../material/text-field'
import LoadingIndicator from '../progress/dots'
import { colorError, colorSuccess, colorTextSecondary } from '../styles/colors'
import { body1, subtitle1 } from '../styles/typography'
import {
  clearSearch,
  createMapPool,
  deleteMapPool,
  getMapPoolHistory,
  searchMaps,
} from './action-creators'
import { useTranslation } from 'react-i18next'

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

const StyledSelectedIcon = styled(SelectedIcon)`
  path:last-child {
    stroke: #000;
  }
`

const SectionTitle = styled.div`
  ${subtitle1};
  color: ${colorTextSecondary};
`

const DateInputContainer = styled.div`
  display: flex;
  align-items: center;
`

const DateInput = styled.input`
  color: #000;
`

const InvalidDateInput = styled.div`
  ${body1};
  margin-left: 16px;
  color: ${colorError};
`

const ValidDateIcon = styled(CheckIcon)`
  color: ${colorSuccess};
  margin-left: 8px;
`

const CreatePoolButton = styled(RaisedButton)`
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
    color: ${colorTextSecondary};
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
  ${subtitle1};
  color: ${colorError};
`

export class MapPoolEditor extends React.Component {
  static propTypes = {
    initialMaps: PropTypes.instanceOf(List),
    searchResult: PropTypes.object,
    searchQuery: PropTypes.string,
    onSearchClick: PropTypes.func.isRequired,
    onLoadMoreMaps: PropTypes.func.isRequired,
    onCreate: PropTypes.func.isRequired,
  }

  state = {
    maps: new OrderedMap(),
    startDate: '',
    searchQuery: '',
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
    const { t } = useTranslation()

    if (lastError) {
      return (
        <>
          <p>{t('admin.mapPools.errorSearchingMaps', 'Something went wrong while trying to search maps. The error message was:')}</p>
          <ErrorText as='p'>{lastError.message}</ErrorText>
        </>
      )
    }

    if (total === 0) {
      return <p>{t('admin.mapPools.noResultsText', 'No results')}</p>
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
    const { t } = useTranslation()
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
            label={t('admin.mapPools.findMapLabel', 'Find a map')}
            value={searchQuery}
            allowErrors={false}
            leadingIcons={[<SearchIcon />]}
            onChange={this.onSearchChange}
            onFocus={this.onSearchFocus}
            onBlur={this.onSearchBlur}
          />
          <SearchMapsButton label={t('admin.mapPools.findLabel', 'Find')} color='accent' onClick={this.onSearchClick} />
        </SearchContainer>
        <SectionTitle>{t('admin.mapPools.searchResultsTitle', 'Search results')}</SectionTitle>
        {this.renderSearchMapsResult()}
        <SectionTitle>{t('admin.mapPools.selectedMapsTitle', 'Selected maps')}</SectionTitle>
        {selectedMaps.size > 0 ? (
          <Carousel>{selectedMaps}</Carousel>
        ) : (
          <p>{t('admin.mapPools.selectedMapsDescription', 'Use the search above to find maps and select them to be used in the map pool')}</p>
        )}
        <SectionTitle>{t('admin.mapPools.startDateTitle', 'Start date')}</SectionTitle>
        <p>{t('admin.mapPools.startDateDescription', 'Choose a date and time (in your local timezone) when the map pool will start')}</p>
        <DateInputContainer>
          <DateInput
            type='datetime-local'
            value={this.state.startDate}
            onChange={this.onStartDateChange}
          />
          {dateValidationContents}
        </DateInputContainer>
        <CreatePoolButton
          label={t('admin.mapPools.createMapPoolLabel', 'Create')}
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
    this.props.onCreate(this.state.maps.keySeq().toArray(), Date.parse(this.state.startDate))
    this.setState({ maps: new OrderedMap(), startDate: '' })
  }
}

const MapPoolHistoryRow = React.memo(props => {
  const [actionsOverlayOpen, openActionsOverlay, closeActionsOverlay] = usePopoverController()
  const [anchorRef, anchorX, anchorY] = useAnchorPosition('left', 'top')

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
    const { t } = useTranslation()
    actionsMenu = (
      <>
        <MapPoolActionButton
          icon={<MapPoolActionsIcon />}
          title={t('admin.mapPools.mapPoolActionsTitle', 'Map pool actions')}
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

MapPoolHistoryRow.propTypes = {
  mapPool: PropTypes.object.isRequired,
  onUseAsTemplate: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
}

class MapPoolHistory extends React.PureComponent {
  static propTypes = {
    history: PropTypes.object,
    onUseAsTemplate: PropTypes.func.isRequired,
    onDelete: PropTypes.func.isRequired,
  }

  render() {
    const { history } = this.props
    const { t } = useTranslation()

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
          {t('admin.mapPools.errorRetrievingMapPoolHistory', 'Something went wrong while trying to retrieve the map pool history. The error message was:')}
          </p>
          <ErrorText as='p'>{history.lastError.message}</ErrorText>
        </>
      )
    }

    if (history.mapPools.isEmpty()) {
      return <p>{t('admin.mapPools.errorMatchmakingTypeNoMapHistory', 'This matchmaking type doesn\'t have map pool history.')}</p>
    }

    return (
      <HistoryContainer>
        <thead>
          <tr>
            <th>{t('admin.mapPools.infoLabel', 'Info')}</th>
            <th>{t('admin.mapPools.mapsLabel', 'Maps')}</th>
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
    const { t } = useTranslation()

    return (
      <Container>
        <StyledTabs activeTab={activeTab} onChange={this.onTabChange}>
          <TabItem text={t('admin.mapPools.1v1Text', '1v1')} value={MatchmakingType.Match1v1} />
          <TabItem text={t('admin.mapPools.2v2Text', '2v2')} value={MatchmakingType.Match2v2} />
        </StyledTabs>
        <h3>{t('admin.mapPools.createNewMapPoolText', 'Create a new map pool')}</h3>
        <MapPoolEditor
          initialMaps={initialMaps}
          searchResult={mapPools.searchResult}
          onSearchClick={this.onSearchClick}
          onLoadMoreMaps={this.onLoadMoreMaps}
          onCreate={this.onCreateNewMapPool}
        />
        <h3>{t('admin.mapPools.mapPoolHistoryText', 'Map pool history')}</h3>
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

  onCreateNewMapPool = (maps, startDate) => {
    this.props.dispatch(createMapPool(this.state.activeTab, maps, startDate))
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
