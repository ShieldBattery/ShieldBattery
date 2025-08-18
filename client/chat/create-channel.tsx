import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ChatServiceErrorCode } from '../../common/chat'
import { CHANNEL_MAXLENGTH, CHANNEL_PATTERN } from '../../common/constants'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { composeValidators, maxLength, regex, required } from '../forms/validators'
import logger from '../logging/logger'
import { useAutoFocusRef } from '../material/auto-focus'
import { FilledButton } from '../material/button'
import { TextField } from '../material/text-field'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch } from '../redux-hooks'
import { bodyLarge, headlineMedium } from '../styles/typography'
import { joinChannel, navigateToChannel } from './action-creators'

const CreateChannelRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 400px;
  padding: 16px 24px;
`

const Title = styled.div`
  ${headlineMedium};
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

interface JoinChannelModel {
  channel: string
}

export function CreateChannel() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [error, setError] = useState<Error>()
  const autoFocusRef = useAutoFocusRef<HTMLInputElement>()

  const { submit, bindInput, form } = useForm<JoinChannelModel>(
    { channel: '' },
    {
      channel: composeValidators(
        required(t('chat.channelValidator.required', 'Enter a channel name')),
        maxLength(CHANNEL_MAXLENGTH),
        regex(
          CHANNEL_PATTERN,
          t('chat.channelValidator.pattern', 'Channel name contains invalid characters'),
        ),
      ),
    },
  )

  useFormCallbacks(form, {
    onSubmit: model => {
      const channelName = model.channel

      dispatch(
        joinChannel(channelName, {
          onSuccess: channel => navigateToChannel(channel.channelInfo.id, channel.channelInfo.name),
          onError: err => setError(err),
        }),
      )
    },
  })

  let errorMessage
  if (error) {
    errorMessage = t(
      'chat.createChannel.defaultError',
      'An error occurred while creating the channel.',
    )

    if (isFetchError(error) && error.code) {
      if (error.code === ChatServiceErrorCode.MaximumOwnedChannels) {
        errorMessage = t(
          'chat.createChannel.maximumOwnedError',
          'You have reached the limit of created channels. ' +
            'You must leave one channel you created before you can create another.',
        )
      } else if (error.code === ChatServiceErrorCode.UserBanned) {
        errorMessage = t('chat.createChannel.bannedError', 'You are banned from this channel.')
      } else {
        logger.error(`Unhandled code when creating the channel: ${error.code}`)
      }
    } else {
      logger.error(`Error when creating the channel: ${String(error.stack ?? error)}`)
    }
  }

  return (
    <CreateChannelRoot>
      <Title>{t('chat.createChannel.title', 'Create channel')}</Title>
      {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
      <form noValidate={true} onSubmit={submit}>
        <TextField
          {...bindInput('channel')}
          label={t('chat.createChannel.channelName', 'Channel name')}
          floatingLabel={true}
          ref={autoFocusRef}
          inputProps={{
            autoCapitalize: 'off',
            autoCorrect: 'off',
            spellCheck: false,
            tabIndex: 0,
          }}
        />

        <FilledButton
          type='submit'
          label={t('chat.createChannel.createAction', 'Create channel')}
          onClick={submit}
        />
      </form>
    </CreateChannelRoot>
  )
}
