import React, { useCallback, useMemo } from 'react'
import { Virtuoso } from 'react-virtuoso'
import styled, { css } from 'styled-components'
import { SbUserId } from '../../common/users/sb-user'
import { ConnectedAvatar } from '../avatars/avatar'
import { useVirtuosoScrollFix } from '../dom/virtuoso-scroll-fix'
import { useChatUserMenuItems, useMentionFilterClick } from '../messaging/mention-hooks'
import { useAppSelector } from '../redux-hooks'
import {
  alphaDisabled,
  background700,
  colorDividers,
  colorTextFaint,
  colorTextSecondary,
} from '../styles/colors'
import { body2, overline, singleLine } from '../styles/typography'
import {
  areUserEntriesEqual,
  sortUserEntries,
  useUserEntriesSelector,
} from '../users/sorted-user-ids'
import { ConnectedUserContextMenu } from '../users/user-context-menu'
import { useUserOverlays } from '../users/user-overlays'
import { ConnectedUserProfileOverlay } from '../users/user-profile-overlay'
import { useTranslation } from 'react-i18next'

const UserListContainer = styled.div`
  width: 256px;
  flex-grow: 0;
  flex-shrink: 0;

  background-color: ${background700};
`

const VertPadding = styled.div<{ context?: unknown }>`
  width: 100%;
  height: 8px;
`

const userListRow = css`
  ${singleLine};

  margin: 0 8px;
  padding: 0 8px;
  line-height: 36px;
`

const OVERLINE_HEIGHT = 36 + 24
const FIRST_OVERLINE_HEIGHT = 36 + 8

const UserListOverline = styled.div<{ $firstOverline: boolean }>`
  ${overline}
  ${userListRow};
  height: ${props => (props.$firstOverline ? FIRST_OVERLINE_HEIGHT : OVERLINE_HEIGHT)}px;
  color: ${colorTextSecondary};

  padding-top: ${props => (props.$firstOverline ? '8px' : '24px')};
`

const StyledAvatar = styled(ConnectedAvatar)`
  width: 32px;
  height: 32px;

  display: inline-block;

  margin: 2px 16px 2px 0;
`
const LoadingName = styled.div`
  width: 64px;
  height: 20px;
  margin: 8px 0;
  display: inline-block;

  background-color: ${colorDividers};
  border-radius: 2px;
`

const fadedCss = css`
  color: ${colorTextFaint};
  ${StyledAvatar}, ${LoadingName} {
    opacity: ${alphaDisabled};
  }
`

interface UserListEntryItemProps {
  $isOverlayOpen?: boolean
  $faded?: boolean
}

const UserListEntryItem = styled.div<UserListEntryItemProps>`
  ${body2};
  ${userListRow};
  height: 44px;
  border-radius: 2px;
  padding-top: 4px;
  padding-bottom: 4px;

  &:hover {
    cursor: pointer;
    background-color: rgba(255, 255, 255, 0.08);
  }

  ${props => {
    if (props.$isOverlayOpen) {
      return 'background-color: rgba(255, 255, 255, 0.08);'
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

const UserListName = styled.span`
  ${singleLine};
  display: inline-block;
