import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import {
  ALL_MAP_SORT_TYPES,
  ALL_TILESETS,
  MapSortType,
  mapSortTypeToLabel,
  NumPlayers,
  Tileset,
  tilesetToName,
} from '../../common/maps'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import { IconButton, TextButton } from '../material/button'
import { CheckBox } from '../material/check-box'
import { fastOutSlowInShort } from '../material/curves'
import { FloatingActionButton } from '../material/floating-action-button'
import { MenuList } from '../material/menu/menu'
import { SelectableMenuItem } from '../material/menu/selectable-item'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { useImmerState } from '../react/state-hooks'
import { SearchInput } from '../search/search-input'
import { labelMedium } from '../styles/typography'
import { ALL_MAP_THUMBNAIL_SIZES, MapThumbnailSize, thumbnailSizeToLabel } from './thumbnail-size'

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

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

const FilterOverlayContents = styled.div`
  position: relative;
  min-width: 288px;
  padding: 0 16px 4px;
`

function FilterOverlay({ children, onApply }: { children: React.ReactNode; onApply: () => void }) {
  useKeyListener({
    onKeyDown(event: KeyboardEvent) {
      if (event.code === ENTER || event.code === ENTER_NUMPAD) {
        onApply()
        return true
      }

      return false
    },
  })

  return <FilterOverlayContents>{children}</FilterOverlayContents>
}

const SectionOverline = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
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

export interface BrowserFooterProps {
  thumbnailSize: MapThumbnailSize
  sortOption: number
  numPlayersFilter: Set<NumPlayers>
  tilesetFilter: Set<Tileset>
  searchQuery: string
  onSizeChange: (size: MapThumbnailSize) => void
  onFilterApply: (
    numPlayersFilter: ReadonlyDeep<Set<NumPlayers>>,
    tilesetFilter: ReadonlyDeep<Set<Tileset>>,
  ) => void
  onSortChange: (sortType: MapSortType) => void
  onSearchChange: (value: string) => void
  onBrowseLocalMaps?: () => void
}

