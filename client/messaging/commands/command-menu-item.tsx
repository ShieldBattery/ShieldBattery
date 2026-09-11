import * as React from 'react'
import { useEffect, useRef } from 'react'
import styled from 'styled-components'
import { useButtonState } from '../../material/button'
import { MenuItemButton } from '../../material/menu/item'
import { MenuItemSymbol, MenuItemType } from '../../material/menu/menu-item-symbol'
import { Ripple } from '../../material/ripple'
import { bodyMedium } from '../../styles/typography'
import { ChatCommand, getCommandArgUsages } from './command-schema'
import { CommandAliases, CommandUsage } from './command-usage'

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

const UsageCell = styled.div`
  min-width: 0;
`

const Description = styled.div`
  min-width: 0;

  ${bodyMedium};
  color: var(--theme-on-surface);
`

export interface CommandMenuItemProps {
  command: ChatCommand
  /** What the command does, already localized. */
  description: string
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
 * column, what it does in the right one.
 */
export function CommandMenuItem({
  command,
  description,
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
      <UsageCell>
        <CommandUsage name={command.name} args={getCommandArgUsages(command)} />
        <CommandAliases aliases={command.aliases ?? []} />
      </UsageCell>
      <Description>{description}</Description>
      <Ripple ref={rippleRef} />
    </Row>
  )
}

CommandMenuItem[MenuItemSymbol] = MenuItemType.Default
