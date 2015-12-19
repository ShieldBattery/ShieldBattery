import React from 'react'
import FlatButton from './flat-button.jsx'
import FontIcon from './font-icon.jsx'

class AppBar extends React.Component {
  render() {
    return (<header className='md-app-bar'>
      <h4>{this.props.title}</h4>
      <FlatButton label={<FontIcon>more_vert</FontIcon>} />
      <FlatButton label={<FontIcon>settings</FontIcon>} onClick={::this.onSettingsClicked} />
    </header>)
  }

  onSettingsClicked() {
    this.props.onSettingsClicked()
  }
}

export default AppBar
