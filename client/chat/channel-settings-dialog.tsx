import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { ChatServiceErrorCode, EditChannelRequest } from '../../common/chat'
import { CHANNEL_BANNERS } from '../../common/flags'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { ChannelSettingsDialogPayload, DialogType } from '../dialogs/dialog-type'
import { useObjectUrl } from '../dom/use-object-url'
import { useForm, useFormCallbacks } from '../forms/form-hook'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { SingleFileInput } from '../material/file-input'
import { TextField } from '../material/text-field'
import { isFetchError } from '../network/fetch-errors'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { FlexSpacer } from '../styles/flex-spacer'
import { bodyLarge } from '../styles/typography'
import { updateChannel } from './action-creators'
import { ChannelBadge } from './channel-badge'
import { ChannelBanner, ChannelBannerPlaceholderImage } from './channel-banner'
import {
  ChannelActions,
  ChannelBannerAndBadge,
  ChannelCardBadge,
  ChannelCardRoot,
  ChannelDescriptionContainer,
  ChannelName,
} from './channel-info-card'

const StyledDialog = styled(Dialog)`
  max-width: 960px;
`

const Root = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
`

const Content = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 24px;
`

const FormContainer = styled.div`
  position: relative;
  flex-grow: 1;
`

const StyledForm = styled.form`
  display: flex;
  flex-direction: column;
  gap: 24px;
`

const BannerButtonsContainer = styled.div`
  width: fit-content;
  display: grid;
  grid-template-columns: auto auto;
  grid-column-gap: 16px;
  grid-row-gap: 24px;
`

const ErrorText = styled.span`
  ${bodyLarge};
  color: var(--theme-error);
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

interface ChannelSettingsModel {
  description?: string
  topic?: string
  uploadedBannerPath?: string
  uploadedBadgePath?: string
  banner?: File
  badge?: File
}

type ChannelSettingsDialogProps = CommonDialogProps &
  ReadonlyDeep<ChannelSettingsDialogPayload['initData']>

export function ChannelSettingsDialog({
  dialogRef,
  onCancel,
  channelId,
}: ChannelSettingsDialogProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const basicChannelInfo = useAppSelector(s => s.chat.idToBasicInfo.get(channelId)!)
  const detailedChannelInfo = useAppSelector(s => s.chat.idToDetailedInfo.get(channelId)!)
  const joinedChannelInfo = useAppSelector(s => s.chat.idToJoinedInfo.get(channelId)!)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<Error>()

  const { submit, bindCustom, bindInput, getInputValue, setInputValue, form } =
    useForm<ChannelSettingsModel>(
      {
        description: detailedChannelInfo.description,
        topic: joinedChannelInfo.topic,
        uploadedBannerPath: detailedChannelInfo.bannerPath,
        uploadedBadgePath: detailedChannelInfo.badgePath,
      },
      {},
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
              dispatch(closeDialog(DialogType.ChannelSettings))
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

  const buttons = [
    <TextButton
      label={t('common.actions.cancel', 'Cancel')}
      key='cancel'
      color='accent'
      onClick={() => dispatch(closeDialog(DialogType.ChannelSettings))}
    />,
    <TextButton
      label={t('common.actions.save', 'Save')}
      key='save'
      color='accent'
      disabled={isSaving}
      onClick={() => submit()}
      testName='channel-settings-save-button'
    />,
  ]

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
    <StyledDialog dialogRef={dialogRef} title={`#${basicChannelInfo?.name}`} buttons={buttons}>
      <Root>
        {errorMessage ? (
          <ErrorText data-test='channel-settings-error-message'>{errorMessage}</ErrorText>
        ) : null}

        <Content>
          <FormContainer>
            <StyledForm noValidate={true} onSubmit={submit}>
              {CHANNEL_BANNERS ? (
                <BannerButtonsContainer>
                  <SingleFileInput
                    {...bindCustom('banner')}
                    label={bannerUrl ? 'Change banner' : 'Upload banner'}
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
              ) : null}

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
            </StyledForm>

            {isSaving ? (
              <DisabledOverlay>
                <LoadingDotsArea />
              </DisabledOverlay>
            ) : null}
          </FormContainer>

          <ChannelCardRoot>
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
          </ChannelCardRoot>
        </Content>
      </Root>
    </StyledDialog>
  )
}
