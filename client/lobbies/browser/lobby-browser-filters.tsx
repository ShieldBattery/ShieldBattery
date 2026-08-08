import { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ALL_GAME_TYPES, GameType, gameTypeToLabel } from '../../../common/games/game-type'
import { MaterialIcon } from '../../icons/material/material-icon'
import { TextButton } from '../../material/button'
import { FilterChip } from '../../material/filter-chip'
import { SelectableMenuItem } from '../../material/menu/selectable-item'
import { useUserLocalStorageValue } from '../../react/state-hooks'
import { SearchInput } from '../../search/search-input'
import { FlexSpacer } from '../../styles/flex-spacer'
import { ALL_LOBBY_BROWSER_SORTS, LobbyBrowserSort } from './summary-utils'

/** The filter choices the browser remembers between visits. */
export interface PersistedLobbyFilters {
  /** The one game type being shown, or undefined for all of them. */
  gameType?: GameType
  /** Show only lobbies a friend is already in. */
  friendsOnly: boolean
  /** Show lobbies with nothing open, which are hidden by default. */
  showFull: boolean
}

const DEFAULT_FILTERS: PersistedLobbyFilters = {
  gameType: undefined,
  friendsOnly: false,
  showFull: false,
}

function validateFilters(value: unknown): PersistedLobbyFilters | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }

  const { gameType, friendsOnly, showFull } = value as Partial<PersistedLobbyFilters>
  return {
    gameType: ALL_GAME_TYPES.includes(gameType as GameType) ? (gameType as GameType) : undefined,
    friendsOnly: friendsOnly === true,
    showFull: showFull === true,
  }
}

function validateSort(value: unknown): LobbyBrowserSort | undefined {
  return ALL_LOBBY_BROWSER_SORTS.includes(value as LobbyBrowserSort)
    ? (value as LobbyBrowserSort)
    : undefined
}

function getSortLabel(sort: LobbyBrowserSort, t: TFunction): string {
  switch (sort) {
    case LobbyBrowserSort.Newest:
      return t('lobbies.browser.sortNewest', 'Newest')
    case LobbyBrowserSort.MostPlayers:
      return t('lobbies.browser.sortMostPlayers', 'Most players')
    case LobbyBrowserSort.OpenSlots:
      return t('lobbies.browser.sortOpenSlots', 'Open slots')
    default:
      return sort satisfies never
  }
}

/** Everything the browser's filter bar controls, plus what the list needs to apply it. */
export interface LobbyBrowserFilterState {
  gameType?: GameType
  friendsOnly: boolean
  showFull: boolean
  sort: LobbyBrowserSort
  searchQuery: string
  /** Whether anything narrows the list right now. Sort isn't a filter and never counts. */
  hasActiveFilters: boolean
  setGameType: (value: GameType | undefined) => void
  setFriendsOnly: (value: boolean) => void
  setShowFull: (value: boolean) => void
  setSort: (value: LobbyBrowserSort) => void
  setSearchQuery: (value: string) => void
  clearFilters: () => void
}

/**
 * Holds the browser's filter and sort choices. Filters and sort persist per user; the search box
 * doesn't — a query typed to find one lobby tonight shouldn't still be hiding the list tomorrow.
 */
export function useLobbyBrowserFilterState(): LobbyBrowserFilterState {
  const [filters, setFilters] = useUserLocalStorageValue<PersistedLobbyFilters>(
    'lobbies.browser.filters',
    DEFAULT_FILTERS,
    validateFilters,
  )
  const [sort, setSort] = useUserLocalStorageValue<LobbyBrowserSort>(
    'lobbies.browser.sort',
    LobbyBrowserSort.Newest,
    validateSort,
  )
  const [searchQuery, setSearchQuery] = useState('')

  return {
    gameType: filters.gameType,
    friendsOnly: filters.friendsOnly,
    showFull: filters.showFull,
    sort,
    searchQuery,
    hasActiveFilters:
      filters.gameType !== undefined || filters.friendsOnly || filters.showFull || !!searchQuery,
    setGameType: value => setFilters({ ...filters, gameType: value }),
    setFriendsOnly: value => setFilters({ ...filters, friendsOnly: value }),
    setShowFull: value => setFilters({ ...filters, showFull: value }),
    setSort,
    setSearchQuery,
    clearFilters: () => {
      setFilters(DEFAULT_FILTERS)
      setSearchQuery('')
    },
  }
}

const BarRoot = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  min-height: 40px;
`

const BarSearchInput = styled(SearchInput)`
  width: 280px;
  flex-shrink: 0;
`

/**
 * The row of controls above the lobby list: a search box, the chips that narrow what's listed, and
 * — pushed to the far edge, since it changes order rather than membership — the sort chip.
 */
export function LobbyBrowserFilters({
  filterState,
  className,
}: {
  filterState: LobbyBrowserFilterState
  className?: string
}) {
  const { t } = useTranslation()
  const {
    gameType,
    friendsOnly,
    showFull,
    sort,
    searchQuery,
    hasActiveFilters,
    setGameType,
    setFriendsOnly,
    setShowFull,
    setSort,
    setSearchQuery,
    clearFilters,
  } = filterState

  return (
    <BarRoot className={className}>
      <BarSearchInput searchQuery={searchQuery} onSearchChange={setSearchQuery} />

      <FilterChip
        label={
          gameType !== undefined
            ? gameTypeToLabel(gameType, t)
            : t('lobbies.browser.filterGameType', 'Game type')
        }
        selected={gameType !== undefined}>
        <SelectableMenuItem
          text={t('lobbies.browser.filterGameTypeAll', 'All game types')}
          selected={gameType === undefined}
          onClick={() => setGameType(undefined)}
        />
        {ALL_GAME_TYPES.map(type => (
          <SelectableMenuItem
            key={type}
            text={gameTypeToLabel(type, t)}
            selected={gameType === type}
            onClick={() => setGameType(type)}
          />
        ))}
      </FilterChip>

      <FilterChip
        label={t('lobbies.browser.filterFriends', 'Friends')}
        icon={<MaterialIcon icon='group' size={18} />}
        selected={friendsOnly}
        onClick={() => setFriendsOnly(!friendsOnly)}
      />

      <FilterChip
        label={t('lobbies.browser.filterShowFull', 'Show full')}
        icon={<MaterialIcon icon='groups' size={18} />}
        selected={showFull}
        onClick={() => setShowFull(!showFull)}
      />

      {hasActiveFilters ? (
        <TextButton
          label={t('common.actions.clear', 'Clear')}
          iconStart={<MaterialIcon icon='close' />}
          onClick={clearFilters}
        />
      ) : null}

      <FlexSpacer />

      <FilterChip label={getSortLabel(sort, t)} icon={<MaterialIcon icon='sort' size={18} />}>
        {ALL_LOBBY_BROWSER_SORTS.map(option => (
          <SelectableMenuItem
            key={option}
            text={getSortLabel(option, t)}
            selected={sort === option}
            onClick={() => setSort(option)}
          />
        ))}
      </FilterChip>
    </BarRoot>
  )
}
