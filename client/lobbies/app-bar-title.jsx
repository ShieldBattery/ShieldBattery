import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'

import { AppBarTitle } from '../app-bar/app-bar.jsx'

const Container = styled.div`
  max-width: 1140px;
  margin: 0 auto;
  padding-left: 32px;
`

@connect(state => ({ routing: state.routing }))
export default class LobbyTitle extends React.Component {
  render() {
    const {
      routing: {
        location: { pathname },
      },
    } = this.props

    const lobbyTitle = pathname.slice(pathname.lastIndexOf('/') + 1)

    return (
      <Container>
        <AppBarTitle>{lobbyTitle}</AppBarTitle>
      </Container>
    )
  }
}
