import React, { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { STARCRAFT_DOWNLOAD_URL } from '../../common/constants'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSettings } from '../settings/action-creators'
import { GameSettingsPage } from '../settings/settings-page'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { BodyLarge } from '../styles/typography'

export function StarcraftHealthCheckupDialog({ onCancel }: CommonDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const { pathValid, versionValid } = useAppSelector(s => s.starcraft)

  useEffect(() => {
    if (pathValid && versionValid) {
      snackbarController.showSnackbar(
        t(
          'starcraft.starcraftHealth.noProblems',
          'Your local installation is now free of problems.',
        ),
      )
      onCancel()
    }
  }, [dispatch, onCancel, pathValid, snackbarController, t, versionValid])

  return (
    <Dialog
      title={t('starcraft.starcraftHealth.title', 'Installation problems detected')}
      onCancel={onCancel}
      showCloseButton={true}>
      <BodyLarge>
        {t(
          'starcraft.starcraftHealth.header',
          'The following problems need to be corrected before you can play games on ShieldBattery:',
        )}
      </BodyLarge>
      {!pathValid ? (
        <p>
          <Trans t={t} i18nKey='starcraft.starcraftHealth.installPathContents'>
            Your StarCraft path setting does not point to a valid installation. Please correct the
            value in{' '}
            <a
              href='#'
              onClick={e => {
                e.preventDefault()
                onCancel()
                dispatch(openSettings(GameSettingsPage.StarCraft))
              }}>
              Settings
            </a>
            . If you do not have the game installed, it can be easily downloaded from{' '}
            <span>
              <a href={STARCRAFT_DOWNLOAD_URL} target='_blank' rel='noreferrer noopener'>
                Battle.net
              </a>
            </span>
            . You may need to restart ShieldBattery after installation.
          </Trans>
        </p>
      ) : null}
      {pathValid && !versionValid ? (
        <div>
          <p>
            <Trans t={t} i18nKey='starcraft.starcraftHealth.starcraftVersionContents'>
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
      ) : null}
    </Dialog>
  )
}
