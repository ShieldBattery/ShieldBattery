import { darken } from 'polished'
import React from 'react'
import styled from 'styled-components'
import { amberA400 } from '../styles/colors'
import Button, { ButtonCommon, ButtonProps, Label } from './button'
import { shadow6dp } from './shadows'

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

export interface FloatingActionButtonProps extends Omit<ButtonProps, 'label' | 'contentComponent'> {
  icon: React.ReactNode
  title: string
}

/** A floating action button that displays just an SVG icon. */
export const FloatingActionButton = React.forwardRef<Button, FloatingActionButtonProps>(
  (props, ref) => {
    const { icon, ...otherProps } = props

    return (
      <Button
        ref={ref}
        {...otherProps}
        label={icon}
        contentComponent={FloatingActionButtonContents}
      />
    )
  },
)
