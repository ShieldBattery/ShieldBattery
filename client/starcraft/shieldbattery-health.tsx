import React, { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { DEV_ERROR } from '../../common/flags'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { FilledButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium } from '../styles/typography'
import { checkShieldBatteryFiles } from './check-shieldbattery-files-ipc'

const Text = styled.div`
  ${bodyLarge};

  & + & {
    margin-top: 24px;
  }
`

const FileList = styled.ul`
  ${bodyMedium};
  margin-bottom: 40px;
`

const RescanButton = styled(FilledButton)`
  margin-top: 40px;
`

export function ShieldBatteryHealthDialog({ onCancel }: CommonDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const files = useAppSelector(s => s.starcraft.shieldBattery)
  const snackbarController = useSnackbarController()

  useEffect(() => {
    const healthy = Object.values(files).every(f => f)
    if (healthy) {
      snackbarController.showSnackbar(
        t(
          'starcraft.shieldbatteryHealth.noProblems',
          'Your local installation is now free of problems.',
        ),
      )
      dispatch(closeDialog(DialogType.ShieldBatteryHealth))
    }
  }, [dispatch, files, snackbarController, t])

  const initDescription = files.init ? null : <li>sb_init.dll</li>
  const mainDescription = files.main ? null : <li>shieldbattery.dll</li>

  return (
    <Dialog
      title={t('starcraft.shieldbatteryHealth.title', 'Installation problems detected')}
      onCancel={onCancel}
      showCloseButton={true}>
      {DEV_ERROR ? (
        <Text>
          Couldn't find necessary ShieldBattery files, you probably need to run game/build.bat
        </Text>
      ) : (
        <div>
          <Text>
            <Trans t={t} i18nKey='starcraft.shieldbatteryHealth.topContents'>
              We've detected that the following ShieldBattery files are missing or have been
              modified:
            </Trans>
          </Text>
          <FileList>
            {initDescription}
            {mainDescription}
          </FileList>

          <Text>
            <Trans t={t} i18nKey='starcraft.shieldbatteryHealth.middleContents'>
              This is often the result of installed anti-virus software taking action on false
              positives. You may need to add exceptions for these files, or tell the software to
              remove them from quarantine. You can also try re-installing ShieldBattery.
            </Trans>
          </Text>

          <Text>
            <Trans t={t} i18nKey='starcraft.shieldbatteryHealth.bottomContents'>
              If you are able to, reporting these as false positives to your anti-virus vendor will
              help this stop happening for other users as well!
            </Trans>
          </Text>
        </div>
      )}

      <RescanButton
        label={t('starcraft.shieldbatteryHealth.rescanFiles', 'Rescan files')}
        onClick={() => checkShieldBatteryFiles(dispatch)}
      />
    </Dialog>
  )
}
