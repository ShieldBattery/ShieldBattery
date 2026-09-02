import { ChangeEvent, useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getErrorStack } from '../../common/errors'
import { MAX_IMAGE_SIZE_BYTES } from '../../common/images'
import { NewsImageUploadResponse } from '../../common/news'
import { apiUrl } from '../../common/urls'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { useForm, useFormCallbacks, ValidatorMap } from '../forms/form-hook'
import { longTimestamp } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { OutlinedButton, TextButton } from '../material/button'
import { DateTimeTextField } from '../material/datetime-text-field'
import { Dialog } from '../material/dialog'
import { RadioButton, RadioGroup } from '../material/radio'
import { TextField } from '../material/text-field'
import { fetchJson } from '../network/fetch'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodyLarge, bodyMedium, labelMedium } from '../styles/typography'

export const PUBLISH_MODE_DRAFT = 'draft'
export const PUBLISH_MODE_NOW = 'now'
export const PUBLISH_MODE_SCHEDULE = 'schedule'
export const PUBLISH_MODE_PUBLISHED = 'published'
export type PublishMode =
  | typeof PUBLISH_MODE_DRAFT
  | typeof PUBLISH_MODE_NOW
  | typeof PUBLISH_MODE_SCHEDULE
  | typeof PUBLISH_MODE_PUBLISHED

export type PostStatus =
  { kind: 'draft' } | { kind: 'scheduled'; date: Date } | { kind: 'published'; date: Date }

/** The subset of a news post's editable fields that live in the post settings dialog. */
export interface NewsPostSettings {
  summary: string
  publishMode: PublishMode
  scheduledAt: string
  coverImagePath: string | null
  coverImageUrl: string | null
}

interface PostSettingsFormModel {
  summary: string
  publishMode: PublishMode
  scheduledAt: string
}

const ErrorText = styled.div`
  ${bodyLarge};
  color: var(--theme-error);
`

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const SummaryField = styled(TextField)`
  width: 100%;
`

const CoverSection = styled.div`
  ${containerStyles(ContainerLevel.Low)};

  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 12px;

  border-radius: 4px;
`

const CoverLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const CoverPreview = styled.div`
  width: 100%;
  max-width: 480px;
  aspect-ratio: 2 / 1;

  display: flex;
  align-items: center;
  justify-content: center;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 4px;
  overflow: hidden;
`

const CoverImage = styled.img`
  width: 100%;
  height: 100%;
  object-fit: cover;
`

const CoverPlaceholder = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const CoverActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const CoverHint = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const HiddenFileInput = styled.input`
  display: none;
`

const PublishControl = styled.div`
  ${containerStyles(ContainerLevel.Low)};

  padding: 16px;

  display: flex;
  flex-direction: column;
  gap: 12px;

  border-radius: 4px;
`

const ScheduleField = styled(DateTimeTextField)`
  max-width: 320px;
`

const ScheduleHint = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

export interface NewsPostSettingsDialogProps extends CommonDialogProps {
  /** The post's status as of when the editor was opened, fixed for the dialog's lifetime. */
  savedStatus: PostStatus
  settings: NewsPostSettings
  /**
   * Shows validation errors for the summary and schedule fields as soon as the dialog opens,
   * instead of waiting for them to be edited or the dialog submitted. Set when the dialog was
   * opened because a save attempt outside the dialog already failed validation on one of them.
   */
  showErrorsOnOpen?: boolean
  /** Called with the edited settings once the dialog is submitted. */
  onApply: (settings: NewsPostSettings) => void
}

