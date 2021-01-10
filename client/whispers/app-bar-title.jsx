import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'

import { AppBarTitle } from '../app-bar/app-bar'

const Container = styled.div`
  max-width: 884px;
  margin: 0 auto;
`

@connect(state => ({ whispers: state.whispers, router: state.router }))
export default class WhispersTitle extends React.Component {
  render() {
    const {
      whispers,
      router: {
        location: { pathname },
      },
    } = this.props

    const target = pathname.slice(pathname.lastIndexOf('/') + 1)
    const session = whispers.byName.get(target.toLowerCase())

    return (
      <Container>
        <AppBarTitle as='span'>{`Whisper with ${session ? session.target : target}`}</AppBarTitle>
      </Container>
    )
  }
}
