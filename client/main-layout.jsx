import React from 'react'
import { connect } from 'react-redux'
import siteSocket from './network/site-socket'

import AppBar from './material/app-bar.jsx'
import LeftNav from './material/left-nav.jsx'

@connect(state => ({ auth: state.auth }))
class MainLayout extends React.Component {
  componentDidMount() {
    siteSocket.connect()
  }

  componentWillUnmount() {
    siteSocket.disconnect()
  }

  render() {
    return (<div className='flex-row'>
      <LeftNav />
      <div className='flex-fit'>
        <AppBar title='#teamliquid'/>
        { this.props.children }
      </div>
    </div>)
  }
}

export default MainLayout
