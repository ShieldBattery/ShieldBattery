import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'

import { AppBarTitle } from '../app-bar/app-bar.jsx'

const Container = styled.div`
  max-width: 1140px;
  margin: 0 auto;
`

@connect(state => ({ chat: state.chat, router: state.router }))
export class ChatTitle extends React.Component {
  render() {
    const {
      chat,
      router: {
        location: { pathname },
      },
    } = this.props

    const routeChannel = pathname.slice(pathname.lastIndexOf('/') + 1)
    const channel = chat.byName.get(routeChannel.toLowerCase())

    return (
      <Container>
        <AppBarTitle as="span">{`#${channel ? channel.name : routeChannel}`}</AppBarTitle>
      </Container>
    )
  }
}

export class ChatListTitle extends React.Component {
  render() {
    return <AppBarTitle as="span">Chat channels</AppBarTitle>
  }
}
