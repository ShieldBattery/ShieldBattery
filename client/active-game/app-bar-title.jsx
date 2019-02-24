import React from 'react'

import { AppBarTitle } from '../app-bar/app-bar.jsx'

export default class ActiveGameTitle extends React.Component {
  render() {
    return <AppBarTitle as="span">You're in a game</AppBarTitle>
  }
}
