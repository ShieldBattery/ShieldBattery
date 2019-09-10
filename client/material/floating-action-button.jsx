import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import Button from './button.jsx'

import { reset } from './button-reset'
import { fastOutSlowInShort } from './curves'
import { shadow6dp } from './shadows'
import { amberA400 } from '../styles/colors'

const StyledButton = styled(Button)`
  ${reset};
  ${fastOutSlowInShort};
  ${shadow6dp};
  width: 56px;
  height: 56px;
  background-color: ${amberA400};
  border-radius: 50%;

  & > span {
    color: #000;
  }

  &:hover {
    background-color: #ebb000; /* amberA400 darkened 8% */
  }

  &:active {
    background-color: #d69b00; /* amberA400 darkened 16% */
  }
`

export default class FloatingActionButton extends React.Component {
  static propTypes = {
    icon: PropTypes.element.isRequired,
  }

  render() {
    const { icon, ...otherProps } = this.props

    return <StyledButton {...otherProps} label={icon} />
  }
}
