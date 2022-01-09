import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { Chat } from '../messaging/chat'
import { push } from '../navigation/routing'
import LoadingIndicator from '../progress/dots'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
import {
  activateWhisperSession,
  deactivateWhisperSession,
  getMessageHistory,
  sendMessage,
  startWhisperSession,
} from './action-creators'

const MESSAGES_LIMIT = 50

const Container = styled.div`
  max-width: 884px;
  height: 100%;
  padding: 0;
`

const LoadingArea = styled.div`
  padding-top: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
`

// Returns true if the whispers store state shows that we have closed the whisper session while
// having it opened
function isClosingCurrentWhisperSession(oldProps, newProps) {
  return (
    // Rule out a route change
    oldProps.params.target.toLowerCase() === newProps.params.target.toLowerCase() &&
    // We had a whisper session with this user
    oldProps.whispers.byName.has(oldProps.params.target.toLowerCase()) &&
    // Now we don't
    !newProps.whispers.byName.has(newProps.params.target.toLowerCase())
  )
}

@connect(state => ({ whispers: state.whispers, user: state.auth.user }))
export default class Whisper extends React.Component {
  componentDidMount() {
    const target = decodeURIComponent(this.props.params.target).toLowerCase()
    if (this.props.user.name.toLowerCase() === target) {
      push('/')
      this.props.dispatch(openSnackbar({ message: "Can't whisper with yourself." }))
      return
    }

    if (this._hasWhisperSession(target)) {
      this.props.dispatch(activateWhisperSession(target))
    } else {
      this.props.dispatch(startWhisperSession(target))
    }
  }

  componentDidUpdate(prevProps) {
    if (isClosingCurrentWhisperSession(prevProps, this.props)) {
      push('/')
      return
    }

    const target = decodeURIComponent(this.props.params.target).toLowerCase()
    // TODO(tec27): this really only handles one type of error (session creation failure), it needs
    // to handle (or ignore) other stuff too, like sending errors
    const error = this.props.whispers.errorsByName.get(target)
    if (error) {
      push('/')
      this.props.dispatch(openSnackbar({ message: error, time: TIMING_LONG }))
      return
    }

    if (this.props.user.name.toLowerCase() === target) {
      push('/')
      this.props.dispatch(openSnackbar({ message: "Can't whisper with yourself." }))
      return
    }

    if (this._hasWhisperSession(target)) {
      this.props.dispatch(activateWhisperSession(target))
    } else if (!prevProps.whispers.byName.has(target)) {
      this.props.dispatch(startWhisperSession(target))
    }
    if (
      prevProps.params.target &&
      decodeURIComponent(prevProps.params.target).toLowerCase() !== target
    ) {
      this.props.dispatch(
        deactivateWhisperSession(decodeURIComponent(prevProps.params.target).toLowerCase()),
      )
    }
  }

  componentWillUnmount() {
    this.props.dispatch(
      deactivateWhisperSession(decodeURIComponent(this.props.params.target).toLowerCase()),
    )
  }

  render() {
    const target = decodeURIComponent(this.props.params.target)
    const session = this.props.whispers.byName.get(target.toLowerCase())

    if (!session) {
      return (
        <LoadingArea>
          <LoadingIndicator />
        </LoadingArea>
      )
    }

    const listProps = {
      messages: session.messages,
      loading: session.loadingHistory,
      hasMoreHistory: session.hasHistory,
      refreshToken: target,
      onLoadMoreMessages: this.onLoadMoreMessages,
    }
    const inputProps = {
      onSendChatMessage: this.onSendChatMessage,
    }

    return (
      <Container>
        <Chat listProps={listProps} inputProps={inputProps} />
      </Container>
    )
  }

  onLoadMoreMessages = () => {
    const target = decodeURIComponent(this.props.params.target)

    this.props.dispatch(getMessageHistory(target, MESSAGES_LIMIT))
  }

  onSendChatMessage = msg => {
    this.props.dispatch(sendMessage(decodeURIComponent(this.props.params.target), msg))
  }

  _hasWhisperSession(target) {
    return this.props.whispers.byName.has(target)
  }
}
