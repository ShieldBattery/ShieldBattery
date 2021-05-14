import React from 'react'
import { connect } from 'react-redux'
import { AppBarTitle } from '../app-bar/app-bar'

@connect(state => ({ activeGame: state.activeGame, lobby: state.lobby }))
export default class LobbyTitle extends React.Component {
  render() {
    const { activeGame, lobby } = this.props

    let lobbyTitle
    if (activeGame.isActive) {
      lobbyTitle = 'Game in progress...'
    } else if (lobby.info.isLoading) {
      lobbyTitle = 'Loading...'
    } else {
      lobbyTitle = lobby.info.name
    }

    return <AppBarTitle>{lobbyTitle}</AppBarTitle>
  }
}
