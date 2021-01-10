import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'

import { AppBarTitle } from '../app-bar/app-bar'

const Container = styled.div`
  max-width: 1140px;
  margin: 0 auto;
  padding-left: 32px;
`

@connect(state => ({ matchmaking: state.matchmaking }))
export default class LobbyTitle extends React.Component {
  render() {
    const matchmakingTitle = this.props.matchmaking.isLoading
      ? 'Loading game...'
      : 'Game in progress...'

    return (
      <Container>
        <AppBarTitle as='span'>{matchmakingTitle}</AppBarTitle>
      </Container>
    )
  }
}
