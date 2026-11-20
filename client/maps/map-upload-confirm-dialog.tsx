import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { bodyMedium } from '../styles/typography'

const StyledDialog = styled(Dialog)`
  max-width: 480px;
`

const BodyText = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface);
`

export interface MapUploadConfirmDialogProps extends CommonDialogProps {
  /** How many map files are about to be uploaded. */
  count: number
  /** Starts uploading the files once the user confirms. */
  onConfirm: () => void
}

/** Confirms uploading a large batch of map files. */
export function MapUploadConfirmDialog({
  count,
  onConfirm,
  onCancel,
  close,
}: MapUploadConfirmDialogProps) {
  const { t } = useTranslation()

  const buttons = [
    <TextButton key='cancel' label={t('common.actions.cancel', 'Cancel')} onClick={onCancel} />,
    <TextButton
      key='confirm'
      label={t('maps.catalog.uploadConfirm', 'Upload')}
      onClick={() => {
        close()
        onConfirm()
      }}
    />,
  ]

  return (
    <StyledDialog
      title={t('maps.catalog.uploadConfirmTitle', {
        defaultValue: 'Upload {{count}} maps?',
        count,
      })}
      buttons={buttons}
      onCancel={onCancel}>
      <BodyText>
        {t(
          'maps.catalog.uploadConfirmText',
          "They'll upload one at a time and land in your maps as private.",
        )}
      </BodyText>
    </StyledDialog>
  )
}
