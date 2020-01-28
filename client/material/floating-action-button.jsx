import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'
import { darken } from 'polished'

import Button, { ButtonCommon, Label } from './button.jsx'

import { shadow6dp } from './shadows'
import { amberA400 } from '../styles/colors'

const FloatingActionButtonContents = styled(ButtonCommon)`
  ${shadow6dp};
  width: 56px;
  height: 56px;
  background-color: ${amberA400};
  border-radius: 50%;

  & ${Label} {
    color: rgba(0, 0, 0, 0.87);
  }

  ${props => {
    if (props.disabled) return ''

    return `
      &:hover {
        background-color: ${darken(0.04, amberA400)};
      }

      &:active {
        background-color: ${darken(0.08, amberA400)}
      }
    `
  }}
`

// A floating action button that displays just an SVG icon
const FloatingActionButton = React.forwardRef((props, ref) => {
  const { icon, ...otherProps } = props

  return (
    <Button
      ref={ref}
      {...otherProps}
      label={icon}
      contentComponent={FloatingActionButtonContents}
    />
  )
})

FloatingActionButton.propTypes = {
  icon: PropTypes.element.isRequired,
}

export default FloatingActionButton
