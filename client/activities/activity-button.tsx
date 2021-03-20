import PropTypes from 'prop-types'
import React from 'react'
import styled, { css, keyframes } from 'styled-components'
import { ButtonCommon } from '../material/button'
import { blue50, colorTextFaint, colorTextPrimary, colorTextSecondary } from '../styles/colors'

const Container = styled(ButtonCommon)`
  width: 100%;
  min-height: 96px;
  padding: 8px;
  margin-top: 8px;
  position: relative;

  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;

  border-radius: 0;
  color: ${colorTextSecondary};

  ${props => {
    if (props.disabled) {
      return `color: ${colorTextFaint};`
    }

    return `
      &:hover {
        color: ${colorTextPrimary};
        background-color: rgba(255, 255, 255, 0.05);
      }

      &:active {
        background-color: rgba(255, 255, 255, 0.1);
      }
    `
  }}
`

const glowScale = keyframes`
  from {
    transform: scale(0.9);
    opacity: 1;
  }

  to {
    transform: scale(1.3);
    opacity: 0.7;
  }
`

const IconContainer = styled.div<{ glowing?: boolean }>`
  position: relative;
  width: 36px;
  height: 42px;

  svg {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  ${props => {
    if (props.glowing) {
      return css`
        svg:first-child {
          fill: ${blue50};
          filter: blur(4px);
          will-change: transform;
          animation: 2s ${glowScale} ease-out infinite alternate both;
        }
      `
    }

    return ''
  }}
`

const Label = styled.span`
  margin-top: 8px;

  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.5px;
  line-height: 18px;
  text-transform: uppercase;
`

const Count = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;

  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.5px;
  line-height: 18px;
`

export interface ActivityButtonProps {
  /** The text to show on the button. */
  label: string
  /** The icon to show in the center of the button. */
  icon: React.ReactNode
  /** Whether the button should be disabled (not accept clicks). */
  disabled?: boolean
  /**
   * Whether the button should glow (generally used to show an action in progress, like searching).
   */
  glowing?: boolean
  /**
   * A count to show on the button. If not provided, no count will be shown.
   */
  count?: number
  /**
   * An event handler to call when a click occurs.
   */
  onClick?: React.MouseEventHandler
}

const ActivityButton = React.forwardRef(
  (props: ActivityButtonProps, ref: React.ForwardedRef<HTMLButtonElement>) => {
    const { label, icon, disabled, glowing, count, onClick } = props

    return (
      <Container ref={ref} disabled={disabled} onClick={onClick}>
        {count !== undefined ? <Count>{count}</Count> : null}
        <IconContainer glowing={glowing}>
          {glowing ? icon : null}
          {icon}
        </IconContainer>
        <Label>{label}</Label>
      </Container>
    )
  },
)

ActivityButton.propTypes = {
  label: PropTypes.string.isRequired,
  icon: PropTypes.element.isRequired,
  disabled: PropTypes.bool,
  glowing: PropTypes.bool,
  count: PropTypes.number,
  onClick: PropTypes.func,
}

export default ActivityButton
