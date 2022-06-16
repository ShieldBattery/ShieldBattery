import React from 'react'
import styled from 'styled-components'
import SelectedIcon from '../../icons/material/check-24px.svg'
import { MenuItem, MenuItemProps } from './item'
import { MenuItemSymbol, MenuItemType } from './menu-item-symbol'

// 10px is (12px - 2px of built-in padding in the icon)
const StyledMenuItem = styled(MenuItem)<{ $selected?: boolean }>`
  padding-left: ${props => (props.$selected ? '10px' : '46px')};
`

export interface SelectedItemProps extends Omit<MenuItemProps, 'icon'> {
  selected?: boolean
}

export function SelectedItem({ selected, ...otherProps }: SelectedItemProps) {
  const icon = selected ? <SelectedIcon /> : undefined

  return <StyledMenuItem {...otherProps} $selected={selected} icon={icon} />
}

SelectedItem[MenuItemSymbol] = MenuItemType.Selected
