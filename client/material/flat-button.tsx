import PropTypes from 'prop-types'
import React, { ForwardedRef } from 'react'
import styled from 'styled-components'
import { amberA400, blue400, CardLayer } from '../styles/colors'
import Button, { ButtonContent, ButtonProps, Label } from './button'

export interface FlatButtonProps extends Omit<ButtonProps, 'contentComponent'> {
  color?: 'primary' | 'accent' | 'normal'
  disabled?: boolean
  label: string | React.ReactNode
  onBlur?: React.FocusEventHandler
  onFocus?: React.FocusEventHandler
  onClick?: React.MouseEventHandler
  onMouseDown?: React.MouseEventHandler
}

const FlatButtonContents = styled(ButtonContent).attrs<
  FlatButtonProps,
  { primary: boolean; accent: boolean }
>(props => ({
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
const FlatButton = React.forwardRef(
  (props: FlatButtonProps, ref: ForwardedRef<HTMLButtonElement>) => {
    return <Button buttonRef={ref as any} {...props} contentComponent={FlatButtonContents} />
  },
)

FlatButton.propTypes = {
  ...Button.propTypes,
  color: PropTypes.oneOf(['primary', 'accent', 'normal']),
} as any

export default FlatButton
