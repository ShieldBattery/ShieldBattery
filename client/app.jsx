import React from 'react'
import routes from './routes.jsx'
import { Router } from 'react-router'
import ga from 'react-ga'
import { makeServerUrl } from './network/server-url'

export default class App extends React.Component {
  initialized = false
  onUpdate = () => {
    if (!this.initialized) {
      return
    }

    if (process.webpackEnv.SB_ENV !== 'web') {
      ga.pageview(window.location.hash.slice(1))
    } else {
      ga.pageview(window.location.pathname)
    }
  }

  componentDidMount() {
    if (this.props.analyticsId) {
      ga.initialize(this.props.analyticsId)
      if (process.webpackEnv.SB_ENV !== 'web') {
        ga.set({ location: makeServerUrl('') })
        ga.set({ checkProtocolTask: null })
      }
      this.initialized = true
    }
  }

  render() {
    return <Router history={this.props.history} onUpdate={this.onUpdate}>{routes}</Router>
  }
}
