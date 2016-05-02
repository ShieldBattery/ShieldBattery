import React from 'react'
import { connect } from 'react-redux'
import { openDialog, closeDialog } from '../dialogs/dialog-action-creator'
import { openSnackbar } from '../snackbars/action-creators'
import {
  isPsiHealthy,
  isPsiConnected,
  isPsiUpToDate,
  hasValidStarcraftPath,
} from './is-psi-healthy'

import styles from '../material/dialog.css'

@connect(state => ({ network: state.network, upgrade: state.upgrade }))
export default class PsiHealthCheckupDialog extends React.Component {
  componentDidUpdate(prevProps) {
    if (isPsiHealthy(this.props)) {
      this.props.dispatch(
          openSnackbar({ message: 'Your local installation is now free of problems.' }))
      this.props.dispatch(closeDialog())
    }
  }

  renderPsiConnectionInfo() {
    if (isPsiConnected(this.props)) {
      return null
    }

    const downloadLink = this.props.upgrade.installerUrl ?
        <span>Ensure that you've downloaded the latest installer <span>
            <a href={this.props.upgrade.installerUrl} target='_blank'>here</a></span> and completed
            the installation process.</span> :
        <span>Ensure that you've downloaded the latest installer and completed the installation
            process.</span>

    return (<li>
      <span>Couldn't connect to the local ShieldBattery service. { downloadLink } If this does not
          resolve the issue, try restarting your computer.</span>
    </li>)
  }

  renderPsiVersionInfo() {
    if (!isPsiConnected(this.props) || isPsiUpToDate(this.props)) {
      return null
    }

    const upgradeLink = this.props.upgrade.installerUrl ?
        <span>Please <a href={this.props.upgrade.installerUrl} target='_blank'>download</a> the
            latest installer to continue.</span> :
        <span>Please download the latest installer to continue.</span>

    return (<li>
      <span>Your local ShieldBattery installation is out of date. { upgradeLink }</span>
    </li>)
  }

  renderInstallPathInfo() {
    if (!isPsiConnected(this.props) || hasValidStarcraftPath(this.props)) {
      return null
    }

    return (<li>
      <span>
        Your StarCraft path setting does not point to a valid installation. Please correct the
        value in <a href='#' onClick={e => this.onSettingsClicked(e)}>Settings</a>. If you do not
        have the game installed, it can be easily purchased and downloaded from <span>
        <a href='https://us.battle.net/shop/en/product/starcraft' target='_blank'>Battle.net</a>
        </span>.
      </span>
    </li>)
  }

  render() {
    return (<div role='dialog' className={styles.contents}>
      <h3 className={styles.title}>Installation problems detected</h3>
      <div className={styles.body}>
        <p>The following problems need to be corrected before you can play games on
            ShieldBattery:</p>
        <ul>
          { this.renderPsiConnectionInfo() }
          { this.renderPsiVersionInfo() }
          { this.renderInstallPathInfo() }
        </ul>
      </div>
    </div>)
  }

  onSettingsClicked(e) {
    e.preventDefault()
    this.props.dispatch(openDialog('settings'))
  }
}
