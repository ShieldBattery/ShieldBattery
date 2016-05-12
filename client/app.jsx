import React from 'react'
import routes from './routes.jsx'
import { Router } from 'react-router'
import ga from 'react-ga'

const analyticsId = window._sbAnalyticsId
if (analyticsId) {
  ga.initialize(analyticsId)
}
const onUpdate = analyticsId ? () => ga.pageview(window.location.pathname) : () => { }

export default class App extends React.Component {
  render() {
    return <Router history={this.props.history} onUpdate={onUpdate}>{routes}</Router>
  }
}