export function NewsPostSettingsDialog({
  savedStatus,
  settings,
  showErrorsOnOpen = false,
  onApply,
  onCancel,
  close,
}: NewsPostSettingsDialogProps) {
  const { t } = useTranslation()

  const coverFileInputRef = useRef<HTMLInputElement>(null)
  const [coverImagePath, setCoverImagePath] = useState<string | null>(settings.coverImagePath)
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(settings.coverImageUrl)
  const [coverUploading, setCoverUploading] = useState(false)
  const [coverError, setCoverError] = useState<string | undefined>(undefined)

  const onCoverFileSelected = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset the input so selecting the same file again still fires a change event.
    event.target.value = ''
    if (!file) {
      return
    }
    if (!file.type.startsWith('image/')) {
      setCoverError(t('admin.news.form.coverInvalidType', 'Please choose an image file.'))
      return
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setCoverError(t('admin.news.form.coverTooLarge', 'That image is too large (max 5 MB).'))
      return
    }

    setCoverError(undefined)
    setCoverUploading(true)
    const formData = new FormData()
    formData.append('image', file)
    fetchJson<NewsImageUploadResponse>(apiUrl`news/images`, {
      method: 'POST',
      body: formData,
    })
      .then(result => {
        setCoverUploading(false)
        setCoverImagePath(result.path)
        setCoverImageUrl(result.url)
      })
      .catch(err => {
        setCoverUploading(false)
        setCoverError(
          t('admin.news.form.coverUploadError', 'Something went wrong uploading the cover image.'),
        )
        logger.error(`Error uploading news cover image: ${getErrorStack(err)}`)
      })
  }

  const onRemoveCover = () => {
    setCoverError(undefined)
    setCoverImagePath(null)
    setCoverImageUrl(null)
  }

  const defaults: PostSettingsFormModel = {
    summary: settings.summary,
    publishMode: settings.publishMode,
    scheduledAt: settings.scheduledAt,
  }

  const validations: ValidatorMap<PostSettingsFormModel> = {
    // Whitespace-only summaries must fail here: the editor's save flow treats them as missing and
    // opens this dialog, so accepting them would let Done close the dialog with no visible error
    // only for save to immediately reopen it.
    summary: value =>
      value.trim() ? undefined : t('admin.news.form.summaryRequired', 'Summary is required'),
    scheduledAt: (value, model) => {
      if (model.publishMode !== PUBLISH_MODE_SCHEDULE) {
        return undefined
      }
      if (!value || Number.isNaN(new Date(value).getTime())) {
        return t('admin.news.form.scheduleRequired', 'Choose a valid date and time')
      }
      return undefined
    },
  }

  const { submit, bindInput, form, getInputValue, setInputValue } = useForm<PostSettingsFormModel>(
    defaults,
    validations,
  )

  useFormCallbacks(form, {
    onSubmit: model => {
      onApply({ ...model, coverImagePath, coverImageUrl })
      close()
    },
  })

  // Neither field has been touched when the dialog opens, so their validators haven't run and no
  // error is visible even when the dialog was opened specifically because one of them is invalid.
  // Marking them dirty (with their current, unchanged value) triggers that validation without
  // submitting the form.
  const showInitialErrors = useEffectEvent(() => {
    if (showErrorsOnOpen) {
      setInputValue('summary', defaults.summary)
      setInputValue('scheduledAt', defaults.scheduledAt)
    }
  })
  useEffect(() => {
    showInitialErrors()
  }, [])

  const currentPublishMode = getInputValue('publishMode')

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
    <TextButton
      label={t('common.actions.done', 'Done')}
      key='done'
      onClick={() => submit()}
      disabled={coverUploading}
    />,
  ]

  return (
    <Dialog
      title={t('admin.news.settings.title', 'Post settings')}
      buttons={buttons}
      onCancel={onCancel}>
      <Form noValidate={true} onSubmit={submit}>
        <SummaryField
          {...bindInput('summary')}
          label={t('admin.news.form.summary', 'Summary')}
          multiline={true}
          rows={2}
          maxRows={4}
        />
        <CoverSection>
          <CoverLabel>{t('admin.news.form.cover', 'Cover image')}</CoverLabel>
          <CoverPreview>
            {coverImageUrl ? (
              <CoverImage src={coverImageUrl} alt='' draggable={false} />
            ) : (
              <CoverPlaceholder>
                {t('admin.news.form.coverNone', 'No cover image (a stock image will be used)')}
              </CoverPlaceholder>
            )}
          </CoverPreview>
          <HiddenFileInput
            ref={coverFileInputRef}
            type='file'
            accept='image/*'
            onChange={onCoverFileSelected}
            data-testid='news-cover-file-input'
          />
          <CoverActions>
            <OutlinedButton
              label={
                coverImageUrl
                  ? t('admin.news.form.coverChange', 'Change cover')
                  : t('admin.news.form.coverUpload', 'Upload cover')
              }
              iconStart={<MaterialIcon icon='image' />}
              onClick={() => coverFileInputRef.current?.click()}
              disabled={coverUploading}
            />
            {coverImageUrl ? (
              <TextButton
                label={t('admin.news.form.coverRemove', 'Remove cover')}
                onClick={onRemoveCover}
                disabled={coverUploading}
              />
            ) : null}
          </CoverActions>
          {coverUploading ? (
            <CoverHint>{t('admin.news.form.coverUploading', 'Uploading…')}</CoverHint>
          ) : null}
          {coverError ? <ErrorText>{coverError}</ErrorText> : null}
        </CoverSection>
        <PublishControl>
          <RadioGroup
            {...bindInput('publishMode')}
            label={t('admin.news.form.publish', 'Publish')}
            dense={true}>
            {savedStatus.kind === 'published' ? (
              <RadioButton
                value={PUBLISH_MODE_PUBLISHED}
                label={t('admin.news.form.publishPublished', 'Published ({{date}})', {
                  date: longTimestamp.format(savedStatus.date),
                })}
              />
            ) : null}
            <RadioButton
              value={PUBLISH_MODE_DRAFT}
              label={t('admin.news.form.publishDraft', 'Draft (not published)')}
            />
            <RadioButton
              value={PUBLISH_MODE_NOW}
              label={t('admin.news.form.publishNow', 'Publish now')}
            />
            <RadioButton
              value={PUBLISH_MODE_SCHEDULE}
              label={t('admin.news.form.publishSchedule', 'Schedule')}
            />
          </RadioGroup>
          {currentPublishMode === PUBLISH_MODE_SCHEDULE ? (
            <>
              <ScheduleField
                {...bindInput('scheduledAt')}
                label={t('admin.news.form.scheduleDate', 'Publish date and time')}
                floatingLabel={true}
              />
              <ScheduleHint>
                {t(
                  'admin.news.form.scheduleHint',
                  'A future date/time schedules the post; a past date/time publishes it immediately.',
                )}
              </ScheduleHint>
            </>
          ) : null}
        </PublishControl>
      </Form>
    </Dialog>
  )
}
