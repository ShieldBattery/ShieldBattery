import { CheckIcon, CheckIconContainer } from '../check-box'
import { MenuItem } from './item'
import { BaseMenuItemProps, MenuItemSymbol, MenuItemType } from './menu-item-symbol'

export interface CheckableMenuItemProps extends BaseMenuItemProps {
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
