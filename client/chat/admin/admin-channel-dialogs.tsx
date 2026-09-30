import { useState } from 'react'
import { ChatServiceErrorCode, SbChannelId } from '../../../common/chat'
import { CHANNEL_MAXLENGTH, isValidChannelName } from '../../../common/constants'
import { closeDialog } from '../../dialogs/action-creators'
import { CommonDialogProps } from '../../dialogs/common-dialog-props'
import { DialogType } from '../../dialogs/dialog-type'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import { useAutoFocusRef } from '../../material/auto-focus'
import { TextButton } from '../../material/button'
import { Dialog } from '../../material/dialog'
import { TextField } from '../../material/text-field'
import { isFetchError } from '../../network/fetch-errors'
import { useAppDispatch } from '../../redux-hooks'
import { useSnackbarController } from '../../snackbars/snackbar-overlay'
import { BodyLarge } from '../../styles/typography'
import { closeChannelAdmin, deleteChannelAdmin, renameChannelAdmin } from './admin-action-creators'

interface RenameChannelModel {
  name: string
}

export interface AdminRenameChannelDialogProps extends CommonDialogProps {
  channelId: SbChannelId
  channelName: string
  /** Called once the channel has been renamed successfully. */
  onSuccess?: () => void
}

export function AdminRenameChannelDialog({
  onCancel,
  channelId,
  channelName,
  onSuccess,
}: AdminRenameChannelDialogProps) {
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const autoFocusRef = useAutoFocusRef<HTMLInputElement>()

  const {
    submit: handleSubmit,
    bindInput,
    form,
    setInputError,
  } = useForm<RenameChannelModel>(
    { name: channelName },
    {
      name: value => {
        if (!value) {
          return 'Enter a channel name'
        }
        if (value.length > CHANNEL_MAXLENGTH) {
          return `Channel name must be ${CHANNEL_MAXLENGTH} characters or fewer`
        }
        if (!isValidChannelName(value)) {
          return 'Channel name contains invalid characters'
        }
        return undefined
      },
    },
  )

  useFormCallbacks(form, {
    onSubmit: model => {
      dispatch(
        renameChannelAdmin(channelId, model.name, {
          onSuccess: () => {
            dispatch(closeDialog(DialogType.AdminRenameChannel))
            onSuccess?.()
          },
          onError: err => {
            if (isFetchError(err) && err.code === ChatServiceErrorCode.ChannelNameTaken) {
              setInputError('name', 'A channel with that name already exists')
            } else {
              snackbarController.showSnackbar('Error renaming channel')
            }
          },
        }),
      )
    },
  })

  const buttons = [
    <TextButton label='Cancel' key='cancel' onClick={onCancel} />,
    <TextButton label='Rename' key='rename' onClick={() => handleSubmit()} />,
  ]

  return (
    <Dialog title={`Rename #${channelName}`} buttons={buttons} onCancel={onCancel}>
      <form noValidate={true} onSubmit={handleSubmit}>
        <TextField
          {...bindInput('name')}
          label='Channel name'
          floatingLabel={true}
          ref={autoFocusRef}
          inputProps={{
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
            tabIndex: 0,
          }}
        />
      </form>
    </Dialog>
  )
}

export interface AdminCloseChannelDialogProps extends CommonDialogProps {
  channelId: SbChannelId
  channelName: string
  /** Called once the channel has been closed successfully. */
  onSuccess?: () => void
}

export function AdminCloseChannelDialog({
  onCancel,
  channelId,
  channelName,
  onSuccess,
}: AdminCloseChannelDialogProps) {
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const [isClosing, setIsClosing] = useState(false)

  const onConfirmClick = () => {
    setIsClosing(true)

    dispatch(
      closeChannelAdmin(channelId, {
        onSuccess: () => {
          dispatch(closeDialog(DialogType.AdminCloseChannel))
          onSuccess?.()
        },
        onError: () => {
          setIsClosing(false)
          snackbarController.showSnackbar('Error closing channel')
        },
      }),
    )
  }

  const buttons = [
    <TextButton label='Cancel' key='cancel' onClick={onCancel} disabled={isClosing} />,
    <TextButton label='Close channel' key='close' onClick={onConfirmClick} disabled={isClosing} />,
  ]

  return (
    <Dialog title={`Close #${channelName}?`} buttons={buttons} onCancel={onCancel}>
      <BodyLarge>
        Every member will be removed from the channel and its owner will lose ownership. Nobody will
        be able to join it until it's reopened. The channel's name, message history, and bans are
        kept.
      </BodyLarge>
    </Dialog>
  )
}

export interface AdminDeleteChannelDialogProps extends CommonDialogProps {
  channelId: SbChannelId
  channelName: string
  /** Called once the channel has been deleted successfully. */
  onSuccess?: () => void
}

export function AdminDeleteChannelDialog({
  onCancel,
  channelId,
  channelName,
  onSuccess,
}: AdminDeleteChannelDialogProps) {
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()
  const [isDeleting, setIsDeleting] = useState(false)

  const onConfirmClick = () => {
    setIsDeleting(true)

    dispatch(
      deleteChannelAdmin(channelId, {
        onSuccess: () => {
          dispatch(closeDialog(DialogType.AdminDeleteChannel))
          onSuccess?.()
        },
        onError: () => {
          setIsDeleting(false)
          snackbarController.showSnackbar('Error deleting channel')
        },
      }),
    )
  }

  const buttons = [
    <TextButton label='Cancel' key='cancel' onClick={onCancel} disabled={isDeleting} />,
    <TextButton
      label='Delete channel'
      key='delete'
      onClick={onConfirmClick}
      disabled={isDeleting}
    />,
  ]

  return (
    <Dialog title={`Delete #${channelName}?`} buttons={buttons} onCancel={onCancel}>
      <BodyLarge>
        This will permanently delete the channel, along with all of its messages and bans, and
        remove all of its members. This can't be undone.
      </BodyLarge>
    </Dialog>
  )
}
