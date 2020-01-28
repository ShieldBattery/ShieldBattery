import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import Button, { ButtonCommon, Label } from './button.jsx'
import Card from './card.jsx'

import { colorTextPrimary, colorTextFaint } from '../styles/colors'

const IconButtonContents = styled(ButtonCommon)`
  width: 48px;
  min-height: 48px;
  border-radius: 50%;
  vertical-align: middle;

  & ${Label} {
    color: ${props => (props.disabled ? colorTextFaint : colorTextPrimary)};
  }

  ${props => {
    if (props.disabled) return ''

    return `
      &:active {
        background-color: rgba(255, 255, 255, 0.16);
      }

      ${Card} &:active {
        background-color: rgba(255, 255, 255, 0.1);
      }
    `
  }}
`

// A button that displays just an SVG icon
const IconButton = React.forwardRef((props, ref) => {
  const { icon, ...otherProps } = props

  return <Button ref={ref} {...otherProps} label={icon} contentComponent={IconButtonContents} />
})

IconButton.propTypes = {
  icon: PropTypes.element.isRequired,
}

export default IconButton
