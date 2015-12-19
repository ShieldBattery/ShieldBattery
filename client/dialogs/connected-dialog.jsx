import React from 'react'
import { connect } from 'react-redux'
import Dialog from '../material/dialog.jsx'
import Settings from '../settings/settings.jsx'

@connect(state => ({ dialog: state.dialog }))
class ConnectedDialog extends React.Component {
  render() {
    const { dialog } = this.props
    let dialogComponent = null
    const dialogType = dialog.isDialogOpened ? dialog.dialogType : 'closed'
    if (dialogType === 'closed') {
      return <span style={{display: 'none'}} />
    }

    switch (dialogType) {
      case 'settings':
        dialogComponent = <Settings />
        break
      default:
        throw new Error('Unknown dialog type')
    }

    return (
      <Dialog>
        { dialogComponent }
      </Dialog>
    )
  }
}

export default ConnectedDialog
