import { Set } from 'immutable'
import PropTypes from 'prop-types'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CSSTransition } from 'react-transition-group'
import styled from 'styled-components'
import { ALL_TILESETS, tilesetToName } from '../../common/maps'
import FilterIcon from '../icons/material/baseline-filter_list-24px.svg'
import FolderIcon from '../icons/material/baseline-folder_open-24px.svg'
import SortIcon from '../icons/material/baseline-sort_by_alpha-24px.svg'
import SizeIcon from '../icons/material/baseline-view_list-24px.svg'
import KeyListener from '../keyboard/key-listener'
import { IconButton, TextButton } from '../material/button'
import CheckBox from '../material/check-box'
import { fastOutSlowInShort } from '../material/curves'
import { FloatingActionButton } from '../material/floating-action-button'
import { LegacyPopover } from '../material/legacy-popover'
import { Menu } from '../material/menu/menu'
import { SelectedItem as SelectedMenuItem } from '../material/menu/selected-item'
import { useAnchorPosition } from '../material/popover'
import { SearchInput } from '../search/search-input'
import { usePrevious, useValueAsRef } from '../state-hooks'
import { colorTextSecondary } from '../styles/colors'
import { overline } from '../styles/typography'

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
  ${LeftActions} > & {
    margin-right: 8px;
  }
`

const PositionedFloatingActionButton = styled(FloatingActionButton)`
  position: absolute;
  top: -28px;
  left: calc(50% - 28px);
`

const StyledSearchInput = styled(SearchInput)`
  width: 200px;
  ${fastOutSlowInShort};

  &:focus-within {
    width: 256px;
  }
`

const FilterOverlayContents = styled.div<{ transitionDuration: number; transitionDelay: number }>`
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

