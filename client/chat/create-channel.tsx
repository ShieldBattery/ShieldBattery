import { TFunction } from 'i18next'
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
import { createChannel } from './action-creators'
import {
  ChannelCardPreview,
  ChannelSettingsFields,
  ChannelSettingsModel,
  useChannelImageUrls,
  useChannelImageValidators,
} from './channel-settings/channel-settings-fields'

const CreateChannelRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 880px;
  padding: 16px 24px;
`

const Title = styled.div`
  ${headlineMedium};
`

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const Content = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 24px;
`

const StyledForm = styled.form`
  flex: 1 1 360px;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 4px;
`

const ActionButtonsContainer = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
`

interface CreateChannelModel extends ChannelSettingsModel {
  name: string
}

export function CreateChannel() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [isCreating, setIsCreating] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string>()
  const autoFocusRef = useAutoFocusRef<HTMLInputElement>()

  const imageValidators = useChannelImageValidators()
  const createForm = useForm<CreateChannelModel>(
    { name: '', private: false, membersCanInvite: false },
    {
      ...imageValidators,
      name: composeValidators(
        required(t('chat.channelValidator.required', 'Enter a channel name')),
        maxLength(CHANNEL_MAXLENGTH),
        regex(
          CHANNEL_PATTERN,
          t('chat.channelValidator.pattern', 'Channel name contains invalid characters'),
        ),
      ),
    },
  )
  const { submit, bindInput, getInputValue, setInputError, form } = createForm

  useFormCallbacks(form, {
    onSubmit: model => {
      setIsCreating(true)
      setErrorMessage(undefined)

      dispatch(
        createChannel({
          settings: {
            name: model.name,
            description: model.description || undefined,
            topic: model.topic || undefined,
            private: model.private,
            membersCanInvite: model.private ? model.membersCanInvite : undefined,
          },
          banner: model.banner,
          badge: model.badge,
          spec: {
            onSuccess: () => {},
            onError: err => {
              setIsCreating(false)
              if (isFetchError(err) && err.code === ChatServiceErrorCode.ChannelNameTaken) {
                setInputError(
                  'name',
                  t(
                    'chat.createChannel.nameTakenError',
                    'A channel with this name already exists.',
                  ),
                )
              } else {
                setErrorMessage(getCreateChannelErrorMessage(err, t))
              }
            },
          },
        }),
      )
    },
  })

  const { bannerUrl, badgeUrl } = useChannelImageUrls(createForm)
  const name = getInputValue('name')

  return (
    <CreateChannelRoot>
      <Title>{t('chat.createChannel.title', 'Create channel')}</Title>
      {errorMessage ? <ErrorText>{errorMessage}</ErrorText> : null}
      <Content>
        <StyledForm noValidate={true} onSubmit={submit}>
          <TextField
            {...bindInput('name')}
            label={t('chat.createChannel.channelName', 'Channel name')}
            floatingLabel={true}
            disabled={isCreating}
            ref={autoFocusRef}
            inputProps={{
              autoCapitalize: 'off',
              autoCorrect: 'off',
              spellCheck: false,
              tabIndex: 0,
            }}
            testName='create-channel-name-input'
          />

          <ChannelSettingsFields
            form={createForm}
            bannerUrl={bannerUrl}
            badgeUrl={badgeUrl}
            disabled={isCreating}
            canBePrivate={true}
            testNamePrefix='create-channel'
          />

          <ActionButtonsContainer>
            <FilledButton
              type='submit'
              label={t('chat.createChannel.createAction', 'Create channel')}
              disabled={isCreating}
              testName='create-channel-button'
            />
          </ActionButtonsContainer>
        </StyledForm>

        <ChannelCardPreview
          name={name || t('chat.createChannel.channelName', 'Channel name')}
          bannerUrl={bannerUrl}
          badgeUrl={badgeUrl}
          description={getInputValue('description')}
          testNamePrefix='create-channel'
        />
      </Content>
    </CreateChannelRoot>
  )
}

function getCreateChannelErrorMessage(error: Error, t: TFunction): string {
  if (isFetchError(error) && error.code) {
    switch (error.code) {
      case ChatServiceErrorCode.MaximumOwnedChannels:
        return t(
          'chat.createChannel.maximumOwnedError',
          'You have reached the limit of created channels. ' +
            'You must leave one channel you created before you can create another.',
        )
      case ChatServiceErrorCode.MaximumJoinedChannels:
        return t(
          'chat.joinChannel.maximumChannelsError',
          'You have reached the limit of joined channels. ' +
            'You must leave one before you can join another.',
        )
      case ChatServiceErrorCode.UserChatRestricted:
        return t(
          'chat.createChannel.chatRestrictedError',
          "You're currently restricted from chatting, so you can't create channels.",
        )
      case ChatServiceErrorCode.InappropriateImage:
        return t(
          'chat.channelSettings.general.inappropriateImageErrorMessage',
          'The selected image is inappropriate. Please select a different image.',
        )
      default:
        logger.error(`Unhandled code when creating the channel: ${error.code}`)
    }
  } else {
    logger.error(`Error when creating the channel: ${String(error.stack ?? error)}`)
  }

  return t('chat.createChannel.defaultError', 'An error occurred while creating the channel.')
}
