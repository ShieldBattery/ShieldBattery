import React from 'react'
import Download from './download'

import Dialog from '../material/dialog'

export default class DownloadDialog extends React.Component {
  render() {
    return (
      <Dialog title={'Download'} onCancel={this.onDismiss} showCloseButton={true}>
        <Download />
      </Dialog>
    )
  }

  onDismiss = () => {
    if (this.props.onCancel) {
      this.props.onCancel()
    }
  }
}
