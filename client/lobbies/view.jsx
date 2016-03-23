import React from 'react'
import { connect } from 'react-redux'
import { routeActions } from 'redux-simple-router'
import ContentLayout from '../content/content-layout.jsx'
import IconButton from '../material/icon-button.jsx'
import { addComputer, leaveLobby, setRace, startCountdown, sendChat } from './action-creators'
import styles from './view.css'

import Lobby from './lobby.jsx'
import LoadingScreen from './loading.jsx'

const mapStateToProps = state => {
  return {
    user: state.auth.user,
    lobby: state.lobby,
    gameClient: state.gameClient,
    hasActiveGame: state.activeGame.isActive,
  }
}

// Returns true if the lobby store state shows that we have left the current lobby
function isLeavingLobby(oldProps, newProps) {
  return (
    oldProps.routeParams === newProps.routeParams && /* rule out a route change */
    oldProps.lobby.inLobby &&
    oldProps.lobby.info.name === oldProps.routeParams.lobby && /* we were in this lobby */
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

  componentWillReceiveProps(nextProps) {
    if (isLeavingLobby(this.props, nextProps)) {
      this.props.dispatch(routeActions.push(nextProps.hasActiveGame ? '/active-game' : '/'))
    }
  }

  render() {
    const routeLobby = this.props.routeParams.lobby
    const { lobby, user, gameClient } = this.props

    let content
    let actions
    if (!lobby.inLobby) {
      content = this.renderJoin()
    } else if (lobby.info.name !== routeLobby) {
      content = this.renderLeaveAndJoin()
    } else if (lobby.info.isLoading) {
      content = <LoadingScreen lobby={lobby} gameStatus={gameClient.status} user={user} />
    } else {
      content = <Lobby lobby={lobby.info} chat={lobby.chat} user={user}
          onAddComputer={this._handleAddComputer} onSetRace={this._handleSetRace}
          onStartGame={this._handleStartGame} onSendChatMessage={this._handleSendChatMessage} />
      actions = [
        <IconButton key='leave' icon='close' title='Leave lobby'
            onClick={this._handleLeaveLobbyClick} />
      ]
    }

    return (<ContentLayout title={this.props.routeParams.lobby} actions={actions}>
      { content }
    </ContentLayout>)
  }

  renderJoin() {
    return <p className={styles.contentArea}>Wanna join this lobby?</p>
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
