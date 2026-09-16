import { useTranslation } from 'react-i18next'
import { closeDialog } from '../dialogs/action-creators'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { DialogType } from '../dialogs/dialog-type'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { useAppDispatch } from '../redux-hooks'
import { BodyLarge } from '../styles/typography'

export interface NewsPostDeleteConfirmationProps extends CommonDialogProps {
  title: string
  /** Performs the deletion once the user confirms. */
  onConfirm: () => void
}

export function NewsPostDeleteConfirmation({
  onCancel,
  title,
  onConfirm,
}: NewsPostDeleteConfirmationProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const onConfirmClick = () => {
    dispatch(closeDialog(DialogType.NewsPostDeleteConfirmation))
    onConfirm()
  }

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
    <TextButton
      label={t('common.actions.delete', 'Delete')}
      key='confirm'
      onClick={onConfirmClick}
      testName='confirm-delete-news-post'
    />,
  ]

  return (
    <Dialog
      title={t('news.deleteDialogTitle', { defaultValue: 'Delete "{{title}}"?', title })}
      buttons={buttons}
      onCancel={onCancel}>
      <BodyLarge>
        {t(
          'news.deleteDialogBody',
          'This news post will be permanently removed. This cannot be undone.',
        )}
      </BodyLarge>
    </Dialog>
  )
}
