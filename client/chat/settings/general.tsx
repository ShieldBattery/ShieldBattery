import React, { useImperativeHandle, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  BasicChannelInfo,
  DetailedChannelInfo,
  EditChannelRequest,
  JoinedChannelInfo,
} from '../../../common/chat'
import { useObjectUrl } from '../../dom/use-object-url'
import { FileInputHandle, SingleFileInput } from '../../forms/file-input'
import { useForm } from '../../forms/form-hook'
import { RaisedButton, TextButton } from '../../material/button'
import { TextField } from '../../material/text-field'
import { useAppDispatch } from '../../redux-hooks'
import { openSnackbar } from '../../snackbars/action-creators'
import { useStableCallback } from '../../state-hooks'
import { FlexSpacer } from '../../styles/flex-spacer'
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
  align-items: flex-start;
  gap: 24px;
`

const FormContainer = styled.div`
  flex-grow: 1;
`

const StyledForm = styled.form`
  display: flex;
  flex-direction: column;
  gap: 24px;
`

const BannerButtonsContainer = styled.div`
  display: flex;
  gap: 20px;
`

const HiddenFileInput = styled(SingleFileInput)`
  display: none;
`

interface ChannelSettingsGeneralModel {
  description?: string
  topic?: string
  banner?: File | string
  badge?: File | string
}

export interface ChannelSettingsGeneralHandle {
  submit?: () => void
}

interface ChannelSettingsGeneralProps {
  basicChannelInfo: BasicChannelInfo
  detailedChannelInfo: DetailedChannelInfo
  joinedChannelInfo: JoinedChannelInfo
}

export const ChannelSettingsGeneral = React.forwardRef<
  ChannelSettingsGeneralHandle,
  ChannelSettingsGeneralProps
>(({ basicChannelInfo, detailedChannelInfo, joinedChannelInfo }, ref) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const bannerInputRef = useRef<FileInputHandle>(null)
  const badgeInputRef = useRef<FileInputHandle>(null)

  useImperativeHandle(ref, () => ({
    submit: onSubmit,
  }))

  const onFormSubmit = useStableCallback((model: Readonly<ChannelSettingsGeneralModel>) => {
    const patch: EditChannelRequest & { banner?: Blob; badge?: Blob } = {
      description:
        model.description !== detailedChannelInfo.description ? model.description : undefined,
      topic: model.topic !== joinedChannelInfo.topic ? model.topic : undefined,
      deleteBanner: detailedChannelInfo.bannerPath && !model.banner ? true : undefined,
      deleteBadge: detailedChannelInfo.badgePath && !model.badge ? true : undefined,
    }

    dispatch(
      updateChannel({
        channelId: basicChannelInfo.id,
        channelChanges: patch,
        channelBanner: model.banner instanceof File ? model.banner : undefined,
        channelBadge: model.badge instanceof File ? model.badge : undefined,
        spec: {
          onSuccess: () => {},
          onError: err => {
            dispatch(
              openSnackbar({
                message: t(
                  'chat.channelSettings.general.saveErrorMessage',
                  'Something went wrong saving the settings',
                ),
              }),
            )
          },
        },
      }),
    )
  })

  const { bindCustom, bindInput, getInputValue, setInputValue, onSubmit } = useForm(
    {
      description: detailedChannelInfo.description,
      topic: joinedChannelInfo.topic,
      banner: detailedChannelInfo.bannerPath,
      badge: detailedChannelInfo.badgePath,
    },
    {},
    { onSubmit: onFormSubmit },
  )

  const bannerUrl = useObjectUrl(getInputValue('banner'))
  const badgeUrl = useObjectUrl(getInputValue('badge'))

  return (
    <Root>
      <FormContainer>
        <StyledForm noValidate={true} onSubmit={onSubmit}>
          <BannerButtonsContainer>
            <HiddenFileInput
              {...bindCustom('banner')}
              ref={bannerInputRef}
              inputProps={{ accept: 'image/*', tabIndex: -1 }}
            />

            <RaisedButton
              label={bannerUrl ? 'Change banner' : 'Upload banner'}
              tabIndex={0}
              onClick={() => {
                bannerInputRef.current?.click()
              }}
            />
            {bannerUrl ? (
              <TextButton
                label='Remove banner'
                tabIndex={0}
                onClick={() => {
                  setInputValue('banner', undefined)
                  bannerInputRef.current?.clear()
                }}
              />
            ) : null}
          </BannerButtonsContainer>

          <BannerButtonsContainer>
            <HiddenFileInput
              {...bindCustom('badge')}
              ref={badgeInputRef}
              inputProps={{ accept: 'image/*', tabIndex: -1 }}
            />

            <RaisedButton
              label={badgeUrl ? 'Change badge' : 'Upload badge'}
              tabIndex={0}
              onClick={() => {
                badgeInputRef.current?.click()
              }}
            />
            {badgeUrl ? (
              <TextButton
                label='Remove badge'
                tabIndex={0}
                onClick={() => {
                  setInputValue('badge', undefined)
                  badgeInputRef.current?.clear()
                }}
              />
            ) : null}
          </BannerButtonsContainer>

          <TextField
            {...bindInput('description')}
            label={t('chat.channelSettings.general.descriptionLabel', 'Description')}
            allowErrors={false}
            floatingLabel={true}
            multiline={true}
            rows={4}
            maxRows={4}
            inputProps={{ tabIndex: 0 }}
          />
          <TextField
            {...bindInput('topic')}
            label={t('chat.channelSettings.general.topicLabel', 'Topic')}
            allowErrors={false}
            floatingLabel={true}
            inputProps={{ tabIndex: 0 }}
          />
        </StyledForm>
      </FormContainer>

      <ChannelCardRoot>
        <ChannelBannerAndBadge>
          {bannerUrl ? <ChannelBanner src={bannerUrl} /> : <ChannelBannerPlaceholderImage />}
          {basicChannelInfo ? (
            <ChannelCardBadge>
              <ChannelBadge src={badgeUrl} channelName={basicChannelInfo.name} />
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
    </Root>
  )
})
