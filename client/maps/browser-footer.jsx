import React from 'react'
import PropTypes from 'prop-types'
import { Set } from 'immutable'
import { CSSTransition } from 'react-transition-group'
import styled from 'styled-components'

import CheckBox from '../material/check-box.jsx'
import FlatButton from '../material/flat-button.jsx'
import FloatingActionButton from '../material/floating-action-button.jsx'
import IconButton from '../material/icon-button.jsx'
import KeyListener from '../keyboard/key-listener.jsx'
import { Label } from '../material/button.jsx'
import Menu from '../material/menu/menu.jsx'
import Popover from '../material/popover.jsx'
import SelectedMenuItem from '../material/menu/selected-item.jsx'
import TextField from '../material/text-field.jsx'

import FilterIcon from '../icons/material/baseline-filter_list-24px.svg'
import FolderIcon from '../icons/material/baseline-folder_open-24px.svg'
import SearchIcon from '../icons/material/baseline-search-24px.svg'
import SizeIcon from '../icons/material/baseline-view_list-24px.svg'
import SortIcon from '../icons/material/baseline-sort_by_alpha-24px.svg'

import { MAP_UPLOADING } from '../../common/flags'

import { fastOutSlowInShort } from '../material/curves'
import { colorTextSecondary } from '../styles/colors.ts'
import { Subheading } from '../styles/typography'

const transitionNames = {
  appear: 'enter',
  appearActive: 'enterActive',
  enter: 'enter',
  enterActive: 'enterActive',
  exit: 'exit',
  exitActive: 'exitActive',
}

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'
const ESCAPE = 'Escape'
const F = 'KeyF'

const Container = styled.div`
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
  & ${Label} {
    color: ${colorTextSecondary};
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

const FilterOverlayContents = styled.div`
  position: relative;
  min-width: 288px;
  padding: 0 16px 4px;

  &.enter {
    opacity: 0;
  }

  &.enterActive {
    opacity: 1;
    transition-property: opacity;
    transition-duration: ${props => props.transitionDuration}ms;
    transition-timing-function: linear;
    transition-delay: ${props => props.transitionDelay}ms;
  }

  &.exit {
    opacity: 1;
  }

  &.exitActive {
    opacity: 0;
    transition-property: opacity;
    transition-duration: ${props => props.transitionDuration}ms;
    transition-timing-function: linear;
  }
`

const MainFocus = styled.span`
  &:focus {
    outline: none;
  }
`

const Overline = styled(Subheading)`
  color: ${colorTextSecondary};
`

const ColumnGroup = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-column-gap: 16px;
`

const FilterActions = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
`

const SearchInput = styled(TextField)`
  width: ${props => (props.isFocused ? '250px' : '200px')};
  ${fastOutSlowInShort};
