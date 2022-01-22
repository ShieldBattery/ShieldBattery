import React, { useCallback } from 'react'
import { ChannelModerationAction } from '../../common/chat'
import { SbUser } from '../../common/users/sb-user'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useForm } from '../forms/form-hook'
import { useAutoFocusRef } from '../material/auto-focus'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import TextField from '../material/text-field'
import { useAppDispatch } from '../redux-hooks'
import { openSnackbar } from '../snackbars/action-creators'
import { moderateUser } from './action-creators'

interface BanUserModel {
  banReason: string
}

interface ChannelBanUserDialogProps extends CommonDialogProps {
  channel: string
  user: SbUser
}

export function ChannelBanUserDialog({
  dialogRef,
  onCancel,
  channel,
  user,
}: ChannelBanUserDialogProps) {
  const dispatch = useAppDispatch()
  const autoFocusRef = useAutoFocusRef<TextField>()

  const onFormSubmit = useCallback(
    (model: BanUserModel) => {
      dispatch(
        moderateUser(
          channel,
          user.id,
          ChannelModerationAction.Ban,
          {
            onSuccess: () => dispatch(openSnackbar({ message: `${user.name} was banned` })),
            onError: () => dispatch(openSnackbar({ message: `Error banning ${user.name}` })),
          },
          model.banReason,
        ),
      )
      dispatch(closeDialog())
    },
    [channel, user, dispatch],
  )

  const { onSubmit: handleSubmit, bindInput } = useForm<BanUserModel>(
    { banReason: '' },
    {},
    { onSubmit: onFormSubmit },
  )

  const onBanClick = useCallback(() => handleSubmit(), [handleSubmit])

  const buttons = [
    <TextButton label='Cancel' key='cancel' color='accent' onClick={onCancel} />,
    <TextButton label={`Ban ${user.name}`} key='send' color='accent' onClick={onBanClick} />,
  ]

  return (
    <Dialog
      title={`Ban ${user.name} from ${channel}?`}
      buttons={buttons}
      onCancel={onCancel}
      dialogRef={dialogRef}>
      <form noValidate={true} onSubmit={handleSubmit}>
        <TextField
          {...bindInput('banReason')}
          label='Ban reason (optional)'
          floatingLabel={true}
          ref={autoFocusRef}
          inputProps={{
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: 'off',
            tabIndex: 0,
          }}
        />
      </form>
    </Dialog>
  )
}
