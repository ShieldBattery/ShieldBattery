import React, { PropTypes } from 'react'
import { connect } from 'react-redux'
import { routeActions } from 'redux-simple-router'
import {
  sendMessage,
  startWhisperSession,
  retrieveInitialMessageHistory,
  retrieveNextMessageHistory,
  activateWhisperSession,
  deactivateWhisperSession,
} from './action-creators'
import styles from './whisper.css'

import ContentLayout from '../content/content-layout.jsx'
import LoadingIndicator from '../progress/dots.jsx'
import MessageList from '../messaging/message-list.jsx'
import TextField from '../material/text-field.jsx'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'

// Height to the bottom of the loading area (the top of the messages)
const LOADING_AREA_BOTTOM = 32 + 8

class Whisper extends React.Component {
  static propTypes = {
    session: PropTypes.object.isRequired,
    onSendChatMessage: PropTypes.func,
    onRequestMoreHistory: PropTypes.func,
  };

  constructor(props) {
    super(props)
    this.state = {
      isScrolledUp: false
    }

    this.messageList = null
    this._setMessageListRef = elem => { this.messageList = elem }

    this._handleChatEnter = ::this.onChatEnter
    this._handleScrollUpdate = ::this.onScrollUpdate
  }

  componentWillUpdate(nextProps, nextState) {
    const insertingAtTop = nextProps.session !== this.props.session &&
        this.props.session.messages.size > 0 &&
        nextProps.session.messages.size > this.props.session.messages.size &&
        nextProps.session.messages.get(0) !== this.props.session.messages.get(0)
    this.messageList.setInsertingAtTop(insertingAtTop)
  }

  render() {
    const { session } = this.props
    const inputClass = this.state.isScrolledUp ? styles.chatInputScrollBorder : styles.chatInput
    return (<div className={styles.container}>
      <div className={styles.messagesAndInput}>
        <div className={styles.messages}>
          <MessageList
              ref={this._setMessageListRef}
              loading={session.loadingHistory}
              hasMoreHistory={session.hasHistory}
              messages={session.messages}
              onScrollUpdate={this._handleScrollUpdate}/>
        </div>
        <TextField ref='chatEntry' className={inputClass} label='Send a message'
            maxLength={500} floatingLabel={false} allowErrors={false} autoComplete='off'
            onEnterKeyDown={this._handleChatEnter}/>
      </div>
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

    const isScrolledUp = scrollTop + clientHeight < scrollHeight
    if (isScrolledUp !== this.state.isScrolledUp) {
      this.setState({ isScrolledUp })
    }

    if (this.props.onRequestMoreHistory &&
        this.props.session.hasHistory && !this.props.session.loadingHistory &&
        scrollTop < LOADING_AREA_BOTTOM) {
      this.props.onRequestMoreHistory()
    }
  }
}

// Returns true if the whispers store state shows that we have closed the whisper session while
// having it opened
function isClosingCurrentWhisperSession(oldProps, newProps) {
  return (
    // Rule out a route change
    oldProps.routeParams === newProps.routeParams &&
    // We had a whisper session with this user
    oldProps.whispers.sessions.has(oldProps.routeParams.target) &&
    // Now we don't
    !newProps.whispers.sessions.has(newProps.routeParams.target)
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
    const target = this.props.routeParams.target
    if (this.props.user.name === target) {
      this.props.dispatch(routeActions.push('/'))
      this.props.dispatch(openSnackbar({ message: 'Can\'t whisper with yourself.' }))
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
      this.props.dispatch(routeActions.push('/'))
      return
    }

    const target = nextProps.routeParams.target
    // TODO(tec27): this really only handles one type of error (session creation failure), it needs
    // to handle (or ignore) other stuff too, like sending errors
    const error = nextProps.whispers.errorsByName.get(target)
    if (error) {
      this.props.dispatch(routeActions.push('/'))
      this.props.dispatch(openSnackbar({ message: error, time: TIMING_LONG }))
      return
    }

    if (nextProps.user.name === target) {
      this.props.dispatch(routeActions.push('/'))
      this.props.dispatch(openSnackbar({ message: 'Can\'t whisper with yourself.' }))
      return
    }
  }

  componentDidUpdate(prevProps) {
    const target = this.props.routeParams.target
    if (this._hasWhisperSession(target)) {
      this.props.dispatch(retrieveInitialMessageHistory(target))
      this.props.dispatch(activateWhisperSession(target))
    } else if (!prevProps.whispers.sessions.has(target)) {
      this.props.dispatch(startWhisperSession(target))
    }
    if (this._hasWhisperSession(target) &&
        prevProps.routeParams.target &&
        prevProps.routeParams.target !== target) {
      this.props.dispatch(deactivateWhisperSession(prevProps.routeParams.target))
    }
  }

  componentWillUnmount() {
    const target = this.props.routeParams.target
    if (this._hasWhisperSession(target)) {
      this.props.dispatch(deactivateWhisperSession(target))
    }
  }

  render() {
    const target = this.props.routeParams.target
    const session = this.props.whispers.byName.get(target)

    return (
      <ContentLayout title={`Whisper with ${target}`} appBarContentClassName={styles.appBarContent}>
        { session ? <Whisper session={session} onSendChatMessage={this._handleSendChatMessage}
            onRequestMoreHistory={this._handleRequestMoreHistory} /> : <LoadingIndicator /> }
      </ContentLayout>
    )
  }

  onSendChatMessage(msg) {
    this.props.dispatch(sendMessage(this.props.routeParams.target, msg))
  }

  onRequestMoreHistory() {
    this.props.dispatch(retrieveNextMessageHistory(this.props.routeParams.target))
  }

  _hasWhisperSession(target) {
    return this.props.whispers.sessions.has(target)
  }
}