`

interface UserListEntryProps {
  userId: SbUserId
  faded?: boolean
  style?: React.CSSProperties
}

const ConnectedUserListEntry = React.memo<UserListEntryProps>(props => {
  const user = useAppSelector(s => s.users.byId.get(props.userId))
  const filterClick = useMentionFilterClick()
  const addChatMenuItems = useChatUserMenuItems()

  const {
    clickableElemRef,
    profileOverlayProps,
    contextMenuProps,
    onClick,
    onContextMenu,
    isOverlayOpen,
  } = useUserOverlays<HTMLDivElement>({
    userId: props.userId,
    profileAnchorX: 'left',
    profileAnchorY: 'top',
    profileOriginX: 'right',
    profileOriginY: 'top',
    profileOffsetX: -4,
    filterClick,
    modifyMenuItems: addChatMenuItems,
  })
  const { t } = useTranslation()
  return (
    <div style={props.style}>
      <ConnectedUserProfileOverlay {...profileOverlayProps} />
      <ConnectedUserContextMenu {...contextMenuProps} />

      <UserListEntryItem
        ref={clickableElemRef}
        key='entry'
        $faded={!!props.faded}
        $isOverlayOpen={isOverlayOpen}
        onClick={onClick}
        onContextMenu={onContextMenu}>
        <StyledAvatar userId={props.userId} />
        {user ? (
          <UserListName>{user.name}</UserListName>
        ) : (
          <LoadingName aria-label={t('chat.channelUserList.usernameLoadingText', 'Username loading\u2026')} />
        )}
      </UserListEntryItem>
    </div>
  )
})

enum UserListRowType {
  Header,
  Active,
  Faded,
}

interface HeaderRowData {
  type: UserListRowType.Header
  label: string
  count: number
}

interface ActiveRowData {
  type: UserListRowType.Active
  userId: SbUserId
}

interface FadedRowData {
  type: UserListRowType.Faded
  userId: SbUserId
}

type UserListRowData = HeaderRowData | ActiveRowData | FadedRowData

interface UserListProps {
  active: SbUserId[]
  idle: SbUserId[]
  offline: SbUserId[]
}

const UserList = React.memo((props: UserListProps) => {
  const [scrollerRef] = useVirtuosoScrollFix()

  const { active, idle, offline } = props

  const rowData = useMemo((): ReadonlyArray<UserListRowData> => {
    let result: UserListRowData[] = [
      { type: UserListRowType.Header, label: 'Active', count: active.length },
    ]
    result = result.concat(active.map(userId => ({ type: UserListRowType.Active, userId })))

    if (idle.length) {
      result.push({ type: UserListRowType.Header, label: 'Idle', count: idle.length })
      result = result.concat(idle.map(userId => ({ type: UserListRowType.Faded, userId })))
    }

    if (offline.length) {
      result.push({ type: UserListRowType.Header, label: 'Offline', count: offline.length })
      result = result.concat(offline.map(userId => ({ type: UserListRowType.Faded, userId })))
    }

    return result
  }, [active, idle, offline])

  const renderRow = useCallback((index: number, row: UserListRowData) => {
    if (row.type === UserListRowType.Header) {
      return (
        <UserListOverline key={row.label} $firstOverline={index === 0}>
          <span>
            {row.label} ({row.count})
          </span>
        </UserListOverline>
      )
    } else {
      const faded = row.type === UserListRowType.Faded
      return <ConnectedUserListEntry userId={row.userId} key={row.userId} faded={faded} />
    }
  }, [])

  return (
    <UserListContainer>
      <Virtuoso
        scrollerRef={scrollerRef}
        components={{ Footer: VertPadding }}
        data={rowData}
        itemContent={renderRow}
      />
    </UserListContainer>
  )
})

export function ChannelUserList({
  active,
  idle,
  offline,
}: {
  active?: ReadonlySet<SbUserId>
  idle?: ReadonlySet<SbUserId>
  offline?: ReadonlySet<SbUserId>
}) {
  // We map the user IDs to their usernames so we can sort them by their name without pulling all of
  // the users from the store and depending on any of their changes.

  const activeUserEntries = useAppSelector(useUserEntriesSelector(active), areUserEntriesEqual)
  const idleUserEntries = useAppSelector(useUserEntriesSelector(idle), areUserEntriesEqual)
  const offlineUserEntries = useAppSelector(useUserEntriesSelector(offline), areUserEntriesEqual)

  const sortedActiveUsers = useMemo(() => sortUserEntries(activeUserEntries), [activeUserEntries])
  const sortedIdleUsers = useMemo(() => sortUserEntries(idleUserEntries), [idleUserEntries])
  const sortedOfflineUsers = useMemo(
    () => sortUserEntries(offlineUserEntries),
    [offlineUserEntries],
  )

  return <UserList active={sortedActiveUsers} idle={sortedIdleUsers} offline={sortedOfflineUsers} />
}
