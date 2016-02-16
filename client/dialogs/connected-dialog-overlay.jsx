import React from 'react'
import { connect } from 'react-redux'
import Dialog from '../material/dialog.jsx'
import Settings from '../settings/settings.jsx'
import { closeDialog } from './dialog-action-creator'

@connect(state => ({ dialog: state.dialog }))
class ConnectedDialogOverlay extends React.Component {
  render() {
    const { dialog } = this.props
    // Dialog content implementations should focus *something* when mounted, so that our focus traps
    // have the proper effect of keeping focus in the dialog
    let dialogComponent
    if (dialog.isDialogOpened) {
      switch (dialog.dialogType) {
        case 'settings':
          dialogComponent = <Settings />
          break
        default:
          throw new Error('Unknown dialog type: ' + dialog.dialogType)
      }
    }

    // We always render a dialog even if we don't have one, so that its always mounted (and
    // thus usable for TransitionGroup animations)
    return (<div>
      <div className={this.props.className} aria-hidden={dialog.isDialogOpened}>
        {this.props.children}
      </div>
      <span tabIndex={0} onFocus={::this.onFocusTrap}/>
      <span ref='focusable' tabIndex={-1}>
        <Dialog onCancel={::this.onCancel}>
          { dialogComponent }
        </Dialog>
      </span>
      <span tabIndex={0} onFocus={::this.onFocusTrap}/>
    </div>)
  }

  onCancel() {
    this.props.dispatch(closeDialog())
  }

  onFocusTrap() {
    // Focus was about to leave the dialog area, redirect it back to the dialog
    this.refs.focusable.focus()
  }
}

export default ConnectedDialogOverlay
