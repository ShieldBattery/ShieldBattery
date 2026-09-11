import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../../icons/material/material-icon'
import { labelMedium, labelSmall, titleSmall } from '../../styles/typography'
import { CommandArgUsage } from './command-schema'

const UsageLine = styled.div`
  ${titleSmall};
  white-space: nowrap;
`

const CommandName = styled.span`
  color: var(--theme-amber);
`

const Arg = styled.span<{ $optional: boolean }>`
  font-weight: 400;
  color: ${props =>
    props.$optional
      ? 'rgb(from var(--theme-on-surface-variant) r g b / 0.6)'
      : 'var(--theme-on-surface-variant)'};
`

export interface CommandUsageProps {
  /** The canonical name, without its leading slash. */
  name: string
  /** The arguments in order, as usage strings spell them. */
  args: ReadonlyArray<CommandArgUsage>
  className?: string
}

/**
 * How a command is typed, e.g. `/kick <user> [reason]`, with the name and each argument typeset
 * separately.
 */
export function CommandUsage({ name, args, className }: CommandUsageProps) {
  return (
    <UsageLine className={className}>
      <CommandName>/{name}</CommandName>
      {args.map((arg, i) => (
        <Arg key={i} $optional={arg.optional}>
          {` ${arg.optional ? `[${arg.label}]` : `<${arg.label}>`}`}
        </Arg>
      ))}
    </UsageLine>
  )
}

const AliasRow = styled.div`
  margin-top: 4px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
`

const AliasesLabel = styled.span`
  ${labelSmall};
  color: rgb(from var(--theme-on-surface-variant) r g b / 0.6);
  margin-right: 2px;
`

const AliasChip = styled.span`
  ${labelMedium};
  padding: 1px 6px;
  border-radius: 4px;

  background-color: var(--theme-container-high);
  color: var(--theme-on-surface-variant);
`

export interface CommandAliasesProps {
  /** The other names that reach the command, without their leading slashes. */
  aliases: ReadonlyArray<string>
  className?: string
}

/** The other names a command answers to, as chips under its usage. Renders nothing without any. */
export function CommandAliases({ aliases, className }: CommandAliasesProps) {
  const { t } = useTranslation()

  if (aliases.length === 0) {
    return null
  }

  return (
    <AliasRow className={className}>
      <AliasesLabel>{t('chat.commands.help.aliasesLabel', 'Also')}</AliasesLabel>
      {aliases.map(alias => (
        <AliasChip key={alias}>/{alias}</AliasChip>
      ))}
    </AliasRow>
  )
}

const ReasonRow = styled.div`
  ${labelSmall};
  margin-top: 4px;
  display: flex;
  align-items: center;
  gap: 4px;

  color: var(--theme-on-surface-variant);
`

export interface CommandUnavailableReasonProps {
  /** Already localized. */
  reason: string
  className?: string
}

/**
 * Why a command can't be run where it is being listed. Meant to sit at full strength inside a
 * faded row, since it is the one part of the row that says why the row looks the way it does.
 */
export function CommandUnavailableReason({ reason, className }: CommandUnavailableReasonProps) {
  return (
    <ReasonRow className={className}>
      <MaterialIcon icon='lock' size={16} />
      {reason}
    </ReasonRow>
  )
}
