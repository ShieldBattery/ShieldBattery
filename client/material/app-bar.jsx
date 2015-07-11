import React from 'react'
import FontIcon from './font-icon.jsx'

class AppBar extends React.Component {
  render() {
    return (<header className='md-app-bar'>
      <h4>{this.props.title}</h4>
      <button>
        <FontIcon>more_vert</FontIcon>
      </button>
    </header>)
  }
}

export default AppBar
