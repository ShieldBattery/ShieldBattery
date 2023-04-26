import React from 'react'
import styled, { css, keyframes } from 'styled-components'
import { HotkeyedText, HotkeyProp, useButtonHotkey, useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Ripple } from '../material/ripple'
import { useMultiRef } from '../state-hooks'
import { blue50, colorTextFaint, colorTextSecondary } from '../styles/colors'

const Container = styled.button`
  ${buttonReset}

  width: 100%;
  height: 96px;
  min-height: 40px;
  padding: 8px;
  margin-top: 8px;
  position: relative;
  flex-shrink: 1;

  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;

  border-radius: 0;
  color: ${colorTextSecondary};
  --sb-ripple-color: #ffffff;

  &:disabled {
    color: ${colorTextFaint};
  }
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

  & > * {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
  }

  ${props => {
    if (props.glowing) {
      return css`
        & > *:first-child {
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
  onClick?: (event?: React.MouseEvent) => void
  /**
   * A hotkey to register for the button. Pressing the specified modifiers and key will result in
   * the button being clicked programmatically.
   */
  hotkey: HotkeyProp
}

export const ActivityButton = React.memo(
  React.forwardRef(
    (
      { label, icon, disabled, glowing, count, onClick, hotkey }: ActivityButtonProps,
      ref: React.ForwardedRef<HTMLButtonElement>,
    ) => {
      const [buttonProps, rippleRef] = useButtonState({
        disabled,
        onClick,
      })

      const [buttonRef, setButtonRef] = useMultiRef<HTMLButtonElement>(ref)
      useButtonHotkey({ ref: buttonRef, disabled, hotkey })

      return (
        <Container ref={setButtonRef} {...buttonProps}>
          {count !== undefined ? <Count>{count}</Count> : null}
          <IconContainer glowing={glowing}>
            {glowing ? icon : null}
            {icon}
          </IconContainer>
          <Label>
            <HotkeyedText hotkey={hotkey} text={label} disabled={disabled} />
          </Label>
          <Ripple ref={rippleRef} disabled={disabled} />
        </Container>
      )
    },
  ),
)
