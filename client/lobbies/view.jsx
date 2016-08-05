import React from 'react'
import { connect } from 'react-redux'
import { routerActions } from 'react-router-redux'
import ContentLayout from '../content/content-layout.jsx'
import IconButton from '../material/icon-button.jsx'
import {
  addComputer,
  leaveLobby,
  setRace,
  startCountdown,
  sendChat,
  getLobbyState,
  activateLobby,
  deactivateLobby,
} from './action-creators'
import styles from './view.css'

import Lobby from './lobby.jsx'
import LoadingScreen from './loading.jsx'

const mapStateToProps = state => {
  return {
    user: state.auth.user,
    lobbyState: state.lobbyState,
    lobby: state.lobby,
    gameClient: state.gameClient,
    hasActiveGame: state.activeGame.isActive,
  }
}

// Returns true if the lobby store state shows that we have left the current lobby
function isLeavingLobby(oldProps, newProps) {
  return (
    oldProps.params === newProps.params && /* rule out a route change */
    oldProps.lobby.inLobby &&
    oldProps.lobby.info.name === oldProps.params.lobby && /* we were in this lobby */
    !newProps.lobby.inLobby /* now we're not */
  )
}

@connect(mapStateToProps)
export default class LobbyView extends React.Component {
  constructor(props) {
    super(props)
    this._handleAddComputer = ::this.onAddComputer
    this._handleSetRace = ::this.onSetRace
    this._handleStartGame = ::this.onStartGame
    this._handleLeaveLobbyClick = ::this.onLeaveLobbyClick
    this._handleSendChatMessage = ::this.onSendChatMessage
  }

  componentDidMount() {
    if (!this.props.lobby.inLobby) {
      const routeLobby = this.props.params.lobby
      this.props.dispatch(getLobbyState(routeLobby))
    } else {
      this.props.dispatch(activateLobby())
    }
  }

  componentDidUpdate() {
    if (this.props.lobby.inLobby) {
      this.props.dispatch(activateLobby())
    }
  }

  componentWillUnmount() {
    this.props.dispatch(deactivateLobby())
  }

  componentWillReceiveProps(nextProps) {
    if (isLeavingLobby(this.props, nextProps)) {
      this.props.dispatch(routerActions.push(nextProps.hasActiveGame ? '/active-game' : '/'))
      return
    }

    const routeLobby = this.props.params.lobby
    const nextRouteLobby = nextProps.params.lobby
    if (!this.props.lobby.inLobby && routeLobby !== nextRouteLobby) {
      this.props.dispatch(getLobbyState(nextRouteLobby))
    }
  }

  render() {
    const routeLobby = this.props.params.lobby
    const { lobby, user, gameClient } = this.props

    let content
    let actions
    if (!lobby.inLobby) {
      content = this.renderLobbyState()
    } else if (lobby.info.name !== routeLobby) {
      content = this.renderLeaveAndJoin()
    } else if (lobby.info.isLoading) {
      content = <LoadingScreen lobby={lobby.info} gameStatus={gameClient.status} user={user} />
    } else {
      content = <Lobby lobby={lobby.info} chat={lobby.chat} user={user}
          onAddComputer={this._handleAddComputer} onSetRace={this._handleSetRace}
          onStartGame={this._handleStartGame} onSendChatMessage={this._handleSendChatMessage} />
      actions = [
        <IconButton key='leave' icon='close' title='Leave lobby'
            onClick={this._handleLeaveLobbyClick} />
      ]
    }

    return (<ContentLayout title={this.props.params.lobby} actions={actions}>
      { content }
    </ContentLayout>)
  }

  // TODO(tec27): refactor out into its own component
  renderLobbyStateContent(state) {
    switch (state) {
      case 'nonexistent':
        return <p>Lobby doesn't exist. Create it?</p>
      case 'exists':
        return <p>Lobby already exists. Join it?</p>
      case 'countingDown':
      case 'hasStarted':
        return <p>Lobby already started.</p>
      default:
        throw new Error('Unknown lobby state: ' + state)
    }
  }

  renderLobbyState() {
    const routeLobby = this.props.params.lobby
    const { lobbyState } = this.props
    if (!lobbyState.has(routeLobby)) {
      return null
    }

    const lobby = lobbyState.get(routeLobby)
    if (!lobby.state && !lobby.error) {
      if (lobby.isRequesting) {
        return <span className={styles.contentArea}>Loading&hellip;</span>
      } else {
        return <span className={styles.contentArea}>There was a problem loading this lobby</span>
      }
    } else if (lobby.state) {
      return (<div className={styles.contentArea}>
        { lobby.isRequesting ? <p>Updating&hellip;</p> : null }
        { this.renderLobbyStateContent(lobby.state) }
      </div>)
    } else if (lobby.error) {
      return (<div className={styles.contentArea}>
        { lobby.isRequesting ? <p>Updating&hellip;</p> : null }
        <p>There was a problem loading this lobby</p>
      </div>)
    }

    return null
  }

  renderLeaveAndJoin() {
    return <p className={styles.contentArea}>You're already in another lobby.</p>
  }

  onLeaveLobbyClick() {
    this.props.dispatch(leaveLobby())
  }

  onAddComputer(slotNum) {
    this.props.dispatch(addComputer(slotNum))
  }

  onSetRace(id, race) {
    this.props.dispatch(setRace(id, race))
  }

  onSendChatMessage(message) {
    this.props.dispatch(sendChat(message))
  }

  onStartGame() {
    this.props.dispatch(startCountdown())
  }
}
