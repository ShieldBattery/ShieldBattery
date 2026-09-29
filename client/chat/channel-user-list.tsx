import * as React from 'react'
import { useContext, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import styled, { css } from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { MaterialIcon } from '../icons/material/material-icon'
import { eatVirtuosoContext } from '../lists/eat-virtuoso-context'
import { LoadErrorRow } from '../lists/load-error-row'
import { buttonReset } from '../material/button-reset'
import { ChatContext } from '../messaging/chat-context'
import { useMentionFilterClick } from '../messaging/mention-hooks'
import { useAppSelector } from '../redux-hooks'
import { SearchInput } from '../search/search-input'
import { FriendActivityStatusLine, NameBlock, NameLine } from '../social/friend-activity-status'
import {
  bodyMedium,
  bodySmall,
  labelLarge,
  labelMedium,
  singleLine,
  titleSmall,
} from '../styles/typography'
import { LiveLabel } from '../twitch/live-indicators'
import { useLiveUserIds } from '../twitch/live-state'
import { MiniLiveStreamEntry } from '../twitch/live-stream-entry'
import { StaffBadgedAvatar } from '../users/staff-badge'
import { ConnectedUserContextMenu } from '../users/user-context-menu'
import { useUserOverlays } from '../users/user-overlays'
import { ConnectedUserProfileOverlay } from '../users/user-profile-overlay'
import { ActivityGameEntry, GameActivityEntry, LiveStreamItem } from './channel-activity'
import { ChannelRoleBadge } from './channel-role-badge'

const UserListContainer = styled.div`
  width: 256px;
  flex-grow: 0;
  flex-shrink: 0;

  display: flex;
  flex-direction: column;
  contain: content;

  background-color: var(--theme-container-low);
  --availability-dot-ring: var(--theme-container-low);
  border-radius: 8px;
`

const ErrorContainer = styled.div`
  flex-shrink: 0;
  padding: 16px 8px 8px;
`

/** Gives the virtualized roster a definite height to fill inside the column above. */
const RosterContainer = styled.div`
  flex: 1 1 0;
  min-height: 0;
`

const PaddingHeader = eatVirtuosoContext(/* */ styled.div<{ context?: unknown }>`
  width: 100%;
  height: 8px;
`)

const PaddingFooter = eatVirtuosoContext(/* */ styled.div<{ context?: unknown }>`
  width: 100%;
  height: 8px;
`)

const userListRow = css`
  ${singleLine};

  margin: 0 8px;
  padding: 0 8px;
`

const StyledAvatar = styled(StaffBadgedAvatar)`
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  margin: 2px 16px 2px 0;
`

const EntryLiveLabel = styled(LiveLabel)`
  flex-shrink: 0;
  margin-left: 8px;
`

/** Lays the roster's name line out as a row so a role badge can sit beside the name. */
const RosterNameLine = styled(NameLine)`
  display: flex;
  align-items: center;
  gap: 4px;
`

/** Takes the ellipsizing, so a long name shortens rather than pushing the badge out of the row. */
const RosterName = styled.span`
  ${singleLine};
  min-width: 0;
`

const RosterRoleBadge = styled(ChannelRoleBadge)`
  flex-shrink: 0;
`

const LoadingName = styled.div`
  width: 64px;
  height: 20px;
  margin: 8px 0;
  display: inline-block;

  background-color: var(--theme-skeleton);
  border-radius: 4px;
`

const fadedCss = css`
  color: var(--theme-on-surface-variant);
  ${StyledAvatar}, ${LoadingName} {
    opacity: var(--theme-disabled-opacity);
  }
`

interface UserListEntryItemProps {
  $isOverlayOpen?: boolean
  $faded?: boolean
}

const UserListEntryItem = styled.div<UserListEntryItemProps>`
  ${titleSmall};
  ${userListRow};
  height: 44px;
  border-radius: 4px;
  padding-top: 4px;
  padding-bottom: 4px;

  display: flex;
  align-items: center;

  &:hover {
    cursor: pointer;
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }

  ${props => {
    if (props.$isOverlayOpen) {
      return 'background-color: rgb(from var(--theme-on-surface) r g b / 0.08);'
    }
    return ''
  }}

  ${props => {
    if (props.$faded) {
      return fadedCss
    }
    return ''
  }}
`

interface UserListEntryProps {
  userId: SbUserId
  faded?: boolean
  isLive?: boolean
  style?: React.CSSProperties
}

const ConnectedUserListEntry = React.memo<UserListEntryProps>(props => {
  const { t } = useTranslation()
  const user = useAppSelector(s => s.users.byId.get(props.userId))
  const filterClick = useMentionFilterClick()
  const { UserMenu } = useContext(ChatContext)

  const { profileOverlayProps, contextMenuProps, onClick, onContextMenu, isOverlayOpen } =
    useUserOverlays({
      userId: props.userId,
      profileAnchorX: 'left',
      profileAnchorY: 'top',
      profileOriginX: 'right',
      profileOriginY: 'top',
      profileOffsetX: -4,
      filterClick,
      UserMenu,
    })

  return (
    <div style={props.style}>
      <ConnectedUserProfileOverlay {...profileOverlayProps} />
      <ConnectedUserContextMenu {...contextMenuProps} />

      <UserListEntryItem
        key='entry'
        $faded={!!props.faded}
        $isOverlayOpen={isOverlayOpen}
        onClick={onClick}
        onContextMenu={onContextMenu}>
        <StyledAvatar userId={props.userId} showAvailability={true} />
        {user ? (
          <NameBlock>
            <RosterNameLine>
              <RosterName>{user.name}</RosterName>
              <RosterRoleBadge userId={props.userId} />
            </RosterNameLine>
            <FriendActivityStatusLine userId={props.userId} />
          </NameBlock>
        ) : (
          <LoadingName aria-label={t('common.loading.username', 'Username loading…')} />
        )}
        {props.isLive ? <EntryLiveLabel /> : null}
      </UserListEntryItem>
    </div>
  )
})

type SectionKey = 'live' | 'games' | 'active' | 'offline'

/** How many games show before the rest fold behind a "Show N more" button. */
const GAMES_SHOWN = 3

enum UserListRowType {
  Header,
  Stream,
  Game,
  MoreGames,
  Active,
  Faded,
  NoMatches,
}

interface HeaderRowData {
  type: UserListRowType.Header
  section: SectionKey
  label: string
  count: number
  collapsed: boolean
}

interface StreamRowData {
  type: UserListRowType.Stream
  stream: LiveStreamItem
}

interface GameRowData {
  type: UserListRowType.Game
  entry: GameActivityEntry
}

interface MoreGamesRowData {
  type: UserListRowType.MoreGames
  /** How many games are folded away, or 0 when every game shows and the button folds them. */
  hidden: number
}

interface ActiveRowData {
  type: UserListRowType.Active
  userId: SbUserId
  isLive: boolean
}

interface FadedRowData {
  type: UserListRowType.Faded
  userId: SbUserId
  isLive: boolean
}

interface NoMatchesRowData {
  type: UserListRowType.NoMatches
}

type UserListRowData =
  | HeaderRowData
  | StreamRowData
  | GameRowData
  | MoreGamesRowData
  | ActiveRowData
  | FadedRowData
  | NoMatchesRowData

/**
 * Identifies a row by what it holds rather than by where it sits, so that entries keep their
 * component state (an open profile overlay, say) when the roster reorders around them.
 */
function computeRowKey(_index: number, row: UserListRowData): React.Key {
  switch (row.type) {
    case UserListRowType.Header:
      return `header:${row.section}`
    case UserListRowType.Stream:
      return `stream:${row.stream.id}`
    case UserListRowType.Game:
      return `game:${row.entry.gameId}`
    case UserListRowType.MoreGames:
      return 'more-games'
    case UserListRowType.NoMatches:
      return 'no-matches'
    default:
      return `user:${row.userId}`
  }
}

const FilterContainer = styled.div`
  flex-shrink: 0;
  padding: 8px 8px 0;
`

const SectionHeader = styled.div<{ $first: boolean }>`
  margin: 0 8px;
  padding-top: ${props => (props.$first ? '0' : '16px')};
`

const SectionToggle = styled.button`
  ${buttonReset};
  width: 100%;
  height: 36px;
  padding: 0 8px 0 4px;

  display: flex;
  align-items: center;
  gap: 4px;

  border-radius: 4px;
  color: var(--theme-on-surface-variant);
  text-align: left;

  &:hover,
  &:focus-visible {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
    outline: none;
  }
`

const SectionLabel = styled.span`
  ${labelMedium};
  ${singleLine};
  flex: 1;
  min-width: 0;
`

const SectionCount = styled.span`
  ${bodySmall};
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
`

const StreamSlot = styled.div`
  margin: 0 8px;
`

const MoreGamesButton = styled.button`
  ${buttonReset};
  ${labelLarge};
  height: 32px;
  margin: 2px 8px 0;
  padding: 0 8px;

  border-radius: 4px;
  color: var(--theme-amber);

  &:hover,
  &:focus-visible {
    background-color: rgb(from var(--theme-amber) r g b / 0.08);
    outline: none;
  }
`

const NoMatches = styled.div`
  ${bodyMedium};
  padding: 16px;
  color: var(--theme-on-surface-variant);
`

function toggled<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const result = new Set(set)
  if (!result.delete(value)) {
    result.add(value)
  }
  return result
}

