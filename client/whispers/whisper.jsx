import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { push } from 'connected-react-router'
import styled from 'styled-components'
import {
  sendMessage,
  startWhisperSession,
  retrieveInitialMessageHistory,
  retrieveNextMessageHistory,
  activateWhisperSession,
  deactivateWhisperSession,
} from './action-creators'

import LoadingIndicator from '../progress/dots.jsx'
import MessageInput from '../messaging/message-input.jsx'
import MessageList from '../messaging/message-list.jsx'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
import { colorDividers } from '../styles/colors'

// Height to the bottom of the loading area (the top of the messages)
const LOADING_AREA_BOTTOM = 32 + 8

const Container = styled.div`
  max-width: 884px;
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
    return (
      <Container>
        <MessagesAndInput>
          <Messages isScrolledUp={this.state.isScrolledUp}>
            <MessageList
              ref={this._setMessageListRef}
              loading={session.loadingHistory}
              hasMoreHistory={session.hasHistory}
              messages={session.messages}
              onScrollUpdate={this.onScrollUpdate}
            />
          </Messages>
          <ChatInput onSend={onSendChatMessage} />
        </MessagesAndInput>
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
    this._handleSendChatMessage = this.onSendChatMessage.bind(this)
    this._handleRequestMoreHistory = this.onRequestMoreHistory.bind(this)
  }

  componentDidMount() {
    const target = this.props.match.params.target.toLowerCase()
    if (this.props.user.name.toLowerCase() === target) {
      this.props.dispatch(push('/'))
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
      this.props.dispatch(push('/'))
      return
    }

    const target = nextProps.match.params.target.toLowerCase()
    // TODO(tec27): this really only handles one type of error (session creation failure), it needs
    // to handle (or ignore) other stuff too, like sending errors
    const error = nextProps.whispers.errorsByName.get(target)
    if (error) {
      this.props.dispatch(push('/'))
      this.props.dispatch(openSnackbar({ message: error, time: TIMING_LONG }))
      return
    }

    if (nextProps.user.name.toLowerCase() === target) {
      this.props.dispatch(push('/'))
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
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
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
