import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { VariableSizeList } from 'react-window'
import styled, { css } from 'styled-components'
import { ClientChatMessageType, ServerChatMessageType } from '../../common/chat'
import { MULTI_CHANNEL } from '../../common/flags'
import { SbUserId } from '../../common/users/user-info'
import Avatar from '../avatars/avatar'
import { useObservedDimensions } from '../dom/dimension-hooks'
import { useAnchorPosition } from '../material/popover'
import Chat from '../messaging/chat'
import { Message } from '../messaging/message-records'
import { push } from '../navigation/routing'
import { ConnectedUserProfileOverlay } from '../profile/user-profile-overlay'
import LoadingIndicator from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { RootState } from '../root-reducer'
import { usePrevious } from '../state-hooks'
import {
  alphaDisabled,
  background700,
  background800,
  colorTextFaint,
  colorTextSecondary,
} from '../styles/colors'
import { body2, overline, singleLine } from '../styles/typography'
import {
  activateChannel,
  deactivateChannel,
  getMessageHistory,
  joinChannel,
  retrieveUserList,
  sendMessage,
} from './action-creators'
import {
  JoinChannelMessage,
  LeaveChannelMessage,
  NewChannelOwnerMessage,
  SelfJoinChannelMessage,
} from './chat-message-layout'

const UserListContainer = styled.div`
  width: 256px;
  flex-grow: 0;
  flex-shrink: 0;
  overflow-y: auto;
  overflow-x: hidden;

  background-color: ${background700};
`

const userListRow = css`
  ${singleLine};

  margin: 0 8px;
  padding: 0 8px;
  line-height: 36px;
`

const OVERLINE_HEIGHT = 36 + 24
const FIRST_OVERLINE_HEIGHT = 36 + 8

const UserListOverline = styled.div`
  ${overline}
  ${userListRow};
  height: ${OVERLINE_HEIGHT}px;
  color: ${colorTextSecondary};

  padding-top: 24px;

  &:first-child {
    padding-top: 8px;
  }
`

const StyledAvatar = styled(Avatar)`
  width: 32px;
  height: 32px;

  display: inline-block;

  margin: 2px 16px 2px 0;
`

const fadedCss = css`
  color: ${colorTextFaint};
  ${StyledAvatar} {
    opacity: ${alphaDisabled};
  }
`

const USER_ENTRY_HEIGHT = 44

interface UserListEntryItemProps {
  isOverlayOpen?: boolean
  faded?: boolean
}

const UserListEntryItem = styled.div<UserListEntryItemProps>`
  ${body2};
  ${userListRow};
  height: ${USER_ENTRY_HEIGHT}px;
  border-radius: 2px;
  padding-top: 4px;
  padding-bottom: 4px;

  &:hover {
    cursor: pointer;
    background-color: rgba(255, 255, 255, 0.08);
  }

  ${props => {
    if (props.isOverlayOpen) {
      return 'background-color: rgba(255, 255, 255, 0.08);'
    }
    return ''
  }}

  ${props => {
    if (props.faded) {
      return fadedCss
    }
    return ''
  }}
`

const UserListName = styled.span`
  ${singleLine};
  display: inline-block;
`

const LoadingUserListEntryItem = styled(UserListEntryItem)`
  display: flex;
  flex-direction: row;
  align-items: center;
`

const LoadingAvatar = styled.div`
  width: 32px;
  height: 32px;
  margin-right: 16px;
  border: 1px solid ${colorTextFaint};
  border-radius: 50%;
`

const LoadingName = styled.div`
  width: 64px;
  height: 24px;
  background-color: ${colorTextFaint};
`

interface UserListEntryProps {
  userId: SbUserId
  faded?: boolean
  style?: any
}

const ConnectedUserListEntry = React.memo<UserListEntryProps>(props => {
  const [overlayOpen, setOverlayOpen] = useState(false)
  const userEntryRef = useRef(null)
  const [, anchorX, anchorY] = useAnchorPosition('left', 'top', userEntryRef.current ?? null)

  const onOpenOverlay = useCallback(() => {
    setOverlayOpen(true)
  }, [])
  const onCloseOverlay = useCallback(() => {
    setOverlayOpen(false)
  }, [])

  const user = useAppSelector(s => s.users.byId.get(props.userId))
  if (!user) {
    return (
      <div style={props.style}>
        <LoadingUserListEntryItem key={'entry'}>
          <LoadingAvatar />
          <LoadingName />
        </LoadingUserListEntryItem>
      </div>
    )
  }

  return (
    <div style={props.style}>
      <ConnectedUserProfileOverlay
        key={'overlay'}
        userId={props.userId}
        popoverProps={{
          open: overlayOpen,
          onDismiss: onCloseOverlay,
          anchorX: (anchorX ?? 0) - 4,
          anchorY: anchorY ?? 0,
          originX: 'right',
          originY: 'top',
        }}
      />

      <UserListEntryItem
        ref={userEntryRef}
        key={'entry'}
        faded={!!props.faded}
        isOverlayOpen={overlayOpen}
        onClick={onOpenOverlay}>
        <StyledAvatar user={user.name} />
        <UserListName>{user.name}</UserListName>
      </UserListEntryItem>
    </div>
  )
})

