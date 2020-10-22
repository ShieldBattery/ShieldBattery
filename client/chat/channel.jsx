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

import MessageInput from '../messaging/message-input.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import MessageList from '../messaging/message-list.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'
import { colorDividers, colorTextSecondary } from '../styles/colors'
import { Body2, singleLine } from '../styles/typography'

import { MULTI_CHANNEL } from '../../common/flags'

// Height to the bottom of the loading area (the top of the messages)
const LOADING_AREA_BOTTOM = 32 + 8

const UserListContainer = styled.div`
  width: 256px;
  flex-grow: 0;
  flex-shrink: 0;
`

const UserListSection = styled.div`
  padding-left: 16px;

  &:first-child {
    padding-top: 16px;
  }

  &:last-child {
    padding-bottom: 16px;
  }

  & + & {
    margin-top: 16px;
  }
`

const userListRow = css`
  height: 28px;
  margin: 0;
  padding: 0;
  line-height: 28px;
`

const UserListSubheader = styled(Body2)`
  ${singleLine};
  ${userListRow};
  color: ${colorTextSecondary};
`

const UserSublist = styled.ul`
  list-style-type: none;
  margin: 0;
  padding: 0;
`

const UserListEntryItem = styled.li`
  ${userListRow};
`

class UserListEntry extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
  }

  render() {
    return <UserListEntryItem>{this.props.user}</UserListEntryItem>
  }
}

class UserList extends React.Component {
  static propTypes = {
    users: PropTypes.object.isRequired,
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
        <UserListSubheader as='p'>{title}</UserListSubheader>
        <UserSublist>
          {users.map(u => (
            <UserListEntry user={u} key={u} />
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
  height: calc(100% - 56px - 16px); /* chat input height + margin */h
  margin: 0 0 -1px 0;
  border-bottom: 1px solid ${props =>
    props.isScrolledUp ? colorDividers : 'rgba(255, 255, 255, 0)'};
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
  }

  messageList = null
  _setMessageListRef = elem => {
    this.messageList = elem
  }
  state = {
    isScrolledUp: false,
  }

  componentWillUpdate(nextProps, nextState) {
    const insertingAtTop =
      nextProps.channel !== this.props.channel &&
      this.props.channel.messages.size > 0 &&
      nextProps.channel.messages.size > this.props.channel.messages.size &&
      nextProps.channel.messages.get(0) !== this.props.channel.messages.get(0)
    this.messageList.setInsertingAtTop(insertingAtTop)
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
        <UserList users={this.props.channel.users} />
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
  constructor(props) {
    super(props)
    this._handleSendChatMessage = this.onSendChatMessage.bind(this)
    this._handleRequestMoreHistory = this.onRequestMoreHistory.bind(this)
  }

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

  componentWillReceiveProps(nextProps) {
    if (isLeavingChannel(this.props, nextProps)) {
      this.props.dispatch(push('/'))
    }
  }

  componentDidUpdate(prevProps) {
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
        onSendChatMessage={this._handleSendChatMessage}
        onRequestMoreHistory={this._handleRequestMoreHistory}
      />
    )
  }

  onSendChatMessage(msg) {
    this.props.dispatch(sendMessage(this.props.match.params.channel, msg))
  }

  onRequestMoreHistory() {
    this.props.dispatch(retrieveNextMessageHistory(this.props.match.params.channel))
  }

  _isInChannel() {
    const routeChannel = this.props.match.params.channel
    return this.props.chat.byName.has(routeChannel.toLowerCase())
  }
}
