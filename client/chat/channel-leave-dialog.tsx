import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SbChannelId } from '../../common/chat'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { BodyLarge } from '../styles/typography'
import { ChannelLeaveSeverity, getChannelLeaveSeverity, leaveChannel } from './action-creators'

export interface ChannelLeaveConfirmationProps extends CommonDialogProps {
  channelId: SbChannelId
}

export function ChannelLeaveConfirmation({ onCancel, channelId }: ChannelLeaveConfirmationProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const selfId = useAppSelector(s => s.auth.self!.user.id)
  const currentSeverity = useAppSelector(s => getChannelLeaveSeverity(s, channelId, selfId))
  // What's at stake is captured when the dialog opens: leaving clears the membership state this is
  // derived from, so recomputing it would rewrite the text as the dialog tears down.
  const [severity] = useState(currentSeverity)
  const channelName = useAppSelector(s => s.chat.idToBasicInfo.get(channelId)?.name ?? '')
  const [isLeaving, setIsLeaving] = useState(false)

  const onConfirmClick = () => {
    setIsLeaving(true)

    dispatch(
      leaveChannel(channelId, {
        onSuccess: () => {
          dispatch(closeDialog(DialogType.ChannelLeaveConfirmation))
        },
        onError: () => {
          setIsLeaving(false)
          snackbarController.showSnackbar(
            t('chat.leaveChannel.errorMessage', {
              defaultValue: 'Something went wrong while leaving #{{channelName}}',
              channelName,
            }),
          )
        },
      }),
    )
  }

  let title = t('chat.leaveChannel.dialogTitle', {
    defaultValue: 'Leave #{{channelName}}?',
    channelName,
  })
  let body = t('chat.leaveChannel.losePermissionsBody', {
    defaultValue:
      "Leaving #{{channelName}} will remove your channel permissions, and rejoining won't restore them.",
    channelName,
  })
  let confirmLabel = t('chat.leaveChannel.confirmAction', 'Leave channel')

  if (severity === ChannelLeaveSeverity.DeleteChannel) {
    title = t('chat.leaveChannel.deleteChannelTitle', {
      defaultValue: 'Delete #{{channelName}}?',
      channelName,
    })
    body = t('chat.leaveChannel.deleteChannelBody', {
      defaultValue:
        "You're the last member of #{{channelName}}. Leaving now will permanently delete the channel and its entire message history — this can't be undone.",
      channelName,
    })
    confirmLabel = t('chat.leaveChannel.deleteChannelConfirmAction', 'Delete channel')
  } else if (severity === ChannelLeaveSeverity.LoseOwnership) {
    body = t('chat.leaveChannel.loseOwnershipBody', {
      defaultValue:
        "Leaving #{{channelName}} will pass ownership to another member, and you won't be able to take it back yourself. You'll also lose your channel permissions.",
      channelName,
    })
  }

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      onClick={onCancel}
      disabled={isLeaving}
    />,
    <TextButton label={confirmLabel} key='confirm' onClick={onConfirmClick} disabled={isLeaving} />,
  ]

  return (
    <Dialog title={title} buttons={buttons} onCancel={onCancel}>
      <BodyLarge>{body}</BodyLarge>
    </Dialog>
  )
}
