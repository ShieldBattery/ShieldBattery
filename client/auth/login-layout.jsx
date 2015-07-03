import React from 'react'
import { RouteHandler } from 'react-router'

class MainLayout extends React.Component {
  render() {
    return (<div className="login-wrapper">
      <img className="logo" src="/images/logo.svg" />
      <div className="logotext">
        <h1 className="md-display4 logotext-light">Shield</h1>
        <h1 className="md-display4 logotext-medium">Battery</h1>
      </div>
      <div>
        <RouteHandler />
      </div>
    </div>)
  }
}

export default MainLayout
