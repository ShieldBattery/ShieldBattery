import { TFunction } from 'i18next'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { CommonDialogProps } from '../../dialogs/common-dialog-props'
import { TextButton } from '../../material/button'
import { Dialog } from '../../material/dialog'
import { bodyMedium, labelMedium, titleSmall } from '../../styles/typography'
import { CommandGroup, groupCommands } from './command-schema'
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

const CommandGroupSection = styled.div`
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
`

// Section labels: quiet and tracked out, so they read as structure and never compete with the
// amber command names below them.
const GroupHeading = styled.div`
  ${labelMedium};
  grid-column: 1 / -1;
  padding: 20px 0 4px;

  color: var(--theme-on-surface-variant);
  letter-spacing: 1.6px;
  text-transform: uppercase;

  ${CommandGroupSection}:first-child > & {
    padding-top: 8px;
  }
`

const CommandRow = styled.div`
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  align-items: baseline;
  padding: 12px 0;
  border-bottom: 1px solid var(--theme-outline-variant);

  &:last-child {
    border-bottom: none;
  }

  ${CommandGroupSection}:last-child > &:last-child {
    padding-bottom: 0;
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
    /** The heading the dialog lists the command under. */
    group: CommandGroup
  }>
}

function commandGroupLabel(group: CommandGroup, t: TFunction): string {
  switch (group) {
    case 'chat':
      return t('chat.commands.help.groups.chat', 'Chat')
    case 'people':
      return t('chat.commands.help.groups.people', 'People')
    case 'matchmaking':
      return t('chat.commands.help.groups.matchmaking', 'Matchmaking')
    case 'moderation':
      return t('chat.commands.help.groups.moderation', 'Moderation')
    case 'fun':
      return t('chat.commands.help.groups.fun', 'Fun')
    default:
      return assertUnreachable(group)
  }
}

/**
 * A two-column reference sheet for the commands that can be run where the dialog was opened from,
 * filed under group headings: each row's usage (name, arguments, and aliases) on the left and what
 * it does on the right.
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
        {groupCommands(commands).map(({ group, commands }) => (
          <CommandGroupSection key={group}>
            <GroupHeading>{commandGroupLabel(group, t)}</GroupHeading>
            {commands.map(command => (
              <CommandRow key={command.name}>
                <UsageCell>
                  <CommandUsage name={command.name} args={command.args} />
                  <CommandAliases aliases={command.aliases} />
                </UsageCell>
                <Description>{command.description}</Description>
              </CommandRow>
            ))}
          </CommandGroupSection>
        ))}
      </CommandTable>
    </Dialog>
  )
}
