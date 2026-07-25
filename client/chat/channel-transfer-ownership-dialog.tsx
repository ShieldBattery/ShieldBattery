import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SbChannelId } from '../../common/chat'
import { SbUserId } from '../../common/users/sb-user-id'
import { useSelfUser } from '../auth/auth-utils'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { BodyLarge } from '../styles/typography'
import { transferChannelOwnership } from './action-creators'

export interface ChannelTransferOwnershipDialogProps extends CommonDialogProps {
  channelId: SbChannelId
  userId: SbUserId
  /**
   * The name of the channel, used to make it clear which channel is being handed over when the
   * viewer is the owner losing it. Viewers that aren't the owner (and callers that don't know the
   * name) get a generic prompt instead.
   */
  channelName?: string
  /** Called once the ownership has been transferred successfully. */
  onSuccess?: () => void
}

export function ChannelTransferOwnershipDialog({
  onCancel,
  channelId,
  userId,
  channelName,
  onSuccess,
}: ChannelTransferOwnershipDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const user = useAppSelector(s => s.users.byId.get(userId))
  const selfUser = useSelfUser()
  const ownerId = useAppSelector(s => s.chat.idToJoinedInfo.get(channelId)?.ownerId)
  // Server moderators can transfer the ownership of channels they don't own, so the "you will no
  // longer be the owner" phrasing is only correct when the viewer actually is the current owner.
  const isSelfOwner = ownerId !== undefined && ownerId === selfUser?.id
  const [isTransferring, setIsTransferring] = useState(false)

  const userName = user?.name ?? ''

  const onConfirmClick = () => {
    setIsTransferring(true)

    dispatch(
      transferChannelOwnership(channelId, userId, {
        onSuccess: () => {
          setIsTransferring(false)
          snackbarController.showSnackbar(
            t('chat.transferOwnership.successMessage', {
              defaultValue: '{{user}} is now the channel owner',
              user: userName,
            }),
          )
          dispatch(closeDialog(DialogType.ChannelTransferOwnership))
          onSuccess?.()
        },
        onError: () => {
          setIsTransferring(false)
          snackbarController.showSnackbar(
            t('chat.transferOwnership.errorMessage', {
              defaultValue: 'Something went wrong while transferring the ownership to {{user}}',
              user: userName,
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
      disabled={isTransferring}
    />,
    <TextButton
      label={t('chat.transferOwnership.confirmAction', 'Transfer ownership')}
      key='transfer'
      onClick={onConfirmClick}
      disabled={isTransferring}
    />,
  ]

  return (
    <Dialog
      title={t('chat.transferOwnership.dialogTitle', 'Transfer ownership?')}
      buttons={buttons}
      onCancel={onCancel}>
      <BodyLarge>
        {isSelfOwner && channelName
          ? t('chat.transferOwnership.body', {
              defaultValue:
                'Transfer ownership of #{{channelName}} to {{user}}? You will no longer be the owner.',
              channelName,
              user: userName,
            })
          : t('chat.transferOwnership.adminBody', {
              defaultValue:
                'Make {{user}} the owner of this channel? The current owner will lose ownership.',
              user: userName,
            })}
      </BodyLarge>
    </Dialog>
  )
}
