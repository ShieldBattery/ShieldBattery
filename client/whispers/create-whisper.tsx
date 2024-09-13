import React, { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { styled } from 'styled-components'
import { USERNAME_MAXLENGTH, USERNAME_MINLENGTH, USERNAME_PATTERN } from '../../common/constants.js'
import { whisperServiceErrorToString } from '../../common/whispers.js'
import { closeDialog } from '../dialogs/action-creators.js'
import { CommonDialogProps } from '../dialogs/common-dialog-props.js'
import { DialogType } from '../dialogs/dialog-type.js'
import { useForm } from '../forms/form-hook.js'
import { composeValidators, maxLength, minLength, regex, required } from '../forms/validators.js'
import { useAutoFocusRef } from '../material/auto-focus.js'
import { TextButton } from '../material/button.js'
import { Dialog } from '../material/dialog.js'
import { TextField } from '../material/text-field.js'
import { isFetchError } from '../network/fetch-errors.js'
import { LoadingDotsArea } from '../progress/dots.js'
import { useAppDispatch } from '../redux-hooks.js'
import { useStableCallback } from '../state-hooks.js'
import { colorError } from '../styles/colors.js'
import { subtitle1 } from '../styles/typography.js'
import { navigateToWhisper, startWhisperSessionByName } from './action-creators.js'

const ErrorText = styled.div`
  ${subtitle1};
  color: ${colorError};
  margin-bottom: 16px;
`

const usernameValidator = composeValidators(
  required(t => t('whispers.createWhisper.usernameRequired', 'Enter a username')),
  minLength(USERNAME_MINLENGTH),
  maxLength(USERNAME_MAXLENGTH),
  regex(USERNAME_PATTERN, t =>
    t('whispers.createWhisper.usernamePattern', 'Username contains invalid characters'),
  ),
)

interface CreateWhisperFormModel {
  target: string
}

export function CreateWhisper(props: CommonDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const inputRef = useAutoFocusRef<HTMLInputElement>()
  const [loading, setLoading] = useState(false)
  const [lastError, setLastError] = useState<Error>()
  const onFormSubmit = useStableCallback(({ target }: CreateWhisperFormModel) => {
    setLoading(true)
    dispatch(
      startWhisperSessionByName(target, {
        onSuccess: ({ userId }) => {
          dispatch(closeDialog(DialogType.Whispers))
          navigateToWhisper(userId, target)
        },
        onError: err => {
          setLoading(false)
          setLastError(err)
        },
      }),
    )
  })

  const { onSubmit, bindInput } = useForm<CreateWhisperFormModel>(
    { target: '' },
    {
      target: usernameValidator,
    },
    { onSubmit: onFormSubmit },
  )

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      color='accent'
      onClick={props.onCancel}
    />,
    <TextButton
      label={t('common.actions.start', 'Start')}
      key='send'
      color='accent'
      onClick={onSubmit}
    />,
  ]

  return (
    <Dialog
      title={t('whispers.createWhisper.title', 'Send a message')}
      buttons={buttons}
      onCancel={props.onCancel}
      dialogRef={props.dialogRef}>
      {loading ? (
        <LoadingDotsArea />
      ) : (
        <>
          {lastError ? (
            <ErrorText>
              <Trans t={t} i18nKey='whispers.createWhisper.error'>
                Error:{' '}
                {{
                  errorMessage: isFetchError(lastError)
                    ? whisperServiceErrorToString(lastError.code, t)
                    : lastError.message,
                }}
              </Trans>
            </ErrorText>
          ) : undefined}
          <form noValidate={true} onSubmit={onSubmit}>
            <TextField
              {...bindInput('target')}
              label={t('whispers.createWhisper.username', 'Username')}
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
        </>
      )}
    </Dialog>
  )
}
