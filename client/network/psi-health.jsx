import React from 'react'
import { connect } from 'react-redux'
import Dialog from '../material/dialog.jsx'
import { openDialog, closeDialog } from '../dialogs/dialog-action-creator'
import { openSnackbar } from '../snackbars/action-creators'
import {
  isPsiHealthy,
  hasValidStarcraftPath,
  hasValidStarcraftVersion,
} from './is-psi-healthy'

@connect(state => ({ starcraft: state.starcraft }))
export default class PsiHealthCheckupDialog extends React.Component {
  componentDidUpdate(prevProps) {
    if (isPsiHealthy(this.props)) {
      this.props.dispatch(
          openSnackbar({ message: 'Your local installation is now free of problems.' }))
      this.props.dispatch(closeDialog())
    }
  }

  renderInstallPathInfo() {
    if (hasValidStarcraftPath(this.props)) {
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

  renderStarcraftVersionInfo() {
    if (!hasValidStarcraftPath(this.props) || hasValidStarcraftVersion(this.props)) {
      return null
    }

    return (<li>
      <span>
        Your StarCraft installation is out of date. ShieldBattery requires all players to have
        version 1.16.1. Please install the <span>
        <a href='http://ftp.blizzard.com/pub/broodwar/patches/PC/BW-1161.exe' target='_blank'>latest
        patch</a></span> and restart your computer.
      </span>
    </li>)
  }

  render() {
    return (<Dialog title={'Installation problems detected'} onCancel={this.props.onCancel}
        showCloseButton={true}>
      <p>The following problems need to be corrected before you can play games on
          ShieldBattery:</p>
      <ul>
        { this.renderInstallPathInfo() }
        { this.renderStarcraftVersionInfo() }
      </ul>
    </Dialog>)
  }

  onSettingsClicked(e) {
    e.preventDefault()
    this.props.dispatch(openDialog('settings'))
  }
}
