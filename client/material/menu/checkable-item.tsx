import React from 'react'
import { CheckIcon, CheckIconContainer } from '../check-box.js'
import { MenuItem, MenuItemProps } from './item.js'
import { MenuItemSymbol, MenuItemType } from './menu-item-symbol.js'

export interface CheckableMenuItemProps extends Omit<MenuItemProps, 'icon'> {
  checked?: boolean
}

export function CheckableMenuItem({ checked, ...otherProps }: CheckableMenuItemProps) {
  return (
    <MenuItem
      {...otherProps}
      trailingContent={
        <CheckIconContainer $checked={checked}>
          <CheckIcon $checked={checked} />
        </CheckIconContainer>
      }
    />
  )
}

CheckableMenuItem[MenuItemSymbol] = MenuItemType.Checkable
