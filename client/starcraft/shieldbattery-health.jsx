import React from 'react'
import { connect } from 'react-redux'
import styled from 'styled-components'
import { closeDialog } from '../dialogs/action-creators'
import { RaisedButton } from '../material/button'
import Dialog from '../material/dialog'
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

@connect(state => ({ files: state.starcraft.shieldBattery }))
export class ShieldBatteryHealthDialog extends React.Component {
  componentDidUpdate() {
    if (isShieldBatteryHealthy({ starcraft: { shieldBattery: this.props.files } })) {
      this.props.dispatch(
        openSnackbar({
          message: 'Your local installation is now free of problems.',
        }),
      )
      this.props.dispatch(closeDialog())
    }
  }

  render() {
    const initDescription = this.props.files.init ? null : <li>sb_init.dll</li>
    const mainDescription = this.props.files.main ? null : <li>shieldbattery.dll</li>

    return (
      <Dialog
        title={'Installation problems detected'}
        onCancel={this.props.onCancel}
        showCloseButton={true}
        dialogRef={this.props.dialogRef}>
        <Text>
          We've detected that the following ShieldBattery files are missing or have been modified:
        </Text>
        <FileList>
          {initDescription}
          {mainDescription}
        </FileList>

        <Text>
          This is often the result of installed anti-virus software taking action on false
          positives. You may need to add exceptions for these files, or tell the software to remove
          them from quarantine. You can also try re-installing ShieldBattery.
        </Text>

        <Text>
          If you are able to, reporting these as false positives to your anti-virus vendor will help
          this stop happening for other users as well!
        </Text>

        <RescanButton label='Rescan files' onClick={this.onRescanClick} />
      </Dialog>
    )
  }

  onRescanClick = () => {
    checkShieldBatteryFiles(this.props.dispatch)
  }
}
