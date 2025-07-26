import * as React from 'react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import styled, { css } from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { ConnectedAvatar } from '../avatars/avatar'
import { eatVirtuosoContext } from '../lists/eat-virtuoso-context'
import { useMentionFilterClick } from '../messaging/mention-hooks'
import { useAppSelector } from '../redux-hooks'
import { labelMedium, singleLine, titleSmall } from '../styles/typography'
import { ConnectedUserContextMenu } from '../users/user-context-menu'
import { useUserOverlays } from '../users/user-overlays'
import { ConnectedUserProfileOverlay } from '../users/user-profile-overlay'
import { ChannelUserMenu } from './channel-menu-items'

const UserListContainer = styled.div`
  width: 256px;
  flex-grow: 0;
  flex-shrink: 0;

  contain: content;

  background-color: var(--theme-container-low);
  border-radius: 8px;
`

const PaddingHeader = eatVirtuosoContext(/* */ styled.div<{ context?: unknown }>`
  width: 100%;
  height: 10px;
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

const OVERLINE_HEIGHT = 36 + 24
const FIRST_OVERLINE_HEIGHT = 36 + 8

const UserListOverline = styled.div<{ $firstOverline: boolean }>`
  ${labelMedium}
  ${userListRow};
  height: ${props => (props.$firstOverline ? FIRST_OVERLINE_HEIGHT : OVERLINE_HEIGHT)}px;
  padding-top: ${props => (props.$firstOverline ? '8px' : '24px')};

  color: var(--theme-on-surface-variant);
  line-height: 36px;
`

const StyledAvatar = styled(ConnectedAvatar)`
  flex-shrink: 0;
  width: 32px;
  height: 32px;

  margin: 2px 16px 2px 0;
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

const UserListName = styled.span`
  ${singleLine};
  flex-grow: 1;
  flex-shrink: 1;
`

interface UserListEntryProps {
  userId: SbUserId
  faded?: boolean
  style?: React.CSSProperties
}

const ConnectedUserListEntry = React.memo<UserListEntryProps>(props => {
  const user = useAppSelector(s => s.users.byId.get(props.userId))
  const filterClick = useMentionFilterClick()

  const { profileOverlayProps, contextMenuProps, onClick, onContextMenu, isOverlayOpen } =
    useUserOverlays({
      userId: props.userId,
      profileAnchorX: 'left',
      profileAnchorY: 'top',
      profileOriginX: 'right',
      profileOriginY: 'top',
      profileOffsetX: -4,
      filterClick,
      UserMenu: ChannelUserMenu,
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
        <StyledAvatar userId={props.userId} />
        {user ? (
          <UserListName>{user.name}</UserListName>
        ) : (
          <LoadingName aria-label='Username loading…' />
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
  className?: string
}

export const UserList = React.memo(({ active, idle, offline, className }: UserListProps) => {
  const { t } = useTranslation()

  const rowData = useMemo((): ReadonlyArray<UserListRowData> => {
    let result: UserListRowData[] = [
      {
        type: UserListRowType.Header,
        label: t('chat.userList.active', 'Active'),
        count: active.length,
      },
    ]
    result = result.concat(active.map(userId => ({ type: UserListRowType.Active, userId })))

    if (idle.length) {
      result.push({
        type: UserListRowType.Header,
        label: t('chat.userList.idle', 'Idle'),
        count: idle.length,
      })
      result = result.concat(idle.map(userId => ({ type: UserListRowType.Faded, userId })))
    }

    if (offline.length) {
      result.push({
        type: UserListRowType.Header,
        label: t('chat.userList.offline', 'Offline'),
        count: offline.length,
      })
      result = result.concat(offline.map(userId => ({ type: UserListRowType.Faded, userId })))
    }

    return result
  }, [active, idle, offline, t])

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
    <UserListContainer className={className}>
      <Virtuoso
        components={{ Header: PaddingHeader, Footer: PaddingFooter }}
        data={rowData}
        itemContent={renderRow}
      />
    </UserListContainer>
  )
})
