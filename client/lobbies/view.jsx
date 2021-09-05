import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { Route, Switch } from 'wouter'
import { openMapPreviewDialog, toggleFavoriteMap } from '../maps/action-creators'
import { push, replace } from '../navigation/routing'
import LoadingIndicator from '../progress/dots'
import {
  activateLobby,
  addComputer,
  banPlayer,
  changeSlot,
  closeSlot,
  deactivateLobby,
  getLobbyState,
  kickPlayer,
  leaveLobby,
  makeObserver,
  openSlot,
  removeObserver,
  sendChat,
  setRace,
  startCountdown,
} from './action-creators'
import ActiveLobby from './active-lobby'
import LoadingScreen from './loading'
import Lobby from './lobby'

const mapStateToProps = state => {
  return {
    user: state.auth.user,
    lobbyState: state.lobbyState,
    lobby: state.lobby,
    gameClient: state.gameClient,
    activeGame: state.activeGame,
    maps: state.maps,
  }
}

// Returns true if the lobby store state shows that we have left the current lobby
function isLeavingLobby(oldProps, newProps) {
  return (
    oldProps.params.lobby === newProps.params.lobby /* rule out a route change */ &&
    oldProps.lobby.inLobby &&
    oldProps.lobby.info.name ===
      decodeURIComponent(oldProps.params.lobby) /* we were in this lobby */ &&
    !newProps.lobby.inLobby /* now we're not */
  )
}

const LoadingArea = styled.div`
  height: 32px;
  display: flex;
  align-items: center;
`

const PreLobbyArea = styled.div`
  display: flex;
  flex-direction: column;
  padding: 0 16px;
`

@connect(mapStateToProps)
export default class LobbyView extends React.Component {
  componentDidMount() {
    if (!this.props.lobby.inLobby) {
      const routeLobby = decodeURIComponent(this.props.params.lobby)
      this.props.dispatch(getLobbyState(routeLobby))
    } else {
      this.props.dispatch(activateLobby())
    }
  }

  componentDidUpdate(prevProps) {
    if (isLeavingLobby(prevProps, this.props) && !this.props.activeGame.isActive) {
      push('/')
      return
    }

    if (prevProps.activeGame.isActive && !this.props.activeGame.isActive) {
      // TODO(2Pac): handle this in socket-handlers once we start tracking game ending on the server
      replace('/')
      return
    }

    const routeLobby = prevProps.params.lobby
    const nextRouteLobby = this.props.params.lobby
    if (!prevProps.lobby.inLobby && routeLobby !== nextRouteLobby) {
      prevProps.dispatch(getLobbyState(decodeURIComponent(nextRouteLobby)))
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
      activeGame: { isActive: hasActiveGame, info: gameInfo },
    } = this.props

    if (!hasActiveGame) return null

    return <ActiveLobby lobby={gameInfo.extra.lobby.info} />
  }

  renderLobby = params => {
    const routeLobby = decodeURIComponent(params.lobby)
    const { lobby, maps, user } = this.props

    let content
    if (!lobby.inLobby) {
      content = this.renderLobbyState(routeLobby)
    } else if (lobby.info.name !== routeLobby) {
      content = this.renderLeaveAndJoin()
    } else {
      content = (
        <Lobby
          lobby={lobby.info}
          chat={lobby.chat}
          user={user}
          isFavoritingMap={maps.favoriteStatusRequests.has(lobby.info.map.id)}
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
          onMapPreview={this.onMapPreview}
          onToggleFavoriteMap={this.onToggleFavoriteMap}
        />
      )
    }

    return content
  }

  render() {
    return (
      <Switch>
        <Route path='/lobbies/:lobby/loading-game'>{this.renderLoadingScreen}</Route>
        <Route path='/lobbies/:lobby/active-game'>{this.renderActiveLobby}</Route>
        <Route path='/lobbies/:lobby'>{this.renderLobby}</Route>
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

  renderLobbyState(routeLobby) {
    const { lobbyState } = this.props
    if (!lobbyState.has(routeLobby)) {
      return null
    }

    const lobby = lobbyState.get(routeLobby)
    let preLobbyAreaContents
    if (!lobby.state && !lobby.error) {
      if (lobby.isRequesting) {
        preLobbyAreaContents = (
          <LoadingArea>
            <LoadingIndicator />
          </LoadingArea>
        )
      } else {
        preLobbyAreaContents = <span>There was a problem loading this lobby</span>
      }
    } else if (lobby.state) {
      preLobbyAreaContents = [
        lobby.isRequesting ? (
          <LoadingArea key='loading'>
            <LoadingIndicator />
          </LoadingArea>
        ) : null,
        this.renderLobbyStateContent(lobby.state),
      ]
    } else if (lobby.error) {
      preLobbyAreaContents = [
        lobby.isRequesting ? (
          <LoadingArea key='loading'>
            <LoadingIndicator />
          </LoadingArea>
        ) : null,
        <p>There was a problem loading this lobby</p>,
      ]
    }

    return <PreLobbyArea>{preLobbyAreaContents}</PreLobbyArea>
  }

  renderLeaveAndJoin() {
    return <PreLobbyArea as='p'>You're already in another lobby.</PreLobbyArea>
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

  onMapPreview = () => {
    const {
      lobby: {
        info: { map },
      },
    } = this.props

    this.props.dispatch(openMapPreviewDialog(map.id))
  }

  onToggleFavoriteMap = () => {
    this.props.dispatch(toggleFavoriteMap(this.props.lobby.info.map))
  }
}
