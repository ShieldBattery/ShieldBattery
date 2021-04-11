import React, { useCallback, useEffect, useRef, useState } from 'react'
import { List as VirtualizedList, ListRowRenderer } from 'react-virtualized'
import styled, { css } from 'styled-components'
import { useRoute } from 'wouter'
import { MULTI_CHANNEL } from '../../common/flags'
import Avatar from '../avatars/avatar'
import WindowListener from '../dom/window-listener'
import MenuItem from '../material/menu/item'
import MessageInput from '../messaging/message-input'
import MessageList from '../messaging/message-list'
import { Message } from '../messaging/message-records'
import { push } from '../navigation/routing'
import UserProfileOverlay from '../profile/user-profile-overlay'
import LoadingIndicator from '../progress/dots'
import { usePrevious } from '../react-extra-hooks'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { alphaDisabled, colorDividers, colorTextSecondary } from '../styles/colors'
import { body2, overline, singleLine } from '../styles/typography'
import { navigateToWhisper } from '../whispers/action-creators'
import {
  activateChannel,
  deactivateChannel,
  joinChannel,
  retrieveInitialMessageHistory,
  retrieveNextMessageHistory,
  retrieveUserList,
  sendMessage,
} from './action-creators'
import {
  JoinChannelMessage,
  LeaveChannelMessage,
  NewChannelOwnerMessage,
  SelfJoinChannelMessage,
} from './chat-message-layout'
import { ChatMessageType } from './chat-message-records'
import { Channel as ChannelRecord, Users as UsersRecord } from './chat-reducer'

// Height to the bottom of the loading area (the top of the messages)
const LOADING_AREA_BOTTOM = 32 + 8

const UserListContainer = styled.div`
  width: 256px;
  flex-grow: 0;
  flex-shrink: 0;
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
  color: ${colorTextSecondary};
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

const USER_LIST_PADDING_HEIGHT = 8

const UserListPadding = styled.div`
  width: 100%;
  height: ${USER_LIST_PADDING_HEIGHT}px;
`

const UserListName = styled.span`
  ${singleLine};
  display: inline-block;
`

interface UserListEntryProps {
  user: string
  faded?: boolean
  style?: any
  onWhisperClick: (user: string) => void
}

const UserListEntry = React.memo<UserListEntryProps>(props => {
  const [overlayOpen, setOverlayOpen] = useState(false)
  const userEntryRef = useRef(null)

  const onOpenOverlay = useCallback(() => {
    setOverlayOpen(true)
  }, [])
  const onCloseOverlay = useCallback(() => {
    setOverlayOpen(false)
  }, [])
  const onWhisperClick = useCallback(() => {
    props.onWhisperClick(props.user)
  }, [props.onWhisperClick, props.user])

  return (
    <div style={props.style}>
      <UserProfileOverlay
        key={'overlay'}
        open={overlayOpen}
        onDismiss={onCloseOverlay}
        anchor={userEntryRef.current}
        user={props.user}>
        <MenuItem key='whisper' text='Whisper' onClick={onWhisperClick} />
      </UserProfileOverlay>

      <UserListEntryItem
        ref={userEntryRef}
        key={'entry'}
        faded={!!props.faded}
        isOverlayOpen={overlayOpen}
        onClick={onOpenOverlay}>
        <StyledAvatar user={props.user} />
        <UserListName>{props.user}</UserListName>
      </UserListEntryItem>
    </div>
  )
})

const UsersVirtualizedList = styled(VirtualizedList)`
  &:focus,
  & > div:focus {
    outline: none;
  }
