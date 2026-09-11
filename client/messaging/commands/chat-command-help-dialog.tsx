import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { CommonDialogProps } from '../../dialogs/common-dialog-props'
import { TextButton } from '../../material/button'
import { Dialog } from '../../material/dialog'
import { bodyMedium, titleSmall } from '../../styles/typography'
import { CommandAliases, CommandUnavailableReason, CommandUsage } from './command-usage'

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

const UsageCell = styled.div<{ $unavailable: boolean }>`
  min-width: 0;
  opacity: ${props => (props.$unavailable ? 0.5 : 1)};
`

const DescriptionCell = styled.div`
  min-width: 0;
`

const Description = styled.div<{ $unavailable: boolean }>`
  ${bodyMedium};
  color: var(--theme-on-surface);
  opacity: ${props => (props.$unavailable ? 0.5 : 1)};
`

export interface ChatCommandHelpDialogProps extends CommonDialogProps {
  /** Every command that exists where the dialog was opened from, in display order. */
  commands: ReadonlyArray<{
    /** The canonical name, without its leading slash. */
    name: string
    /** Other names that reach the command, without their leading slashes. Empty when there are none. */
    aliases: ReadonlyArray<string>
    /** The arguments in order, as usage strings spell them. */
    args: ReadonlyArray<{ label: string; optional: boolean }>
    /** Already localized. */
    description: string
    /** Why the command can't be run where the dialog was opened from. Absent when it can. */
    unavailableReason?: string
  }>
}

/**
 * A two-column reference sheet for the commands that exist where the dialog was opened from: each
 * row's usage (name, arguments, and aliases) on the left and what it does on the right. A command
 * that can't be run from there is faded, with the reason under its description.
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
        {commands.map(command => {
          const unavailable = command.unavailableReason !== undefined

          return (
            <CommandRow key={command.name}>
              <UsageCell $unavailable={unavailable}>
                <CommandUsage name={command.name} args={command.args} />
                <CommandAliases aliases={command.aliases} />
              </UsageCell>
              <DescriptionCell>
                <Description $unavailable={unavailable}>{command.description}</Description>
                {command.unavailableReason !== undefined ? (
                  <CommandUnavailableReason reason={command.unavailableReason} />
                ) : null}
              </DescriptionCell>
            </CommandRow>
          )
        })}
      </CommandTable>
    </Dialog>
  )
}
