import React from 'react'
import { connect } from 'react-redux'
import TransitionGroup from 'react-addons-css-transition-group'
import Settings from '../settings/settings.jsx'
import PsiHealthCheckupDialog from '../network/psi-health.jsx'
import CreateWhisperSessionDialog from '../whispers/create-whisper.jsx'
import { closeDialog } from './dialog-action-creator'
import styles from '../material/dialog.css'


const transitionNames = {
  enter: styles.enter,
  enterActive: styles.enterActive,
  leave: styles.leave,
  leaveActive: styles.leaveActive,
}

@connect(state => ({ dialog: state.dialog }))
class ConnectedDialogOverlay extends React.Component {
  _focusable = null;
  _setFocusable = elem => { this._focusable = elem };

  renderDialog() {
    const { dialog } = this.props

    // Dialog content implementations should focus *something* when mounted, so that our focus traps
    // have the proper effect of keeping focus in the dialog
    let dialogComponent
    if (dialog.isDialogOpened) {
      const childProps = {
        key: 'dialog',
        onCancel: this.onCancel,
      }
      switch (dialog.dialogType) {
        case 'settings':
          dialogComponent = <Settings {...childProps}/>
          break
        case 'psiHealth':
          dialogComponent = <PsiHealthCheckupDialog {...childProps}/>
          break
        case 'whispers':
          dialogComponent = <CreateWhisperSessionDialog {...childProps}/>
          break
        default:
          throw new Error('Unknown dialog type: ' + dialog.dialogType)
      }
    }

    return [
      <span key='topFocus' tabIndex={0} onFocus={this.onFocusTrap}/>,
      <span key='mainFocus' ref={this._setFocusable} tabIndex={-1}>
          <TransitionGroup transitionName={transitionNames}
              transitionEnterTimeout={350} transitionLeaveTimeout={250}>
            { dialogComponent }
          </TransitionGroup>
      </span>,
      <span key='bottomFocus' tabIndex={0} onFocus={this.onFocusTrap}/>,
    ]
  }

  render() {
    const { dialog } = this.props
    // We always render a dialog even if we don't have one, so that its always mounted (and
    // thus usable for TransitionGroup animations)
    return (<div>
      <div className={this.props.className} aria-hidden={dialog.isDialogOpened}>
        {this.props.children}
      </div>
      {this.renderDialog()}
    </div>)
  }

  onCancel = () => {
    this.props.dispatch(closeDialog())
  };

  onFocusTrap = () => {
    // Focus was about to leave the dialog area, redirect it back to the dialog
    this._focusable.focus()
  };
}

export default ConnectedDialogOverlay
