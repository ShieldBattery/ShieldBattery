import styled from 'styled-components'
import { MaterialIcon } from '../../icons/material/material-icon'
import { MenuItem } from './item'
import { BaseMenuItemProps, MenuItemSymbol, MenuItemType } from './menu-item-symbol'

// 10px is (12px - 2px of built-in padding in the icon)
const StyledMenuItem = styled(MenuItem)<{ $selected?: boolean }>`
  padding-left: ${props => (props.$selected ? '10px' : '46px')};
`

export interface SelectableMenuItemProps extends BaseMenuItemProps {
  selected?: boolean
}

export function SelectableMenuItem({ selected, ...otherProps }: SelectableMenuItemProps) {
  const icon = selected ? <MaterialIcon icon='check' /> : undefined

  return <StyledMenuItem {...otherProps} $selected={selected} icon={icon} />
}

SelectableMenuItem[MenuItemSymbol] = MenuItemType.Selectable
