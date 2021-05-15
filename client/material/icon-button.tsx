import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import { CardLayer } from '../styles/colors'
import Button, { ButtonCommon, ButtonProps } from './button'

export const IconButtonContents = styled(ButtonCommon)`
  width: 48px;
  min-height: 48px;
  border-radius: 8px;
  vertical-align: middle;

  ${props => {
    if (props.disabled) return ''

    return `
      &:active {
        background-color: rgba(255, 255, 255, 0.16);
      }

      ${CardLayer} &:active {
        background-color: rgba(255, 255, 255, 0.12);
      }
    `
  }}
`

export interface IconButtonProps extends Omit<ButtonProps, 'label' | 'contentComponent'> {
  icon: React.ReactNode
  title?: string
  buttonRef?: React.Ref<HTMLButtonElement>
}

/** A button that displays just an SVG icon. */
const IconButton = React.forwardRef<Button, IconButtonProps>((props, ref) => {
  const { icon, ...otherProps } = props

  return <Button ref={ref} {...otherProps} label={icon} contentComponent={IconButtonContents} />
})

IconButton.propTypes = {
  icon: PropTypes.element.isRequired,
}

export default IconButton
