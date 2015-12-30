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
    return <span>In this lobby, yeah!</span>
  }
}
