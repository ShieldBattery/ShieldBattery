import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { routerActions } from 'react-router-redux'
import {
  sendMessage,
  startWhisperSession,
  retrieveInitialMessageHistory,
  retrieveNextMessageHistory,
  activateWhisperSession,
  deactivateWhisperSession,
} from './action-creators'
import styles from './whisper.css'

import LoadingIndicator from '../progress/dots.jsx'
import MessageInput from '../messaging/message-input.jsx'
import MessageList from '../messaging/message-list.jsx'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'

// Height to the bottom of the loading area (the top of the messages)
const LOADING_AREA_BOTTOM = 32 + 8

class Whisper extends React.Component {
  static propTypes = {
    session: PropTypes.object.isRequired,
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
      nextProps.session !== this.props.session &&
      this.props.session.messages.size > 0 &&
      nextProps.session.messages.size > this.props.session.messages.size &&
      nextProps.session.messages.get(0) !== this.props.session.messages.get(0)
    this.messageList.setInsertingAtTop(insertingAtTop)
  }

  render() {
    const { session, onSendChatMessage } = this.props
    const inputClass = this.state.isScrolledUp ? styles.chatInputScrollBorder : styles.chatInput
    return (
      <div className={styles.container}>
        <div className={styles.messagesAndInput}>
          <div className={styles.messages}>
            <MessageList
              ref={this._setMessageListRef}
              loading={session.loadingHistory}
              hasMoreHistory={session.hasHistory}
              messages={session.messages}
              onScrollUpdate={this.onScrollUpdate}
            />
          </div>
          <MessageInput className={inputClass} onSend={onSendChatMessage} />
        </div>
      </div>
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
      this.props.session.hasHistory &&
      !this.props.session.loadingHistory &&
      scrollTop < LOADING_AREA_BOTTOM
    ) {
      this.props.onRequestMoreHistory()
    }
  }
}

// Returns true if the whispers store state shows that we have closed the whisper session while
// having it opened
function isClosingCurrentWhisperSession(oldProps, newProps) {
  return (
    // Rule out a route change
    oldProps.location === newProps.location &&
    // We had a whisper session with this user
    oldProps.whispers.byName.has(oldProps.match.params.target.toLowerCase()) &&
    // Now we don't
    !newProps.whispers.byName.has(newProps.match.params.target.toLowerCase())
  )
}

@connect(state => ({ whispers: state.whispers, user: state.auth.user }))
export default class WhisperView extends React.Component {
  constructor(props) {
    super(props)
    this._handleSendChatMessage = ::this.onSendChatMessage
    this._handleRequestMoreHistory = ::this.onRequestMoreHistory
  }

  componentDidMount() {
    const target = this.props.match.params.target.toLowerCase()
    if (this.props.user.name.toLowerCase() === target) {
      this.props.dispatch(routerActions.push('/'))
      this.props.dispatch(openSnackbar({ message: "Can't whisper with yourself." }))
      return
    }

    if (this._hasWhisperSession(target)) {
      this.props.dispatch(retrieveInitialMessageHistory(target))
      this.props.dispatch(activateWhisperSession(target))
    } else {
      this.props.dispatch(startWhisperSession(target))
    }
  }

  componentWillReceiveProps(nextProps) {
    if (isClosingCurrentWhisperSession(this.props, nextProps)) {
      this.props.dispatch(routerActions.push('/'))
      return
    }

    const target = nextProps.match.params.target.toLowerCase()
    // TODO(tec27): this really only handles one type of error (session creation failure), it needs
    // to handle (or ignore) other stuff too, like sending errors
    const error = nextProps.whispers.errorsByName.get(target)
    if (error) {
      this.props.dispatch(routerActions.push('/'))
      this.props.dispatch(openSnackbar({ message: error, time: TIMING_LONG }))
      return
    }

    if (nextProps.user.name.toLowerCase() === target) {
      this.props.dispatch(routerActions.push('/'))
      this.props.dispatch(openSnackbar({ message: "Can't whisper with yourself." }))
      return
    }
  }

  componentDidUpdate(prevProps) {
    const target = this.props.match.params.target.toLowerCase()
    if (this._hasWhisperSession(target)) {
      this.props.dispatch(retrieveInitialMessageHistory(target))
      this.props.dispatch(activateWhisperSession(target))
    } else if (!prevProps.whispers.byName.has(target)) {
      this.props.dispatch(startWhisperSession(target))
    }
    if (prevProps.match.params.target && prevProps.match.params.target.toLowerCase() !== target) {
      this.props.dispatch(deactivateWhisperSession(prevProps.match.params.target.toLowerCase()))
    }
  }

  componentWillUnmount() {
    this.props.dispatch(deactivateWhisperSession(this.props.match.params.target.toLowerCase()))
  }

  render() {
    const target = this.props.match.params.target
    const session = this.props.whispers.byName.get(target.toLowerCase())

    if (!session) {
      return (
        <div className={styles.loadingArea}>
          <LoadingIndicator />
        </div>
      )
    }

    return (
      <Whisper
        session={session}
        onSendChatMessage={this._handleSendChatMessage}
        onRequestMoreHistory={this._handleRequestMoreHistory}
      />
    )
  }

  onSendChatMessage(msg) {
    this.props.dispatch(sendMessage(this.props.match.params.target, msg))
  }

  onRequestMoreHistory() {
    this.props.dispatch(retrieveNextMessageHistory(this.props.match.params.target))
  }

  _hasWhisperSession(target) {
    return this.props.whispers.byName.has(target)
  }
}
