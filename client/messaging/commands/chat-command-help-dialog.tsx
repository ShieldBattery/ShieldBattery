import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CommonDialogProps } from '../../dialogs/common-dialog-props'
import { TextButton } from '../../material/button'
import { Dialog } from '../../material/dialog'
import { bodyMedium, titleSmall } from '../../styles/typography'

const CommandList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const CommandUsage = styled.div`
  ${titleSmall};
`

const CommandDescription = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

export interface ChatCommandHelpDialogProps extends CommonDialogProps {
  /** Every command available where the dialog was opened from, in display order. */
  commands: ReadonlyArray<{ usage: string; description: string }>
}

/** Lists the commands that can be run where the dialog was opened from, with what each one does. */
export function ChatCommandHelpDialog({ onCancel, close, commands }: ChatCommandHelpDialogProps) {
  const { t } = useTranslation()

  const buttons = [
    <TextButton label={t('common.actions.close', 'Close')} key='close' onClick={close} />,
  ]

  return (
    <Dialog
      title={t('chat.commands.help.dialogTitle', 'Chat commands')}
      buttons={buttons}
      onCancel={onCancel}>
      <CommandList>
        {commands.map(command => (
          <div key={command.usage}>
            <CommandUsage>{command.usage}</CommandUsage>
            <CommandDescription>{command.description}</CommandDescription>
          </div>
        ))}
      </CommandList>
    </Dialog>
  )
}
