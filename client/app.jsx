import React from 'react'
import routes from './routes.jsx'
import { Router } from 'react-router'

export default class App extends React.Component {
  render() {
    return <Router history={this.props.history}>{routes}</Router>
  }
}
