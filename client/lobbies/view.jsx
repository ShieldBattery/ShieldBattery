import React from 'react'
import { connect } from 'react-redux'
import { Route, Switch } from 'react-router-dom'
import { push, replace } from 'connected-react-router'
import styles from './view.css'

import Lobby from './lobby.jsx'
import LoadingScreen from './loading.jsx'
import LoadingIndicator from '../progress/dots.jsx'

import {
  addComputer,
  changeSlot,
  openSlot,
  closeSlot,
  kickPlayer,
  banPlayer,
  makeObserver,
  removeObserver,
  leaveLobby,
  setRace,
  startCountdown,
  sendChat,
  getLobbyState,
  activateLobby,
  deactivateLobby,
} from './action-creators'

const mapStateToProps = state => {
  return {
    user: state.auth.user,
    lobbyState: state.lobbyState,
    lobby: state.lobby,
    gameClient: state.gameClient,
    activeGame: state.activeGame,
  }
}

// Returns true if the lobby store state shows that we have left the current lobby
function isLeavingLobby(oldProps, newProps) {
  return (
    oldProps.location === newProps.location /* rule out a route change */ &&
    oldProps.lobby.inLobby &&
    oldProps.lobby.info.name === oldProps.match.params.lobby /* we were in this lobby */ &&
    !newProps.lobby.inLobby /* now we're not */
  )
}

@connect(mapStateToProps)
export default class LobbyView extends React.Component {
  componentDidMount() {
    if (!this.props.lobby.inLobby) {
      const routeLobby = this.props.match.params.lobby
      this.props.dispatch(getLobbyState(routeLobby))
    } else {
      this.props.dispatch(activateLobby())
    }
  }

  componentDidUpdate(prevProps) {
    if (isLeavingLobby(prevProps, this.props) && !this.props.activeGame.isActive) {
      this.props.dispatch(push('/'))
      return
    }

    if (prevProps.activeGame.isActive && !this.props.activeGame.isActive) {
      // TODO(2Pac): handle this in socket-handlers once we start tracking game ending on the server
      this.props.dispatch(replace('/'))
      return
    }

    const routeLobby = prevProps.match.params.lobby
    const nextRouteLobby = this.props.match.params.lobby
    if (!prevProps.lobby.inLobby && routeLobby !== nextRouteLobby) {
      prevProps.dispatch(getLobbyState(nextRouteLobby))
    }

    if (this.props.lobby.inLobby) {
      this.props.dispatch(activateLobby())
    }
  }

  componentWillUnmount() {
    this.props.dispatch(deactivateLobby())
  }

  renderLoadingScreen = () => {
    const { lobby, user, gameClient } = this.props

    if (!lobby.info.isLoading) return null

    return <LoadingScreen lobby={lobby.info} gameStatus={gameClient.status} user={user} />
  }

  renderActiveLobby = () => {
    const {
      activeGame: { isActive: hasActiveGame },
    } = this.props

    if (!hasActiveGame) return null

    return <span>Why are you looking here?</span>
  }

  renderLobby = () => {
    const routeLobby = this.props.match.params.lobby
    const { lobby, user } = this.props

    let content
    if (!lobby.inLobby) {
      content = this.renderLobbyState()
    } else if (lobby.info.name !== routeLobby) {
      content = this.renderLeaveAndJoin()
    } else {
      content = (
        <Lobby
          lobby={lobby.info}
          chat={lobby.chat}
          user={user}
          onLeaveLobbyClick={this.onLeaveLobbyClick}
          onAddComputer={this.onAddComputer}
          onSetRace={this.onSetRace}
          onSwitchSlot={this.onSwitchSlot}
          onOpenSlot={this.onOpenSlot}
          onCloseSlot={this.onCloseSlot}
          onKickPlayer={this.onKickPlayer}
          onBanPlayer={this.onBanPlayer}
          onMakeObserver={this.onMakeObserver}
          onRemoveObserver={this.onRemoveObserver}
          onStartGame={this.onStartGame}
          onSendChatMessage={this.onSendChatMessage}
        />
      )
    }

    return content
  }

  render() {
    return (
      <Switch>
        <Route path='/lobbies/:lobby/loading-game' render={this.renderLoadingScreen} />
        <Route path='/lobbies/:lobby/active-game' render={this.renderActiveLobby} />
        <Route path='/lobbies/:lobby' exact={true} render={this.renderLobby} />
      </Switch>
    )
  }

  // TODO(tec27): refactor out into its own component
  renderLobbyStateContent(state) {
    switch (state) {
      case 'nonexistent':
        return <p key='stateContent'>Lobby doesn't exist. Create it?</p>
      case 'exists':
        return <p key='stateContent'>Lobby already exists. Join it?</p>
      case 'countingDown':
      case 'hasStarted':
        return <p key='stateContent'>Lobby already started.</p>
      default:
        throw new Error('Unknown lobby state: ' + state)
    }
  }

  renderLobbyState() {
    const routeLobby = this.props.match.params.lobby
    const { lobbyState } = this.props
    if (!lobbyState.has(routeLobby)) {
      return null
    }

    const lobby = lobbyState.get(routeLobby)
    let preLobbyAreaContents
    if (!lobby.state && !lobby.error) {
      if (lobby.isRequesting) {
        preLobbyAreaContents = (
          <div className={styles.loadingArea}>
            <LoadingIndicator />
          </div>
        )
      } else {
        preLobbyAreaContents = <span>There was a problem loading this lobby</span>
      }
    } else if (lobby.state) {
      preLobbyAreaContents = [
        lobby.isRequesting ? (
          <div key='loading' className={styles.loadingArea}>
            <LoadingIndicator />
          </div>
        ) : null,
        this.renderLobbyStateContent(lobby.state),
      ]
    } else if (lobby.error) {
      preLobbyAreaContents = [
        lobby.isRequesting ? (
          <div key='loading' className={styles.loadingArea}>
            <LoadingIndicator />
          </div>
        ) : null,
        <p>There was a problem loading this lobby</p>,
      ]
    }

    return <div className={styles.preLobbyArea}>{preLobbyAreaContents}</div>
  }

  renderLeaveAndJoin() {
    return <p className={styles.preLobbyArea}>You're already in another lobby.</p>
  }

  onLeaveLobbyClick = () => {
    this.props.dispatch(leaveLobby())
  }

  onAddComputer = slotId => {
    this.props.dispatch(addComputer(slotId))
  }

  onSwitchSlot = slotId => {
    this.props.dispatch(changeSlot(slotId))
  }

  onOpenSlot = slotId => {
    this.props.dispatch(openSlot(slotId))
  }

  onCloseSlot = slotId => {
    this.props.dispatch(closeSlot(slotId))
  }

  onKickPlayer = slotId => {
    this.props.dispatch(kickPlayer(slotId))
  }

  onBanPlayer = slotId => {
    this.props.dispatch(banPlayer(slotId))
  }

  onMakeObserver = slotId => {
    this.props.dispatch(makeObserver(slotId))
  }

  onRemoveObserver = slotId => {
    this.props.dispatch(removeObserver(slotId))
  }

  onSetRace = (slotId, race) => {
    this.props.dispatch(setRace(slotId, race))
  }

  onSendChatMessage = message => {
    this.props.dispatch(sendChat(message))
  }

  onStartGame = () => {
    this.props.dispatch(startCountdown())
  }
}
