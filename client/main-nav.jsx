import React from 'react'
import { RouteHandler } from 'react-router'
import Tab from './tab.jsx'
import Card from './material/card.jsx'

class MainNav extends React.Component {
  render() {
    return (<div>
      <div className='page-with-docked-left-nav'>
        <Card className='docked-left-nav' zDepth={1}>
          <ul className="tabs">
            <Tab label="Games" route="games" />
            <Tab label="Replays" route="replays" />
          </ul>
        </Card>

        <div className="mui-app-page-content">
          <RouteHandler />
        </div>
      </div>
      <Card className='docked-bottom-toolbar' zDepth={2}>
        <span>Hello bottom toolbar world!</span>
      </Card>
    </div>)
  }
}

export default MainNav