interface UserListProps {
  active: SbUserId[]
  offline: SbUserId[]
  /** Members' live streams, shown in a section above the roster. */
  streams?: ReadonlyArray<LiveStreamItem>
  /** Live games with members in them, shown in a section above the roster. */
  games?: ReadonlyArray<GameActivityEntry>
  /**
   * Whether the last request for the channel's members failed. What the roster below the error row
   * lists is then only whoever this client already knew about rather than everyone in the channel,
   * which is why the failure is said out loud instead of passing for a quiet channel.
   */
  loadError?: boolean
  /** Asks for the member list again. */
  onRetryLoad?: () => void
  className?: string
}

const NO_STREAMS: ReadonlyArray<LiveStreamItem> = []
const NO_GAMES: ReadonlyArray<GameActivityEntry> = []

/**
 * The channel's people as one list: members who are live, games members are playing, then the
 * active and offline roster. Each section collapses, and the filter narrows every section by name.
 */
export const UserList = React.memo((props: UserListProps) => {
  const {
    active,
    offline,
    streams = NO_STREAMS,
    games = NO_GAMES,
    loadError,
    onRetryLoad,
    className,
  } = props
  const { t } = useTranslation()
  const liveUserIds = useLiveUserIds()
  const usersById = useAppSelector(s => s.users.byId)
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<SectionKey>>(() => new Set())
  const [expandedGames, setExpandedGames] = useState<ReadonlySet<string>>(() => new Set())
  const [showAllGames, setShowAllGames] = useState(false)

  const needle = filter.trim().toLowerCase()
  const filtering = needle.length > 0
  const matches = (name: string | undefined) => !!name && name.toLowerCase().includes(needle)

  const shownStreams = filtering
    ? streams.filter(s => matches(s.user?.name) || matches(s.twitchLogin))
    : streams
  const shownGames = filtering
    ? games.filter(g => g.teams.some(team => team.some(p => matches(p.name))))
    : games
  const shownActive = filtering ? active.filter(id => matches(usersById.get(id)?.name)) : active
  const shownOffline = filtering ? offline.filter(id => matches(usersById.get(id)?.name)) : offline

  // While filtering, every match shows: a collapsed section or folded game would hide the very
  // thing being looked for.
  const isCollapsed = (section: SectionKey) => !filtering && collapsed.has(section)

  const rowData: UserListRowData[] = []
  const pushHeader = (section: SectionKey, label: string, count: number) => {
    rowData.push({
      type: UserListRowType.Header,
      section,
      label,
      count,
      collapsed: isCollapsed(section),
    })
  }

  if (shownStreams.length) {
    pushHeader('live', t('chat.userList.liveNow', 'Live now'), shownStreams.length)
    if (!isCollapsed('live')) {
      for (const stream of shownStreams) {
        rowData.push({ type: UserListRowType.Stream, stream })
      }
    }
  }

  if (shownGames.length) {
    pushHeader('games', t('chat.userList.inGame', 'In game'), shownGames.length)
    if (!isCollapsed('games')) {
      const foldable = !filtering && shownGames.length > GAMES_SHOWN
      const visibleGames = foldable && !showAllGames ? shownGames.slice(0, GAMES_SHOWN) : shownGames
      for (const entry of visibleGames) {
        rowData.push({ type: UserListRowType.Game, entry })
      }
      if (foldable) {
        rowData.push({
          type: UserListRowType.MoreGames,
          hidden: shownGames.length - visibleGames.length,
        })
      }
    }
  }

  if (!filtering || shownActive.length) {
    pushHeader('active', t('chat.userList.active', 'Active'), shownActive.length)
    if (!isCollapsed('active')) {
      for (const userId of shownActive) {
        rowData.push({ type: UserListRowType.Active, userId, isLive: liveUserIds.has(userId) })
      }
    }
  }

  if (shownOffline.length) {
    pushHeader('offline', t('chat.userList.offline', 'Offline'), shownOffline.length)
    if (!isCollapsed('offline')) {
      for (const userId of shownOffline) {
        rowData.push({ type: UserListRowType.Faded, userId, isLive: liveUserIds.has(userId) })
      }
    }
  }

  if (!rowData.length) {
    rowData.push({ type: UserListRowType.NoMatches })
  }

  const renderRow = (index: number, row: UserListRowData) => {
    switch (row.type) {
      case UserListRowType.Header:
        return (
          <SectionHeader $first={index === 0}>
            <SectionToggle
              type='button'
              aria-expanded={!row.collapsed}
              onClick={() => setCollapsed(c => toggled(c, row.section))}>
              <MaterialIcon icon={row.collapsed ? 'chevron_right' : 'expand_more'} size={20} />
              <SectionLabel>{row.label}</SectionLabel>
              <SectionCount>{row.count}</SectionCount>
            </SectionToggle>
          </SectionHeader>
        )
      case UserListRowType.Stream:
        return (
          <StreamSlot>
            <MiniLiveStreamEntry query={row.stream} />
          </StreamSlot>
        )
      case UserListRowType.Game:
        return (
          <ActivityGameEntry
            entry={row.entry}
            expanded={expandedGames.has(row.entry.gameId)}
            onToggle={() => setExpandedGames(g => toggled(g, row.entry.gameId))}
          />
        )
      case UserListRowType.MoreGames:
        return (
          <MoreGamesButton type='button' onClick={() => setShowAllGames(s => !s)}>
            {row.hidden
              ? t('chat.userList.showMoreGames', {
                  defaultValue_one: 'Show {{count}} more game',
                  defaultValue_other: 'Show {{count}} more games',
                  count: row.hidden,
                })
              : t('chat.userList.showFewerGames', 'Show fewer games')}
          </MoreGamesButton>
        )
      case UserListRowType.NoMatches:
        return (
          <NoMatches>{t('chat.userList.noMatches', 'Nobody here matches that name.')}</NoMatches>
        )
      default:
        return (
          <ConnectedUserListEntry
            userId={row.userId}
            faded={row.type === UserListRowType.Faded}
            isLive={row.isLive}
          />
        )
    }
  }

  return (
    <UserListContainer className={className}>
      <FilterContainer>
        <SearchInput
          searchQuery={filter}
          onSearchChange={setFilter}
          label={t('chat.userList.filter', 'Filter people')}
        />
      </FilterContainer>
      {loadError ? (
        <ErrorContainer>
          <LoadErrorRow
            message={t('chat.userList.loadFailed', "Couldn't load the user list")}
            onRetry={onRetryLoad ?? (() => {})}
          />
        </ErrorContainer>
      ) : null}
      <RosterContainer>
        <Virtuoso
          components={{ Header: PaddingHeader, Footer: PaddingFooter }}
          computeItemKey={computeRowKey}
          data={rowData}
          itemContent={renderRow}
        />
      </RosterContainer>
    </UserListContainer>
  )
})
