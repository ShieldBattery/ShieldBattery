import React from 'react'
import styled from 'styled-components'
import { amberA400, colorTextFaint } from '../styles/colors'
import { useButtonState } from './button'
import { buttonReset } from './button-reset'
import { fastOutSlowInShort } from './curves'
import { Ripple } from './ripple'
import { shadowDef12dp, shadowDef8dp } from './shadow-constants'
import { shadow6dp } from './shadows'

const Root = styled.button`
  ${buttonReset};
  ${shadow6dp};
  ${fastOutSlowInShort};

  width: 56px;
  height: 56px;
  display: inline-flex;
  align-items: center;
  justify-content: center;

  background-color: ${amberA400};
  border-radius: 50%;
  color: rgba(0, 0, 0, 0.87);
  contain: content;
  --sb-ripple-color: #000000;

  &:hover,
  &:focus {
    box-shadow: ${shadowDef8dp};
  }

  &:active {
    box-shadow: ${shadowDef12dp};
  }

  &:disabled {
    background-color: ${colorTextFaint};
    box-shadow: none;
    color: rgba(0, 0, 0, 0.54);
  }
`

export interface FloatingActionButtonProps {
  icon: React.ReactNode
  title: string
  className?: string
  disabled?: boolean
  onBlur?: React.FocusEventHandler
  onFocus?: React.FocusEventHandler
  onClick?: React.MouseEventHandler
  onMouseDown?: React.MouseEventHandler
  tabIndex?: number
}

/**
 * A circular button with an icon, meant to be used for the most primary action on a particular
 * screen.
 */
export const FloatingActionButton = React.forwardRef(
  (
    {
      icon,
      title,
      className,
      disabled,
      onBlur,
      onFocus,
      onClick,
      onMouseDown,
      tabIndex,
    }: FloatingActionButtonProps,
    ref: React.ForwardedRef<HTMLButtonElement>,
  ) => {
    const [buttonProps, rippleRef] = useButtonState({
      ref,
      disabled,
      onBlur,
      onFocus,
      onClick,
      onMouseDown,
    })

    return (
      <Root className={className} tabIndex={tabIndex} title={title} {...buttonProps}>
        {icon}
        <Ripple ref={rippleRef} disabled={disabled} />
      </Root>
    )
  },
)
