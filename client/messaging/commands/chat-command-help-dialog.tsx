import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CommonDialogProps } from '../../dialogs/common-dialog-props'
import { TextButton } from '../../material/button'
import { Dialog } from '../../material/dialog'
import { bodyMedium, titleSmall } from '../../styles/typography'
import { CommandAliases, CommandUsage } from './command-usage'

const Intro = styled.div`
  ${bodyMedium};
  margin-bottom: 8px;

  color: var(--theme-on-surface-variant);
`

const InlineCommand = styled.span`
  ${titleSmall};
  line-height: inherit;

  color: var(--theme-amber);
`

const CommandTable = styled.div`
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  column-gap: 24px;
`

const CommandRow = styled.div`
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  align-items: baseline;
  padding: 12px 0;
  border-bottom: 1px solid var(--theme-outline-variant);

  &:last-child {
    padding-bottom: 0;
    border-bottom: none;
  }
`

const UsageCell = styled.div`
  min-width: 0;
`

const Description = styled.div`
  min-width: 0;

  ${bodyMedium};
  color: var(--theme-on-surface);
`

export interface ChatCommandHelpDialogProps extends CommonDialogProps {
  /** Every command that can be run where the dialog was opened from, in display order. */
  commands: ReadonlyArray<{
    /** The canonical name, without its leading slash. */
    name: string
    /** Other names that reach the command, without their leading slashes. Empty when there are none. */
    aliases: ReadonlyArray<string>
    /** The arguments in order, as usage strings spell them. */
    args: ReadonlyArray<{ label: string; optional: boolean }>
    /** Already localized. */
    description: string
  }>
}

/**
 * A two-column reference sheet for the commands that can be run where the dialog was opened from:
 * each row's usage (name, arguments, and aliases) on the left and what it does on the right.
 */
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
      <Intro>
        <Trans t={t} i18nKey='chat.commands.help.intro'>
          Type a command at the start of a message to run it. To send a message that begins with a
          slash, type <InlineCommand>{'//'}</InlineCommand> instead.
        </Trans>
      </Intro>
      <CommandTable>
        {commands.map(command => (
          <CommandRow key={command.name}>
            <UsageCell>
              <CommandUsage name={command.name} args={command.args} />
              <CommandAliases aliases={command.aliases} />
            </UsageCell>
            <Description>{command.description}</Description>
          </CommandRow>
        ))}
      </CommandTable>
    </Dialog>
  )
}
