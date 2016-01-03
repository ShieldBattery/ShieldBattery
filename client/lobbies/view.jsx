import React from 'react'
import { connect } from 'react-redux'
import ContentLayout from '../content/content-layout.jsx'
import Card from '../material/card.jsx'
import FlatButton from '../material/flat-button.jsx'
import styles from './view.css'
import { leaveLobby } from './action-creators'

const mapStateToProps = state => {
  return {
    user: state.auth.user,
    lobby: state.lobby.name ? state.lobby : undefined,
  }
}

@connect(mapStateToProps)
export default class LobbyView extends React.Component {
  render() {
    const routeLobby = this.props.routeParams.lobby
    const { lobby } = this.props

    let content
    if (!lobby) {
      content = this.renderJoin()
    } else if (lobby.name !== routeLobby) {
      content = this.renderLeaveAndJoin()
    } else {
      content = this.renderLobby()
    }

    return (<ContentLayout title={this.props.routeParams.lobby}>
      { content }
    </ContentLayout>)
  }

  renderJoin() {
    return <span className={styles.contentArea}>Wanna join this lobby?</span>
  }

  renderLeaveAndJoin() {
    return <span className={styles.contentArea}>You're already in another lobby.</span>
  }

  renderLobby() {
    const { lobby } = this.props
    const halfNumSlots = Math.ceil(lobby.numSlots / 2)
    const playersBySlot = lobby.players.valueSeq().reduce((result, p) => {
      result[p.slot] = p
      return result
    }, [])

    const firstCol = []
    const secondCol = []
    for (let i = 0; i < lobby.numSlots; i++) {
      let playerElem
      if (playersBySlot[i]) {
        const p = playersBySlot[i]
        playerElem = <div>
          <span>{p.slot + 1}. </span><span>{p.name} - </span><span>{p.race} - </span>
          <span>{p.isComputer ? 'Computer' : 'Human'}</span>
        </div>
      } else {
        playerElem = <em>Empty</em>
      }

      if (i < halfNumSlots) {
        firstCol.push(<Card className={styles.slotCard} key={i}>{playerElem}</Card>)
      } else {
        secondCol.push(<Card className={styles.slotCard} key={i}>{playerElem}</Card>)
      }
    }

    return (<div className={styles.contentArea}>
      <FlatButton color='primary' label='Leave lobby' onClick={::this.onLeaveLobbyClick} />
      <p>Map: {lobby.map}</p>
      <p>Slots: {lobby.players.size} / {lobby.numSlots}</p>
      <p>Host: {lobby.players.get(lobby.hostId).name}</p>
      <div className={styles.slots}>
        <div className={styles.slotColumn}>{firstCol}</div>
        <div className={styles.slotColumn}>{secondCol}</div>
      </div>
    </div>)
  }

  onLeaveLobbyClick() {
    this.props.dispatch(leaveLobby())
  }
}
