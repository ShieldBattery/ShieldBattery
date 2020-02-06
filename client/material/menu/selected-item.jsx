import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import MenuItem from './item.jsx'

import SelectedIcon from '../../icons/material/check-24px.svg'

const StyledMenuItem = styled(MenuItem)`
  padding-left: ${props => (props.selected ? '12px' : '52px')};
`

class SelectedItem extends React.Component {
  static propTypes = {
    ...MenuItem.propTypes,
    selected: PropTypes.bool,
    onItemSelected: PropTypes.func,
  }

  render() {
    const icon = this.props.selected ? <SelectedIcon /> : null

    return <StyledMenuItem {...this.props} icon={icon} onClick={this.onClick} />
  }

  onClick = () => {
    if (this.props.onItemSelected) {
      this.props.onItemSelected()
    }
  }
}

export default SelectedItem
