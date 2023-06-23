import React from 'react'
import { Trans, withTranslation } from 'react-i18next'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { DEV_ERROR } from '../../common/flags'
import { closeDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { RaisedButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { openSnackbar } from '../snackbars/action-creators'
import { body1, subtitle1 } from '../styles/typography'
import { checkShieldBatteryFiles } from './check-shieldbattery-files-ipc'
import { isShieldBatteryHealthy } from './is-starcraft-healthy'

const Text = styled.div`
  ${subtitle1};

  & + & {
    margin-top: 24px;
  }
`

const FileList = styled.ul`
  ${body1};
  margin-bottom: 40px;
`

const RescanButton = styled(RaisedButton)`
  margin-top: 40px;
`

@withTranslation()
@connect(state => ({ files: state.starcraft.shieldBattery }))
export class ShieldBatteryHealthDialog extends React.Component {
  componentDidUpdate() {
    if (isShieldBatteryHealthy({ starcraft: { shieldBattery: this.props.files } })) {
      this.props.dispatch(
        openSnackbar({
          message: this.props.t(
            'starcraft.shieldbatteryHealth.noProblems',
            'Your local installation is now free of problems.',
          ),
        }),
      )
      this.props.dispatch(closeDialog(DialogType.ShieldBatteryHealth))
    }
  }

  render() {
    const initDescription = this.props.files.init ? null : <li>sb_init.dll</li>
    const mainDescription = this.props.files.main ? null : <li>shieldbattery.dll</li>

    return (
      <Dialog
        title={this.props.t(
          'starcraft.shieldbatteryHealth.title',
          'Installation problems detected',
        )}
        onCancel={this.props.onCancel}
        showCloseButton={true}
        dialogRef={this.props.dialogRef}>
        {DEV_ERROR ? (
          <Text>
            Couldn't find necessary ShieldBattery files, you probably need to run game/build.bat
          </Text>
        ) : (
          <div>
            <Text>
              <Trans t={this.props.t} i18nKey='starcraft.shieldbatteryHealth.topContents'>
                We've detected that the following ShieldBattery files are missing or have been
                modified:
              </Trans>
            </Text>
            <FileList>
              {{ initDescription }}
              {{ mainDescription }}
            </FileList>

            <Text>
              <Trans t={this.props.t} i18nKey='starcraft.shieldbatteryHealth.middleContents'>
                This is often the result of installed anti-virus software taking action on false
                positives. You may need to add exceptions for these files, or tell the software to
                remove them from quarantine. You can also try re-installing ShieldBattery.
              </Trans>
            </Text>

            <Text>
              <Trans t={this.props.t} i18nKey='starcraft.shieldbatteryHealth.bottomContents'>
                If you are able to, reporting these as false positives to your anti-virus vendor
                will help this stop happening for other users as well!
              </Trans>
            </Text>
          </div>
        )}

        <RescanButton
          label={this.props.t('starcraft.shieldbatteryHealth.rescanFiles', 'Rescan files')}
          onClick={this.onRescanClick}
        />
      </Dialog>
    )
  }

  onRescanClick = () => {
    checkShieldBatteryFiles(this.props.dispatch)
  }
}
