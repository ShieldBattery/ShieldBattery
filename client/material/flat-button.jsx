import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import Button, { ButtonContent, Label } from './button.jsx'

import { amberA400, blue400, CardLayer } from '../styles/colors'

const FlatButtonContents = styled(ButtonContent).attrs(props => ({
  primary: props.color === 'primary',
  accent: props.color === 'accent',
}))`
  ${props => {
    if (props.disabled) return ''

    if (props.primary) {
      return `
        & ${Label} {
          color: ${blue400};
        }
      `
    } else if (props.accent) {
      return `
        & ${Label} {
          color: ${amberA400};
        }
      `
    }

    return ''
  }}

  ${props => {
    if (props.disabled) return ''

    return `
      &:active {
        background-color: rgba(255, 255, 255, 0.16);
      }

      ${CardLayer} &:active {
        background-color: rgba(255, 255, 255, 0.1);
      }
    `
  }}
`

// A button with no elevation
const FlatButton = React.forwardRef((props, ref) => {
  return <Button ref={ref} {...props} contentComponent={FlatButtonContents} />
})

FlatButton.propTypes = {
  ...Button.propTypes,
  color: PropTypes.oneOf(['primary', 'accent', 'normal']),
}

export default FlatButton
