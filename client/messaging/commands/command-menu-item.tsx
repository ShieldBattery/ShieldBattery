import * as React from 'react'
import { useEffect, useRef } from 'react'
import styled from 'styled-components'
import { useButtonState } from '../../material/button'
import { MenuItemButton } from '../../material/menu/item'
import { MenuItemSymbol, MenuItemType } from '../../material/menu/menu-item-symbol'
import { Ripple } from '../../material/ripple'
import { bodyMedium } from '../../styles/typography'
import { ChatCommand, getCommandArgUsages } from './command-schema'
import { CommandAliases, CommandUnavailableReason, CommandUsage } from './command-usage'

// The columns come from the list this sits in, so every row's usage and description line up.
const Row = styled(MenuItemButton)`
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: subgrid;
  align-items: baseline;
  column-gap: 24px;

  height: auto;
  padding: 6px 8px;
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

export interface CommandMenuItemProps {
  command: ChatCommand
  /** What the command does, already localized. */
  description: string
  /** Why the command can't be run where it was typed. Absent when it can. */
  unavailableReason?: string
  className?: string
  focused?: boolean
  dense?: boolean
  /**
   * If true, the focused state only affects visual styling without moving actual DOM focus, so
   * that the input the command is being typed into keeps it.
   */
  virtualFocus?: boolean
  onClick?: (event: React.MouseEvent | KeyboardEvent) => void
  /** Set by MenuList when it is rendered as a listbox. */
  id?: string
  /** Set by MenuList when it is rendered as a listbox. */
  role?: React.AriaRole
  /** Set by MenuList when it is rendered as a listbox. */
  'aria-selected'?: boolean
}

/**
 * A menu row listing one command the way the help sheet does: its usage and aliases in the left
 * column, what it does in the right one, and for a command that can't be run where it was typed, a
 * faded row with the reason at full strength under its description.
 */
export function CommandMenuItem({
  command,
  description,
  unavailableReason,
  className,
  focused,
  dense,
  virtualFocus,
  onClick,
  id,
  role,
  'aria-selected': ariaSelected,
}: CommandMenuItemProps) {
  const [buttonProps, rippleRef] = useButtonState({ onClick })
  const buttonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!virtualFocus) {
      if (focused) {
        buttonRef.current?.focus()
      } else {
        buttonRef.current?.blur()
      }
    }
  }, [focused, virtualFocus])

  const unavailable = unavailableReason !== undefined

  return (
    <Row
      ref={buttonRef}
      id={id}
      role={role}
      aria-selected={ariaSelected}
      className={className}
      {...buttonProps}
      $dense={dense}
      $focused={focused && virtualFocus}>
      <UsageCell $unavailable={unavailable}>
        <CommandUsage name={command.name} args={getCommandArgUsages(command)} />
        <CommandAliases aliases={command.aliases ?? []} />
      </UsageCell>
      <DescriptionCell>
        <Description $unavailable={unavailable}>{description}</Description>
        {unavailableReason !== undefined ? (
          <CommandUnavailableReason reason={unavailableReason} />
        ) : null}
      </DescriptionCell>
      <Ripple ref={rippleRef} />
    </Row>
  )
}

CommandMenuItem[MenuItemSymbol] = MenuItemType.Default
