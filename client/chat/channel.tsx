import PropTypes from 'prop-types'
import React, { useCallback, useRef, useState } from 'react'
import { connect } from 'react-redux'
import { List as VirtualizedList } from 'react-virtualized'
import styled, { css } from 'styled-components'
import { MULTI_CHANNEL } from '../../common/flags'
import { SelfUserRecord } from '../auth/auth-records'
import Avatar from '../avatars/avatar'
import { DispatchFunction } from '../dispatch-registry'
import WindowListener from '../dom/window-listener'
import MenuItem from '../material/menu/item'
import MessageInput from '../messaging/message-input'
import MessageList from '../messaging/message-list'
import { Message } from '../messaging/message-records'
import { push } from '../navigation/routing'
import UserProfileOverlay from '../profile/user-profile-overlay'
import LoadingIndicator from '../progress/dots'
import { RootState } from '../root-reducer'
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
import { Channel as ChannelRecord, ChatState, Users as UsersRecord } from './chat-reducer'

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
  users: typeof UsersRecord
  onWhisperClick: (user: string) => void
}

class UserList extends React.Component<UserListProps> {
  static propTypes = {
    users: PropTypes.object.isRequired,
    onWhisperClick: PropTypes.func.isRequired,
  }

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

  renderRow = ({ index, style }: { index: number; style: any }) => {
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
  showDivider?: boolean
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
  onSendChatMessage?: (msg: string) => void
  onRequestMoreHistory?: () => void
  onWhisperClick: (user: string) => void
}

class Channel extends React.Component<ChannelProps> {
  static propTypes = {
    channel: PropTypes.object.isRequired,
    onSendChatMessage: PropTypes.func,
    onRequestMoreHistory: PropTypes.func,
    onWhisperClick: PropTypes.func.isRequired,
  }

  state = {
    isScrolledUp: false,
  }

  render() {
    const { channel, onSendChatMessage } = this.props
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
          <ChatInput onSend={onSendChatMessage} showDivider={this.state.isScrolledUp} />
        </MessagesAndInput>
        <UserList users={this.props.channel.users} onWhisperClick={this.props.onWhisperClick} />
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
      this.props.onRequestMoreHistory &&
      this.props.channel.hasHistory &&
      !this.props.channel.loadingHistory &&
      scrollTop < LOADING_AREA_BOTTOM
    ) {
      this.props.onRequestMoreHistory()
    }
  }
}

const mapStateToProps = (state: RootState) => {
  return {
    user: state.auth.user,
    chat: state.chat,
  }
}

interface ChatChannelViewProps {
  user: SelfUserRecord
  chat: typeof ChatState
  dispatch: DispatchFunction<any> // TODO(2Pac): Type this better
  params: any // TODO(2Pac): Type this better
}

function isLeavingChannel(oldProps: ChatChannelViewProps, newProps: ChatChannelViewProps) {
  return (
    oldProps.params.channel.toLowerCase() === newProps.params.channel.toLowerCase() &&
    oldProps.chat.byName.has(oldProps.params.channel.toLowerCase()) &&
    !newProps.chat.byName.has(oldProps.params.channel.toLowerCase())
  )
}

class ChatChannelView extends React.Component<ChatChannelViewProps> {
  componentDidMount() {
    const routeChannel = decodeURIComponent(this.props.params.channel)
    if (this._isInChannel()) {
      this.props.dispatch(retrieveUserList(routeChannel))
      this.props.dispatch(retrieveInitialMessageHistory(routeChannel))
      this.props.dispatch(activateChannel(routeChannel))
    } else {
      this.props.dispatch(joinChannel(routeChannel))
    }
  }

  componentDidUpdate(prevProps: ChatChannelViewProps) {
    if (isLeavingChannel(prevProps, this.props)) {
      push('/')
      return
    }

    const prevChannel = decodeURIComponent(prevProps.params.channel)
    const routeChannel = decodeURIComponent(this.props.params.channel)
    if (this._isInChannel()) {
      this.props.dispatch(retrieveUserList(routeChannel))
      this.props.dispatch(retrieveInitialMessageHistory(routeChannel))
      this.props.dispatch(activateChannel(routeChannel))
    } else if (
      !prevProps.chat.byName.has(routeChannel) &&
      prevChannel.toLowerCase() !== routeChannel.toLowerCase()
    ) {
      if (MULTI_CHANNEL) {
        this.props.dispatch(joinChannel(routeChannel))
      } else {
        push('/')
      }
    }
    if (prevChannel && prevChannel.toLowerCase() !== routeChannel.toLowerCase()) {
      this.props.dispatch(deactivateChannel(prevChannel))
    }
  }

  componentWillUnmount() {
    this.props.dispatch(deactivateChannel(decodeURIComponent(this.props.params.channel)))
  }

  render() {
    const routeChannel = decodeURIComponent(this.props.params.channel)
    const channel = this.props.chat.byName.get(routeChannel.toLowerCase())

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
        onSendChatMessage={this.onSendChatMessage}
        onRequestMoreHistory={this.onRequestMoreHistory}
        onWhisperClick={this.onWhisperClick}
      />
    )
  }

  onSendChatMessage = (msg: string) => {
    this.props.dispatch(sendMessage(decodeURIComponent(this.props.params.channel), msg))
  }

  onRequestMoreHistory = () => {
    this.props.dispatch(retrieveNextMessageHistory(decodeURIComponent(this.props.params.channel)))
  }

  onWhisperClick = (user: string) => {
    navigateToWhisper(user)
  }

  _isInChannel() {
    const routeChannel = decodeURIComponent(this.props.params.channel)
    return this.props.chat.byName.has(routeChannel.toLowerCase())
  }
}

export default connect(mapStateToProps)(ChatChannelView)
