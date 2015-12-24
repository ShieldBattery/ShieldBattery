import React from 'react'
import { connect } from 'react-redux'
import Dialog from '../material/dialog.jsx'
import Settings from '../settings/settings.jsx'
import { closeDialog } from './dialog-action-creator'

@connect(state => ({ dialog: state.dialog }))
class ConnectedDialog extends React.Component {
  static contextTypes = {
    store: React.PropTypes.object.isRequired,
  }

  render() {
    const { dialog } = this.props
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
    return (
      <Dialog onCancel={::this.onCancel}>
        { dialogComponent }
      </Dialog>
    )
  }

  onCancel() {
    this.context.store.dispatch(closeDialog())
  }
}

export default ConnectedDialog
