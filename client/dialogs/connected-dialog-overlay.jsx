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
import { closeDialog } from './action-creators'

const transitionNames = {
  enter: styles.enter,
  enterActive: styles.enterActive,
  leave: styles.leave,
  leaveActive: styles.leaveActive,
}

@connect(state => ({ dialog: state.dialog }))
class ConnectedDialogOverlay extends React.Component {
  _focusable = null
  _setFocusable = elem => {
    this._focusable = elem
  }

  getDialog(dialogType) {
    switch (dialogType) {
      case 'acceptMatch':
        return { component: AcceptMatch, modal: true }
      case 'changelog':
        return { component: ChangelogDialog, modal: false }
      case 'channel':
        return { component: JoinChannelDialog, modal: false }
      case 'download':
        return { component: DownloadDialog, modal: false }
      case 'psiHealth':
        return { component: PsiHealthCheckupDialog, modal: false }
      case 'settings':
        return { component: Settings, modal: false }
      case 'simple':
        return { component: SimpleDialog, modal: false }
      case 'updateAvailable':
        return { component: UpdateDialog, modal: true }
      case 'whispers':
        return { component: CreateWhisperSessionDialog, modal: false }
      default:
        throw new Error('Unknown dialog type: ' + dialogType)
    }
  }

  renderDialog = () => {
    const { dialog } = this.props

    // Dialog content implementations should focus *something* when mounted, so that our focus traps
    // have the proper effect of keeping focus in the dialog
    let dialogComponent
    if (dialog.isDialogOpened) {
      const { component: DialogComponent } = this.getDialog(dialog.dialogType)
      dialogComponent = (
        <DialogComponent key='dialog' onCancel={this.onCancel} {...dialog.initData.toJS()} />
      )
    }

    return [
      <span key='topFocus' tabIndex={0} onFocus={this.onFocusTrap} />,
      <span key='mainFocus' ref={this._setFocusable} tabIndex={-1}>
        <TransitionGroup
          transitionName={transitionNames}
          transitionEnterTimeout={350}
          transitionLeaveTimeout={250}>
          {dialogComponent}
        </TransitionGroup>
      </span>,
      <span key='bottomFocus' tabIndex={0} onFocus={this.onFocusTrap} />,
    ]
  }

  render() {
    const { dialog } = this.props
    // We always render a dialog even if we don't have one, so that its always mounted (and
    // thus usable for TransitionGroup animations)
    return (
      <Portal
        onDismiss={this.onCancel}
        open={true}
        scrim={dialog.isDialogOpened}
        propagateClicks={true}>
        {this.renderDialog}
      </Portal>
    )
  }

  onCancel = () => {
    const { dialog } = this.props
    const { modal } = this.getDialog(dialog.dialogType)
    if (modal) return
    this.props.dispatch(closeDialog())
  }

  onFocusTrap = () => {
    // Focus was about to leave the dialog area, redirect it back to the dialog
    this._focusable.focus()
  }
}

export default ConnectedDialogOverlay
