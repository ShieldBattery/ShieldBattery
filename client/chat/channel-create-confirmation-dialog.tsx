import { useTranslation } from 'react-i18next'
import { CommonDialogProps } from '../dialogs/common-dialog-props'
import { TextButton } from '../material/button'
import { Dialog } from '../material/dialog'
import { BodyLarge } from '../styles/typography'

export interface ChannelCreateConfirmationProps extends CommonDialogProps {
  /** The name of the channel that would be created, without a leading `#`. */
  channelName: string
  /** Performs the join that creates the channel. */
  onConfirm: () => void
}

/**
 * Asks before joining a channel name the client has never seen, since joining a name that doesn't
 * exist creates the channel and hands the user everything that comes with owning one. The client
 * can't tell an unseen channel from a nonexistent one (there is no lookup by exact name), so the
 * copy hedges rather than claiming the channel doesn't exist.
 */
export function ChannelCreateConfirmation({
  onCancel,
  close,
  channelName,
  onConfirm,
}: ChannelCreateConfirmationProps) {
  const { t } = useTranslation()

  const onConfirmClick = () => {
    onConfirm()
    close()
  }

  const buttons = [
    <TextButton label={t('common.actions.cancel', 'Cancel')} key='cancel' onClick={onCancel} />,
    <TextButton
      label={t('chat.createChannelConfirmation.confirmAction', 'Create')}
      key='create'
      onClick={onConfirmClick}
    />,
  ]

  return (
    <Dialog
      title={t('chat.createChannelConfirmation.dialogTitle', {
        defaultValue: 'Create #{{channelName}}?',
        channelName,
      })}
      buttons={buttons}
      onCancel={onCancel}>
      <BodyLarge>
        {t('chat.createChannelConfirmation.body', {
          defaultValue:
            'If no channel named #{{channelName}} exists yet, joining it will create the channel and make you its owner.',
          channelName,
        })}
      </BodyLarge>
    </Dialog>
  )
}
