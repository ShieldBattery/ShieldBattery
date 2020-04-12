import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'

import Dialog from '../material/dialog.jsx'
import RaisedButton from '../material/raised-button.jsx'
import LoadingIndicator from '../progress/dots.jsx'

import { openDialog, closeDialog } from '../dialogs/action-creators'
import { openSnackbar } from '../snackbars/action-creators'
import {
  isStarcraftHealthy,
  hasValidStarcraftPath,
  hasValidStarcraftVersion,
} from './is-starcraft-healthy'
import { forceAttemptDowngrade } from '../downgrade/action-creators'
import getDowngradePath from '../downgrade/get-downgrade-path'

import { STARCRAFT_DOWNLOAD_URL } from '../../app/common/constants'
import { Subheading } from '../styles/typography'

const LoadingArea = styled.div`
  width: 100%;
  text-align: center;
  padding-top: 24px;
  padding-bottom: 24px;
`

const ErrorMessage = styled(Subheading)`
  margin-top: 24px;
  margin-bottom: 24px;
`

const HeaderText = styled(Subheading)`
  margin-top: 0;
`

@connect(state => ({ downgrade: state.downgrade, starcraft: state.starcraft }))
export default class StarcraftHealthCheckupDialog extends React.Component {
  componentDidUpdate(prevProps) {
    if (isStarcraftHealthy(this.props)) {
      this.props.dispatch(
        openSnackbar({
          message: 'Your local installation is now free of problems.',
        }),
      )
      this.props.dispatch(closeDialog())
    }
  }

  renderInstallPathInfo() {
    if (hasValidStarcraftPath(this.props)) {
      return null
    }

    return (
      <p>
        Your StarCraft path setting does not point to a valid installation. Please correct the value
        in{' '}
        <a href='#' onClick={e => this.onSettingsClicked(e)}>
          Settings
        </a>
        . If you do not have the game installed, it can be easily downloaded from{' '}
        <span>
          <a href={STARCRAFT_DOWNLOAD_URL} target='_blank'>
            Blizzard's website
          </a>
        </span>
        . You may need to restart ShieldBattery after installation.
      </p>
    )
  }

  renderStarcraftVersionInfo() {
    if (!hasValidStarcraftPath(this.props) || hasValidStarcraftVersion(this.props)) {
      return null
    }

    const { downgradeInProgress, lastDowngradeError } = this.props.downgrade

    // Wait for the downgrade to finish/fail
    if (downgradeInProgress) {
      return (
        <div>
          <p>
            ShieldBattery is attempting to identify the version of your installed StarCraft
            client&hellip;
          </p>
          <LoadingArea>
            <LoadingIndicator />
          </LoadingArea>
        </div>
      )
    }

    // The downgrade either didn't fail, or we don't have a patch for this version
    if (
      !lastDowngradeError ||
      (lastDowngradeError.body && lastDowngradeError.body.error === 'Unrecognized file version')
    ) {
      return (
        <div>
          <p>
            Your StarCraft installation is out of date. ShieldBattery supports installations of
            version 1.16.1 or greater. Please install the{' '}
            <span>
              <a href={STARCRAFT_DOWNLOAD_URL} target='_blank'>
                latest version
              </a>
            </span>{' '}
            and restart ShieldBattery.
          </p>
          <p>
            If you already have the latest version and are seeing this error, it may be a temporary
            failure. Click the button below to try again, or contact an administrator for help.
          </p>
          <RaisedButton label={'Try again'} onClick={this.onTryAgainClick} />
        </div>
      )
    }

    // The downgrade failed in a bad way
    return (
      <div>
        <p>
          ShieldBattery was unable to make your version of StarCraft compatible with the service.
          The error message was:
        </p>
        <ErrorMessage as='p'>
          {lastDowngradeError.body ? lastDowngradeError.body.error : lastDowngradeError.message}
        </ErrorMessage>
        <p>
          This may be a temporary error. Click the button below to try again, or consider
          reinstalling the{' '}
          <a href={STARCRAFT_DOWNLOAD_URL} target='_blank'>
            latest version
          </a>{' '}
          of StarCraft and restarting ShieldBattery.
        </p>
        <RaisedButton label={'Try again'} onClick={this.onTryAgainClick} />
      </div>
    )
  }

  render() {
    return (
      <Dialog
        title={'Installation problems detected'}
        onCancel={this.props.onCancel}
        showCloseButton={true}>
        <HeaderText as='p'>
          The following problems need to be corrected before you can play games on ShieldBattery:
        </HeaderText>
        {this.renderInstallPathInfo()}
        {this.renderStarcraftVersionInfo()}
      </Dialog>
    )
  }

  onSettingsClicked(e) {
    e.preventDefault()
    this.props.dispatch(openDialog('settings'))
  }

  onTryAgainClick = () => {
    this.props.dispatch((dispatch, getState) => {
      const {
        settings: {
          local: { starcraftPath },
        },
      } = getState()
      // Note: this may unnecessarily copy a valid 1.16.1 installation into the downgrade dir. This
      // is generally fine, as we prefer the "real" installation anyway, and it's actually sort of
      // good to back up valid binaries since they'll be valid for us forever, even if the
      // installation we got them from gets patched to something else.
      dispatch(forceAttemptDowngrade(starcraftPath, getDowngradePath()))
    })
  }
}
