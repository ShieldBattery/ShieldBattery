import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'

import { AppBarTitle } from '../app-bar/app-bar'

const Container = styled.div`
  max-width: 1140px;
  margin: 0 auto;
  padding-left: 32px;
`

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

    return (
      <Container>
        <AppBarTitle as='span'>{lobbyTitle}</AppBarTitle>
      </Container>
    )
  }
}
