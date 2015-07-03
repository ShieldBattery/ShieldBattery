import React from 'react'
import { RouteHandler } from 'react-router'

import { Theme } from 'material-ui'
import theme from './theme'

class App extends React.Component {
  render() {
    return (
      <Theme theme={theme}>
        { props => <RouteHandler></RouteHandler> }
      </Theme>
    )
  }
}

export default App
