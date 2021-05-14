import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import SelectedIcon from '../../icons/material/check-24px.svg'
import MenuItem, { MenuItemProps } from './item'
import MenuItemSymbol from './menu-item-symbol'

// 10px is (12px - 2px of built-in padding in the icon)
const StyledMenuItem = styled(MenuItem)<{ $selected?: boolean }>`
  padding-left: ${props => (props.$selected ? '10px' : '46px')};
`

export interface SelectedItemProps extends MenuItemProps {
  selected?: boolean
  onItemSelected?: () => void
}

class SelectedItem extends React.Component<SelectedItemProps> {
  static propTypes = {
    ...MenuItem.propTypes,
    selected: PropTypes.bool,
    onItemSelected: PropTypes.func,
  }

  static [MenuItemSymbol] = true

  render() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { selected, onItemSelected, ...otherProps } = this.props
    const icon = selected ? <SelectedIcon /> : null

    return (
      <StyledMenuItem {...otherProps} $selected={selected} icon={icon} onClick={this.onClick} />
    )
  }

  onClick = () => {
    if (this.props.onItemSelected) {
      this.props.onItemSelected()
    }
  }
}

export default SelectedItem
