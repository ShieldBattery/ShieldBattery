import React from 'react'

import AppBar from './material/app-bar.jsx'
import LeftNav from './material/left-nav.jsx'

class MainLayout extends React.Component {
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
