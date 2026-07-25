import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChannelModerationAction, SbChannelId } from '../../common/chat'
import { SbUserId } from '../../common/users/sb-user-id'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { BodyLarge } from '../styles/typography'
import { moderateUser } from './action-creators'

export interface ChannelKickUserConfirmationProps extends CommonDialogProps {
  channelId: SbChannelId
  userId: SbUserId
}

export function ChannelKickUserConfirmation({
  onCancel,
  channelId,
  userId,
}: ChannelKickUserConfirmationProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const user = useAppSelector(s => s.users.byId.get(userId))!
  const [isKicking, setIsKicking] = useState(false)

  const onConfirmClick = () => {
    setIsKicking(true)

    dispatch(
      moderateUser(channelId, userId, ChannelModerationAction.Kick, {
        onSuccess: () => {
          snackbarController.showSnackbar(
            t('chat.kickUser.successMessage', {
              defaultValue: '{{user}} was kicked',
              user: user.name,
            }),
          )
          dispatch(closeDialog(DialogType.ChannelKickUserConfirmation))
        },
        onError: () => {
          setIsKicking(false)
          snackbarController.showSnackbar(
            t('chat.kickUser.errorMessage', {
              defaultValue: 'Something went wrong while kicking {{user}}',
              user: user.name,
            }),
          )
        },
      }),
    )
  }

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      onClick={onCancel}
      disabled={isKicking}
    />,
    <TextButton
      label={t('chat.kickUser.confirmAction', { defaultValue: 'Kick {{user}}', user: user.name })}
      key='kick'
      onClick={onConfirmClick}
      disabled={isKicking}
    />,
  ]

  return (
    <Dialog
      title={t('chat.kickUser.dialogTitle', { defaultValue: 'Kick {{user}}?', user: user.name })}
      buttons={buttons}
      onCancel={onCancel}>
      <BodyLarge>
        {t('chat.kickUser.body', {
          defaultValue:
            '{{user}} will be removed from the channel and lose their channel permissions. They can rejoin at any time.',
          user: user.name,
        })}
      </BodyLarge>
    </Dialog>
  )
}
