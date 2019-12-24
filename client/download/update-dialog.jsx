import React from 'react'
import { connect } from 'react-redux'
import Dialog from '../material/dialog.jsx'
import { closeDialog } from '../dialogs/action-creators'
import { openSnackbar } from '../snackbars/action-creators'
import styles from './update.css'

import { NEW_VERSION_RESTART } from '../../app/common/ipc-constants'

import LoadingIndicator from '../progress/dots.jsx'
import RaisedButton from '../material/raised-button.jsx'

const ipcRenderer = IS_ELECTRON ? require('electron').ipcRenderer : null

@connect(state => ({ update: state.update }))
export default class UpdateDialog extends React.Component {
  componentDidMount() {
    this.componentWillUpdate(this.props)
  }

  componentWillUpdate(nextProps) {
    if (!nextProps.update.hasUpdate) {
      // This should really never happen, but just in case!
      this.props.dispatch(openSnackbar({ message: 'Your client is now up to date.' }))
      this.props.dispatch(closeDialog())
    }
  }

  renderInfo() {
    if (this.props.update.hasDownloadError) {
      return (
        <p className={styles.text}>
          There was an error downloading the latest update. Please restart and try again.
        </p>
      )
    } else if (this.props.update.readyToInstall) {
      return [
        <p className={styles.text} key={'text'}>
          A new update is downloaded and ready to install. Please restart the application to
          continue.
        </p>,
        <RaisedButton key={'button'} onClick={this.onRestartClick} label={'Restart now'} />,
      ]
    } else {
      return [
        <p className={styles.text} key={'text'}>
          A new update is available and is downloading. Please wait for the download to complete in
          order to continue.
        </p>,
        <div key={'loading'} className={styles.loading}>
          <LoadingIndicator />
        </div>,
      ]
    }
  }

  render() {
    const {
      update: { hasDownloadError },
    } = this.props
    const title = !hasDownloadError ? 'Update available' : 'Error downloading update'
    return (
      <Dialog title={title} showCloseButton={false}>
        {this.renderInfo()}
      </Dialog>
    )
  }

  onRestartClick = () => {
    ipcRenderer.send(NEW_VERSION_RESTART)
  }
}
