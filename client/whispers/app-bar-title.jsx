import React from 'react'
import { connect } from 'react-redux'

import { AppBarTitle } from '../app-bar/app-bar'

@connect(state => ({ whispers: state.whispers }))
export default class WhispersTitle extends React.Component {
  render() {
    const { whispers } = this.props
    const { pathname } = location

    const target = pathname.slice(pathname.lastIndexOf('/') + 1)
    const session = whispers.byName.get(target.toLowerCase())

    return <AppBarTitle>{`Whisper with ${session ? session.target : target}`}</AppBarTitle>
  }
}
