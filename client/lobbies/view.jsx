import React from 'react'
import { connect } from 'react-redux'
import { pushPath } from 'redux-simple-router'
import ContentLayout from '../content/content-layout.jsx'
import Card from '../material/card.jsx'
import IconButton from '../material/icon-button.jsx'
import RaisedButton from '../material/raised-button.jsx'
import { leaveLobby } from './action-creators'
import styles from './view.css'

import EmptySlot from './empty-slot.jsx'
import FilledSlot from './filled-slot.jsx'

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
      this.props.dispatch(pushPath('/', null))
    }
  }

  render() {
    const routeLobby = this.props.routeParams.lobby
    const { lobby } = this.props

    let content
    let actions
    if (!lobby) {
      content = this.renderJoin()
    } else if (lobby.name !== routeLobby) {
      content = this.renderLeaveAndJoin()
    } else {
      content = this.renderLobby()
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

  renderLobby() {
    const { lobby } = this.props
    const playersBySlot = lobby.players.valueSeq().reduce((result, p) => {
      result[p.slot] = p
      return result
    }, new Array(lobby.numSlots))

    const slots = new Array(lobby.numSlots)
    for (let i = 0; i < lobby.numSlots; i++) {
      if (playersBySlot[i]) {
        const { name, race, isComputer } = playersBySlot[i]
        slots[i] = <FilledSlot name={name} race={race} isComputer={isComputer} />
      } else {
        slots[i] = <EmptySlot />
      }
    }

    return (<div className={styles.contentArea}>
      <div className={styles.top}>
        <Card className={lobby.numSlots > 4 ? styles.slotsDense : styles.slotsSparse}>
          <div className={styles.slotColumn}>{slots}</div>
        </Card>
        <div className={styles.info}>
          <h3 className={styles.mapName}>{lobby.map}</h3>
          <img className={styles.mapThumbnail} src='/images/map-placeholder.jpg' />
          <div className={styles.infoItem}>
            <span className={styles.infoLabel}>Game type</span>
            <span className={styles.infoValue}>Melee</span>
          </div>
          <RaisedButton className={styles.startButton} color='primary' label='Start game' />
        </div>
      </div>
      <div className={styles.chat}>
        <p className={styles.chatHeader}>Chat</p>
      </div>
    </div>)
  }

  onLeaveLobbyClick() {
    this.props.dispatch(leaveLobby())
  }
}
