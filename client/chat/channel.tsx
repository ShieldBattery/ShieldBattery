import React, { useCallback, useEffect, useMemo } from 'react'
import { Virtuoso } from 'react-virtuoso'
import styled, { css } from 'styled-components'
import { ClientChatMessageType, SbChannelId, ServerChatMessageType } from '../../common/chat'
import { SbUserId } from '../../common/users/sb-user'
import { ConnectedAvatar } from '../avatars/avatar'
import { useVirtuosoScrollFix } from '../dom/virtuoso-scroll-fix'
import { Chat } from '../messaging/chat'
import { useChatMenuItems, useMentionFilterClick } from '../messaging/mention-hooks'
import { SbMessage } from '../messaging/message-records'
import { push } from '../navigation/routing'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { usePrevious, useStableCallback } from '../state-hooks'
import {
  alphaDisabled,
  background700,
  background800,
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
import { ConnectedUserContextMenu, MenuItemCategory } from '../users/user-context-menu'
import { useUserOverlays } from '../users/user-overlays'
import { ConnectedUserProfileOverlay } from '../users/user-profile-overlay'
import {
  activateChannel,
  correctChannelNameForChat,
  deactivateChannel,
  getMessageHistory,
  retrieveUserList,
  sendMessage,
} from './action-creators'
import { ConnectedChannelInfoCard } from './channel-info-card'
import { addChannelMenuItems } from './channel-menu-items'
import {
  BanUserMessage,
  JoinChannelMessage,
  KickUserMessage,
  LeaveChannelMessage,
  NewChannelOwnerMessage,
  SelfJoinChannelMessage,
} from './chat-message-layout'

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
  const addChatMenuItems = useChatMenuItems()

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

const MESSAGES_LIMIT = 50

const Container = styled.div`
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  display: flex;
  background-color: ${background700};
`

const StyledChat = styled(Chat)`
  max-width: 960px;
  flex-grow: 1;
  background-color: ${background800};
`

const ChannelInfoContainer = styled.div`
  width: 100%;
  max-width: 960px;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
`

function renderMessage(msg: SbMessage) {
  switch (msg.type) {
    case ClientChatMessageType.BanUser:
      return <BanUserMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case ClientChatMessageType.KickUser:
      return <KickUserMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case ServerChatMessageType.JoinChannel:
      return <JoinChannelMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case ClientChatMessageType.LeaveChannel:
      return <LeaveChannelMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case ClientChatMessageType.NewChannelOwner:
      return <NewChannelOwnerMessage key={msg.id} time={msg.time} newOwnerId={msg.newOwnerId} />
    case ClientChatMessageType.SelfJoinChannel:
      return <SelfJoinChannelMessage key={msg.id} channelId={msg.channelId} />
    default:
      return null
  }
}

interface ChatChannelProps {
  channelId: SbChannelId
  channelName: string
}

export function ConnectedChatChannel({
  channelId,
  channelName: channelNameFromRoute,
}: ChatChannelProps) {
  const dispatch = useAppDispatch()
  const channelInfo = useAppSelector(s => s.chat.idToInfo.get(channelId))
  const channelUsers = useAppSelector(s => s.chat.idToUsers.get(channelId))
  const channelMessages = useAppSelector(s => s.chat.idToMessages.get(channelId))
  const isInChannel = useAppSelector(s => s.chat.joinedChannels.has(channelId))
  const activeUserIds = channelUsers?.active
  const idleUserIds = channelUsers?.idle
  const offlineUserIds = channelUsers?.offline
  // We map the user IDs to their usernames so we can sort them by their name without pulling all of
  // the users from the store and depending on any of their changes.
  const activeUserEntries = useAppSelector(
    useUserEntriesSelector(activeUserIds),
    areUserEntriesEqual,
  )
  const idleUserEntries = useAppSelector(useUserEntriesSelector(idleUserIds), areUserEntriesEqual)
  const offlineUserEntries = useAppSelector(
    useUserEntriesSelector(offlineUserIds),
    areUserEntriesEqual,
  )

  const prevIsInChannel = usePrevious(isInChannel)
  const prevChannelId = usePrevious(channelId)
  const isLeavingChannel = !isInChannel && prevIsInChannel && prevChannelId === channelId

  // TODO(2Pac): Pull this out into some kind of "isLeaving" hook and share with whispers/lobby?
  useEffect(() => {
    if (isLeavingChannel) {
      push('/')
    }
  }, [isLeavingChannel])

  useEffect(() => {
    if (isInChannel) {
      dispatch(retrieveUserList(channelId))
      dispatch(activateChannel(channelId))
    }

    return () => {
      dispatch(deactivateChannel(channelId))
    }
  }, [isInChannel, channelId, dispatch])

  useEffect(() => {
    if (channelInfo && channelNameFromRoute !== channelInfo.name) {
      correctChannelNameForChat(channelInfo.id, channelInfo.name)
    }
  }, [channelInfo, channelNameFromRoute])

  const onLoadMoreMessages = useStableCallback(() =>
    dispatch(getMessageHistory(channelId, MESSAGES_LIMIT)),
  )

  const onSendChatMessage = useStableCallback((msg: string) =>
    dispatch(sendMessage(channelId, msg)),
  )

  const sortedActiveUsers = useMemo(() => sortUserEntries(activeUserEntries), [activeUserEntries])
  const sortedIdleUsers = useMemo(() => sortUserEntries(idleUserEntries), [idleUserEntries])
  const sortedOfflineUsers = useMemo(
    () => sortUserEntries(offlineUserEntries),
    [offlineUserEntries],
  )

  const modifyMenuItems = useCallback(
    (
      userId: SbUserId,
      items: Map<MenuItemCategory, React.ReactNode[]>,
      onMenuClose: (event?: MouseEvent) => void,
    ) => addChannelMenuItems(userId, items, onMenuClose, channelId),
    [channelId],
  )

  return (
    <Container>
      {isInChannel || isLeavingChannel ? (
        <StyledChat
          listProps={{
            messages: channelMessages?.messages ?? [],
            loading: channelMessages?.loadingHistory,
            hasMoreHistory: channelMessages?.hasHistory,
            refreshToken: channelId,
            renderMessage,
            onLoadMoreMessages,
          }}
          inputProps={{
            onSendChatMessage,
            storageKey: `chat.${channelId}`,
          }}
          extraContent={
            <UserList
              active={sortedActiveUsers}
              idle={sortedIdleUsers}
              offline={sortedOfflineUsers}
            />
          }
          modifyMenuItems={modifyMenuItems}
        />
      ) : (
        <ChannelInfoContainer>
          <ConnectedChannelInfoCard channelId={channelId} channelName={channelNameFromRoute} />
        </ChannelInfoContainer>
      )}
    </Container>
  )
}
