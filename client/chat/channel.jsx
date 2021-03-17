import React, { useCallback, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { push } from 'connected-react-router'
import styled, { css } from 'styled-components'
import { List as VirtualizedList } from 'react-virtualized'
import {
  sendMessage,
  retrieveInitialMessageHistory,
  retrieveNextMessageHistory,
  retrieveUserList,
  activateChannel,
  deactivateChannel,
  joinChannel,
} from './action-creators'
import { navigateToWhisper } from '../whispers/action-creators'

import Avatar from '../avatars/avatar'
import WindowListener from '../dom/window-listener'
import MessageInput from '../messaging/message-input'
import LoadingIndicator from '../progress/dots'
import MessageList from '../messaging/message-list'
import MenuItem from '../material/menu/item'
import UserProfileOverlay from '../profile/user-profile-overlay'
import { colorDividers, colorTextSecondary, alphaDisabled } from '../styles/colors'
import { body2, overline, singleLine } from '../styles/typography'

import { MULTI_CHANNEL } from '../../common/flags'

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

const UserListEntryItem = styled.div`
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

const UserListEntry = React.memo(props => {
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
        <MenuItem text='Whisper' onClick={onWhisperClick} />
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

UserListEntry.propTypes = {
  user: PropTypes.string.isRequired,
  onWhisperClick: PropTypes.func.isRequired,
  faded: PropTypes.bool,
  style: PropTypes.any,
}

const UsersVirtualizedList = styled(VirtualizedList)`
  &:focus,
  & > div:focus {
    outline: none;
  }
`

class UserList extends React.Component {
  static propTypes = {
    users: PropTypes.object.isRequired,
    onWhisperClick: PropTypes.func.isRequired,
  }

  state = {
    width: 0,
    height: 0,
  }
  _contentRef = React.createRef()
  _listRef = React.createRef()

  componentDidMount() {
    this.updateDimensions()
  }

  componentDidUpdate(prevProps) {
    if (prevProps.users !== this.props.users) {
      this._listRef.current?.recomputeRowHeights()
    }
  }

  getRowHeight = ({ index }) => {
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

  renderRow = ({ index, style }) => {
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
`

const Messages = styled.div`
  height: calc(100% - 56px - 16px); /* chat input height + margin */
  margin: 0 0 -1px 0;
  border-bottom: 1px solid
    ${props => (props.isScrolledUp ? colorDividers : 'rgba(255, 255, 255, 0)')};
  transition: border 250ms linear;
`

const ChatInput = styled(MessageInput)`
  margin: 8px 0;
  padding: 0 16px;
`

class Channel extends React.Component {
  static propTypes = {
    channel: PropTypes.object.isRequired,
    onSendChatMessage: PropTypes.func,
    onRequestMoreHistory: PropTypes.func,
    onWhisperClick: PropTypes.func.isRequired,
  }

  messageList = null
  _setMessageListRef = elem => {
    this.messageList = elem
  }
  state = {
    isScrolledUp: false,
  }

  getSnapshotBeforeUpdate(prevProps) {
    const insertingAtTop =
      prevProps.channel !== this.props.channel &&
      prevProps.channel.chatMessages.size > 0 &&
      this.props.channel.chatMessages.size > prevProps.channel.chatMessages.size &&
      this.props.channel.chatMessages.get(0) !== prevProps.channel.chatMessages.get(0)
    this.messageList.setInsertingAtTop(insertingAtTop)
    return null
  }

  render() {
    const { channel, onSendChatMessage } = this.props
    return (
      <Container>
        <MessagesAndInput>
          <Messages isScrolledUp={this.state.isScrolledUp}>
            <MessageList
              ref={this._setMessageListRef}
              loading={channel.loadingHistory}
              hasMoreHistory={channel.hasHistory}
              messages={channel.messages}
              onScrollUpdate={this.onScrollUpdate}
            />
          </Messages>
          <ChatInput onSend={onSendChatMessage} />
        </MessagesAndInput>
        <UserList users={this.props.channel.users} onWhisperClick={this.props.onWhisperClick} />
      </Container>
    )
  }

  onScrollUpdate = values => {
    const { scrollTop, scrollHeight, clientHeight } = values

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

const mapStateToProps = state => {
  return {
    user: state.auth.user,
    chat: state.chat,
  }
}

function isLeavingChannel(oldProps, newProps) {
  return (
    oldProps.location === newProps.location &&
    oldProps.chat.byName.has(oldProps.match.params.channel.toLowerCase()) &&
    !newProps.chat.byName.has(oldProps.match.params.channel.toLowerCase())
  )
}

@connect(mapStateToProps)
export default class ChatChannelView extends React.Component {
  componentDidMount() {
    const routeChannel = this.props.match.params.channel
    if (this._isInChannel()) {
      this.props.dispatch(retrieveUserList(routeChannel))
      this.props.dispatch(retrieveInitialMessageHistory(routeChannel))
      this.props.dispatch(activateChannel(routeChannel))
    } else {
      this.props.dispatch(joinChannel(routeChannel))
    }
  }

  componentDidUpdate(prevProps) {
    if (isLeavingChannel(prevProps, this.props)) {
      this.props.dispatch(push('/'))
      return
    }

    const prevChannel = prevProps.match.params.channel
    const routeChannel = this.props.match.params.channel
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
        this.props.dispatch(push('/'))
      }
    }
    if (prevChannel && prevChannel.toLowerCase() !== routeChannel.toLowerCase()) {
      this.props.dispatch(deactivateChannel(prevChannel))
    }
  }

  componentWillUnmount() {
    this.props.dispatch(deactivateChannel(this.props.match.params.channel))
  }

  render() {
    const routeChannel = this.props.match.params.channel
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

  onSendChatMessage = msg => {
    this.props.dispatch(sendMessage(this.props.match.params.channel, msg))
  }

  onRequestMoreHistory = () => {
    this.props.dispatch(retrieveNextMessageHistory(this.props.match.params.channel))
  }

  onWhisperClick = user => {
    this.props.dispatch(navigateToWhisper(user))
  }

  _isInChannel() {
    const routeChannel = this.props.match.params.channel
    return this.props.chat.byName.has(routeChannel.toLowerCase())
  }
}
