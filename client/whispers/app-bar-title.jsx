import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'

import { AppBarTitle } from '../app-bar/app-bar.jsx'

const Container = styled.div`
  max-width: 884px;
  margin: 0 auto;
`

@connect(state => ({ whispers: state.whispers, routing: state.routing }))
export default class WhispersTitle extends React.Component {
  render() {
    const {
      whispers,
      routing: {
        location: { pathname },
      },
    } = this.props

    const target = pathname.slice(pathname.lastIndexOf('/') + 1)
    const session = whispers.byName.get(target.toLowerCase())

    return (
      <Container>
        <AppBarTitle>{`Whisper with ${session ? session.target : target}`}</AppBarTitle>
      </Container>
    )
  }
}