const SectionOverline = styled.div`
  ${overline};
  color: ${colorTextSecondary};
  margin-top: 8px;
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

interface FilterOverlayProps {
  open: boolean
  onDismiss: () => void
  onApply: () => void
  anchor: any
  children?: React.ReactNode
}

class FilterOverlay extends React.Component<FilterOverlayProps> {
  static propTypes = {
    open: PropTypes.bool.isRequired,
    onDismiss: PropTypes.func.isRequired,
    onApply: PropTypes.func.isRequired,
    anchor: PropTypes.object,
  }

  private focusable = React.createRef<HTMLSpanElement>()

  override render() {
    const { children, open, onDismiss, anchor } = this.props

    return (
      <LegacyPopover
        open={open}
        onDismiss={onDismiss}
        anchor={anchor}
        anchorOriginVertical='bottom'
        anchorOriginHorizontal='right'
        popoverOriginVertical='bottom'
        popoverOriginHorizontal='right'>
        {(state: any, timings: any) => {
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
              <MainFocus key='mainFocus' ref={this.focusable} tabIndex={-1}>
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
      </LegacyPopover>
    )
  }

  onKeyDown = (event: KeyboardEvent) => {
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
    this.focusable.current?.focus()
  }
}

export interface BrowserFooterProps {
  thumbnailSize: number
  sortOption: number
  numPlayersFilter: Set<number>
  tilesetFilter: Set<number>
  searchQuery: string
  onBrowseLocalMaps: () => void
  onSizeChange: (index: number) => void
  onFilterApply: (numPlayersFilter: Set<number>, tilesetFilter: Set<number>) => void
  onSortChange: (index: number) => void
  onSearchChange: (value: string) => void
}

type FooterView = 'filterOverlay' | 'sizeMenu' | 'sortMenu'
const SIZE_MENU_OPTIONS = ['Small', 'Medium', 'Large']
const SORT_MENU_OPTIONS = ['Name', 'Number of players', 'Date uploaded']

export const BrowserFooter = React.memo((props: BrowserFooterProps) => {
  const [open, setOpen] = useState<FooterView>()
  const [tempNumPlayersFilter, setTempNumPlayersFilter] = useState(props.numPlayersFilter)
  const [tempTilesetFilter, setTempTilesetFilter] = useState(props.tilesetFilter)

  const filterApplyButtonRef = useRef<HTMLButtonElement>(null)
  const filterButtonRef = useRef<HTMLButtonElement>(null)

  const [sizeRef, sizeAnchorX, sizeAnchorY] = useAnchorPosition('right', 'bottom')
  const [sortMenuRef, sortAnchorX, sortAnchorY] = useAnchorPosition('right', 'bottom')

  const numPlayersFilterRef = useValueAsRef(props.numPlayersFilter)
  const tilesetFilterRef = useValueAsRef(props.tilesetFilter)
  const lastOpen = usePrevious(open)

  const onDismiss = useCallback(() => {
    setOpen(undefined)
  }, [])
  const onSizeMenuOpen = useCallback(() => {
    setOpen('sizeMenu')
  }, [])
  const onFilterOverlayOpen = useCallback(() => {
    setOpen('filterOverlay')
  }, [])
  const onSortMenuOpen = useCallback(() => {
    setOpen('sortMenu')
  }, [])

  const { searchQuery, onSearchChange, onSizeChange, onSortChange, onFilterApply } = props

  const onSizeSelected = useCallback(
    (index: number) => {
      onSizeChange(index)
      onDismiss()
    },
    [onDismiss, onSizeChange],
  )
  const onSortSelected = useCallback(
    (index: number) => {
      onSortChange(index)
      onDismiss()
    },
    [onDismiss, onSortChange],
  )
  const onNumPlayersFilterChange = useCallback((numPlayers: number) => {
    setTempNumPlayersFilter(value =>
      value.has(numPlayers) ? value.delete(numPlayers) : value.add(numPlayers),
    )
  }, [])
  const onTilesetFilterChange = useCallback((tilesetId: number) => {
    setTempTilesetFilter(value =>
      value.has(tilesetId) ? value.delete(tilesetId) : value.add(tilesetId),
    )
  }, [])
  const onFilterCancel = useCallback(() => {
    // Since the filter overlay doesn't get unmounted after it's closed, we need to reset the
    // temporary filter state to its initial value manually.
    setTempNumPlayersFilter(numPlayersFilterRef.current)
    setTempTilesetFilter(tilesetFilterRef.current)
    onDismiss()
  }, [onDismiss, numPlayersFilterRef, tilesetFilterRef])
  const forwardOnFilterApply = useCallback(() => {
    onFilterApply(tempNumPlayersFilter, tempTilesetFilter)
    onDismiss()
  }, [tempNumPlayersFilter, tempTilesetFilter, onFilterApply, onDismiss])

  const numPlayersItems = useMemo(() => {
    const values: Array<[n: number, label: string]> = [
      [2, '2 players'],
      [3, '3 players'],
      [4, '4 players'],
      [5, '5 players'],
      [6, '6 players'],
      [7, '7 players'],
      [8, '8 players'],
    ]

    return values.map(([numPlayers, label]) => (
      <CheckBox
        key={numPlayers}
        label={label}
        checked={tempNumPlayersFilter.has(numPlayers)}
        onChange={() => onNumPlayersFilterChange(numPlayers)}
      />
    ))
  }, [tempNumPlayersFilter, onNumPlayersFilterChange])
  const tilesetItems = useMemo(() => {
    return ALL_TILESETS.map(tilesetId => (
      <CheckBox
        key={tilesetId}
        label={tilesetToName(tilesetId)}
        checked={tempTilesetFilter.has(tilesetId)}
        onChange={() => onTilesetFilterChange(tilesetId)}
      />
    ))
  }, [tempTilesetFilter, onTilesetFilterChange])

  useEffect(() => {
    if (!lastOpen && open === 'filterOverlay') {
      Promise.resolve().then(() => filterApplyButtonRef.current?.focus())
    }
  }, [lastOpen, open])

  return (
    <Container>
      <PositionedFloatingActionButton
        title='Browse local maps'
        icon={<FolderIcon />}
        onClick={props.onBrowseLocalMaps}
      />
      <LeftActions>
        <ActionButton
          ref={sizeRef}
          icon={<SizeIcon />}
          title='Thumbnail size'
          onClick={onSizeMenuOpen}
        />
        <ActionButton
          ref={filterButtonRef}
          icon={<FilterIcon />}
          title='Filter options'
          onClick={onFilterOverlayOpen}
        />
        <ActionButton
          ref={sortMenuRef}
          icon={<SortIcon />}
          title='Sort maps'
          onClick={onSortMenuOpen}
        />
      </LeftActions>

      <StyledSearchInput searchQuery={searchQuery} onSearchChange={onSearchChange} />

      <Menu
        dense={true}
        popoverProps={{
          open: open === 'sizeMenu',
          onDismiss,
          anchorX: sizeAnchorX ?? 0,
          anchorY: sizeAnchorY ?? 0,
          originX: 'right',
          originY: 'bottom',
        }}>
        {SIZE_MENU_OPTIONS.map((text, index) => (
          <SelectedMenuItem
            key={index}
            text={text}
            selected={props.thumbnailSize === index}
            onClick={() => onSizeSelected(index)}
          />
        ))}
      </Menu>
      <FilterOverlay
        open={open === 'filterOverlay'}
        onDismiss={onDismiss}
        onApply={forwardOnFilterApply}
        anchor={filterButtonRef.current}>
        <SectionOverline>Number of players</SectionOverline>
        <ColumnGroup>{numPlayersItems}</ColumnGroup>
        <SectionOverline>Tileset</SectionOverline>
        <ColumnGroup>{tilesetItems}</ColumnGroup>
        <FilterActions>
          <TextButton label='Cancel' color='accent' onClick={onFilterCancel} />
          <TextButton
            ref={filterApplyButtonRef}
            label='Apply'
            color='accent'
            onClick={forwardOnFilterApply}
          />
        </FilterActions>
      </FilterOverlay>
      <Menu
        dense={true}
        popoverProps={{
          open: open === 'sortMenu',
          onDismiss,
          anchorX: sortAnchorX ?? 0,
          anchorY: sortAnchorY ?? 0,
          originX: 'right',
          originY: 'bottom',
        }}>
        {SORT_MENU_OPTIONS.map((text, index) => (
          <SelectedMenuItem
            key={index}
            text={text}
            selected={props.sortOption === index}
            onClick={() => onSortSelected(index)}
          />
        ))}
      </Menu>
    </Container>
  )
})
