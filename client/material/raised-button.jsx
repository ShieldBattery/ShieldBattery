import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'
import { darken } from 'polished'

import Button, { ButtonContent, Label } from './button.jsx'

import { shadowDef8dp } from './shadow-constants'
import { shadow2dp } from './shadows'
import { amberA400, blue500, blue600, blue700, CardLayer } from '../styles/colors'

const RaisedButtonContent = styled(ButtonContent).attrs(props => ({
  primary: props.color !== 'accent',
  accent: props.color === 'accent',
}))`
  ${shadow2dp};

  &:active {
    box-shadow: ${shadowDef8dp};
  }

  ${props => {
    if (props.disabled) {
      return `
        background-color: rgba(255, 255, 255, 0.12);
        box-shadow: none !important;
      `
    } else if (props.primary) {
      return `
        background-color: ${blue500};

        &:hover {
          background-color: ${blue600};
        }
        ${props.focused ? `background-color: ${blue600}` : ''};

        &:active {
          background-color: ${blue700};
        }
      `
    } else if (props.accent) {
      return `
        background-color: ${amberA400};

        & ${Label} {
          color: rgba(0, 0, 0, 0.87);
        }

        &:hover {
          background-color: ${darken(0.04, amberA400)};
        }
        ${props.focused ? `background-color: ${darken(0.04, amberA400)}` : ''};

        &:active {
          background-color: ${darken(0.08, amberA400)};
        }
      `
    }
    return ''
  }}

  ${CardLayer} && {
    ${props => (props.disabled ? 'background-color: rgba(255, 255, 255, 0.08)' : '')};
  }
`

// A button that has elevation, and raises further when pressed
const RaisedButton = React.forwardRef((props, ref) => {
  return <Button ref={ref} {...props} contentComponent={RaisedButtonContent} />
})

RaisedButton.propTypes = {
  ...Button.propTypes,
  color: PropTypes.oneOf(['primary', 'accent']),
}

export default RaisedButton
