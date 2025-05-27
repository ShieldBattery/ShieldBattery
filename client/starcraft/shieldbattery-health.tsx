import { useAtom } from 'jotai'
import React, { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { DEV_ERROR } from '../../common/flags'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { FilledButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { bodyLarge, bodyMedium } from '../styles/typography'
import { checkShieldBatteryFiles } from './check-shieldbattery-files-ipc'
import { shieldBatteryFilesState, shieldBatteryHealthy } from './health-state'

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

const DevContent = styled.div`
  margin-bottom: 24px;
  color: var(--theme-error);
`

export function ShieldBatteryHealthDialog({ onCancel }: CommonDialogProps) {
  const { t } = useTranslation()
  const [files] = useAtom(shieldBatteryFilesState)
  const [healthy] = useAtom(shieldBatteryHealthy)
  const snackbarController = useSnackbarController()

  useEffect(() => {
    if (healthy) {
      snackbarController.showSnackbar(
        t(
          'starcraft.shieldbatteryHealth.noProblems',
          'Your local installation is now free of problems.',
        ),
      )
      onCancel()
    }
  }, [healthy, onCancel, snackbarController, t])

  const initDescription = files.init ? null : <li>sb_init.dll</li>
  const mainDescription = files.main ? null : <li>shieldbattery.dll</li>

  return (
    <Dialog
      title={t('starcraft.shieldbatteryHealth.title', 'Installation problems detected')}
      onCancel={onCancel}
      showCloseButton={true}>
      {DEV_ERROR ? (
        <DevContent>
          <Text>
            Couldn't find necessary ShieldBattery files, you probably need to run game/build.bat
          </Text>
        </DevContent>
      ) : null}

      <div>
        <Text>
          <Trans t={t} i18nKey='starcraft.shieldbatteryHealth.topContents'>
            We've detected that the following ShieldBattery files are missing or have been modified:
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

      <RescanButton
        label={t('starcraft.shieldbatteryHealth.rescanFiles', 'Rescan files')}
        onClick={() => checkShieldBatteryFiles()}
      />
    </Dialog>
  )
}
