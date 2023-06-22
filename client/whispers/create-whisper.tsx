import React, { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { USERNAME_MAXLENGTH, USERNAME_MINLENGTH, USERNAME_PATTERN } from '../../common/constants'
import { whisperServiceErrorToString } from '../../common/whispers'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { useForm } from '../forms/form-hook'
import { composeValidators, maxLength, minLength, regex, required } from '../forms/validators'
import { useAutoFocusRef } from '../material/auto-focus'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { TextField } from '../material/text-field'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import { colorError } from '../styles/colors'
import { subtitle1 } from '../styles/typography'
import { navigateToWhisper, startWhisperSessionByName } from './action-creators'

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