export function BrowserFooter({
  thumbnailSize,
  sortOption,
  numPlayersFilter,
  tilesetFilter,
  searchQuery,
  onSizeChange,
  onFilterApply,
  onSearchChange,
  onSortChange,
  onBrowseLocalMaps,
}: BrowserFooterProps) {
  const { t } = useTranslation()
  const [localNumPlayersFilter, updateLocalNumPlayersFilter] = useImmerState(
    () => new Set(numPlayersFilter),
  )
  const [localTilesetFilter, updateLocalTilesetFilter] = useImmerState(() => new Set(tilesetFilter))

  const [filterButtonRef, filterAnchorX, filterAnchorY, refreshFilterPos] = useRefAnchorPosition(
    'right',
    'bottom',
  )
  const [sizeRef, sizeAnchorX, sizeAnchorY, refreshSizePos] = useRefAnchorPosition(
    'right',
    'bottom',
  )
  const [sortMenuRef, sortAnchorX, sortAnchorY, refreshSortPos] = useRefAnchorPosition(
    'right',
    'bottom',
  )

  const [filterOverlayOpen, openFilterOverlay, closeFilterOverlay] = usePopoverController({
    refreshAnchorPos: refreshFilterPos,
  })
  const [sizeMenuOpen, openSizeMenu, closeSizeMenu] = usePopoverController({
    refreshAnchorPos: refreshSizePos,
  })
  const [sortMenuOpen, openSortMenu, closeSortMenu] = usePopoverController({
    refreshAnchorPos: refreshSortPos,
  })

  // TODO(tec27): The overlays menus should probably return focus to the button that opens them, so
  // that keyboard navigation of this interface is reasonably possible
  return (
    <Container>
      {onBrowseLocalMaps ? (
        <PositionedFloatingActionButton
          title={t('maps.server.browseLocal', 'Browse local maps')}
          icon={<MaterialIcon icon='folder' invertColor={true} filled={false} />}
          onClick={onBrowseLocalMaps}
        />
      ) : undefined}
      <LeftActions>
        <ActionButton
          ref={sizeRef}
          icon={<MaterialIcon icon='view_list' />}
          title={t('maps.server.thumbnailSize.title', 'Thumbnail size')}
          onClick={openSizeMenu}
        />
        <ActionButton
          ref={filterButtonRef}
          icon={<MaterialIcon icon='filter_list' />}
          title={t('maps.server.filterOptions.title', 'Filter options')}
          onClick={event => {
            // Ensure that our local state is in sync with our current props
            updateLocalNumPlayersFilter(() => new Set(numPlayersFilter))
            updateLocalTilesetFilter(() => new Set(tilesetFilter))
            openFilterOverlay(event)
          }}
        />
        <ActionButton
          ref={sortMenuRef}
          icon={<MaterialIcon icon='sort_by_alpha' />}
          title={t('maps.server.sortMaps.title', 'Sort maps')}
          onClick={openSortMenu}
        />
      </LeftActions>

      <StyledSearchInput searchQuery={searchQuery} onSearchChange={onSearchChange} />

      <Popover
        open={sizeMenuOpen}
        onDismiss={closeSizeMenu}
        anchorX={sizeAnchorX ?? 0}
        anchorY={sizeAnchorY ?? 0}
        originX='right'
        originY='bottom'>
        <MenuList dense={true}>
          {ALL_MAP_THUMBNAIL_SIZES.map(size => (
            <SelectableMenuItem
              key={size}
              text={thumbnailSizeToLabel(size, t)}
              selected={thumbnailSize === size}
              onClick={() =>
                (size => {
                  onSizeChange(size)
                  closeSizeMenu()
                })(size)
              }
            />
          ))}
        </MenuList>
      </Popover>

      <Popover
        open={filterOverlayOpen}
        onDismiss={closeFilterOverlay}
        anchorX={filterAnchorX ?? 0}
        anchorY={filterAnchorY ?? 0}
        originX='right'
        originY='bottom'>
        <FilterOverlay
          onApply={() => {
            onFilterApply(localNumPlayersFilter, localTilesetFilter)
            closeFilterOverlay()
          }}>
          <SectionOverline>
            {t('maps.server.filterOptions.section.numberOfPlayers', 'Number of players')}
          </SectionOverline>
          <ColumnGroup>
            {([2, 3, 4, 5, 6, 7, 8] as NumPlayers[]).map((numPlayers: NumPlayers) => (
              <CheckBox
                key={numPlayers}
                label={t('maps.server.filterOptions.numberOfPlayers', '{{numPlayers}} players', {
                  numPlayers,
                })}
                checked={localNumPlayersFilter.has(numPlayers)}
                onChange={event => {
                  updateLocalNumPlayersFilter(value => {
                    if (event.target.checked) {
                      value.add(numPlayers)
                    } else {
                      value.delete(numPlayers)
                    }
                  })
                }}
              />
            ))}
          </ColumnGroup>
          <SectionOverline>
            {t('maps.server.filterOptions.section.tileset', 'Tileset')}
          </SectionOverline>
          <ColumnGroup>
            {ALL_TILESETS.map(tilesetId => (
              <CheckBox
                key={tilesetId}
                label={tilesetToName(tilesetId, t)}
                checked={localTilesetFilter.has(tilesetId)}
                onChange={event => {
                  updateLocalTilesetFilter(value => {
                    if (event.target.checked) {
                      value.add(tilesetId)
                    } else {
                      value.delete(tilesetId)
                    }
                  })
                }}
              />
            ))}
          </ColumnGroup>
          <FilterActions>
            <TextButton label={t('common.actions.cancel', 'Cancel')} onClick={closeFilterOverlay} />
            <TextButton
              label={t('common.actions.apply', 'Apply')}
              onClick={() => {
                onFilterApply(localNumPlayersFilter, localTilesetFilter)
                closeFilterOverlay()
              }}
            />
          </FilterActions>
        </FilterOverlay>
      </Popover>

      <Popover
        open={sortMenuOpen}
        onDismiss={closeSortMenu}
        anchorX={sortAnchorX ?? 0}
        anchorY={sortAnchorY ?? 0}
        originX='right'
        originY='bottom'>
        <MenuList dense={true}>
          {ALL_MAP_SORT_TYPES.map(sortType => {
            return (
              <SelectableMenuItem
                key={sortType}
                text={mapSortTypeToLabel(sortType, t)}
                selected={sortOption === sortType}
                onClick={() => {
                  onSortChange(sortType)
                  closeSortMenu()
                }}
              />
            )
          })}
        </MenuList>
      </Popover>
    </Container>
  )
}
