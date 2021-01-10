import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { push } from 'connected-react-router'
import styled, { css } from 'styled-components'
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
import MessageInput from '../messaging/message-input'
import LoadingIndicator from '../progress/dots'
import MessageList from '../messaging/message-list'
import MenuItem from '../material/menu/item'
import UserProfileOverlay from '../profile/user-profile-overlay'
import { ScrollableContent } from '../material/scroll-bar'
import { colorDividers, colorTextSecondary } from '../styles/colors'
import { body2, overline, singleLine } from '../styles/typography'

import { MULTI_CHANNEL } from '../../common/flags'

// Height to the bottom of the loading area (the top of the messages)
const LOADING_AREA_BOTTOM = 32 + 8

const UserListContainer = styled.div`
  width: 256px;
  flex-grow: 0;
  flex-shrink: 0;
`

const UserListSection = styled.div`
  padding-left: 8px;
  padding-right: 8px;

  &:first-child {
    margin-top: 8px;
  }

  &:last-child {
    margin-bottom: 8px;
  }

  & + & {
    margin-top: 24px;
  }
`

const userListRow = css`
  ${singleLine};

  height: 36px;
  margin: 0;
  padding: 0 8px;
  line-height: 36px;
`

const UserListOverline = styled.div`
  ${overline}
  ${userListRow};
  color: ${colorTextSecondary};
`

const UserSublist = styled.ul`
  list-style-type: none;
  margin: 0;
  padding: 0;
`

const UserListEntryItem = styled.li`
  ${body2};
  ${userListRow};
  height: 44px;
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
`

const StyledAvatar = styled(Avatar)`
  width: 32px;
  height: 32px;

  display: inline-block;

  margin: 2px 16px 2px 0;
`

const UserListName = styled.span`
  ${singleLine};
  display: inline-block;
`

class UserListEntry extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
    onWhisperClick: PropTypes.func.isRequired,
  }

  state = {
    userOverlayOpen: false,
  }

  _userEntryRef = React.createRef()

  renderUserOverlay() {
    return (
      <UserProfileOverlay
        open={this.state.userOverlayOpen}
        onDismiss={this.onCloseUserOverlay}
        anchor={this._userEntryRef.current}
        user={this.props.user}>
        <MenuItem text='Whisper' onClick={this.onWhisperClick} />
      </UserProfileOverlay>
    )
  }

  render() {
    return (
      <>
        <UserListEntryItem
          ref={this._userEntryRef}
          isOverlayOpen={this.state.userOverlayOpen}
          onClick={this.onOpenUserOverlay}>
          <StyledAvatar user={this.props.user} />
          <UserListName>{this.props.user}</UserListName>
        </UserListEntryItem>
        {this.renderUserOverlay()}
      </>
    )
  }

  onOpenUserOverlay = () => {
    this.setState({ userOverlayOpen: true })
  }

  onCloseUserOverlay = () => {
    this.setState({ userOverlayOpen: false })
  }

  onWhisperClick = () => {
    this.props.onWhisperClick(this.props.user)
  }
}

class UserList extends React.Component {
  static propTypes = {
    users: PropTypes.object.isRequired,
    onWhisperClick: PropTypes.func.isRequired,
  }

  shouldComponentUpdate(nextProps) {
    return this.props.users !== nextProps.users
  }

  renderSection(title, users) {
    if (!users.size) {
      return null
    }

    return (
      <UserListSection>
        <UserListOverline>
          {title} ({users.size})
        </UserListOverline>
        <UserSublist>
          {users.map(u => (
            <UserListEntry user={u} key={u} onWhisperClick={this.props.onWhisperClick} />
          ))}
        </UserSublist>
      </UserListSection>
    )
  }

  render() {
    const { active, idle, offline } = this.props.users
    return (
      <UserListContainer>
        <ScrollableContent>
          {this.renderSection('Active', active)}
          {this.renderSection('Idle', idle)}
          {this.renderSection('Offline', offline)}
        </ScrollableContent>
      </UserListContainer>
    )
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
