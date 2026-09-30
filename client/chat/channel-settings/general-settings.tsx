import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  BasicChannelInfo,
  ChatServiceErrorCode,
  DetailedChannelInfo,
  EditChannelRequest,
  JoinedChannelInfo,
} from '../../../common/chat'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import { FilledButton, TextButton } from '../../material/button'
import { isFetchError } from '../../network/fetch-errors'
import { useRefreshToken } from '../../network/refresh-token'
import { LoadingDotsArea } from '../../progress/dots'
import { useAppDispatch } from '../../redux-hooks'
import { bodyLarge } from '../../styles/typography'
import { updateChannel } from '../action-creators'
import {
  ChannelCardPreview,
  ChannelSettingsFields,
  ChannelSettingsModel,
  useChannelImageUrls,
  useChannelImageValidators,
} from './channel-settings-fields'

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`

const ErrorText = styled.span`
  ${bodyLarge};
  color: var(--theme-error);
`

const Content = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 24px;
`

const FormContainer = styled.div`
  position: relative;
  flex-grow: 1;
  min-width: 0;
`

const StyledForm = styled.form`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const DisabledOverlay = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  right: 0;
  bottom: 0;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
`

const ActionButtonsContainer = styled.div`
  display: flex;
  flex-direction: row;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
`

export function GeneralSettings({
  basicChannelInfo,
  detailedChannelInfo,
  joinedChannelInfo,
  onCloseSettings,
}: {
  basicChannelInfo: BasicChannelInfo
  detailedChannelInfo: DetailedChannelInfo
  joinedChannelInfo: JoinedChannelInfo
  onCloseSettings: () => void
}) {
  const [formKey, resetForm] = useRefreshToken()

  return (
    <GeneralSettingsForm
      key={formKey}
      basicChannelInfo={basicChannelInfo}
      detailedChannelInfo={detailedChannelInfo}
      joinedChannelInfo={joinedChannelInfo}
      onCloseSettings={onCloseSettings}
      onReset={resetForm}
    />
  )
}

function GeneralSettingsForm({
  basicChannelInfo,
  detailedChannelInfo,
  joinedChannelInfo,
  onCloseSettings,
  onReset,
}: {
  basicChannelInfo: BasicChannelInfo
  detailedChannelInfo: DetailedChannelInfo
  joinedChannelInfo: JoinedChannelInfo
  onCloseSettings: () => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<Error>()

  const imageValidators = useChannelImageValidators()
  const settingsForm = useForm<ChannelSettingsModel>(
    {
      description: detailedChannelInfo.description,
      topic: joinedChannelInfo.topic,
      uploadedBannerPath: detailedChannelInfo.bannerPath,
      uploadedBadgePath: detailedChannelInfo.badgePath,
      private: basicChannelInfo.private,
      membersCanInvite: joinedChannelInfo.membersCanInvite,
    },
    imageValidators,
  )
  const { submit, getInputValue, hasChanges, form } = settingsForm

  useFormCallbacks(form, {
    onSubmit: model => {
      const patch: EditChannelRequest = {
        description:
          model.description !== detailedChannelInfo.description ? model.description : undefined,
        topic: model.topic !== joinedChannelInfo.topic ? model.topic : undefined,
        deleteBanner: !model.uploadedBannerPath && !model.banner ? true : undefined,
        deleteBadge: !model.uploadedBadgePath && !model.badge ? true : undefined,
        private: model.private !== basicChannelInfo.private ? model.private : undefined,
        membersCanInvite:
          model.membersCanInvite !== joinedChannelInfo.membersCanInvite
            ? model.membersCanInvite
            : undefined,
      }

      setIsSaving(true)
      setError(undefined)

      dispatch(
        updateChannel({
          channelId: basicChannelInfo.id,
          channelChanges: patch,
          channelBanner: model.banner,
          channelBadge: model.badge,
          spec: {
            onSuccess: () => {
              setIsSaving(false)
              onCloseSettings()
            },
            onError: err => {
              setIsSaving(false)
              setError(err)
            },
          },
        }),
      )
    },
  })

  const { bannerUrl, badgeUrl } = useChannelImageUrls(settingsForm)

  let errorMessage
  if (error) {
    if (isFetchError(error) && error.code === ChatServiceErrorCode.InappropriateImage) {
      errorMessage = t(
        'chat.channelSettings.general.inappropriateImageErrorMessage',
        'The selected image is inappropriate. Please select a different image.',
      )
    } else {
      errorMessage = t(
        'chat.channelSettings.general.saveErrorMessage',
        'Something went wrong while saving the settings',
      )
    }
  }

  return (
    <Root>
      {errorMessage ? (
        <ErrorText data-testid='channel-settings-error-message'>{errorMessage}</ErrorText>
      ) : null}

      <Content>
        <FormContainer>
          <StyledForm noValidate={true} onSubmit={submit}>
            <ChannelSettingsFields
              form={settingsForm}
              bannerUrl={bannerUrl}
              badgeUrl={badgeUrl}
              disabled={isSaving}
              canBePrivate={!basicChannelInfo.official}
              testNamePrefix='channel-settings'
            />

            {hasChanges && !isSaving ? (
              <ActionButtonsContainer>
                <TextButton
                  label={t('common.actions.reset', 'Reset')}
                  disabled={isSaving}
                  onClick={onReset}
                  testName='channel-settings-reset-button'
                />
                <FilledButton
                  type='submit'
                  label={t('common.actions.save', 'Save')}
                  disabled={isSaving}
                  testName='channel-settings-save-button'
                />
              </ActionButtonsContainer>
            ) : null}
          </StyledForm>

          {isSaving ? (
            <DisabledOverlay>
              <LoadingDotsArea />
            </DisabledOverlay>
          ) : null}
        </FormContainer>

        <ChannelCardPreview
          name={basicChannelInfo.name}
          bannerUrl={bannerUrl}
          badgeUrl={badgeUrl}
          description={getInputValue('description')}
          testNamePrefix='channel-settings'
        />
      </Content>
    </Root>
  )
}
