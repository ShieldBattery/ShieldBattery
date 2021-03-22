import PropTypes from 'prop-types'
import React from 'react'
import styled from 'styled-components'
import { CardLayer } from '../styles/colors'
import Button, { ButtonCommon } from './button'

export const IconButtonContents = styled(ButtonCommon)`
  width: 48px;
  min-height: 48px;
  border-radius: 50%;
  vertical-align: middle;

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

export interface IconButtonProps {
  icon: React.ReactNode
  title?: string
  onClick?: () => void
  buttonRef?: React.Ref<HTMLButtonElement>
}

/** A button that displays just an SVG icon. */
const IconButton = React.forwardRef((props: IconButtonProps, ref) => {
  const { icon, ...otherProps } = props

  // TODO(tec27): Remove once Button is TS-ified
  const AnyButton = Button as any
  return <AnyButton ref={ref} {...otherProps} label={icon} contentComponent={IconButtonContents} />
})

IconButton.propTypes = {
  icon: PropTypes.element.isRequired,
}

export default IconButton
