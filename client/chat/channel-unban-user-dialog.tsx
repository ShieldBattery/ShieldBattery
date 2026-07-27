import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { SbChannelId } from '../../common/chat'
import { SbUserId } from '../../common/users/sb-user-id'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { BodyLarge } from '../styles/typography'
import { unbanUser } from './action-creators'

export interface ChannelUnbanUserConfirmationProps extends CommonDialogProps {
  channelId: SbChannelId
  channelName: string
  userId: SbUserId
  /** Called once the user has been unbanned successfully. */
  onSuccess: () => void
}

export function ChannelUnbanUserConfirmation({
  onCancel,
  channelId,
  channelName,
  userId,
  onSuccess,
}: ChannelUnbanUserConfirmationProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const user = useAppSelector(s => s.users.byId.get(userId))!
  const [isWorking, setIsWorking] = useState(false)

  const onConfirmClick = () => {
    setIsWorking(true)

    dispatch(
      unbanUser(channelId, userId, {
        onSuccess: () => {
          snackbarController.showSnackbar(
            t('chat.unbanUser.successMessage', {
              defaultValue: '{{user}} was unbanned',
              user: user.name,
            }),
          )
          dispatch(closeDialog(DialogType.ChannelUnbanUser))
          onSuccess()
        },
        onError: () => {
          setIsWorking(false)
          snackbarController.showSnackbar(
            t('chat.unbanUser.errorMessage', {
              defaultValue: 'Something went wrong while unbanning {{user}}',
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
      disabled={isWorking}
    />,
    <TextButton
      label={t('chat.unbanUser.action', 'Unban')}
      key='unban'
      onClick={onConfirmClick}
      disabled={isWorking}
    />,
  ]

  return (
    <Dialog title={t('chat.unbanUser.title', 'Unban user?')} buttons={buttons} onCancel={onCancel}>
      <BodyLarge>
        <Trans t={t} i18nKey='chat.unbanUser.body'>
          Are you sure you want to unban {{ user: user.name }} from #{{ channelName }}? They will be
          able to join the channel again.
        </Trans>
      </BodyLarge>
    </Dialog>
  )
}