`

interface UserListProps {
  users: ReturnType<typeof UsersRecord>
  onWhisperClick: (user: string) => void
}

class UserList extends React.Component<UserListProps> {
  state = {
    width: 0,
    height: 0,
  }
  _contentRef = React.createRef<HTMLDivElement>()
  _listRef = React.createRef<VirtualizedList>()

  componentDidMount() {
    this.updateDimensions()
  }

  componentDidUpdate(prevProps: UserListProps) {
    if (prevProps.users !== this.props.users) {
      this._listRef.current?.recomputeRowHeights()
    }
  }

  getRowHeight = ({ index }: { index: number }) => {
    const { active, idle, offline } = this.props.users
    if (index === 0) {
      return FIRST_OVERLINE_HEIGHT
    } else if (index < active.size + 1) {
      return USER_ENTRY_HEIGHT
    }

    let i = index - (active.size + 1)
    if (idle.size) {
      if (i === 0) {
        return OVERLINE_HEIGHT
      } else if (i < idle.size + 1) {
        return USER_ENTRY_HEIGHT
      }

      i -= idle.size + 1
    }

    if (offline.size) {
      if (i === 0) {
        return OVERLINE_HEIGHT
      } else if (i < offline.size + 1) {
        return USER_ENTRY_HEIGHT
      }

      i -= offline.size + 1
    }

    if (i === 0) {
      return USER_LIST_PADDING_HEIGHT
    }

    throw new Error('Asked to size nonexistent user: ' + index)
  }

  renderRow: ListRowRenderer = ({ index, style }) => {
    const { active, idle, offline } = this.props.users
    if (index === 0) {
      // NOTE(tec27): We know the active header is always visible because this user is online
      return (
        <UserListOverline style={style} key={index}>
          Active ({active.size})
        </UserListOverline>
      )
    } else if (index < active.size + 1) {
      return (
        <UserListEntry
          style={style}
          user={active.get(index - 1)}
          key={index}
          onWhisperClick={this.props.onWhisperClick}
        />
      )
    }

    let i = index - (active.size + 1)
    if (idle.size) {
      if (i === 0) {
        return (
          <UserListOverline style={style} key={index}>
            Idle ({idle.size})
          </UserListOverline>
        )
      } else if (i < idle.size + 1) {
        return (
          <UserListEntry
            style={style}
            user={idle.get(i - 1)}
            key={index}
            onWhisperClick={this.props.onWhisperClick}
          />
        )
      }

      i -= idle.size + 1
    }

    if (offline.size) {
      if (i === 0) {
        return (
          <UserListOverline style={style} key={index}>
            Offline ({offline.size})
          </UserListOverline>
        )
      } else if (i < offline.size + 1) {
        return (
          <UserListEntry
            style={style}
            user={offline.get(i - 1)}
            key={index}
            onWhisperClick={this.props.onWhisperClick}
            faded={true}
          />
        )
      }

      i -= offline.size + 1
    }

    if (i === 0) {
      return <UserListPadding style={style} key={index} />
    }

    throw new Error('Asked to render nonexistent user: ' + index)
  }

  render() {
    const { active, idle, offline } = this.props.users
    const rowCount =
      1 + active.size + (idle.size ? 1 : 0) + idle.size + (offline.size ? 1 : 0) + offline.size + 1

    return (
      <UserListContainer ref={this._contentRef}>
        <WindowListener event='resize' listener={this.updateDimensions} />
        <UsersVirtualizedList
          ref={this._listRef}
          width={this.state.width}
          height={this.state.height}
          rowCount={rowCount}
          rowHeight={this.getRowHeight}
          rowRenderer={this.renderRow}
        />
      </UserListContainer>
    )
  }

  updateDimensions = () => {
    const width = this._contentRef.current?.clientWidth ?? 0
    const height = this._contentRef.current?.clientHeight ?? 0
    if (this.state.width !== width || this.state.height !== height) {
      this.setState({ width, height })
    }
  }
}

const Container = styled.div`
  max-width: 1140px;
  height: 100%;
  margin: 0 auto;
  padding: 0;
  padding-left: var(--pixel-shove-x, 0);
  display: flex;
`

const LoadingArea = styled.div`
  padding-top: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
`

const MessagesAndInput = styled.div`
  min-width: 320px;
  height: 100%;
  flex-grow: 1;
  contain: content;
`

const CHAT_INPUT_HEIGHT_PX = 56
const CHAT_INPUT_PADDING_PX = 16

const StyledMessageList = styled(MessageList)`
  height: calc(100% - ${CHAT_INPUT_HEIGHT_PX}px - ${CHAT_INPUT_PADDING_PX}px);
  contain: strict;
`

interface ChatInputProps {
  showDivider: boolean
  onSend: (msg: string) => void
}

const ChatInput = styled(MessageInput)<ChatInputProps>`
  position: relative;
  padding: ${CHAT_INPUT_PADDING_PX / 2}px 16px;
  contain: content;

  // TODO(2Pac): Move this to the MessageInput component so it can be reused in other chat services.
  &::after {
    position: absolute;
    height: 1px;
    left: 0px;
    right: 0px;
    top: 0;

    content: '';
    border-top: 1px solid ${props => (props.showDivider ? colorDividers : 'transparent')};
    transition: border 250ms linear;
  }
