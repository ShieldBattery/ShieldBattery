import React, { useState } from 'react'
import styled from 'styled-components'
import { ChatServiceErrorCode } from '../../common/chat'
import { CHANNEL_MAXLENGTH, CHANNEL_PATTERN } from '../../common/constants'
import { useForm } from '../forms/form-hook'
import SubmitOnEnter from '../forms/submit-on-enter'
import { composeValidators, maxLength, regex, required } from '../forms/validators'
import logger from '../logging/logger'
import { useAutoFocusRef } from '../material/auto-focus'
import { RaisedButton } from '../material/button'
import { TextField } from '../material/text-field'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import { colorError } from '../styles/colors'
import { headline4, subtitle1 } from '../styles/typography'
import { createChannel, navigateToChannel } from './action-creators'

const CreateChannelRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 400px;
  padding: 16px 24px;
`

const Title = styled.div`
  ${headline4};
`

const ErrorText = styled.div`
  ${subtitle1};
  color: ${colorError};
`

const channelValidator = composeValidators(
  required('Enter a channel name'),
  maxLength(CHANNEL_MAXLENGTH, `Enter at most ${CHANNEL_MAXLENGTH} characters`),
  regex(CHANNEL_PATTERN, 'Channel name contains invalid characters'),
)

interface JoinChannelModel {
  channel: string
}

export function CreateChannel() {
  const dispatch = useAppDispatch()
  const [errorMessage, setErrorMessage] = useState<string>()
  const autoFocusRef = useAutoFocusRef<HTMLInputElement>()

  const onFormSubmit = useStableCallback((model: JoinChannelModel) => {
    const channelName = model.channel

    dispatch(
      createChannel(channelName, {
        onSuccess: channel => navigateToChannel(channel.channelInfo.id, channel.channelInfo.name),
        onError: err => {
          let message = `An error occurred while joining ${channelName}`

          if (isFetchError(err) && err.code) {
            if (err.code === ChatServiceErrorCode.UserBanned) {
              message = `You are banned from ${channelName}`
            } else {
              logger.error(`Unhandled code when joining ${channelName}: ${err.code}`)
            }
          } else {
            logger.error(`Error when joining ${channelName}: ${err.stack ?? err}`)
          }
          setErrorMessage(message)
        },
      }),
    )
  })

  const { onSubmit, bindInput } = useForm<JoinChannelModel>(
    { channel: '' },
    { channel: value => channelValidator(value) },
    { onSubmit: onFormSubmit },
  )

  return (
    <CreateChannelRoot>
      <Title>Create channel</Title>
      {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
      <form noValidate={true} onSubmit={onSubmit}>
        <SubmitOnEnter />

        <TextField
          {...bindInput('channel')}
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

        <RaisedButton label='Create channel' color='primary' onClick={onSubmit} />
      </form>
    </CreateChannelRoot>
  )
}
