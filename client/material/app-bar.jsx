import React from 'react'

class AppBar extends React.Component {
  render() {
    return (<header className='md-app-bar'>
      <h4>{this.props.title}</h4>
      { this.props.children }
    </header>)
  }
}

export default AppBar
