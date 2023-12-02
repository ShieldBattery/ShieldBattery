import React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { EditChannelRequest } from '../../common/chat'
import { CHANNEL_BANNERS } from '../../common/flags'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { ChannelSettingsDialogPayload, DialogType } from '../dialogs/dialog-type'
import { useObjectUrl } from '../dom/use-object-url'
import { useForm } from '../forms/form-hook'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { SingleFileInput } from '../material/file-input'
import { TextField } from '../material/text-field'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSnackbar } from '../snackbars/action-creators'
import { useStableCallback } from '../state-hooks'
import { FlexSpacer } from '../styles/flex-spacer'
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
  width: fit-content;
  display: grid;
  grid-template-columns: auto auto;
  grid-column-gap: 16px;
  grid-row-gap: 24px;
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

  const onFormSubmit = useStableCallback((model: Readonly<ChannelSettingsModel>) => {
    const patch: EditChannelRequest = {
      description:
        model.description !== detailedChannelInfo.description ? model.description : undefined,
      topic: model.topic !== joinedChannelInfo.topic ? model.topic : undefined,
      deleteBanner: !model.uploadedBannerPath && !model.banner ? true : undefined,
      deleteBadge: !model.uploadedBadgePath && !model.badge ? true : undefined,
    }

    dispatch(
      updateChannel({
        channelId: basicChannelInfo.id,
        channelChanges: patch,
        channelBanner: model.banner,
        channelBadge: model.badge,
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
      uploadedBannerPath: detailedChannelInfo.bannerPath,
      uploadedBadgePath: detailedChannelInfo.badgePath,
    },
    {},
    { onSubmit: onFormSubmit },
  )

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
      onClick={() => {
        onSubmit()
        dispatch(closeDialog(DialogType.ChannelSettings))
      }}
    />,
  ]

  return (
    <StyledDialog dialogRef={dialogRef} title={`#${basicChannelInfo?.name}`} buttons={buttons}>
      <Root>
        <FormContainer>
          <StyledForm noValidate={true} onSubmit={onSubmit}>
            {CHANNEL_BANNERS ? (
              <BannerButtonsContainer>
                <SingleFileInput
                  {...bindCustom('banner')}
                  label={bannerUrl ? 'Change banner' : 'Upload banner'}
                  inputProps={{ accept: 'image/*' }}
                />

                {bannerUrl ? (
                  <TextButton
                    label='Remove banner'
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
                  inputProps={{ accept: 'image/*' }}
                />

                {badgeUrl ? (
                  <TextButton
                    label='Remove badge'
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
    </StyledDialog>
  )
}
