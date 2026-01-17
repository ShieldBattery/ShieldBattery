import prettyBytes from 'pretty-bytes'
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
import { MAX_IMAGE_SIZE_BYTES } from '../../../common/images'
import { useObjectUrl } from '../../dom/use-object-url'
import { useForm, useFormCallbacks } from '../../forms/form-hook'
import { maxFileSize } from '../../forms/validators'
import { MaterialIcon } from '../../icons/material/material-icon'
import { FilledButton, TextButton } from '../../material/button'
import { SingleFileInput } from '../../material/file-input'
import { TextField } from '../../material/text-field'
import { isFetchError } from '../../network/fetch-errors'
import { useRefreshToken } from '../../network/refresh-token'
import { LoadingDotsArea } from '../../progress/dots'
import { useAppDispatch } from '../../redux-hooks'
import { FlexSpacer } from '../../styles/flex-spacer'
import { bodyLarge } from '../../styles/typography'
import { updateChannel } from '../action-creators'
import { ChannelBadge } from '../channel-badge'
import { ChannelBanner, ChannelBannerPlaceholderImage } from '../channel-banner'
import {
  ChannelActions,
  ChannelBannerAndBadge,
  ChannelCardBadge,
  ChannelCardRoot,
  ChannelDescriptionContainer,
  ChannelName,
} from '../channel-info-card'

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

const BannerButtonsContainer = styled.div`
  width: fit-content;
  display: grid;
  grid-template-columns: min-content min-content;
  grid-column-gap: 16px;
  grid-row-gap: 4px;
  align-items: flex-start;
  justify-content: space-between;
`

const TextFieldContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 20px;
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

const StyledChannelCardRoot = styled(ChannelCardRoot)`
  flex-shrink: 0;
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

export interface ChannelSettingsModel {
  description?: string
  topic?: string
  uploadedBannerPath?: string
  uploadedBadgePath?: string
  banner?: File
  badge?: File
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

  const { submit, bindCustom, bindInput, getInputValue, setInputValue, hasChanges, form } =
    useForm<ChannelSettingsModel>(
      {
        description: detailedChannelInfo.description,
        topic: joinedChannelInfo.topic,
        uploadedBannerPath: detailedChannelInfo.bannerPath,
        uploadedBadgePath: detailedChannelInfo.badgePath,
      },
      {
        banner: maxFileSize(
          MAX_IMAGE_SIZE_BYTES,
          t('chat.channelSettings.general.bannerMaxFileSizeErrorMessage', {
            defaultValue: 'The maximum banner file size is {{fileSize}}.',
            fileSize: prettyBytes(MAX_IMAGE_SIZE_BYTES),
          }),
        ),
        badge: maxFileSize(
          MAX_IMAGE_SIZE_BYTES,
          t('chat.channelSettings.general.badgeMaxFileSizeErrorMessage', {
            defaultValue: 'The maximum badge file size is {{fileSize}}.',
            fileSize: prettyBytes(MAX_IMAGE_SIZE_BYTES),
          }),
        ),
      },
    )

  useFormCallbacks(form, {
    onSubmit: model => {
      const patch: EditChannelRequest = {
        description:
          model.description !== detailedChannelInfo.description ? model.description : undefined,
        topic: model.topic !== joinedChannelInfo.topic ? model.topic : undefined,
        deleteBanner: !model.uploadedBannerPath && !model.banner ? true : undefined,
        deleteBadge: !model.uploadedBadgePath && !model.badge ? true : undefined,
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

  const bannerUrl = useObjectUrl(getInputValue('banner')) ?? getInputValue('uploadedBannerPath')
  const badgeUrl = useObjectUrl(getInputValue('badge')) ?? getInputValue('uploadedBadgePath')

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
        <ErrorText data-test='channel-settings-error-message'>{errorMessage}</ErrorText>
      ) : null}

      <Content>
        <FormContainer>
          <StyledForm noValidate={true} onSubmit={submit}>
            <BannerButtonsContainer>
              <SingleFileInput
                {...bindCustom('banner')}
                label={bannerUrl ? 'Change banner' : 'Upload banner'}
                allowErrors={true}
                disabled={isSaving}
                inputProps={{ accept: 'image/*' }}
                testName='channel-settings-banner-input'
              />

              {bannerUrl ? (
                <TextButton
                  label='Remove banner'
                  disabled={isSaving}
                  iconStart={<MaterialIcon icon='clear' />}
                  onClick={() => {
                    setInputValue('uploadedBannerPath', undefined)
                    setInputValue('banner', undefined)
                  }}
                />
              ) : (
                <div></div>
              )}

              <SingleFileInput
                {...bindCustom('badge')}
                label={badgeUrl ? 'Change badge' : 'Upload badge'}
                allowErrors={true}
                disabled={isSaving}
                inputProps={{ accept: 'image/*' }}
                testName='channel-settings-badge-input'
              />

              {badgeUrl ? (
                <TextButton
                  label='Remove badge'
                  disabled={isSaving}
                  iconStart={<MaterialIcon icon='clear' />}
                  onClick={() => {
                    setInputValue('uploadedBadgePath', undefined)
                    setInputValue('badge', undefined)
                  }}
                />
              ) : (
                <div></div>
              )}
            </BannerButtonsContainer>

            <TextFieldContainer>
              <TextField
                {...bindInput('description')}
                label={t('chat.channelSettings.general.descriptionLabel', 'Description')}
                disabled={isSaving}
                allowErrors={false}
                floatingLabel={true}
                multiline={true}
                rows={4}
                maxRows={4}
                inputProps={{ tabIndex: 0 }}
                testName='channel-settings-description-input'
              />
              <TextField
                {...bindInput('topic')}
                label={t('chat.channelSettings.general.topicLabel', 'Topic')}
                disabled={isSaving}
                allowErrors={false}
                floatingLabel={true}
                inputProps={{ tabIndex: 0 }}
                testName='channel-settings-topic-input'
              />
            </TextFieldContainer>

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

        <StyledChannelCardRoot>
          <ChannelBannerAndBadge>
            {bannerUrl ? (
              <ChannelBanner src={bannerUrl} testName='channel-settings-banner-image' />
            ) : (
              <ChannelBannerPlaceholderImage />
            )}
            {basicChannelInfo ? (
              <ChannelCardBadge>
                <ChannelBadge
                  src={badgeUrl}
                  channelName={basicChannelInfo.name}
                  testName='channel-settings-badge-image'
                />
              </ChannelCardBadge>
            ) : null}
          </ChannelBannerAndBadge>
          <ChannelName>{basicChannelInfo.name}</ChannelName>

          <ChannelDescriptionContainer>
            <span>{getInputValue('description')}</span>
          </ChannelDescriptionContainer>

          <FlexSpacer />

          <ChannelActions>
            <div />
          </ChannelActions>
        </StyledChannelCardRoot>
      </Content>
    </Root>
  )
}
