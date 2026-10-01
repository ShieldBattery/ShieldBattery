import prettyBytes from 'pretty-bytes'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MAX_IMAGE_SIZE_BYTES } from '../../../common/images'
import { useObjectUrl } from '../../dom/use-object-url'
import { FormHook, Validator } from '../../forms/form-hook'
import { maxFileSize } from '../../forms/validators'
import { MaterialIcon } from '../../icons/material/material-icon'
import { TextButton } from '../../material/button'
import { CheckBox } from '../../material/check-box'
import { SingleFileInput } from '../../material/file-input'
import { TextField } from '../../material/text-field'
import { FlexSpacer } from '../../styles/flex-spacer'
import { bodyMedium } from '../../styles/typography'
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

/** The channel settings that can be set both when creating a channel and in its settings. */
export interface ChannelSettingsModel {
  description?: string
  topic?: string
  uploadedBannerPath?: string
  uploadedBadgePath?: string
  private?: boolean
  membersCanInvite?: boolean
  banner?: File
  badge?: File
}

/**
 * The parts of a form these fields bind to. The form's model can have more fields than
 * `ChannelSettingsModel`.
 */
export type ChannelSettingsFormBindings = Pick<
  FormHook<ChannelSettingsModel>,
  'bindCheckable' | 'bindCustom' | 'bindInput' | 'getInputValue' | 'setInputValue'
>

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

const PrivacyContainer = styled.div`
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const PrivacyDescription = styled.div`
  ${bodyMedium};
  /* Lines up with the checkbox label, tucked into the checkbox's bottom padding. */
  margin-top: -4px;
  padding-left: 30px;
  color: var(--theme-on-surface-variant);
`

const StyledChannelCardRoot = styled(ChannelCardRoot)`
  flex-shrink: 0;
`

/** Validators for the banner and badge files of a form built on `ChannelSettingsModel`. */
export function useChannelImageValidators(): {
  banner: Validator<File | undefined, any>
  badge: Validator<File | undefined, any>
} {
  const { t } = useTranslation()

  return {
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
  }
}

/**
 * Returns the URLs to display the form's banner and badge from: a newly picked file if there is
 * one, otherwise the image the channel already has.
 */
export function useChannelImageUrls(form: ChannelSettingsFormBindings) {
  const bannerUrl =
    useObjectUrl(form.getInputValue('banner')) ?? form.getInputValue('uploadedBannerPath')
  const badgeUrl =
    useObjectUrl(form.getInputValue('badge')) ?? form.getInputValue('uploadedBadgePath')

  return { bannerUrl, badgeUrl }
}

/**
 * The inputs for a channel's images, description, topic and privacy, bound to a form whose model
 * includes `ChannelSettingsModel`.
 */
export function ChannelSettingsFields({
  form,
  bannerUrl,
  badgeUrl,
  disabled,
  canBePrivate,
  testNamePrefix,
}: {
  form: ChannelSettingsFormBindings
  bannerUrl: string | undefined
  badgeUrl: string | undefined
  disabled: boolean
  /** Whether the privacy settings are shown. Official channels can't be private. */
  canBePrivate: boolean
  /** Prefixes the `testName` of each input, so each form that uses these fields has its own. */
  testNamePrefix: string
}) {
  const { t } = useTranslation()
  const { bindCheckable, bindCustom, bindInput, getInputValue, setInputValue } = form

  return (
    <>
      <BannerButtonsContainer>
        <SingleFileInput
          {...bindCustom('banner')}
          label={
            bannerUrl
              ? t('chat.channelSettings.general.changeBanner', 'Change banner')
              : t('chat.channelSettings.general.uploadBanner', 'Upload banner')
          }
          allowErrors={true}
          disabled={disabled}
          inputProps={{ accept: 'image/*' }}
          testName={`${testNamePrefix}-banner-input`}
        />

        {bannerUrl ? (
          <TextButton
            label={t('chat.channelSettings.general.removeBanner', 'Remove banner')}
            disabled={disabled}
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
          label={
            badgeUrl
              ? t('chat.channelSettings.general.changeBadge', 'Change badge')
              : t('chat.channelSettings.general.uploadBadge', 'Upload badge')
          }
          allowErrors={true}
          disabled={disabled}
          inputProps={{ accept: 'image/*' }}
          testName={`${testNamePrefix}-badge-input`}
        />

        {badgeUrl ? (
          <TextButton
            label={t('chat.channelSettings.general.removeBadge', 'Remove badge')}
            disabled={disabled}
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
          disabled={disabled}
          allowErrors={false}
          floatingLabel={true}
          multiline={true}
          rows={4}
          maxRows={4}
          inputProps={{ tabIndex: 0 }}
          testName={`${testNamePrefix}-description-input`}
        />
        <TextField
          {...bindInput('topic')}
          label={t('chat.channelSettings.general.topicLabel', 'Topic')}
          disabled={disabled}
          allowErrors={false}
          floatingLabel={true}
          inputProps={{ tabIndex: 0 }}
          testName={`${testNamePrefix}-topic-input`}
        />
      </TextFieldContainer>

      {canBePrivate ? (
        <PrivacyContainer>
          <div>
            <CheckBox
              {...bindCheckable('private')}
              label={t('chat.channelSettings.general.privateLabel', 'Private channel')}
              disabled={disabled}
              inputProps={{ tabIndex: 0 }}
            />
            <PrivacyDescription>
              {t(
                'chat.channelSettings.general.privateDescription',
                'Private channels are hidden from browse and search, and can only be joined ' +
                  'through an invite link.',
              )}
            </PrivacyDescription>
          </div>
          {getInputValue('private') ? (
            <div>
              <CheckBox
                {...bindCheckable('membersCanInvite')}
                label={t(
                  'chat.channelSettings.general.membersCanInviteLabel',
                  'Members can create invite links',
                )}
                disabled={disabled}
                inputProps={{ tabIndex: 0 }}
              />
              <PrivacyDescription>
                {t(
                  'chat.channelSettings.general.membersCanInviteDescription',
                  'When this is off, only the channel owner can invite people. Turning it ' +
                    'off also disables the invite links members have already shared.',
                )}
              </PrivacyDescription>
            </div>
          ) : null}
        </PrivacyContainer>
      ) : null}
    </>
  )
}

/** A preview of how the channel's card will look with the settings being edited. */
export function ChannelCardPreview({
  name,
  bannerUrl,
  badgeUrl,
  description,
  testNamePrefix,
}: {
  name: string
  bannerUrl: string | undefined
  badgeUrl: string | undefined
  description: string | undefined
  testNamePrefix: string
}) {
  return (
    <StyledChannelCardRoot>
      <ChannelBannerAndBadge>
        {bannerUrl ? (
          <ChannelBanner src={bannerUrl} testName={`${testNamePrefix}-banner-image`} />
        ) : (
          <ChannelBannerPlaceholderImage />
        )}
        <ChannelCardBadge>
          <ChannelBadge
            src={badgeUrl}
            channelName={name}
            testName={`${testNamePrefix}-badge-image`}
          />
        </ChannelCardBadge>
      </ChannelBannerAndBadge>
      <ChannelName>{name}</ChannelName>

      <ChannelDescriptionContainer>
        <span>{description}</span>
      </ChannelDescriptionContainer>

      <FlexSpacer />

      <ChannelActions>
        <div />
      </ChannelActions>
    </StyledChannelCardRoot>
  )
}
