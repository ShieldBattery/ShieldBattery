import React from 'react'
import { connect } from 'react-redux'

import { AppBarTitle } from '../app-bar/app-bar'

@connect(state => ({ matchmaking: state.matchmaking }))
export default class LobbyTitle extends React.Component {
  render() {
    const matchmakingTitle = this.props.matchmaking.isLoading
      ? 'Loading game...'
      : 'Game in progress...'

    return <AppBarTitle as='span'>{matchmakingTitle}</AppBarTitle>
  }
}