`

class FilterOverlay extends React.Component {
  static propTypes = {
    open: PropTypes.bool.isRequired,
    onDismiss: PropTypes.func.isRequired,
    onApply: PropTypes.func.isRequired,
    anchor: PropTypes.object,
  }

  _focusable = React.createRef()

  render() {
    const { children, open, onDismiss, anchor } = this.props

    return (
      <Popover
        open={open}
        onDismiss={onDismiss}
        anchor={anchor}
        anchorOriginVertical='bottom'
        anchorOriginHorizontal='right'
        popoverOriginVertical='bottom'
        popoverOriginHorizontal='right'>
        {(state, timings) => {
          const { openDelay, openDuration, closeDuration } = timings
          let transitionDuration = 0
          let transitionDelay = 0
          if (state === 'opening') {
            transitionDuration = openDuration
            transitionDelay = openDelay
          } else if (state === 'opened') {
            transitionDuration = closeDuration
          }

          return (
            <>
              <KeyListener onKeyDown={this.onKeyDown} />
              <span key='topFocus' tabIndex={0} onFocus={this.onFocusTrap} />
              <MainFocus key='mainFocus' ref={this._focusable} tabIndex={-1}>
                <CSSTransition
                  in={state === 'opening' || state === 'opened'}
                  classNames={transitionNames}
                  appear={true}
                  timeout={{ appear: openDuration, enter: openDuration, exit: closeDuration }}>
                  <FilterOverlayContents
                    key={'contents'}
                    transitionDuration={transitionDuration}
                    transitionDelay={transitionDelay}>
                    {children}
                  </FilterOverlayContents>
                </CSSTransition>
              </MainFocus>
              <span key='bottomFocus' tabIndex={0} onFocus={this.onFocusTrap} />
            </>
          )
        }}
      </Popover>
    )
  }

  onKeyDown = event => {
    if (event.code === ESCAPE) {
      // Set focus back to element that opens the overlay
      this.props.anchor.focus()
      this.props.onDismiss()
      return true
    } else if (event.code === ENTER || event.code === ENTER_NUMPAD) {
      // Set focus back to element that opens the overlay
      this.props.anchor.focus()
      this.props.onApply()
      return true
    }

    return false
  }

  onFocusTrap = () => {
    // Focus was about to leave the filter overlay, redirect it back to the overlay
    this._focusable.current.focus()
  }
}

// This has to be a pure component to prevent re-rendering when the map browser updates some of its
// state unrelated to this component. Not making it pure can mess with the rendering of the popover
// component which is defined here; specifically, it can cancel the CSS transition at weird times.
export default class BrowserFooter extends React.PureComponent {
  static propTypes = {
    thumbnailSize: PropTypes.number.isRequired,
    sortOption: PropTypes.number.isRequired,
    numPlayersFilter: PropTypes.instanceOf(Set).isRequired,
    tilesetFilter: PropTypes.instanceOf(Set).isRequired,
    searchQuery: PropTypes.string.isRequired,
    onBrowseLocalMaps: PropTypes.func.isRequired,
    onSizeChange: PropTypes.func.isRequired,
    onFilterApply: PropTypes.func.isRequired,
    onSortChange: PropTypes.func.isRequired,
    onSearchChange: PropTypes.func.isRequired,
  }

  state = {
    open: false,
    tempNumPlayersFilter: new Set(this.props.numPlayersFilter),
    tempTilesetFilter: new Set(this.props.tilesetFilter),
    searchFocused: false,
  }

  _sizeButtonRef = React.createRef()
  _filterButtonRef = React.createRef()
  _sortButtonRef = React.createRef()
  _filterApplyButtonRef = React.createRef()
  _searchInputRef = React.createRef()

  componentDidUpdate(prevProps, prevState) {
    if (!prevState.open && this.state.open === 'filterOverlay') {
      Promise.resolve().then(() => this._filterApplyButtonRef.current.focus())
    }
  }

  render() {
    const { thumbnailSize, sortOption, searchQuery, onBrowseLocalMaps } = this.props
    const { open, tempNumPlayersFilter, tempTilesetFilter, searchFocused } = this.state

    const numPlayersItems = [
      [2, '2 players'],
      [3, '3 players'],
      [4, '4 players'],
      [5, '5 players'],
      [6, '6 players'],
      [7, '7 players'],
      [8, '8 players'],
    ].map(([numPlayers, label]) => (
      <CheckBox
        key={numPlayers}
        label={label}
        checked={tempNumPlayersFilter.has(numPlayers)}
        onChange={() => this.onNumPlayersFilterChange(numPlayers)}
      />
    ))

    const tilesetItems = [
      [0, 'Badlands'],
      [1, 'Space platform'],
      [2, 'Installation'],
      [3, 'Ashworld'],
      [4, 'Jungle world'],
      [5, 'Desert'],
      [6, 'Ice'],
      [7, 'Twilight'],
    ].map(([tilesetId, label]) => (
      <CheckBox
        key={tilesetId}
        label={label}
        checked={tempTilesetFilter.has(tilesetId)}
        onChange={() => this.onTilesetFilterChange(tilesetId)}
      />
    ))

    return (
      <Container>
        <KeyListener onKeyDown={this.onKeyDown} />
        {MAP_UPLOADING ? (
          <PositionedFloatingActionButton
            title='Browse local maps'
            icon={<FolderIcon />}
            onClick={onBrowseLocalMaps}
          />
        ) : null}
        <LeftActions>
          <ActionButton
            buttonRef={this._sizeButtonRef}
            icon={<SizeIcon />}
            title='Thumbnail size'
            onClick={this.onSizeMenuOpen}
          />
          <ActionButton
            buttonRef={this._filterButtonRef}
            icon={<FilterIcon />}
            title='Filter options'
            onClick={this.onFilterOverlayOpen}
          />
          <ActionButton
            buttonRef={this._sortButtonRef}
            icon={<SortIcon />}
            title='Sort maps'
            onClick={this.onSortMenuOpen}
          />
        </LeftActions>
        <SearchInput
          ref={this._searchInputRef}
          value={searchQuery}
          label='Search'
          dense={true}
          allowErrors={false}
          isFocused={searchFocused}
          onChange={this.onSearchChange}
          onFocus={this.onSearchFocus}
          onBlur={this.onSearchBlur}
          leadingIcons={[<SearchIcon />]}
        />

        <Menu
          open={open === 'sizeMenu'}
          onDismiss={this.onDismiss}
          anchor={this._sizeButtonRef.current}
          anchorOriginVertical='bottom'
          anchorOriginHorizontal='right'
          popoverOriginVertical='bottom'
          popoverOriginHorizontal='right'
          dense={true}
          selectedIndex={thumbnailSize}
          onItemSelected={this.onSizeSelected}>
          <SelectedMenuItem text='Small' />
          <SelectedMenuItem text='Medium' />
          <SelectedMenuItem text='Large' />
        </Menu>
        <FilterOverlay
          open={open === 'filterOverlay'}
          onDismiss={this.onDismiss}
          onApply={this.onFilterApply}
          anchor={this._filterButtonRef.current}>
          <Overline>Number of players</Overline>
          <ColumnGroup>{numPlayersItems}</ColumnGroup>
          <Overline>Tileset</Overline>
          <ColumnGroup>{tilesetItems}</ColumnGroup>
          <FilterActions>
            <FlatButton label='Cancel' color='accent' onClick={this.onFilterCancel} />
            <FlatButton
              ref={this._filterApplyButtonRef}
              label='Apply'
              color='accent'
              onClick={this.onFilterApply}
            />
          </FilterActions>
        </FilterOverlay>
        <Menu
          open={open === 'sortMenu'}
          onDismiss={this.onDismiss}
          anchor={this._sortButtonRef.current}
          anchorOriginVertical='bottom'
          anchorOriginHorizontal='right'
          popoverOriginVertical='bottom'
          popoverOriginHorizontal='right'
          dense={true}
          selectedIndex={sortOption}
          onItemSelected={this.onSortSelected}>
          <SelectedMenuItem text='Name' />
          <SelectedMenuItem text='Number of players' />
          <SelectedMenuItem text='Date uploaded' />
        </Menu>
      </Container>
    )
  }

  onDismiss = () => {
    this.setState({ open: false })
  }

  onSizeMenuOpen = () => {
    this.setState({ open: 'sizeMenu' })
  }

  onFilterOverlayOpen = () => {
    this.setState({ open: 'filterOverlay' })
  }

  onSortMenuOpen = () => {
    this.setState({ open: 'sortMenu' })
  }

  onSizeSelected = index => {
    this.props.onSizeChange(index)
    this.onDismiss()
  }

  onSortSelected = index => {
    this.props.onSortChange(index)
    this.onDismiss()
  }

  onNumPlayersFilterChange = numPlayers => {
    const { tempNumPlayersFilter } = this.state

    this.setState({
      tempNumPlayersFilter: tempNumPlayersFilter.has(numPlayers)
        ? tempNumPlayersFilter.delete(numPlayers)
        : tempNumPlayersFilter.add(numPlayers),
    })
  }

  onTilesetFilterChange = tilesetId => {
    const { tempTilesetFilter } = this.state

    this.setState({
      tempTilesetFilter: tempTilesetFilter.has(tilesetId)
        ? tempTilesetFilter.delete(tilesetId)
        : tempTilesetFilter.add(tilesetId),
    })
  }

  onFilterCancel = () => {
    // Since the filter overlay doesn't get unmounted after it's closed, we need to reset the
    // temporary filter state to its initial value manually.
    this.setState({
      tempNumPlayersFilter: new Set(this.props.numPlayersFilter),
      tempTilesetFilter: new Set(this.props.tilesetFilter),
    })
    this.onDismiss()
  }

  onFilterApply = () => {
    const { tempNumPlayersFilter, tempTilesetFilter } = this.state

    this.props.onFilterApply(tempNumPlayersFilter, tempTilesetFilter)
    this.onDismiss()
  }

  onSearchChange = event => {
    this.props.onSearchChange(event.target.value)
  }

  onSearchFocus = () => {
    this.setState({ searchFocused: true })
  }

  onSearchBlur = () => {
    this.setState({ searchFocused: false })
  }

  onKeyDown = event => {
    if (event.code === F && event.ctrlKey) {
      this._searchInputRef.current.focus()
      return true
    } else if (event.code === ESCAPE && this.state.searchFocused) {
      this._searchInputRef.current.blur()
      return true
    }

    return false
  }
}
