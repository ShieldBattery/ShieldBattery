import React, { useCallback, useEffect, useRef } from 'react'
import { USERNAME_MAXLENGTH, USERNAME_MINLENGTH, USERNAME_PATTERN } from '../../common/constants'
import { closeDialog } from '../dialogs/action-creators'
import { useForm } from '../forms/form-hook'
import { composeValidators, maxLength, minLength, regex, required } from '../forms/validators'
import { TextButton } from '../material/button'
import Dialog from '../material/dialog'
import TextField from '../material/text-field'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSnackbar } from '../snackbars/action-creators'
import { inviteToParty } from './action-creators'

const userValidator = composeValidators(
  required('Enter a username'),
  minLength(USERNAME_MINLENGTH),
  maxLength(USERNAME_MAXLENGTH),
  regex(USERNAME_PATTERN, 'User name contains invalid characters'),
)

interface InviteUsersModel {
  user: string
}

export function PartyInviteDialog({
  dialogRef,
  onCancel,
}: {
  dialogRef: HTMLElement
  onCancel: () => void
}) {
  const dispatch = useAppDispatch()
  const usernameToId = useAppSelector(s => s.users.usernameToId)
  const inputRef = useRef<TextField>(null)

  useEffect(() => {
    const autoFocusTimer = setTimeout(() => inputRef.current?.focus(), 450)
    return () => clearTimeout(autoFocusTimer)
  }, [])

  const onFormSubmit = useCallback(
    (model: InviteUsersModel) => {
      // TODO(2Pac): Make this a case-insensitive search (or make the whole thing redundant by doing
      // it differently; see comment below).
      const userId = usernameToId.get(model.user)

      // TODO(2Pac): Need to rethink how to get the user ID from the entered username. Since someone
      // can pretty much enter *any* user in the system here, we would need to load all existing
      // users on the client, which is obviously a bad idea. One alternative would be to rewrite the
      // invite API to take the username, which is also pretty bad.
      // The better solution, I think, would be to have the input field perform a (debounced) API
      // request to fetch the user info while the user is typing. This could be combined into an
      // autocomplete component which we should use here anyway at some point.
      if (!userId) {
        dispatch(openSnackbar({ message: 'Unknown user' }))
        return
      }
      dispatch(inviteToParty(userId))
      dispatch(closeDialog())
    },
    [usernameToId, dispatch],
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
            spellCheck: 'off',
            tabIndex: 0,
          }}
        />
      </form>
    </Dialog>
  )
}
