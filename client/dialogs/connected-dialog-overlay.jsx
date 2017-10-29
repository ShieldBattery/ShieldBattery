import React from 'react'
import { connect } from 'react-redux'
import TransitionGroup from 'react-addons-css-transition-group'
import styles from '../material/dialog.css'

import Portal from '../material/portal.jsx'
import SimpleDialog from './simple-dialog.jsx'
import Settings from '../settings/settings.jsx'
import PsiHealthCheckupDialog from '../network/psi-health.jsx'
import JoinChannelDialog from '../chat/join-channel.jsx'
import CreateWhisperSessionDialog from '../whispers/create-whisper.jsx'
import ChangelogDialog from '../changelog/changelog-dialog.jsx'
import DownloadDialog from '../download/download-dialog.jsx'
import UpdateDialog from '../download/update-dialog.jsx'
import AcceptMatch from '../matchmaking/accept-match.jsx'
import { closeDialog } from './dialog-action-creator'

const transitionNames = {
  appear: styles.enter,
  appearActive: styles.enterActive,
  enter: styles.enter,
  enterActive: styles.enterActive,
  leave: styles.leave,
  leaveActive: styles.leaveActive,
}

const CLOSE_TIME = 250

@connect(state => ({ dialog: state.dialog }))
class ConnectedDialogOverlay extends React.Component {
  state = {
    isClosing: false,
  }

  _closeTimer = null
  _focusable = null
  _setFocusable = elem => {
    this._focusable = elem
  }

  componentWillUnmount() {
    clearTimeout(this._closeTimer)
  }

  getDialogComponent(dialogType) {
    switch (dialogType) {
      case 'acceptMatch':
        return AcceptMatch
      case 'changelog':
        return ChangelogDialog
      case 'channel':
        return JoinChannelDialog
      case 'download':
        return DownloadDialog
      case 'psiHealth':
        return PsiHealthCheckupDialog
      case 'settings':
        return Settings
      case 'simple':
        return SimpleDialog
      case 'updateAvailable':
        return UpdateDialog
      case 'whispers':
        return CreateWhisperSessionDialog
      default:
        throw new Error('Unknown dialog type: ' + dialogType)
    }
  }

  renderDialog = () => {
    const { dialog } = this.props
    const { isClosing } = this.state

    // Dialog content implementations should focus *something* when mounted, so that our focus traps
    // have the proper effect of keeping focus in the dialog
    let dialogComponent
    if (dialog.isDialogOpened && !isClosing) {
      const DialogComponent = this.getDialogComponent(dialog.dialogType)
      dialogComponent = (
        <DialogComponent
          key="dialog"
          onCancel={this.onCancel}
          simpleTitle={dialog.simpleTitle}
          simpleContent={dialog.simpleContent}
        />
      )
    }

    return [
      <span key="topFocus" tabIndex={0} onFocus={this.onFocusTrap} />,
      <span key="mainFocus" ref={this._setFocusable} tabIndex={-1}>
        <TransitionGroup
          transitionName={transitionNames}
          transitionAppear={true}
          transitionAppearTimeout={350}
          transitionEnterTimeout={350}
          transitionLeaveTimeout={CLOSE_TIME}>
          {dialogComponent}
        </TransitionGroup>
      </span>,
      <span key="bottomFocus" tabIndex={0} onFocus={this.onFocusTrap} />,
    ]
  }

  render() {
    const { dialog } = this.props

    return (
      <Portal onDismiss={this.onCancel} open={dialog.isDialogOpened} scrim={true}>
        {this.renderDialog}
      </Portal>
    )
  }

  onCancel = () => {
    this.setState({ isClosing: true })
    this._closeTimer = setTimeout(() => {
      this.setState({ isClosing: false })
      this.props.dispatch(closeDialog())
    }, CLOSE_TIME)
  }

  onFocusTrap = () => {
    // Focus was about to leave the dialog area, redirect it back to the dialog
    this._focusable.focus()
  }
}

export default ConnectedDialogOverlay
