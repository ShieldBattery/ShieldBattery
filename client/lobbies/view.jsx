import React from 'react'
import { connect } from 'react-redux'
import { pushPath } from 'redux-simple-router'
import ContentLayout from '../content/content-layout.jsx'
import Card from '../material/card.jsx'
import IconButton from '../material/icon-button.jsx'
import { leaveLobby } from './action-creators'
import styles from './view.css'

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
    }, [])

    const slots = []
    for (let i = 0; i < lobby.numSlots; i++) {
      let playerElem
      if (playersBySlot[i]) {
        const p = playersBySlot[i]
        playerElem = <div>
          <span>{p.slot + 1}. </span><span>{p.name} - </span><span>{p.race} - </span>
          <span>{p.isComputer ? 'Computer' : 'Human'}</span>
        </div>
      } else {
        playerElem = <span>{i + 1}. <em>Empty</em></span>
      }

      slots.push(<div className={styles.slotCard} key={i}>{playerElem}</div>)
    }

    return (<div className={styles.contentArea}>
      <p>Map: {lobby.map}</p>
      <p>Slots: {lobby.players.size} / {lobby.numSlots}</p>
      <p>Host: {lobby.players.get(lobby.hostId).name}</p>
      <Card className={styles.slots}>
        <div className={styles.slotColumn}>{slots}</div>
      </Card>
    </div>)
  }

  onLeaveLobbyClick() {
    this.props.dispatch(leaveLobby())
  }
}
