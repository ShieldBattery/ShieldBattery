import React from 'react'
import { connect } from 'react-redux'
import auther from '../auth/auther'
import { openDialog } from '../dialogs/dialog-action-creator'
import styles from './content-layout.css'

import AppBar from '../material/app-bar.jsx'
import IconButton from '../material/icon-button.jsx'

@connect()
export default class ContentLayout extends React.Component {
  static propTypes = {
    title: React.PropTypes.string,
  }

  render() {
    return (<div className={styles.content}>
      <AppBar title={this.props.title}>
        <IconButton icon='account_circle' title='Log out' onClick={::this.onLogOutClicked} />
        <IconButton icon='settings' title='Settings' onClick={::this.onSettingsClicked} />
        <IconButton icon='more_vert' title='More options' />
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
