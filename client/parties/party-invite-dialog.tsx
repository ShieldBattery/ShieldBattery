import React, { useCallback, useEffect, useRef } from 'react'
import { USERNAME_MAXLENGTH, USERNAME_MINLENGTH, USERNAME_PATTERN } from '../../common/constants'
import { closeDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { useForm } from '../forms/form-hook'
import { composeValidators, maxLength, minLength, regex, required } from '../forms/validators'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import { useAppDispatch } from '../redux-hooks'
import { inviteToParty } from './action-creators'

const userValidator = composeValidators(
  required('Enter a username'),
  minLength(USERNAME_MINLENGTH),
  maxLength(USERNAME_MAXLENGTH),
  regex(USERNAME_PATTERN, 'Username contains invalid characters'),
)

interface InviteUsersModel {
  user: string
}

export function PartyInviteDialog({
  dialogRef,
  onCancel,
}: {
  dialogRef: React.Ref<HTMLDivElement>
  onCancel: () => void
}) {
  const dispatch = useAppDispatch()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const autoFocusTimer = setTimeout(() => inputRef.current?.focus(), 450)
    return () => clearTimeout(autoFocusTimer)
  }, [])

  const onFormSubmit = useCallback(
    (model: InviteUsersModel) => {
      dispatch(inviteToParty({ targetName: model.user }))
      dispatch(closeDialog(DialogType.PartyInvite))
    },
    [dispatch],
  )

  const { onSubmit: handleSubmit, bindInput } = useForm<InviteUsersModel>(
    { user: '' },
    { user: value => userValidator(value) },
    { onSubmit: onFormSubmit },
  )

  const onSendClick = useCallback(() => handleSubmit(), [handleSubmit])

  const buttons = [
    <TextButton label='Cancel' key='cancel' color='accent' onClick={onCancel} />,
    <TextButton label='Send invites' key='send' color='accent' onClick={onSendClick} />,
  ]

  return (
    <Dialog
      title='Invite players to the party'
      buttons={buttons}
      onCancel={onCancel}
      dialogRef={dialogRef}>
      <form noValidate={true} onSubmit={handleSubmit}>
        <TextField
          {...bindInput('user')}
          label='Find players'
          floatingLabel={true}
          ref={inputRef}
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
