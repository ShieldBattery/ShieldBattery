import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import Dialog from '../material/dialog.jsx'
import { closeDialog } from '../dialogs/action-creators'
import { openSnackbar } from '../snackbars/action-creators'
import { TitleOld } from '../styles/typography'

import { NEW_VERSION_RESTART } from '../../common/ipc-constants'

import LoadingIndicator from '../progress/dots.jsx'
import RaisedButton from '../material/raised-button.jsx'

const ipcRenderer = IS_ELECTRON ? require('electron').ipcRenderer : null

const Text = styled(TitleOld)`
  margin-top: 0;
  margin-bottom: 24px;
  font-weight: 400;
`

const LoadingContainer = styled.div`
  width: 100%;
  height: 80px;

  display: flex;
  align-items: center;
  justify-content: center;
`

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
        <Text as='p'>
          There was an error downloading the latest update. Please restart and try again.
        </Text>
      )
    } else if (this.props.update.readyToInstall) {
      return [
        <Text as='p' key={'text'}>
          A new update is downloaded and ready to install. Please restart the application to
          continue.
        </Text>,
        <RaisedButton key={'button'} onClick={this.onRestartClick} label={'Restart now'} />,
      ]
    } else {
      return [
        <Text as='p' key={'text'}>
          A new update is available and is downloading. Please wait for the download to complete in
          order to continue.
        </Text>,
        <LoadingContainer key={'loading'}>
          <LoadingIndicator />
        </LoadingContainer>,
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
