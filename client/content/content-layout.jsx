import React from 'react'
import { connect } from 'react-redux'
import auther from '../auth/auther'
import { openDialog } from '../dialogs/dialog-action-creator'
import styles from './content-layout.css'

import ActiveUserCount from '../serverstatus/active-users.jsx'
import AppBar from '../material/app-bar.jsx'
import FlatButton from '../material/flat-button.jsx'
import FontIcon from '../material/font-icon.jsx'

@connect()
export default class ContentLayout extends React.Component {
  static propTypes = {
    title: React.PropTypes.string,
  }

  render() {
    return (<div className={styles.content}>
      <AppBar title={this.props.title}>
        <ActiveUserCount />
        <FlatButton label={<FontIcon>account_circle</FontIcon>}
            onClick={::this.onLogOutClicked} />
        <FlatButton label={<FontIcon>settings</FontIcon>} onClick={::this.onSettingsClicked} />
        <FlatButton label={<FontIcon>more_vert</FontIcon>} />
      </AppBar>
      { this.props.children }
    </div>)
  }

  onSettingsClicked() {
    this.props.dispatch(openDialog('settings'))
  }

  onLogOutClicked() {
    this.props.dispatch(auther.logOut().action)
  }
}