interface UserListProps {
  active: SbUserId[]
  idle: SbUserId[]
  offline: SbUserId[]
}

const UserList = React.memo((props: UserListProps) => {
  const { active, idle, offline } = props
  const [dimensionsRef, containerRect] = useObservedDimensions()
  const listRef = useRef<VariableSizeList | null>(null)

  const rowCount = useMemo(
    () =>
      1 +
      active.length +
      (idle.length ? 1 : 0) +
      idle.length +
      (offline.length ? 1 : 0) +
      offline.length,
    [active, idle, offline],
  )

  const getRowHeight = useCallback(
    (index: number) => {
      if (index >= rowCount) {
        throw new Error('Asked to size nonexistent user: ' + index)
      }

      const idleHeaderIndex = idle.length ? active.length + 1 : null
      let offlineHeaderIndex = null
      if (offline.length) {
        offlineHeaderIndex =
          idleHeaderIndex != null ? idleHeaderIndex + idle.length + 1 : active.length + 1
      }

      switch (index) {
        case 0:
          return FIRST_OVERLINE_HEIGHT
        case idleHeaderIndex:
        case offlineHeaderIndex:
          return OVERLINE_HEIGHT
        default:
          return USER_ENTRY_HEIGHT
      }
    },
    [active, idle, offline, rowCount],
  )

  const renderRow = useCallback(
    ({ index, style }: { index: number; style: React.CSSProperties }) => {
      if (index >= rowCount) {
        throw new Error('Asked to render nonexistent user: ' + index)
      }

      const idleHeaderIndex = idle.length ? active.length + 1 : null
      let offlineHeaderIndex = null
      if (offline.length) {
        offlineHeaderIndex =
          idleHeaderIndex != null ? idleHeaderIndex + idle.length + 1 : active.length + 1
      }

      switch (index) {
        case 0:
          return (
            <UserListOverline style={style} key='active'>
              Active ({active.length})
            </UserListOverline>
          )
        case idleHeaderIndex:
          return (
            <UserListOverline style={style} key='idle'>
              Idle ({idle.length})
            </UserListOverline>
          )
        case offlineHeaderIndex:
          return (
            <UserListOverline style={style} key='offline'>
              Offline ({offline.length})
            </UserListOverline>
          )
        default:
          let userId: SbUserId | undefined
          let faded = false
          if (index < active.length + 1) {
            userId = active[index - 1]!
          } else if (offlineHeaderIndex && index > offlineHeaderIndex) {
            faded = true
            userId = offline[index - offlineHeaderIndex - 1]!
          } else {
            userId = idleHeaderIndex ? idle[index - idleHeaderIndex - 1]! : undefined
          }

          if (userId) {
            return (
              <ConnectedUserListEntry style={style} userId={userId} key={userId} faded={faded} />
            )
          }
          throw new Error('Asked to render nonexistent user: ' + index)
      }
    },
    [active, idle, offline, rowCount],
  )

  useMemo(() => {
    listRef.current?.resetAfterIndex(0, false)
  }, [getRowHeight]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <UserListContainer ref={dimensionsRef}>
      <VariableSizeList
        ref={listRef}
        style={{ overflowX: 'hidden', paddingBottom: '8px' }}
        width='100%'
        height={containerRect?.height ?? 0}
        itemCount={rowCount}
        itemSize={getRowHeight}>
        {renderRow}
      </VariableSizeList>
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

const LoadingArea = styled.div`
  padding-top: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
`

const StyledChat = styled(Chat)`
  max-width: 960px;
  flex-grow: 1;
  background-color: ${background800};
`

function renderMessage(msg: Message) {
  switch (msg.type) {
    case ServerChatMessageType.JoinChannel:
      return <JoinChannelMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case ClientChatMessageType.LeaveChannel:
      return <LeaveChannelMessage key={msg.id} time={msg.time} userId={msg.userId} />
    case ClientChatMessageType.NewChannelOwner:
      return <NewChannelOwnerMessage key={msg.id} time={msg.time} newOwnerId={msg.newOwnerId} />
    case ClientChatMessageType.SelfJoinChannel:
      return <SelfJoinChannelMessage key={msg.id} channel={msg.channel} />
    default:
      return null
  }
}

type UserEntries = [userId: SbUserId, username: string | undefined][]

function userEntriesSelector(userIds: ReadonlySet<SbUserId> | undefined) {
  return (state: RootState) => {
    const userEntries: UserEntries = []
    if (!userIds) {
      return []
    }

    for (const userId of Array.from(userIds.values()).sort((a, b) => a - b)) {
      const username = state.users.byId.get(userId)?.name
      if (username) {
        userEntries.push([userId, username])
      }
    }

    return userEntries
  }
}

function didUserEntryChange(a: UserEntries, b: UserEntries) {
  if (a.length !== b.length) {
    return false
  }

  for (let i = 0; i < a.length; i++) {
    const [aId, aName] = a[i]
    const [bId, bName] = b[i]
    if (aId !== bId || aName !== bName) {
      return false
    }
  }

  return true
}

function sortUsers(userEntries: UserEntries) {
  return userEntries
    .sort(([aId, aName], [bId, bName]) => {
      // We put any user that still hasn't loaded at the bottom of the list
      if (!aName && !bName) {
        return 0
      } else if (!aName) {
        return 1
      } else if (!bName) {
        return -1
      }

      return aName.localeCompare(bName)
    })
    .map(([userId]) => userId)
}

interface ChatChannelProps {
  params: { channel: string }
}

export default function Channel(props: ChatChannelProps) {
  const channelName = decodeURIComponent(props.params.channel).toLowerCase()
  const dispatch = useAppDispatch()
  const channel = useAppSelector(s => s.chat.byName.get(channelName))
  const activeUserIds = channel?.users.active
  const idleUserIds = channel?.users.idle
  const offlineUserIds = channel?.users.offline
  // We map the user IDs to their usernames so we can sort them by their name without pulling all of
  // the users from the store and depending on any of their changes.
  const activeUserEntries = useAppSelector(userEntriesSelector(activeUserIds), didUserEntryChange)
  const idleUserEntries = useAppSelector(userEntriesSelector(idleUserIds), didUserEntryChange)
  const offlineUserEntries = useAppSelector(userEntriesSelector(offlineUserIds), didUserEntryChange)

  const prevChannelName = usePrevious(channelName)
  const prevChannel = usePrevious(channel)
  const isInChannel = !!channel
  const isLeavingChannel = !isInChannel && !!prevChannel && prevChannelName === channelName

  // TODO(2Pac): Pull this out into some kind of "isLeaving" hook and share with whispers/lobby?
  useEffect(() => {
    if (isLeavingChannel) {
      push('/')
    }
  }, [isLeavingChannel])

  useEffect(() => {
    if (isInChannel) {
      dispatch(retrieveUserList(channelName))
      dispatch(activateChannel(channelName) as any)
    } else if (!isLeavingChannel) {
      if (MULTI_CHANNEL) {
        dispatch(joinChannel(channelName))
      } else {
        push('/')
      }
    }

    return () => dispatch(deactivateChannel(channelName) as any)
  }, [isInChannel, isLeavingChannel, channelName, dispatch])

  const onLoadMoreMessages = useCallback(
    () => dispatch(getMessageHistory(channelName, MESSAGES_LIMIT)),
    [channelName, dispatch],
  )

  const onSendChatMessage = useCallback(
    (msg: string) => dispatch(sendMessage(channelName, msg)),
    [dispatch, channelName],
  )

  const sortedActiveUsers = useMemo(() => sortUsers(activeUserEntries), [activeUserEntries])
  const sortedIdleUsers = useMemo(() => sortUsers(idleUserEntries), [idleUserEntries])
  const sortedOfflineUsers = useMemo(() => sortUsers(offlineUserEntries), [offlineUserEntries])

  if (!channel) {
    return (
      <LoadingArea>
        <LoadingIndicator />
      </LoadingArea>
    )
  }

  const listProps = {
    messages: channel.messages,
    loading: channel.loadingHistory,
    hasMoreHistory: channel.hasHistory,
    refreshToken: channelName,
    renderMessage,
    onLoadMoreMessages,
  }
  const inputProps = {
    onSendChatMessage,
  }

  return (
    <Container>
      <StyledChat listProps={listProps} inputProps={inputProps} />
      <UserList active={sortedActiveUsers} idle={sortedIdleUsers} offline={sortedOfflineUsers} />
    </Container>
  )
}
