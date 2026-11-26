import styled from 'styled-components'
import { CheckIcon, CheckIconContainer } from '../check-box'
import { MenuItem } from './item'
import { BaseMenuItemProps, MenuItemSymbol, MenuItemType } from './menu-item-symbol'

// A menu is as wide as its widest item, and that item's text gets no slack of its own, so the box
// needs its own separation from the text.
const TrailingCheckIconContainer = styled(CheckIconContainer)`
  margin-left: 12px;
`

export interface CheckableMenuItemProps extends BaseMenuItemProps {
  checked?: boolean
}

export function CheckableMenuItem({ checked, ...otherProps }: CheckableMenuItemProps) {
  return (
    <MenuItem
      {...otherProps}
      trailingContent={
        <TrailingCheckIconContainer $checked={checked}>
          <CheckIcon $checked={checked} />
        </TrailingCheckIconContainer>
      }
    />
  )
}

CheckableMenuItem[MenuItemSymbol] = MenuItemType.Checkable