`

function renderMessage(msg: Message) {
  switch (msg.type) {
    case ChatMessageType.JoinChannel:
      return <JoinChannelMessage key={msg.id} time={msg.time} user={msg.user} />
    case ChatMessageType.LeaveChannel:
      return <LeaveChannelMessage key={msg.id} time={msg.time} user={msg.user} />
    case ChatMessageType.NewChannelOwner:
      return <NewChannelOwnerMessage key={msg.id} time={msg.time} newOwner={msg.newOwner} />
    case ChatMessageType.SelfJoinChannel:
      return <SelfJoinChannelMessage key={msg.id} channel={msg.channel} />
    default:
      return null
  }
}

interface ChannelProps {
  channel: ChannelRecord
  onSendChatMessage: (msg: string) => void
  onRequestMoreHistory: () => void
  onWhisperClick: (user: string) => void
}

class Channel extends React.Component<ChannelProps> {
  state = {
    isScrolledUp: false,
  }

  render() {
    const { channel, onSendChatMessage, onWhisperClick } = this.props
    return (
      <Container>
        <MessagesAndInput>
          <StyledMessageList
            messages={channel.messages}
            renderMessage={renderMessage}
            loading={channel.loadingHistory}
            hasMoreHistory={channel.hasHistory}
            onScrollUpdate={this.onScrollUpdate}
          />
          <ChatInput showDivider={this.state.isScrolledUp} onSend={onSendChatMessage} />
        </MessagesAndInput>
        <UserList users={channel.users} onWhisperClick={onWhisperClick} />
      </Container>
    )
  }

  onScrollUpdate = (target: EventTarget) => {
    const { scrollTop, scrollHeight, clientHeight } = target as HTMLDivElement

    const isScrolledUp = scrollTop + clientHeight < scrollHeight
    if (isScrolledUp !== this.state.isScrolledUp) {
      this.setState({ isScrolledUp })
    }

    if (
      this.props.channel.hasHistory &&
      !this.props.channel.loadingHistory &&
      scrollTop < LOADING_AREA_BOTTOM
    ) {
      this.props.onRequestMoreHistory()
    }
  }
}

export default function ChatChannelView() {
  const [, params = {}] = useRoute('/chat/:channel')
  const channelName = params ? decodeURIComponent(params.channel).toLowerCase() : null
  const dispatch = useAppDispatch()
  const channel = useAppSelector(s => s.chat.byName.get(channelName))

  const prevChannelName = usePrevious(channelName)
  const prevChannel = usePrevious(channel)

  // TODO(2Pac): Pull this out into some kind of "isLeaving" hook and share with whispers/lobby?
  useEffect(() => {
    if (prevChannelName === channelName && prevChannel && !channel) {
      push('/')
    }
  })

  // TODO(2Pac): Make this less spammy?
  useEffect(() => {
    dispatch(activateChannel(channelName) as any)
  }, [channel])

  useEffect(() => {
    if (channel) {
      dispatch(retrieveUserList(channelName))
      dispatch(retrieveInitialMessageHistory(channelName))
    } else {
      if (MULTI_CHANNEL) {
        dispatch(joinChannel(channelName))
      } else {
        push('/')
      }
    }

    return () => dispatch(deactivateChannel(channelName) as any)
  }, [channelName])

  const onSendChatMessage = useCallback(msg => dispatch(sendMessage(channelName, msg)), [
    dispatch,
    channelName,
  ])
  const onRequestMoreHistory = useCallback(
    () => dispatch(retrieveNextMessageHistory(channelName)),
    [dispatch, channelName],
  )
  const onWhisperClick = useCallback(user => navigateToWhisper(user), [])

  if (!channel) {
    return (
      <LoadingArea>
        <LoadingIndicator />
      </LoadingArea>
    )
  }

  return (
    <Channel
      channel={channel}
      onSendChatMessage={onSendChatMessage}
      onRequestMoreHistory={onRequestMoreHistory}
      onWhisperClick={onWhisperClick}
    />
  )
}
