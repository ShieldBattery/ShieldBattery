import React from 'react'
import { connect } from 'react-redux'

import { AppBarTitle } from '../app-bar/app-bar'

@connect(state => ({ chat: state.chat }))
export class ChatTitle extends React.Component {
  render() {
    const { chat } = this.props

    const { pathname } = location
    const routeChannel = pathname.slice(pathname.lastIndexOf('/') + 1)
    const channel = chat.byName.get(routeChannel.toLowerCase())

    return <AppBarTitle>{`#${channel ? channel.name : routeChannel}`}</AppBarTitle>
  }
}

export class ChatListTitle extends React.Component {
  render() {
    return <AppBarTitle>Chat channels</AppBarTitle>
  }
}
