import { rgba } from 'polished'
import React, { useCallback } from 'react'
import { styled } from 'styled-components'
import { amberA400 } from '../../styles/colors.js'
import { MenuItem } from '../menu/item.js'
import { MenuItemSymbol, MenuItemType } from '../menu/menu-item-symbol.js'

const StyledMenuItem = styled(MenuItem)<{
  $selected?: boolean
  $focused?: boolean
}>`
  &:hover {
    background-color: ${props => {
      if (props.$selected) {
        return rgba(amberA400, 0.2)
      }
      if (props.$focused) {
        return 'rgba(255, 255, 255, 0.24)'
      }

      return 'rgba(255, 255, 255, 0.08)'
    }};
  }

  &:active {
    background-color: ${rgba(amberA400, 0.24)};
  }

  ${props => {
    if (props.$selected) {
      return `background-color: ${rgba(amberA400, 0.16)}`
    }
    if (props.$focused) {
      return 'background-color: rgba(255, 255, 255, 0.24)'
    }

    return ''
  }};
`

export interface SelectOptionProps {
  text: string
  value: unknown
  focused?: boolean
  selected?: boolean
  dense?: boolean
  onClick?: () => void
}

export function SelectOption({ text, focused, selected, dense, onClick }: SelectOptionProps) {
  const onOptionClick = useCallback(() => {
    onClick?.()
  }, [onClick])

  return (
    <StyledMenuItem
      text={text}
      dense={dense}
      $focused={focused}
      $selected={selected}
      onClick={onOptionClick}
    />
  )
}

SelectOption[MenuItemSymbol] = MenuItemType.Selectable
