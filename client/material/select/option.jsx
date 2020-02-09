import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'
import { rgba } from 'polished'

import MenuItem from '../menu/item.jsx'
import MenuItemSymbol from '../menu/menu-item-symbol'

import { amberA400 } from '../../styles/colors'

const StyledMenuItem = styled(MenuItem)`
  &:hover {
    background-color: ${props => {
      if (props.selected) {
        return rgba(amberA400, 0.2)
      }
      if (props.focused) {
        return 'rgba(255, 255, 255, 0.24)'
      }

      return 'rgba(255, 255, 255, 0.08)'
    }};
  }

  &:active {
    background-color: ${rgba(amberA400, 0.24)};
  }

  ${props => {
    if (props.selected) {
      return `background-color: ${rgba(amberA400, 0.16)}`
    }
    if (props.focused) {
      return 'background-color: rgba(255, 255, 255, 0.24)'
    }

    return ''
  }};
`

class Option extends React.Component {
  static propTypes = {
    text: PropTypes.string.isRequired,
    value: PropTypes.any.isRequired,
    focused: PropTypes.bool,
    selected: PropTypes.bool,
    onItemSelected: PropTypes.func,
  }

  static [MenuItemSymbol] = true

  render() {
    const { text, focused, selected } = this.props
    return (
      <StyledMenuItem onClick={this.onClick} text={text} focused={focused} selected={selected} />
    )
  }

  onClick = () => {
    if (this.props.onItemSelected) {
      this.props.onItemSelected()
    }
  }
}

export default Option
