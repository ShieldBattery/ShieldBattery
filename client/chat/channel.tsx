import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Virtuoso } from 'react-virtuoso'
import styled, { css } from 'styled-components'
import {
  ChatServiceErrorCode,
  ClientChatMessageType,
  ServerChatMessageType,
} from '../../common/chat'
import { MULTI_CHANNEL } from '../../common/flags'
import { SbUserId } from '../../common/users/sb-user'
import { ConnectedAvatar } from '../avatars/avatar'
import { useVirtuosoScrollFix } from '../dom/virtuoso-scroll-fix'
import { logger } from '../logging/logger'
import { Chat } from '../messaging/chat'
import { useMentionFilterClick } from '../messaging/mention-hooks'
import { Message } from '../messaging/message-records'
import { push, replace } from '../navigation/routing'
import { isFetchError } from '../network/fetch-errors'
import { ConnectedUserContextMenu } from '../profile/user-context-menu'
import { useUserOverlays } from '../profile/user-overlays'
import { ConnectedUserProfileOverlay } from '../profile/user-profile-overlay'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { RootState } from '../root-reducer'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
import { usePrevious } from '../state-hooks'
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
  activateChannel,
  deactivateChannel,
  getMessageHistory,
  joinChannel,
  retrieveUserList,
  sendMessage,
} from './action-creators'
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

interface UserListEntryProps {
  userId: SbUserId
  faded?: boolean
  style?: any
}

const ConnectedUserListEntry = React.memo<UserListEntryProps>(props => {
  const user = useAppSelector(s => s.users.byId.get(props.userId))
  const filterClick = useMentionFilterClick()
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
  })

  return (
    <div style={props.style}>
      <ConnectedUserProfileOverlay {...profileOverlayProps} />
      <ConnectedUserContextMenu {...contextMenuProps} />

      <UserListEntryItem
        ref={clickableElemRef}
        key='entry'
        faded={!!props.faded}
        isOverlayOpen={isOverlayOpen}
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

const StyledLoadingDotsArea = styled(LoadingDotsArea)`
  width: 100%;
  max-width: 960px;
`

const StyledChat = styled(Chat)`
  max-width: 960px;
  flex-grow: 1;
  background-color: ${background800};
`

function renderMessage(msg: Message) {
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
      return <SelfJoinChannelMessage key={msg.id} channel={msg.channel} />
    default:
      return null
  }
}

type UserEntry = [userId: SbUserId, username: string | undefined]

function useUserEntriesSelector(userIds: ReadonlySet<SbUserId> | undefined) {
  return useCallback(
    (state: RootState): ReadonlyArray<UserEntry> => {
      if (!userIds?.size) {
        return []
      }

      const result = Array.from<SbUserId, UserEntry>(userIds.values(), id => [
        id,
        state.users.byId.get(id)?.name,
      ])
      result.sort((a, b) => a[0] - b[0])
      return result
    },
    [userIds],
  )
}

function areUserEntriesEqual(a: ReadonlyArray<UserEntry>, b: ReadonlyArray<UserEntry>): boolean {
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

function sortUsers(userEntries: ReadonlyArray<UserEntry>): SbUserId[] {
  return userEntries
    .slice()
    .sort(([aId, aName], [bId, bName]) => {
      // We put any user that still hasn't loaded at the bottom of the list
      if (aName === bName) {
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
  const activeUserEntries = useAppSelector(
    useUserEntriesSelector(activeUserIds),
    areUserEntriesEqual,
  )
  const idleUserEntries = useAppSelector(useUserEntriesSelector(idleUserIds), areUserEntriesEqual)
  const offlineUserEntries = useAppSelector(
    useUserEntriesSelector(offlineUserIds),
    areUserEntriesEqual,
  )

  const isInChannel = !!channel
  const prevIsInChannel = usePrevious(isInChannel)
  const prevChannelName = usePrevious(channelName)
  const isLeavingChannel = !isInChannel && prevIsInChannel && prevChannelName === channelName

  // TODO(2Pac): Pull this out into some kind of "isLeaving" hook and share with whispers/lobby?
  useEffect(() => {
    if (isLeavingChannel) {
      push('/')
    }
  }, [isLeavingChannel])

  const [joinChannelError, setJoinChannelError] = useState<Error>()
  const cancelJoinRef = useRef(new AbortController())

  useEffect(() => {
    cancelJoinRef.current.abort()
    const abortController = new AbortController()
    cancelJoinRef.current = abortController

    if (isInChannel) {
      dispatch(retrieveUserList(channelName))
      dispatch(activateChannel(channelName) as any)
    } else if (!isLeavingChannel) {
      if (MULTI_CHANNEL) {
        dispatch(
          joinChannel(channelName, {
            signal: abortController.signal,
            onSuccess: () => setJoinChannelError(undefined),
            onError: err => setJoinChannelError(err),
          }),
        )
      } else {
        push('/')
      }
    }

    return () => {
      abortController.abort()
      dispatch(deactivateChannel(channelName) as any)
    }
  }, [isInChannel, isLeavingChannel, channelName, dispatch])

  useEffect(() => {
    if (joinChannelError) {
      // TODO(2Pac): Rework how joining channel works. Currently we first navigate to the channel
      // and then attempt to join it. Which seems weird to me?
      //
      // To work around this for now, if the user is banned we redirect them to the index page,
      // but ideally they wouldn't be navigated to the channel in the first place.
      replace('/')

      let message = `An error occurred while joining ${channelName}`

      if (isFetchError(joinChannelError) && joinChannelError.code) {
        if (joinChannelError.code === ChatServiceErrorCode.UserBanned) {
          message = `You are banned from ${channelName}`
        } else {
          logger.error(`Unhandled code when joining ${channelName}: ${joinChannelError.code}`)
        }
      } else {
        logger.error(
          `Error when joining ${channelName}: ${joinChannelError.stack ?? joinChannelError}`,
        )
      }

      // TODO(2Pac): Once the joining channel is re-worked, this should probably display the error
      // message based on the context in which the user attempted to join a channel, e.g.
      //  - display the error message directly in the join-channel dialog if the user used the
      //    join-channel dialog to join the channel
      //  - display the error message in the chat channel (or a snackbar) if user attempted to join
      //    the channel with a chat command
      //  - display the error message in the channel info page if user lands on the channel page
      //    directly
      //  - do *something* else when a user attempts to join by clicking the channel invite in the
      //    notifications
      dispatch(openSnackbar({ message, time: TIMING_LONG }))
    }
  }, [joinChannelError, channelName, dispatch])

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

  return (
    <Container>
      {channel ? (
        <StyledChat
          listProps={{
            messages: channel.messages,
            loading: channel.loadingHistory,
            hasMoreHistory: channel.hasHistory,
            refreshToken: channelName,
            renderMessage,
            onLoadMoreMessages,
          }}
          inputProps={{
            onSendChatMessage,
          }}
          extraContent={
            <UserList
              active={sortedActiveUsers}
              idle={sortedIdleUsers}
              offline={sortedOfflineUsers}
            />
          }
        />
      ) : (
        <StyledLoadingDotsArea />
      )}
    </Container>
  )
}
