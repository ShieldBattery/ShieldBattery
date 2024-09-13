import React from 'react'
import { Trans, withTranslation } from 'react-i18next'
import { connect } from 'react-redux'
import { styled } from 'styled-components'
import { STARCRAFT_DOWNLOAD_URL } from '../../common/constants.js'
import { closeDialog } from '../dialogs/action-creators.js'
import { DialogType } from '../dialogs/dialog-type.js'
import { Dialog } from '../material/dialog.js'
import { openSettings } from '../settings/action-creators.js'
import { GameSettingsSubPage } from '../settings/settings-sub-page.js'
import { openSnackbar } from '../snackbars/action-creators.js'
import { SubheadingOld } from '../styles/typography.js'
import {
  hasValidStarcraftPath,
  hasValidStarcraftVersion,
  isStarcraftHealthy,
} from './is-starcraft-healthy.js'

const HeaderText = styled(SubheadingOld)`
  margin-top: 0;
`

@withTranslation()
@connect(state => ({ starcraft: state.starcraft }))
export default class StarcraftHealthCheckupDialog extends React.Component {
  componentDidUpdate(prevProps) {
    if (isStarcraftHealthy(this.props)) {
      this.props.dispatch(
        openSnackbar({
          message: this.props.t(
            'starcraft.starcraftHealth.noProblems',
            'Your local installation is now free of problems.',
          ),
        }),
      )
      this.props.dispatch(closeDialog(DialogType.StarcraftHealth))
    }
  }

  renderInstallPathInfo() {
    if (hasValidStarcraftPath(this.props)) {
      return null
    }

    return (
      <p>
        <Trans t={this.props.t} i18nKey='starcraft.starcraftHealth.installPathContents'>
          Your StarCraft path setting does not point to a valid installation. Please correct the
          value in{' '}
          <a href='#' onClick={e => this.onSettingsClicked(e)}>
            Settings
          </a>
          . If you do not have the game installed, it can be easily downloaded from{' '}
          <span>
            <a href={STARCRAFT_DOWNLOAD_URL} target='_blank' rel='noreferrer noopener'>
              Blizzard's website
            </a>
          </span>
          . You may need to restart ShieldBattery after installation.
        </Trans>
      </p>
    )
  }

  renderStarcraftVersionInfo() {
    if (!hasValidStarcraftPath(this.props) || hasValidStarcraftVersion(this.props)) {
      return null
    }

    return (
      <div>
        <p>
          <Trans t={this.props.t} i18nKey='starcraft.starcraftHealth.starcraftVersionContents'>
            Your StarCraft installation is out of date. ShieldBattery supports installations of
            version 1.16.1 or the latest Remastered version. Please install the{' '}
            <span>
              <a href={STARCRAFT_DOWNLOAD_URL} target='_blank' rel='noreferrer noopener'>
                latest version
              </a>
            </span>{' '}
            and restart ShieldBattery.
          </Trans>
        </p>
      </div>
    )
  }

  render() {
    return (
      <Dialog
        title={this.props.t('starcraft.starcraftHealth.title', 'Installation problems detected')}
        onCancel={this.props.onCancel}
        showCloseButton={true}
        dialogRef={this.props.dialogRef}>
        <HeaderText as='p'>
          {this.props.t(
            'starcraft.starcraftHealth.header',
            'The following problems need to be corrected before you can play games on ' +
              'ShieldBattery:',
          )}
        </HeaderText>
        {this.renderInstallPathInfo()}
        {this.renderStarcraftVersionInfo()}
      </Dialog>
    )
  }

  onSettingsClicked(e) {
    e.preventDefault()
    this.props.dispatch(openSettings(GameSettingsSubPage.StarCraftPath))
    this.props.dispatch(closeDialog(DialogType.StarcraftHealth))
  }
}
