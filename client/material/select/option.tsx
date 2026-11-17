import { useCallback } from 'react'
import styled from 'styled-components'
import { MenuItem } from '../menu/item'
import { MenuItemSymbol, MenuItemType } from '../menu/menu-item-symbol'

// TODO(tec270): Use CSS built-in states where possible instead of style props
const StyledMenuItem = styled(MenuItem)<{
  $selected?: boolean
}>`
  background-color: ${props => (props.$selected ? 'var(--theme-primary-container)' : 'unset')};
  color: ${props => (props.$selected ? 'var(--theme-on-primary-container)' : 'unset')};

  transition:
    background-color 150ms linear,
    color 150ms linear;
`

export interface SelectOptionProps {
  text: string
  /** An optional second line of smaller, muted text rendered below `text`. */
  secondaryText?: string
  value: unknown
  focused?: boolean
  selected?: boolean
  dense?: boolean
  onClick?: () => void
}

export function SelectOption({
  text,
  secondaryText,
  focused,
  selected,
  dense,
  onClick,
}: SelectOptionProps) {
  const onOptionClick = useCallback(() => {
    onClick?.()
  }, [onClick])

  return (
    <StyledMenuItem
      text={text}
      secondaryText={secondaryText}
      dense={dense}
      focused={focused}
      $selected={selected}
      onClick={onOptionClick}
    />
  )
}

SelectOption[MenuItemSymbol] = MenuItemType.Selectable
