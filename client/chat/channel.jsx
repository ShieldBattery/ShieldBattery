import React, { PropTypes } from 'react'
import { connect } from 'react-redux'
import { routeActions } from 'redux-simple-router'
import { sendMessage, retrieveInitialMessageHistory } from './action-creators'
import styles from './channel.css'

import ContentLayout from '../content/content-layout.jsx'
import MessageList from '../messaging/message-list.jsx'
import TextField from '../material/text-field.jsx'

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
      { this.renderSection('Active', active) }
      { this.renderSection('Idle', idle) }
      { this.renderSection('Offline', offline) }
    </div>)
  }
}

class Channel extends React.Component {
  static propTypes = {
    channel: PropTypes.object.isRequired,
    onSendChatMessage: PropTypes.func,
  };

  constructor(props) {
    super(props)
    this.state = {
      isScrolledUp: false
    }
    this._handleChatEnter = ::this.onChatEnter
    this._handleScrollUpdate = ::this.onScrollUpdate
  }

  render() {
    const { channel } = this.props
    const inputClass = this.state.isScrolledUp ? styles.chatInputScrollBorder : styles.chatInput
    return (<div className={styles.container}>
      <div className={styles.messagesAndInput}>
        <MessageList loading={channel.loadingHistory} messages={channel.messages}
            onScrollUpdate={this._handleScrollUpdate}/>
        <TextField ref='chatEntry' className={inputClass} label='Send a message'
            maxLength={500} floatingLabel={false} allowErrors={false} autoComplete='off'
            onEnterKeyDown={this._handleChatEnter}/>
      </div>
      <UserList users={this.props.channel.users} />
    </div>)
  }

  onChatEnter() {
    if (this.props.onSendChatMessage) {
      this.props.onSendChatMessage(this.refs.chatEntry.getValue())
    }
    this.refs.chatEntry.clearValue()
  }

  onScrollUpdate(values) {
    const { scrollTop, scrollHeight, clientHeight } = values
    this.setState({
      isScrolledUp: scrollTop + clientHeight < scrollHeight,
    })
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
    oldProps.routeParams === newProps.routeParams &&
    oldProps.chat.byName.has(oldProps.routeParams.channel) &&
    !newProps.chat.byName.has(oldProps.routeParams.channel)
  )
}

@connect(mapStateToProps)
export default class ChatChannelView extends React.Component {
  constructor(props) {
    super(props)
    this._handleSendChatMessage = ::this.onSendChatMessage
  }

  componentWillReceiveProps(nextProps) {
    if (isLeavingChannel(this.props, nextProps)) {
      this.props.dispatch(routeActions.push('/'))
    }
  }

  componentDidMount() {
    if (this._isInChannel()) {
      const routeChannel = this.props.routeParams.channel
      this.props.dispatch(retrieveInitialMessageHistory(routeChannel))
    }
  }

  componentDidUpdate(prevProps) {
    if (this._isInChannel()) {
      const routeChannel = this.props.routeParams.channel
      this.props.dispatch(retrieveInitialMessageHistory(routeChannel))
    }
  }

  renderJoinChannel() {
    return <span>Not in this channel. Join it?</span>
  }

  renderChannel() {
    return (<Channel channel={this.props.chat.byName.get(this.props.routeParams.channel)}
        onSendChatMessage={this._handleSendChatMessage}/>)
  }

  render() {
    const routeChannel = this.props.routeParams.channel
    const title = `#${routeChannel}`

    return (<ContentLayout title={title}>
      { this._isInChannel() ? this.renderChannel() : this.renderJoinChannel() }
    </ContentLayout>)
  }

  onSendChatMessage(msg) {
    this.props.dispatch(sendMessage(this.props.routeParams.channel, msg))
  }

  _isInChannel() {
    const routeChannel = this.props.routeParams.channel
    return this.props.chat.byName.has(routeChannel)
  }
}
