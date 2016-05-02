import React from 'react'
import { connect } from 'react-redux'
import { closeDialog } from '../dialogs/dialog-action-creator'
import { openSnackbar } from '../snackbars/action-creators'
import { needsUpgrade } from './needs-upgrade'

import styles from '../material/dialog.css'


@connect(state => ({ upgrade: state.upgrade, network: state.network }))
export default class UpgradeDialog extends React.Component {
  componentDidUpdate(prevProps) {
    if (!needsUpgrade(this.props)) {
      this.props.dispatch(openSnackbar({ message: 'Your local installation is now up to date.' }))
      this.props.dispatch(closeDialog())
    }
  }

  render() {
    const upgradeLink = this.props.upgrade.installerUrl ?
        <span>Please <a href={this.props.upgrade.installerUrl} target='_blank'>download</a> the
            latest installer to continue.</span> :
        <span>Please download the latest installer to continue.</span>

    return (<div role='dialog' className={styles.contents}>
      <div className={styles.body}>
        <h3>Upgrade required</h3>
        <p>Your local ShieldBattery installation is out of date. { upgradeLink }</p>
      </div>
    </div>)
  }
}
