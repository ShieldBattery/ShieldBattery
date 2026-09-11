import styled from 'styled-components'
import { ChatCommand, CommandArgUsage } from './command-schema'

// Sits inside the TextField supporting-text strip, which is already `bodySmall`.
const Signature = styled.span`
  white-space: nowrap;
`

const CommandNamePart = styled.span<{ $active: boolean }>`
  color: var(--theme-amber);
  ${props => (props.$active ? 'font-weight: 500;' : '')}
`

const ArgPart = styled.span<{ $optional: boolean; $active: boolean }>`
  color: ${props => {
    if (props.$active) {
      return 'var(--theme-on-surface)'
    }
    return props.$optional
      ? 'rgb(from var(--theme-on-surface-variant) r g b / 0.6)'
      : 'var(--theme-on-surface-variant)'
  }};
  ${props => (props.$active ? 'font-weight: 500;' : '')}
`

export interface CommandSignatureHelpProps {
  command: ChatCommand
  /** The arguments to spell out, as usage does. */
  signature: ReadonlyArray<CommandArgUsage>
  /** Which part is being typed: the name, an index into `signature`, or nothing. */
  active: 'name' | number | undefined
}

/**
 * A command's usage string, e.g. `/kick <user> [reason]`, with the part the caret is currently
 * typing emphasized. Renders in the TextField's supporting-text strip while a known command has
 * something to show.
 */
export function CommandSignatureHelp({ command, signature, active }: CommandSignatureHelpProps) {
  const nameActive = active === 'name'

  return (
    <Signature>
      <CommandNamePart $active={nameActive} aria-current={nameActive ? 'true' : undefined}>
        /{command.name}
      </CommandNamePart>
      {signature.map((arg, index) => {
        const argActive = active === index
        return (
          <ArgPart
            key={index}
            $optional={arg.optional}
            $active={argActive}
            aria-current={argActive ? 'true' : undefined}>
            {` ${arg.optional ? `[${arg.label}]` : `<${arg.label}>`}`}
          </ArgPart>
        )
      })}
    </Signature>
  )
}
