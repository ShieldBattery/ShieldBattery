import { useTranslation } from 'react-i18next'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch } from '../redux-hooks'
import { BodyLarge } from '../styles/typography'

export interface TwitchRemoveLiveStreamConfirmationProps extends CommonDialogProps {
  name: string
  /** Performs the removal (and its own undo snackbar) once the user confirms. */
  onConfirm: () => void
}

export function TwitchRemoveLiveStreamConfirmation({
  onCancel,
  name,
  onConfirm,
}: TwitchRemoveLiveStreamConfirmationProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const onConfirmClick = () => {
    dispatch(closeDialog(DialogType.TwitchRemoveLiveStreamConfirmation))
    onConfirm()
  }

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
    <TextButton
      label={t('twitch.moderation.removeConfirmAction', 'Remove stream')}
      key='confirm'
      onClick={onConfirmClick}
      testName='confirm-remove-live-stream'
    />,
  ]

  return (
    <Dialog
      title={t('twitch.moderation.removeDialogTitle', {
        defaultValue: 'Remove {{name}} from live streams?',
        name,
      })}
      buttons={buttons}
      onCancel={onCancel}>
      <BodyLarge>
        {t('twitch.moderation.removeDialogBody', {
          defaultValue:
            "{{name}}'s stream will be hidden from the live streams feed until you unblock it.",
          name,
        })}
      </BodyLarge>
    </Dialog>
  )
}
