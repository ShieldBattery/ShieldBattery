import React from 'react'
import { connect } from 'react-redux'
import ContentLayout from '../content/content-layout.jsx'

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
    return <span>Wanna join this lobby?</span>
  }

  renderLeaveAndJoin() {
    return <span>You're already in another lobby.</span>
  }

  renderLobby() {
    const { lobby } = this.props
    const sortedPlayers = lobby.players.valueSeq().sortBy(p => p.slot)
    console.dir(sortedPlayers)
    return (<div>
      <p>Name: {lobby.name}</p>
      <p>Map: {lobby.map}</p>
      <p>Slots: {lobby.players.size} / {lobby.numSlots}</p>
      <p>Host: {lobby.players.get(lobby.hostId).name}</p>
      <ul>
        {
          lobby.players.valueSeq().sortBy(p => p.slot).map(p => (<li key={p.slot}>
            <span>{p.slot + 1}. </span><span>{p.name} - </span><span>{p.race} - </span>
            <span>{p.isComputer ? 'Computer' : 'Human'}</span>
          </li>)).toArray()
        }
      </ul>
    </div>)
  }
}
