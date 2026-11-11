import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../../common/errors'
import { TypedIpcRenderer } from '../../../common/ipc'
import { BATTLE_NET_FEEL_VALUES } from '../../../common/settings/game-defaults'
import { CommonDialogProps } from '../../dialogs/common-dialog-props'
import logger from '../../logging/logger'
import { TextButton } from '../../material/button'
import { CheckBox } from '../../material/check-box'
import { Dialog } from '../../material/dialog'
import { useAppDispatch } from '../../redux-hooks'
import { BodyLarge, bodyMedium } from '../../styles/typography'
import { mergeLocalSettings } from '../action-creators'

const ipcRenderer = new TypedIpcRenderer()

const Paragraphs = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const ErrorText = styled.div`
  ${bodyMedium};
  color: var(--theme-error);
`

/**
 * Confirms replacing ShieldBattery's copy of the StarCraft settings with the values in
 * Battle.net's settings file, and switching ShieldBattery's own features that change how the game
 * feels to how Battle.net plays. The updated values reach the rest of the UI through the regular
 * settings change events, so closing the dialog is all that's left to do on success.
 */
export function BattleNetSettingsCopyDialog({
  settingCount,
  featureCount,
  onCancel,
  close,
}: CommonDialogProps & { settingCount: number; featureCount: number }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [switchFeatures, setSwitchFeatures] = useState(true)
  const [isCopying, setIsCopying] = useState(false)
  const [hasError, setHasError] = useState(false)

  const onCopyFailed = () => {
    setIsCopying(false)
    setHasError(true)
  }

  const finish = () => {
    if (featureCount > 0 && (switchFeatures || settingCount === 0)) {
      dispatch(
        mergeLocalSettings({ ...BATTLE_NET_FEEL_VALUES }, { onSuccess: close, onError: close }),
      )
    } else {
      close()
    }
  }

  const onConfirm = () => {
    setIsCopying(true)
    setHasError(false)
    if (settingCount === 0) {
      finish()
      return
    }

    ipcRenderer
      .invoke('settingsScrCopyFromBlizzard')
      ?.then(result => {
        if (result.found) {
          finish()
          return
        }

        logger.error("Couldn't read the Battle.net settings file to copy from it")
        onCopyFailed()
      })
      .catch(err => {
        logger.error('Error copying Battle.net settings: ' + getErrorStack(err))
        onCopyFailed()
      })
  }

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      onClick={onCancel}
      disabled={isCopying}
    />,
    <TextButton
      label={t('settings.game.battleNet.copyConfirm', 'Copy settings')}
      key='confirm'
      onClick={onConfirm}
      disabled={isCopying}
      testName='battle-net-copy-confirm'
    />,
  ]

  return (
    <Dialog
      title={t('settings.game.battleNet.copyDialogTitle', 'Copy Battle.net settings?')}
      buttons={buttons}
      onCancel={onCancel}
      testName='battle-net-copy-dialog'>
      <Paragraphs>
        <BodyLarge>
          {settingCount > 0
            ? t('settings.game.battleNet.copyDialogSettings', {
                defaultValue:
                  'This replaces {{count}} StarCraft settings in ShieldBattery with your Battle.net values.',
                defaultValue_one:
                  'This replaces {{count}} StarCraft setting in ShieldBattery with your Battle.net value.',
                count: settingCount,
              })
            : t('settings.game.battleNet.copyDialogFeaturesOnly', {
                defaultValue:
                  'This switches {{count}} ShieldBattery features to how Battle.net plays.',
                defaultValue_one:
                  'This switches {{count}} ShieldBattery feature to how Battle.net plays.',
                count: featureCount,
              })}{' '}
          {t('settings.game.battleNet.copyDialogNotKept', "Your current values won't be kept.")}
        </BodyLarge>
        {settingCount > 0 && featureCount > 0 ? (
          <CheckBox
            checked={switchFeatures}
            onChange={event => setSwitchFeatures(event.target.checked)}
            disabled={isCopying}
            label={t('settings.game.battleNet.copyDialogFeatures', {
              defaultValue: 'Also switch {{count}} ShieldBattery features to how Battle.net plays',
              defaultValue_one:
                'Also switch {{count}} ShieldBattery feature to how Battle.net plays',
              count: featureCount,
            })}
          />
        ) : null}
        {hasError ? (
          <ErrorText>
            {t(
              'settings.game.battleNet.copyError',
              "Couldn't copy the Battle.net settings. Nothing was changed.",
            )}
          </ErrorText>
        ) : null}
      </Paragraphs>
    </Dialog>
  )
}
