import React from 'react'

import { Theme } from 'material-ui'
import theme from './theme'
import AppRoot from './app-root.jsx'

class App extends React.Component {
  render() {
    return (
      <Theme theme={theme}>
        { props => <AppRoot></AppRoot> }
      </Theme>
    )
  }
}

export default App
