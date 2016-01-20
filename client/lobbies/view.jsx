import React from 'react'
import { connect } from 'react-redux'
import { routeActions } from 'redux-simple-router'
import ContentLayout from '../content/content-layout.jsx'
import IconButton from '../material/icon-button.jsx'
import { addComputer, leaveLobby, setRace, startCountdown } from './action-creators'
import styles from './view.css'

import Lobby from './lobby.jsx'

const mapStateToProps = state => {
  return {
    user: state.auth.user,
    lobby: state.lobby.name ? state.lobby : undefined,
  }
}

// Returns true if the lobby store state shows that we have left the current lobby
function isLeavingLobby(oldProps, newProps) {
  return (
    oldProps.routeParams === newProps.routeParams && /* rule out a route change */
    oldProps.lobby &&
    oldProps.lobby.name === oldProps.routeParams.lobby && /* we were in this lobby */
    !newProps.lobby /* now we're not */
  )
}

@connect(mapStateToProps)
export default class LobbyView extends React.Component {
  componentWillReceiveProps(nextProps) {
    if (isLeavingLobby(this.props, nextProps)) {
      this.props.dispatch(routeActions.push('/'))
    }
  }

  render() {
    const routeLobby = this.props.routeParams.lobby
    const { lobby, user } = this.props

    let content
    let actions
    if (!lobby) {
      content = this.renderJoin()
    } else if (lobby.name !== routeLobby) {
      content = this.renderLeaveAndJoin()
    } else {
      content = <Lobby lobby={lobby} user={user} onAddComputer={::this.onAddComputer}
          onSetRace={::this.onSetRace} onStartGame={::this.onStartGame} />
      actions = [
        <IconButton key='leave' icon='close' title='Leave lobby'
            onClick={::this.onLeaveLobbyClick} />
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

  onStartGame() {
    this.props.dispatch(startCountdown())
  }
}
