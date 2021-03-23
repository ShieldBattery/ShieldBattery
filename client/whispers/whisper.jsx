import React from 'react'
import PropTypes from 'prop-types'
import { connect } from 'react-redux'
import { push } from '../navigation/routing'
import styled from 'styled-components'
import {
  sendMessage,
  startWhisperSession,
  retrieveInitialMessageHistory,
  retrieveNextMessageHistory,
  activateWhisperSession,
  deactivateWhisperSession,
} from './action-creators'

import LoadingIndicator from '../progress/dots'
import MessageInput from '../messaging/message-input'
import MessageList from '../messaging/message-list'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
import { colorDividers } from '../styles/colors'

// Height to the bottom of the loading area (the top of the messages)
const LOADING_AREA_BOTTOM = 32 + 8

const Container = styled.div`
  max-width: 884px;
  height: 100%;
  margin: 0 auto;
  padding: 0;
  padding-left: var(--pixel-shove-x, 0px) solid transparent;
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

const CHAT_INPUT_HEIGHT_PX = 56
const CHAT_INPUT_PADDING_PX = 16

const StyledMessageList = styled(MessageList)`
  height: calc(100% - ${CHAT_INPUT_HEIGHT_PX}px - ${CHAT_INPUT_PADDING_PX}px);
  contain: strict;
`

const ChatInput = styled(MessageInput)`
  position: relative;
  padding: ${CHAT_INPUT_PADDING_PX / 2}px 16px;
  contain: content;

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

class Whisper extends React.Component {
  static propTypes = {
    session: PropTypes.object.isRequired,
    onSendChatMessage: PropTypes.func,
    onRequestMoreHistory: PropTypes.func,
  }

  state = {
    isScrolledUp: false,
  }

  render() {
    const { session, onSendChatMessage } = this.props
    return (
      <Container>
        <MessagesAndInput>
          <StyledMessageList
            loading={session.loadingHistory}
            hasMoreHistory={session.hasHistory}
            messages={session.messages}
            onScrollUpdate={this.onScrollUpdate}
          />
          <ChatInput onSend={onSendChatMessage} showDivider={this.state.isScrolledUp} />
        </MessagesAndInput>
      </Container>
    )
  }

  onScrollUpdate = target => {
    const { scrollTop, scrollHeight, clientHeight } = target

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
    oldProps.params.target.toLowerCase() === newProps.params.target.toLowerCase() &&
    // We had a whisper session with this user
    oldProps.whispers.byName.has(oldProps.params.target.toLowerCase()) &&
    // Now we don't
    !newProps.whispers.byName.has(newProps.params.target.toLowerCase())
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
    const target = decodeURIComponent(this.props.params.target).toLowerCase()
    if (this.props.user.name.toLowerCase() === target) {
      push('/')
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
      this.props.dispatch(retrieveInitialMessageHistory(target))
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

    return (
      <Whisper
        session={session}
        onSendChatMessage={this._handleSendChatMessage}
        onRequestMoreHistory={this._handleRequestMoreHistory}
      />
    )
  }

  onSendChatMessage(msg) {
    this.props.dispatch(sendMessage(decodeURIComponent(this.props.params.target), msg))
  }

  onRequestMoreHistory() {
    this.props.dispatch(retrieveNextMessageHistory(decodeURIComponent(this.props.params.target)))
  }

  _hasWhisperSession(target) {
    return this.props.whispers.byName.has(target)
  }
}
