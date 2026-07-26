import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SbChannelId } from '../../../common/chat'
import { closeDialog } from '../../dialogs/action-creators'
import { CommonDialogProps } from '../../dialogs/common-dialog-props'
import { DialogType } from '../../dialogs/dialog-type'
import { TextButton } from '../../material/button'
import { Dialog } from '../../material/dialog'
import { useAppDispatch } from '../../redux-hooks'
import { useSnackbarController } from '../../snackbars/snackbar-overlay'
import { BodyLarge } from '../../styles/typography'
import { deleteMessageAsAdmin } from '../action-creators'

export interface AdminDeleteChatMessageDialogProps extends CommonDialogProps {
  channelId: SbChannelId
  messageId: string
}

export function AdminDeleteChatMessageDialog({
  onCancel,
  channelId,
  messageId,
}: AdminDeleteChatMessageDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const [isDeleting, setIsDeleting] = useState(false)

  const onConfirmClick = () => {
    setIsDeleting(true)

    dispatch(
      deleteMessageAsAdmin(channelId, messageId, {
        onSuccess: () => {
          snackbarController.showSnackbar(t('chat.deleteMessage.successMessage', 'Message deleted'))
          dispatch(closeDialog(DialogType.AdminDeleteChatMessage))
        },
        onError: () => {
          setIsDeleting(false)
          snackbarController.showSnackbar(
            t('chat.deleteMessage.errorMessage', 'Error deleting message'),
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
      disabled={isDeleting}
    />,
    <TextButton
      label={t('common.actions.delete', 'Delete')}
      key='delete'
      onClick={onConfirmClick}
      disabled={isDeleting}
    />,
  ]

  return (
    <Dialog
      title={t('chat.deleteMessage.dialogTitle', 'Delete message?')}
      buttons={buttons}
      onCancel={onCancel}>
      <BodyLarge>
        {t(
          'chat.deleteMessage.dialogBody',
          "This will permanently delete the message. This can't be undone.",
        )}
      </BodyLarge>
    </Dialog>
  )
}
