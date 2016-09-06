import React, { PropTypes } from 'react'
import { connect } from 'react-redux'
import { routerActions } from 'react-router-redux'
import {
  sendMessage,
  retrieveInitialMessageHistory,
  retrieveNextMessageHistory,
  retrieveUserList,
  activateChannel,
  deactivateChannel,
} from './action-creators'
import styles from './channel.css'

import ContentLayout from '../content/content-layout.jsx'
import MessageInput from '../messaging/message-input.jsx'
import MessageList from '../messaging/message-list.jsx'
import { ScrollableContent } from '../material/scroll-bar.jsx'

// Height to the bottom of the loading area (the top of the messages)
const LOADING_AREA_BOTTOM = 32 + 8

class UserListEntry extends React.Component {
  static propTypes = {
    user: PropTypes.string.isRequired,
  };

  render() {
    return <li className={styles.userListEntry}>{this.props.user}</li>
  }
}

class UserList extends React.Component {
  static propTypes = {
    users: PropTypes.object.isRequired,
  };

  shouldComponentUpdate(nextProps) {
    return this.props.users !== nextProps.users
  }

  renderSection(title, users) {
    if (!users.size) {
      return null
    }

    return (<div className={styles.userListSection}>
      <p className={styles.userSubheader}>{title}</p>
      <ul className={styles.userSublist}>
        { users.map(u => <UserListEntry user={u} key={u} />) }
      </ul>
    </div>)
  }

  render() {
    const { active, idle, offline } = this.props.users
    return (<div className={styles.userList}>
      <ScrollableContent>
        { this.renderSection('Active', active) }
        { this.renderSection('Idle', idle) }
        { this.renderSection('Offline', offline) }
      </ScrollableContent>
    </div>)
  }
}

class Channel extends React.Component {
  static propTypes = {
    channel: PropTypes.object.isRequired,
    onSendChatMessage: PropTypes.func,
    onRequestMoreHistory: PropTypes.func,
  };

  messageList = null;
  _setMessageListRef = elem => { this.messageList = elem };
  state = {
    isScrolledUp: false
  };

  componentWillUpdate(nextProps, nextState) {
    const insertingAtTop = nextProps.channel !== this.props.channel &&
        this.props.channel.messages.size > 0 &&
        nextProps.channel.messages.size > this.props.channel.messages.size &&
        nextProps.channel.messages.get(0) !== this.props.channel.messages.get(0)
    this.messageList.setInsertingAtTop(insertingAtTop)
  }

  render() {
    const { channel, onSendChatMessage } = this.props
    const inputClass = this.state.isScrolledUp ? styles.chatInputScrollBorder : styles.chatInput
    return (<div className={styles.container}>
      <div className={styles.messagesAndInput}>
        <div className={styles.messages}>
          <MessageList
              ref={this._setMessageListRef}
              loading={channel.loadingHistory}
              hasMoreHistory={channel.hasHistory}
              messages={channel.messages}
              onScrollUpdate={this.onScrollUpdate}/>
        </div>
        <MessageInput className={inputClass} onSend={onSendChatMessage} />
      </div>
      <UserList users={this.props.channel.users} />
    </div>)
  }

  onScrollUpdate = values => {
    const { scrollTop, scrollHeight, clientHeight } = values

    const isScrolledUp = scrollTop + clientHeight < scrollHeight
    if (isScrolledUp !== this.state.isScrolledUp) {
      this.setState({ isScrolledUp })
    }

    if (this.props.onRequestMoreHistory &&
        this.props.channel.hasHistory && !this.props.channel.loadingHistory &&
        scrollTop < LOADING_AREA_BOTTOM) {
      this.props.onRequestMoreHistory()
    }
  };
}

const mapStateToProps = state => {
  return {
    user: state.auth.user,
    chat: state.chat,
  }
}

function isLeavingChannel(oldProps, newProps) {
  return (
    oldProps.params === newProps.params &&
    oldProps.chat.byName.has(oldProps.params.channel) &&
    !newProps.chat.byName.has(oldProps.params.channel)
  )
}

@connect(mapStateToProps)
export default class ChatChannelView extends React.Component {
  constructor(props) {
    super(props)
    this._handleSendChatMessage = ::this.onSendChatMessage
    this._handleRequestMoreHistory = ::this.onRequestMoreHistory
  }

  componentWillReceiveProps(nextProps) {
    if (isLeavingChannel(this.props, nextProps)) {
      this.props.dispatch(routerActions.push('/'))
    }
  }

  componentDidMount() {
    if (this._isInChannel()) {
      const routeChannel = this.props.params.channel
      this.props.dispatch(retrieveUserList(routeChannel))
      this.props.dispatch(retrieveInitialMessageHistory(routeChannel))
      this.props.dispatch(activateChannel(routeChannel))
    }
  }

  componentDidUpdate(prevProps) {
    const routeChannel = this.props.params.channel
    if (this._isInChannel()) {
      this.props.dispatch(retrieveUserList(routeChannel))
      this.props.dispatch(retrieveInitialMessageHistory(routeChannel))
      this.props.dispatch(activateChannel(routeChannel))
    }
    if (prevProps.params.channel &&
        prevProps.params.channel !== routeChannel) {
      this.props.dispatch(deactivateChannel(prevProps.params.channel))
    }
  }

  componentWillUnmount() {
    this.props.dispatch(deactivateChannel(this.props.params.channel))
  }

  renderJoinChannel() {
    return <span>Not in this channel. Join it?</span>
  }

  renderChannel() {
    return (<Channel
        channel={this.props.chat.byName.get(this.props.params.channel)}
        onSendChatMessage={this._handleSendChatMessage}
        onRequestMoreHistory={this._handleRequestMoreHistory}/>)
  }

  render() {
    const routeChannel = this.props.params.channel
    const title = `#${routeChannel}`

    return (<ContentLayout title={title} appBarContentClassName={styles.appBarContent}>
      { this._isInChannel() ? this.renderChannel() : this.renderJoinChannel() }
    </ContentLayout>)
  }

  onSendChatMessage(msg) {
    this.props.dispatch(sendMessage(this.props.params.channel, msg))
  }

  onRequestMoreHistory() {
    this.props.dispatch(retrieveNextMessageHistory(this.props.params.channel))
  }

  _isInChannel() {
    const routeChannel = this.props.params.channel
    return this.props.chat.byName.has(routeChannel)
  }
}
